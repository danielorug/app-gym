import { describe, expect, it } from 'vitest';
import type { WorkSet } from '../db/types';
import { bestAtLastWeight, computeProgress, scoreSet, type HistoryItem } from './progress';

let n = 0;
const set = (date: string, weight: number | null, reps: number | null, extra: Partial<WorkSet> = {}): WorkSet => ({
  id: `s${n++}`,
  entryId: 'e',
  sessionId: `ss-${date}`,
  exerciseId: 'ex',
  date,
  order: n,
  weight,
  unit: 'lb',
  load: 'normal',
  reps,
  repsR: null,
  weight2: null,
  reps2: null,
  seconds: null,
  done: 1,
  doubtful: 0,
  updatedAt: 0,
  deleted: 0,
  ...extra,
});
const day = (date: string, ...sets: WorkSet[]): HistoryItem => ({ date, sessionId: `ss-${date}`, sets, note: '' });

// El caso de Dani: 20 lb × 8 un viernes, se enferma 2 semanas y regresa con 17.5 lb × 8.
const curl = [
  day('2026-10-23', set('2026-10-23', 20, 7), set('2026-10-23', 20, 8)),
  day('2026-11-09', set('2026-11-09', 17.5, 8), set('2026-11-09', 17.5, 8)),
];

describe('computeProgress', () => {
  it('recuerda tu mejor aunque la última vez hayas bajado', () => {
    const p = computeProgress(curl, 'lb');
    expect(p.bestPoint?.date).toBe('2026-10-23');
    expect(p.bestPoint?.best.weight).toBe(20);
    expect(p.last?.best.weight).toBe(17.5);
    expect(p.lastVsBest).toBeCloseTo(17.5 / 20, 5);
    expect(p.pauseBeforeLast).toBe(17);
  });

  it('da tus mejores reps con cada peso', () => {
    const p = computeProgress([...curl, day('2026-11-13', set('2026-11-13', 25, 4))], 'lb');
    expect(p.byWeight.map((w) => [w.weight, w.reps])).toEqual([
      [25, 4],
      [20, 8],
      [17.5, 8],
    ]);
    expect(p.heaviest?.set.weight).toBe(25);
  });

  it('"con 20 lb has hecho hasta 8 reps" cuando la última vez hiciste menos con ese peso', () => {
    const p = computeProgress([...curl, day('2026-11-24', set('2026-11-24', 20, 5))], 'lb');
    const hint = bestAtLastWeight(p, 'lb');
    expect(hint?.weight).toBe(20);
    expect(hint?.reps).toBe(8);
    expect(hint?.date).toBe('2026-10-23');
    // Si la última vez ya fue tu mejor con ese peso, no hay nada que recordar.
    expect(bestAtLastWeight(computeProgress(curl.slice(0, 1), 'lb'), 'lb')).toBeNull();
  });

  it('compara barra con discos, unidades mezcladas y peso corporal', () => {
    expect(scoreSet(set('d', 25, 1, { load: 'lado' }), 'fuerza', 'lb')).toBe(95); // barra 45 + 2×25
    expect(scoreSet(set('d', 20, 10, { unit: 'kg' }), 'fuerza', 'kg')).toBeCloseTo(26.67, 1);
    expect(scoreSet(set('d', 9.07, 10, { unit: 'kg' }), 'fuerza', 'lb')).toBeCloseTo(scoreSet(set('d', 20, 10), 'fuerza', 'lb'), 0);
    const pull = computeProgress([day('2026-11-01', set('2026-11-01', null, 5, { load: 'corporal' })), day('2026-11-08', set('2026-11-08', null, 6, { load: 'corporal' }))], 'kg');
    expect(pull.metric).toBe('reps');
    expect(pull.bestPoint?.date).toBe('2026-11-08');
  });
});
