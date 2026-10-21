import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import type { Entry, Exercise, Routine, RoutineSlot, Session, WorkSet } from '../db/types';
import { closeStaleSessions, finishSession, lastTimeFor, mergeExercises, startSession } from './data';

const T = 1_700_000_000_000;
const ex = (id: string, name: string, unit: 'kg' | 'lb' = 'kg'): Exercise => ({ id, name, unit, load: 'normal', notes: '', archived: 0, createdAt: T, updatedAt: T, deleted: 0 });
const session = (id: string, date: string): Session => ({ id, date, routineId: null, title: 'x', notes: '', startedAt: T, finishedAt: T, source: 'notas', updatedAt: T, deleted: 0 });
const entry = (id: string, sessionId: string, exerciseId: string, note = ''): Entry => ({
  id,
  sessionId,
  exerciseId,
  slotId: null,
  order: 0,
  note,
  raw: '',
  review: 0,
  reviewReason: '',
  updatedAt: T,
  deleted: 0,
});
const set = (id: string, e: Entry, date: string, order: number, weight: number, reps: number, done: 0 | 1 = 1): WorkSet => ({
  id,
  entryId: e.id,
  sessionId: e.sessionId,
  exerciseId: e.exerciseId,
  date,
  order,
  weight,
  unit: 'kg',
  load: 'normal',
  reps,
  weight2: null,
  reps2: null,
  seconds: null,
  done,
  doubtful: 0,
  updatedAt: T,
  deleted: 0,
});

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  const bench = ex('ex-banca', 'Press de banca');
  const conv = ex('ex-conv', 'Converging Chest Press');
  await db.exercises.bulkPut([bench, conv]);
  await db.sessions.bulkPut([session('s1', '2026-09-23'), session('s2', '2026-10-12'), session('s3', '2026-10-15')]);
  const e1 = entry('e1', 's1', 'ex-banca');
  const e2 = entry('e2', 's2', 'ex-conv', 'Unilateral');
  const e3 = entry('e3', 's3', 'ex-conv');
  await db.entries.bulkPut([e1, e2, e3]);
  await db.sets.bulkPut([
    set('a', e1, '2026-09-23', 0, 25, 6),
    set('b', e2, '2026-10-12', 1, 39, 10),
    set('c', e2, '2026-10-12', 0, 32, 12),
    set('d', e3, '2026-10-15', 0, 45, 7),
    set('x', e3, '2026-10-15', 1, 50, 1, 0), // sin palomear: no cuenta
  ]);
});

describe('lastTimeFor', () => {
  it('trae la sesión más reciente antes de la fecha, en orden y con la nota del día', async () => {
    const last = await lastTimeFor('ex-conv', '2026-10-14');
    expect(last?.date).toBe('2026-10-12');
    expect(last?.sets.map((s) => s.weight)).toEqual([32, 39]);
    expect(last?.note).toBe('Unilateral');
  });
  it('ignora la sesión actual y las series sin palomear', async () => {
    const last = await lastTimeFor('ex-conv', '2026-10-15', 's3');
    expect(last?.date).toBe('2026-10-12');
    const sameDay = await lastTimeFor('ex-conv', '2026-10-20');
    expect(sameDay?.sets.map((s) => s.weight)).toEqual([45]);
  });
});

describe('startSession', () => {
  it('elige la variante que hiciste más recientemente y omite los lugares "NO"', async () => {
    const routine: Routine = { id: 'rt', name: 'Pecho', weekdays: [1], order: 0, updatedAt: T, deleted: 0 };
    const slots: RoutineSlot[] = [
      { id: 'sl1', routineId: 'rt', order: 0, exerciseIds: ['ex-banca', 'ex-conv'], kind: 'normal', updatedAt: T, deleted: 0 },
      { id: 'sl2', routineId: 'rt', order: 1, exerciseIds: ['ex-banca'], kind: 'no', updatedAt: T, deleted: 0 },
    ];
    await db.routines.put(routine);
    await db.slots.bulkPut(slots);
    const id = await startSession(routine, '2026-10-20');
    const entries = await db.entries.where('sessionId').equals(id).toArray();
    expect(entries.map((e) => e.exerciseId)).toEqual(['ex-conv']);
    expect(entries[0].dirty).toBe(1);
  });
});

describe('finishSession', () => {
  it('borra (lógicamente) las series sin palomear', async () => {
    const s3 = (await db.sessions.get('s3'))!;
    await finishSession({ ...s3, finishedAt: null });
    expect((await db.sets.get('x'))?.deleted).toBe(1);
    expect((await db.sets.get('d'))?.deleted).toBe(0);
  });
});

describe('closeStaleSessions', () => {
  it('borra los vacíos de días pasados, termina los que tienen series y respeta el de hoy', async () => {
    const now = new Date(2026, 9, 21, 8, 0).getTime();
    const open = (id: string, date: string, startedAt: number): Session => ({ ...session(id, date), source: 'app', finishedAt: null, startedAt });
    await db.sessions.bulkPut([open('vacio', '2026-10-20', now - 20 * 3_600_000), open('conSeries', '2026-10-19', now - 40 * 3_600_000), open('hoy', '2026-10-21', now - 600_000)]);
    const e = entry('ev', 'conSeries', 'ex-banca');
    await db.entries.put(e);
    await db.sets.bulkPut([set('ok', e, '2026-10-19', 0, 25, 6), set('pend', e, '2026-10-19', 1, 25, 6, 0)]);

    expect(await closeStaleSessions('2026-10-21', now)).toBe(2);
    expect((await db.sessions.get('vacio'))?.deleted).toBe(1);
    expect((await db.sessions.get('conSeries'))?.finishedAt).toBeTruthy();
    expect((await db.sets.get('pend'))?.deleted).toBe(1);
    expect((await db.sets.get('ok'))?.deleted).toBe(0);
    expect((await db.sessions.get('hoy'))?.finishedAt).toBeNull();
  });

  it('respeta uno empezado ayer hace menos de 6 h (entrenar pasada la medianoche)', async () => {
    const now = new Date(2026, 9, 21, 0, 30).getTime();
    await db.sessions.put({ ...session('noche', '2026-10-20'), source: 'app', finishedAt: null, startedAt: now - 3_600_000 });
    expect(await closeStaleSessions('2026-10-21', now)).toBe(0);
  });
});

describe('mergeExercises', () => {
  it('pasa todo el historial al ejercicio destino', async () => {
    const [bench, conv] = await db.exercises.bulkGet(['ex-banca', 'ex-conv']);
    await mergeExercises(bench!, conv!);
    expect((await db.sets.get('a'))?.exerciseId).toBe('ex-conv');
    expect((await db.entries.get('e1'))?.exerciseId).toBe('ex-conv');
    expect((await db.exercises.get('ex-banca'))?.deleted).toBe(1);
  });
});
