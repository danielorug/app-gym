import Dexie from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, newId, remove, save } from '../db/db';
import type { Entry, Exercise, LoadMode, Routine, RoutineSlot, Session, Unit, WorkSet } from '../db/types';
import { todayISO } from './dates';
import { bestSet } from './format';

const alive = <T extends { deleted: 0 | 1 }>(r: T | undefined): r is T => !!r && r.deleted !== 1;

// ───────────────────────── Consultas ─────────────────────────

export function useRoutines(): Routine[] | undefined {
  return useLiveQuery(async () => (await db.routines.toArray()).filter(alive).sort((a, b) => a.order - b.order), []);
}

export function useRoutine(id: string | null | undefined): Routine | undefined {
  return useLiveQuery(async () => (id ? db.routines.get(id).then((r) => (alive(r) ? r : undefined)) : undefined), [id]);
}

export function useSlots(routineId: string | null | undefined): RoutineSlot[] | undefined {
  return useLiveQuery(
    async () => (routineId ? (await db.slots.where('routineId').equals(routineId).toArray()).filter(alive).sort((a, b) => a.order - b.order) : []),
    [routineId],
  );
}

export function useExercises(): Map<string, Exercise> | undefined {
  return useLiveQuery(async () => new Map((await db.exercises.toArray()).filter(alive).map((e) => [e.id, e])), []);
}

export function useExercise(id: string | undefined): Exercise | undefined {
  return useLiveQuery(async () => (id ? db.exercises.get(id).then((e) => (alive(e) ? e : undefined)) : undefined), [id]);
}

export function useSession(id: string | undefined): Session | null | undefined {
  return useLiveQuery(async () => (id ? db.sessions.get(id).then((s) => (alive(s) ? s : null)) : null), [id]);
}

export function useEntries(sessionId: string | undefined): Entry[] | undefined {
  return useLiveQuery(
    async () => (sessionId ? (await db.entries.where('sessionId').equals(sessionId).toArray()).filter(alive).sort((a, b) => a.order - b.order) : []),
    [sessionId],
  );
}

export function useSessionSets(sessionId: string | undefined): Map<string, WorkSet[]> | undefined {
  return useLiveQuery(async () => {
    const map = new Map<string, WorkSet[]>();
    if (!sessionId) return map;
    const sets = (await db.sets.where('sessionId').equals(sessionId).toArray()).filter(alive).sort((a, b) => a.order - b.order);
    for (const s of sets) {
      const list = map.get(s.entryId) ?? [];
      list.push(s);
      map.set(s.entryId, list);
    }
    return map;
  }, [sessionId]);
}

export interface PastPerformance {
  date: string;
  sessionId: string;
  sets: WorkSet[];
  note: string;
}

/** La última vez que hiciste este ejercicio antes de `date` (sin contar la sesión actual). */
export async function lastTimeFor(exerciseId: string, date: string, excludeSessionId?: string): Promise<PastPerformance | null> {
  const candidates = await db.sets
    .where('[exerciseId+date]')
    .between([exerciseId, Dexie.minKey], [exerciseId, date], true, true)
    .reverse()
    .toArray();
  const done = candidates.filter((s) => alive(s) && s.done === 1 && s.sessionId !== excludeSessionId);
  if (done.length === 0) return null;
  const { sessionId, date: d } = done[0];
  const sets = done.filter((s) => s.sessionId === sessionId).sort((a, b) => a.order - b.order);
  const entry = await db.entries.get(sets[0].entryId);
  return { date: d, sessionId, sets, note: entry?.note ?? '' };
}

export function useLastTime(exerciseId: string | undefined, date: string | undefined, excludeSessionId?: string) {
  return useLiveQuery(
    async () => (exerciseId && date ? lastTimeFor(exerciseId, date, excludeSessionId) : null),
    [exerciseId, date, excludeSessionId],
  );
}

export interface ExerciseHistoryItem {
  date: string;
  sessionId: string;
  sets: WorkSet[];
  note: string;
}

