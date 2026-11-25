import type { Unit, WorkSet } from '../db/types';
import { parseISO } from './dates';
import { effectiveReps, effectiveWeight, type SetLike } from './format';

// Progreso de un ejercicio: tu mejor marca, qué tan cerca estás de ella y tus mejores reps con cada peso.
// Sirve para no confundir "regresar a lo que ya podías" (ej. después de enfermarte) con progreso nuevo.

/** fuerza = peso y reps combinados (1RM estimado); reps = peso corporal; tiempo = ejercicios por segundos. */
export type Metric = 'fuerza' | 'reps' | 'tiempo';

export interface HistoryItem {
  date: string;
  sessionId: string;
  sets: WorkSet[];
  note: string;
}

export interface SessionPoint extends HistoryItem {
  /** La mejor serie de ese día. */
  best: WorkSet;
  score: number;
}

export interface WeightBest {
  /** Peso real en la unidad del ejercicio (barra incluida). */
  weight: number;
  set: WorkSet;
  reps: number;
  date: string;
}

export interface Progress {
  metric: Metric;
  /** Una por sesión, de la más vieja a la más nueva. */
  points: SessionPoint[];
  bestPoint: SessionPoint | null;
  heaviest: { set: WorkSet; date: string } | null;
  last: SessionPoint | null;
  /** Mejor sesión de la última vez contra tu mejor (1 = igual). */
  lastVsBest: number | null;
  /** Mejores reps con cada peso, del más pesado al más ligero. */
  byWeight: WeightBest[];
  /** Días sin hacer el ejercicio antes de la última vez (si fueron 10 o más). */
  pauseBeforeLast: number | null;
}

const LB_PER_KG = 1 / 0.45359237;

export function convert(w: number, from: Unit, to: Unit): number {
  if (from === to) return w;
  return from === 'kg' ? w * LB_PER_KG : w / LB_PER_KG;
}

export function metricFor(sets: SetLike[]): Metric {
  let weighted = 0;
  let body = 0;
  let time = 0;
  for (const s of sets) {
    if (s.seconds != null && s.reps == null) time++;
    else if (s.load === 'corporal' && !s.weight) body++;
    else weighted++;
  }
  if (time > weighted && time > body) return 'tiempo';
  if (body > weighted) return 'reps';
  return 'fuerza';
}

/**
 * Puntaje para comparar series distintas. En "fuerza" es el 1RM estimado (fórmula de Epley):
 * el peso que podrías levantar una vez, calculado con el peso y las reps de la serie.
 * Así 20 lb × 8 y 25 lb × 4 se pueden comparar.
 */
export function scoreSet(s: SetLike, metric: Metric, unit: Unit): number {
  if (metric === 'tiempo') return s.seconds ?? 0;
  const reps = effectiveReps(s);
  if (metric === 'reps') return reps;
  if (reps <= 0) return 0;
  const w = convert(effectiveWeight(s), s.unit, unit);
  return reps === 1 ? w : w * (1 + reps / 30);
}

function daysBetween(a: string, b: string): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86_400_000);
}

export function computeProgress(history: HistoryItem[], unit: Unit): Progress {
  const items = history.filter((h) => h.sets.length > 0).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const metric = metricFor(items.flatMap((h) => h.sets));

  const points: SessionPoint[] = [];
  for (const h of items) {
    let best = h.sets[0];
    let score = scoreSet(best, metric, unit);
    for (const s of h.sets.slice(1)) {
      const sc = scoreSet(s, metric, unit);
      if (sc > score) {
        best = s;
        score = sc;
      }
    }
    if (score > 0) points.push({ ...h, best, score });
  }

  let bestPoint: SessionPoint | null = null;
  for (const p of points) if (!bestPoint || p.score > bestPoint.score) bestPoint = p; // empate: se queda la más vieja

  let heaviest: Progress['heaviest'] = null;
  let heaviestW = -Infinity;
  const weights = new Map<string, WeightBest>();
  if (metric === 'fuerza') {
    for (const p of points) {
      for (const s of p.sets) {
        const reps = effectiveReps(s);
        if (reps <= 0) continue;
        const w = Math.round(convert(effectiveWeight(s), s.unit, unit) * 10) / 10;
        if (w > heaviestW || (w === heaviestW && heaviest && reps > effectiveReps(heaviest.set))) {
          heaviestW = w;
          heaviest = { set: s, date: p.date };
        }
        const key = String(w);
        const prev = weights.get(key);
        if (!prev || reps > prev.reps) weights.set(key, { weight: w, set: s, reps, date: p.date });
      }
    }
  }

  const last = points[points.length - 1] ?? null;
  const prev = points[points.length - 2];
  const gap = last && prev ? daysBetween(prev.date, last.date) : null;

  return {
    metric,
    points,
    bestPoint,
    heaviest,
    last,
    lastVsBest: last && bestPoint ? last.score / bestPoint.score : null,
    byWeight: [...weights.values()].sort((a, b) => b.weight - a.weight),
    pauseBeforeLast: gap != null && gap >= 10 ? gap : null,
  };
}

/**
 * "Con 20 lb has hecho hasta 8 reps": tu mejor marca con el peso más pesado que usaste la última vez,
 * solo si es mejor que lo que hiciste esa vez (si no, no aporta nada).
 */
export function bestAtLastWeight(p: Progress, unit: Unit): WeightBest | null {
  if (p.metric !== 'fuerza' || !p.last) return null;
  const top = p.last.sets.reduce((a, b) => (effectiveWeight(b) > effectiveWeight(a) ? b : a));
  const w = Math.round(convert(effectiveWeight(top), top.unit, unit) * 10) / 10;
  const atW = p.byWeight.find((x) => x.weight === w);
  const lastReps = Math.max(...p.last.sets.filter((s) => Math.round(convert(effectiveWeight(s), s.unit, unit) * 10) / 10 === w).map(effectiveReps));
  if (!atW || atW.reps <= lastReps || atW.date === p.last.date) return null;
  return atW;
}
