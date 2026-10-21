import type { LoadMode, Unit, WorkSet } from '../db/types';

/** Peso de la barra olímpica. */
export const BAR_WEIGHT: Record<Unit, number> = { kg: 20, lb: 45 };

export type SetLike = Pick<WorkSet, 'weight' | 'unit' | 'load' | 'reps' | 'weight2' | 'reps2' | 'seconds'>;

/** Acepta "17,5" (teclado de iPhone en español) y "17.5". */
export function parseNum(text: string): number | null {
  const clean = text.trim().replace(',', '.');
  if (clean === '' || clean === '-' || clean === '.') return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

export function fmtNum(n: number): string {
  return String(Math.round(n * 100) / 100);
}

export function unitLabel(unit: Unit): string {
  return unit === 'kg' ? 'kg' : 'lb';
}

/** Solo el peso: "23 kg", "2×25 lb", "Barra", "Corporal −4.5 kg". */
export function formatWeight(s: Pick<SetLike, 'weight' | 'unit' | 'load' | 'weight2'>): string {
  const u = unitLabel(s.unit);
  if (s.load === 'corporal') {
    if (s.weight == null || s.weight === 0) return 'Corporal';
    return s.weight > 0 ? `Corporal +${fmtNum(s.weight)} ${u}` : `Corporal −${fmtNum(-s.weight)} ${u}`;
  }
  if (s.weight == null) return '—';
  if (s.load === 'lado') {
    if (s.weight === 0 && s.weight2 == null) return 'Barra';
    const second = s.weight2 != null ? `/${fmtNum(s.weight2)}` : '';
    return s.weight === 0 ? `Barra${second}` : `2×${fmtNum(s.weight)}${second} ${u}`;
  }
  const second = s.weight2 != null ? `/${fmtNum(s.weight2)}` : '';
  return `${fmtNum(s.weight)}${second} ${u}`;
}

export function formatReps(s: Pick<SetLike, 'reps' | 'reps2' | 'seconds'>): string {
  if (s.seconds != null && s.reps == null) return formatSeconds(s.seconds);
  if (s.reps == null) return '—';
  return s.reps2 != null ? `${fmtNum(s.reps)}/${fmtNum(s.reps2)}` : fmtNum(s.reps);
}

export function formatSeconds(sec: number): string {
  if (sec < 60) return `${fmtNum(sec)} s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s === 0 ? `${m} min` : `${m}:${String(s).padStart(2, '0')} min`;
}

/** "23 kg × 7" */
export function formatSet(s: SetLike): string {
  if (s.seconds != null && s.reps == null) return `${formatWeight(s)} · ${formatSeconds(s.seconds)}`;
  return `${formatWeight(s)} × ${formatReps(s)}`;
}

function sameSet(a: SetLike, b: SetLike): boolean {
  return (
    a.weight === b.weight &&
    a.unit === b.unit &&
    a.load === b.load &&
    a.reps === b.reps &&
    (a.weight2 ?? null) === (b.weight2 ?? null) &&
    (a.reps2 ?? null) === (b.reps2 ?? null) &&
    (a.seconds ?? null) === (b.seconds ?? null)
  );
}

export interface SetGroup<S extends SetLike = SetLike> {
  count: number;
  set: S;
}

/** Agrupa series seguidas idénticas (mismo peso y mismas reps), como en tus notas. */
export function groupSets<S extends SetLike>(sets: S[]): SetGroup<S>[] {
  const groups: SetGroup<S>[] = [];
  for (const s of sets) {
    const last = groups[groups.length - 1];
    if (last && sameSet(last.set, s)) last.count++;
    else groups.push({ count: 1, set: s });
  }
  return groups;
}

/** "14 kg × 12 · 18 kg × 10 · 23 kg × 7 (2 series)" — el conteo va al final para no confundirse con "2×25" de los discos. */
export function compactSets(sets: SetLike[]): string {
  if (sets.length === 0) return '—';
  return groupSets(sets)
    .map((g) => (g.count > 1 ? `${formatSet(g.set)} (${g.count} series)` : formatSet(g.set)))
    .join(' · ');
}

/** Tu formato de Notas: { series: "1 - 1 - 2", peso: "14 kg - 18 kg - 23 kg", reps: "12 - 10 - 7" } */
export function toNotation(sets: SetLike[]): { series: string; peso: string; reps: string } {
  const groups = groupSets(sets);
  return {
    series: groups.map((g) => g.count).join(' - '),
    peso: groups.map((g) => formatWeight(g.set)).join(' - '),
    reps: groups.map((g) => formatReps(g.set)).join(' - '),
  };
}

/** Peso real movido, en la unidad de la serie (para comparar y calcular récords). */
export function effectiveWeight(s: Pick<SetLike, 'weight' | 'unit' | 'load'>): number {
  if (s.load === 'lado') return BAR_WEIGHT[s.unit] + 2 * (s.weight ?? 0);
  return s.weight ?? 0;
}

function toKg(w: number, unit: Unit): number {
  return unit === 'kg' ? w : w * 0.45359237;
}

/** Comparación: primero peso (en kg para poder mezclar unidades), luego reps, luego tiempo. */
export function compareSets(a: SetLike, b: SetLike): number {
  const wa = toKg(effectiveWeight(a), a.unit);
  const wb = toKg(effectiveWeight(b), b.unit);
  if (Math.abs(wa - wb) > 0.01) return wa - wb;
  const ra = a.reps ?? 0;
  const rb = b.reps ?? 0;
  if (ra !== rb) return ra - rb;
  return (a.seconds ?? 0) - (b.seconds ?? 0);
}

export function bestSet<S extends SetLike>(sets: S[]): S | null {
  let best: S | null = null;
  for (const s of sets) {
    if (s.reps == null && s.seconds == null) continue;
    if (!best || compareSets(s, best) > 0) best = s;
  }
  return best;
}

export type Delta = 'up' | 'down' | 'same';

export function deltaVs(today: SetLike, before: SetLike | undefined): Delta | null {
  if (!before) return null;
  const c = compareSets(today, before);
  return c > 0 ? 'up' : c < 0 ? 'down' : 'same';
}

export const LOAD_LABELS: Record<LoadMode, string> = {
  normal: 'Máquina / mancuerna',
  lado: 'Barra con discos (por lado)',
  corporal: 'Peso corporal',
};