export async function exerciseHistory(exerciseId: string): Promise<ExerciseHistoryItem[]> {
  const sets = (await db.sets.where('exerciseId').equals(exerciseId).toArray()).filter((s) => alive(s) && s.done === 1);
  const bySession = new Map<string, WorkSet[]>();
  for (const s of sets) {
    const list = bySession.get(s.sessionId) ?? [];
    list.push(s);
    bySession.set(s.sessionId, list);
  }
  const entryIds = [...new Set(sets.map((s) => s.entryId))];
  const entries = new Map((await db.entries.bulkGet(entryIds)).filter(alive).map((e) => [e.id, e]));
  return [...bySession.entries()]
    .map(([sessionId, list]) => {
      list.sort((a, b) => a.order - b.order);
      return { sessionId, date: list[0].date, sets: list, note: entries.get(list[0].entryId)?.note ?? '' };
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export function useExerciseHistory(exerciseId: string | undefined) {
  return useLiveQuery(async () => (exerciseId ? exerciseHistory(exerciseId) : []), [exerciseId]);
}

export interface RecordInfo {
  set: WorkSet;
  date: string;
}

export async function recordFor(exerciseId: string, beforeDate?: string): Promise<RecordInfo | null> {
  const sets = (await db.sets.where('exerciseId').equals(exerciseId).toArray()).filter(
    (s) => alive(s) && s.done === 1 && (!beforeDate || s.date < beforeDate),
  );
  const best = bestSet(sets);
  return best ? { set: best, date: best.date } : null;
}

export function useRecord(exerciseId: string | undefined, beforeDate?: string) {
  return useLiveQuery(async () => (exerciseId ? recordFor(exerciseId, beforeDate) : null), [exerciseId, beforeDate]);
}

export interface SessionSummary {
  session: Session;
  exerciseNames: string[];
  setCount: number;
}

export function useSessionList(): SessionSummary[] | undefined {
  return useLiveQuery(async () => {
    const [sessions, entries, sets, exercises] = await Promise.all([
      db.sessions.toArray(),
      db.entries.toArray(),
      db.sets.toArray(),
      db.exercises.toArray(),
    ]);
    const exName = new Map(exercises.map((e) => [e.id, e.name]));
    const doneBySession = new Map<string, Set<string>>();
    const countBySession = new Map<string, number>();
    for (const s of sets) {
      if (!alive(s) || s.done !== 1) continue;
      countBySession.set(s.sessionId, (countBySession.get(s.sessionId) ?? 0) + 1);
      const set = doneBySession.get(s.sessionId) ?? new Set();
      set.add(s.entryId);
      doneBySession.set(s.sessionId, set);
    }
    const entriesBySession = new Map<string, Entry[]>();
    for (const e of entries) {
      if (!alive(e)) continue;
      const list = entriesBySession.get(e.sessionId) ?? [];
      list.push(e);
      entriesBySession.set(e.sessionId, list);
    }
    return sessions
      .filter(alive)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.startedAt ?? 0) - (a.startedAt ?? 0)))
      .map((session) => {
        const done = doneBySession.get(session.id) ?? new Set();
        const names = (entriesBySession.get(session.id) ?? [])
          .filter((e) => done.has(e.id))
          .sort((a, b) => a.order - b.order)
          .map((e) => exName.get(e.exerciseId) ?? '?');
        return { session, exerciseNames: names, setCount: countBySession.get(session.id) ?? 0 };
      });
  }, []);
}

/** Sesión sin terminar más reciente (para "Continuar"). */
export function useOpenSession(): Session | null | undefined {
  return useLiveQuery(async () => {
    const recent = (await db.sessions.where('date').aboveOrEqual(shiftDays(todayISO(), -1)).toArray()).filter(
      (s) => alive(s) && s.source === 'app' && !s.finishedAt,
    );
    recent.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
    return recent[0] ?? null;
  }, []);
}

/**
 * Entrenamientos de días pasados que quedaron abiertos (ej. le diste "Empezar" para probar):
 * si tienen series palomeadas se terminan; si están vacíos se borran. Así nunca bloquean el día de hoy.
 * Uno empezado hace menos de 6 h se respeta, por si entrenas pasada la medianoche.
 */
export async function closeStaleSessions(today = todayISO(), now = Date.now()): Promise<number> {
  const stale = (await db.sessions.where('date').below(today).toArray()).filter(
    (s) => alive(s) && s.source === 'app' && !s.finishedAt && (s.startedAt == null || now - s.startedAt > 6 * 3_600_000),
  );
  for (const s of stale) {
    const hasDone = (await db.sets.where('sessionId').equals(s.id).toArray()).some((x) => alive(x) && x.done === 1);
    if (hasDone) await finishSession(s);
    else await deleteSession(s);
  }
  return stale.length;
}

export function useReviewEntries(): Entry[] | undefined {
  return useLiveQuery(async () => (await db.entries.where('review').equals(1).toArray()).filter(alive), []);
}

/** Último uso de cada ejercicio (para ordenar el catálogo). */
export function useLastUsed(): Map<string, string> | undefined {
  return useLiveQuery(async () => {
    const map = new Map<string, string>();
    await db.sets.each((s) => {
      if (s.deleted === 1 || s.done !== 1) return;
      const prev = map.get(s.exerciseId);
      if (!prev || prev < s.date) map.set(s.exerciseId, s.date);
    });
    return map;
  }, []);
}

function shiftDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// ───────────────────────── Acciones ─────────────────────────

const base = () => ({ updatedAt: Date.now(), deleted: 0 as const });

/** De las variantes de un lugar, la que hiciste más recientemente (como cuando copias la última tabla). */
async function preferredVariant(exerciseIds: string[]): Promise<string> {
  let best = exerciseIds[0];
  let bestDate = '';
  for (const id of exerciseIds) {
    const last = await db.sets
      .where('[exerciseId+date]')
      .between([id, Dexie.minKey], [id, Dexie.maxKey])
      .reverse()
      .filter((s) => s.deleted !== 1 && s.done === 1)
      .first();
    if (last && last.date > bestDate) {
      bestDate = last.date;
      best = id;
    }
  }
  return best;
}

export async function startSession(routine: Routine | null, date = todayISO()): Promise<string> {
  const session: Session = {
    ...base(),
    id: newId('ss-'),
    date,
    routineId: routine?.id ?? null,
    title: routine?.name ?? 'Entrenamiento libre',
    notes: '',
    startedAt: Date.now(),
    finishedAt: null,
    source: 'app',
  };
  const entries: Entry[] = [];
  if (routine) {
    const slots = (await db.slots.where('routineId').equals(routine.id).toArray())
      .filter((s) => alive(s) && s.kind !== 'no' && s.exerciseIds.length > 0)
      .sort((a, b) => a.order - b.order);
    for (const slot of slots) {
      entries.push(newEntry(session.id, await preferredVariant(slot.exerciseIds), entries.length, slot.id));
    }
  }
  await save('sessions', session);
  if (entries.length) await save('entries', entries);
  return session.id;
}

function newEntry(sessionId: string, exerciseId: string, order: number, slotId: string | null): Entry {
  return { ...base(), id: newId('en-'), sessionId, exerciseId, slotId, order, note: '', raw: '', review: 0, reviewReason: '' };
}

export async function addEntry(sessionId: string, exerciseId: string, slotId: string | null = null): Promise<string> {
  const existing = (await db.entries.where('sessionId').equals(sessionId).toArray()).filter(alive);
  const order = existing.reduce((m, e) => Math.max(m, e.order + 1), 0);
  const entry = newEntry(sessionId, exerciseId, order, slotId);
  await save('entries', entry);
  return entry.id;
}

export async function updateEntry(entry: Entry, patch: Partial<Entry>): Promise<void> {
  await save('entries', { ...entry, ...patch });
  if (patch.exerciseId && patch.exerciseId !== entry.exerciseId) {
    const sets = (await db.sets.where('entryId').equals(entry.id).toArray()).filter(alive);
    if (sets.length) await save('sets', sets.map((s) => ({ ...s, exerciseId: patch.exerciseId! })));
  }
}

export async function removeEntry(entry: Entry): Promise<void> {
  const sets = await db.sets.where('entryId').equals(entry.id).primaryKeys();
  await remove('sets', sets);
  await remove('entries', [entry.id]);
}

export async function moveEntry(entries: Entry[], index: number, dir: -1 | 1): Promise<void> {
  const j = index + dir;
  if (j < 0 || j >= entries.length) return;
  const list = [...entries];
  [list[index], list[j]] = [list[j], list[index]];
  await save('entries', list.map((e, i) => ({ ...e, order: i })));
}

export interface SetValues {
  weight: number | null;
  reps: number | null;
  unit: Unit;
  load: LoadMode;
  weight2?: number | null;
  reps2?: number | null;
  seconds?: number | null;
  done?: 0 | 1;
}

export async function addSet(entry: Entry, date: string, order: number, v: SetValues): Promise<WorkSet> {
  const set: WorkSet = {
    ...base(),
    id: newId('st-'),
    entryId: entry.id,
    sessionId: entry.sessionId,
    exerciseId: entry.exerciseId,
    date,
    order,
    weight: v.weight,
    unit: v.unit,
    load: v.load,
    reps: v.reps,
    weight2: v.weight2 ?? null,
    reps2: v.reps2 ?? null,
    seconds: v.seconds ?? null,
    done: v.done ?? 0,
    doubtful: 0,
  };
  await save('sets', set);
  return set;
}

export async function updateSet(set: WorkSet, patch: Partial<WorkSet>): Promise<void> {
  await save('sets', { ...set, ...patch });
}

export async function deleteSet(set: WorkSet): Promise<void> {
  await remove('sets', [set.id]);
}

export async function updateSession(session: Session, patch: Partial<Session>): Promise<void> {
  await save('sessions', { ...session, ...patch });
  if (patch.date && patch.date !== session.date) {
    const sets = (await db.sets.where('sessionId').equals(session.id).toArray()).filter(alive);
    if (sets.length) await save('sets', sets.map((s) => ({ ...s, date: patch.date! })));
  }
}

export async function finishSession(session: Session): Promise<void> {
  // Las series sin palomear no cuentan: se borran para no ensuciar el historial.
  const pending = (await db.sets.where('sessionId').equals(session.id).toArray()).filter((s) => alive(s) && s.done !== 1);
  await remove('sets', pending.map((s) => s.id));
  await save('sessions', { ...session, finishedAt: Date.now() });
}

export async function deleteSession(session: Session): Promise<void> {
  const [sets, entries] = await Promise.all([
    db.sets.where('sessionId').equals(session.id).primaryKeys(),
    db.entries.where('sessionId').equals(session.id).primaryKeys(),
  ]);
  await remove('sets', sets);
  await remove('entries', entries);
  await remove('sessions', [session.id]);
}

export async function createExercise(v: { name: string; unit: Unit; load: LoadMode; notes?: string }): Promise<Exercise> {
  const now = Date.now();
  const ex: Exercise = { ...base(), id: newId('ex-'), name: v.name.trim(), unit: v.unit, load: v.load, notes: v.notes ?? '', archived: 0, createdAt: now };
  await save('exercises', ex);
  return ex;
}

export async function updateExercise(ex: Exercise, patch: Partial<Exercise>): Promise<void> {
  await save('exercises', { ...ex, ...patch });
}

/** Une dos ejercicios duplicados: todo el historial de `from` pasa a `into`. */
export async function mergeExercises(from: Exercise, into: Exercise): Promise<void> {
  if (from.id === into.id) return;
  const [entries, sets, slots] = await Promise.all([
    db.entries.where('exerciseId').equals(from.id).toArray(),
    db.sets.where('exerciseId').equals(from.id).toArray(),
    db.slots.toArray(),
  ]);
  if (entries.length) await save('entries', entries.filter(alive).map((e) => ({ ...e, exerciseId: into.id })));
  if (sets.length) await save('sets', sets.filter(alive).map((s) => ({ ...s, exerciseId: into.id })));
  const touched = slots
    .filter((s) => alive(s) && s.exerciseIds.includes(from.id))
    .map((s) => ({ ...s, exerciseIds: [...new Set(s.exerciseIds.map((id) => (id === from.id ? into.id : id)))] }));
  if (touched.length) await save('slots', touched);
  const notes = [into.notes, from.notes].filter((n) => n.trim()).join('\n');
  await save('exercises', { ...into, notes });
  await remove('exercises', [from.id]);
}

export async function createRoutine(name: string): Promise<Routine> {
  const all = (await db.routines.toArray()).filter(alive);
  const routine: Routine = { ...base(), id: newId('rt-'), name, weekdays: [], order: all.reduce((m, r) => Math.max(m, r.order + 1), 0) };
  await save('routines', routine);
  return routine;
}

export async function updateRoutine(routine: Routine, patch: Partial<Routine>): Promise<void> {
  await save('routines', { ...routine, ...patch });
}

export async function deleteRoutine(routine: Routine): Promise<void> {
  const slots = await db.slots.where('routineId').equals(routine.id).primaryKeys();
  await remove('slots', slots);
  await remove('routines', [routine.id]);
}

export async function addSlot(routineId: string, exerciseId: string): Promise<void> {
  const slots = (await db.slots.where('routineId').equals(routineId).toArray()).filter(alive);
  const slot: RoutineSlot = {
    ...base(),
    id: newId('sl-'),
    routineId,
    order: slots.reduce((m, s) => Math.max(m, s.order + 1), 0),
    exerciseIds: [exerciseId],
    kind: 'normal',
  };
  await save('slots', slot);
}

export async function updateSlot(slot: RoutineSlot, patch: Partial<RoutineSlot>): Promise<void> {
  if (patch.exerciseIds && patch.exerciseIds.length === 0) {
    await remove('slots', [slot.id]);
    return;
  }
  await save('slots', { ...slot, ...patch });
}

export async function removeSlot(slot: RoutineSlot): Promise<void> {
  await remove('slots', [slot.id]);
}

export async function moveSlot(slots: RoutineSlot[], index: number, dir: -1 | 1): Promise<void> {
  const j = index + dir;
  if (j < 0 || j >= slots.length) return;
  const list = [...slots];
  [list[index], list[j]] = [list[j], list[index]];
  await save('slots', list.map((s, i) => ({ ...s, order: i })));
}

export async function resolveReview(entry: Entry, keep: boolean): Promise<void> {
  if (keep) await save('entries', { ...entry, review: 0, reviewReason: '' });
  else await removeEntry(entry);
}
