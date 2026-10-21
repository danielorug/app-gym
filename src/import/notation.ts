// Interpreta las columnas Series / Peso / Reps tal como se escriben en Notas.
//
//   Series  1 - 1 - 2         → grupos: 1 serie, 1 serie, 2 series (mismo peso y reps)
//   Peso    14kg - 18kg - 23kg → un peso por grupo (uno solo = aplica a todas)
//   Reps    12 - 10 - 7 - 6    → por grupo o por serie
//
// "/" sin espacios = dos partes en la misma serie (32/18kg con 8/4).
// " / " con espacios (formato viejo de julio) = separador de lista, igual que " - ".

import type { LoadMode, Unit } from '../db/types';

export interface ParsedWeight {
  weight: number | null;
  weight2: number | null;
  unit: Unit | null; // null = no se escribió la unidad
  load: LoadMode;
  doubtful: boolean;
  placeholder: boolean; // "___ kg" de una plantilla
  unreadable: boolean;
}

export interface ParsedReps {
  reps: number | null;
  reps2: number | null;
  seconds: number | null;
  doubtful: boolean;
}

export interface ExpandedSet {
  weight: number | null;
  weight2: number | null;
  unit: Unit | null;
  load: LoadMode;
  reps: number | null;
  reps2: number | null;
  seconds: number | null;
  doubtful: boolean;
}

export interface Expansion {
  sets: ExpandedSet[];
  issues: string[];
}

const MAX_SETS_PER_GROUP = 6;

/** "1 - 2 - 1" → [1, 2, 1]. null si está vacío o no se entiende ("3–4", "20 min", "50lbs"). */
export function parseCounts(text: string): number[] | null {
  const t = text.trim();
  if (!t || /^[—–\-\s]+$/.test(t)) return null;
  if (/[a-z]/i.test(t) || t.includes('–')) return null;
  const tokens = t.split(/\s*-\s*/).filter((x) => x !== '');
  if (tokens.length === 0) return null;
  const counts: number[] = [];
  for (const tok of tokens) {
    if (!/^\d+$/.test(tok)) return null;
    const n = Number(tok);
    if (n < 1 || n > MAX_SETS_PER_GROUP) return null;
    counts.push(n);
  }
  return counts;
}

export function isEmptyCell(text: string): boolean {
  return /^[—–\-\s]*$/.test(text);
}

function unitOf(s: string | undefined): Unit | null {
  if (!s) return null;
  const u = s.toLowerCase();
  if (/^(kgs?|kh|k)$/.test(u)) return 'kg';
  if (/^(lbs?|libras?)$/.test(u)) return 'lb';
  return null;
}

function num(s: string): number {
  return Number(s.replace(',', '.'));
}

const NUM = String.raw`\d+(?:[.,]\d+)?`;
const UNIT = String.raw`kgs?|kh|k|lbs?|libras?`;

/** Un solo peso: "32kg", "Barra", "2x25", "4.5 kg de ayuda", "32/18kg", "17.5 lbs/c". */
export function parseWeightToken(token: string): ParsedWeight {
  const out: ParsedWeight = { weight: null, weight2: null, unit: null, load: 'normal', doubtful: false, placeholder: false, unreadable: false };
  let t = token.trim();
  if (/creo|aprox/i.test(t)) out.doubtful = true;
  if (/_{2,}/.test(t)) {
    out.placeholder = true;
    return out;
  }
  t = t
    .replace(/\([^)]*\)/g, ' ')
    .replace(/creo|aprox\.?/gi, ' ')
    .replace(/^\s*mancuernas\s*:\s*/i, '')
    .replace(/c\/mano|c\/u/gi, ' ')
    .replace(/\/c\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  if (/de ayuda/.test(t)) {
    const m = new RegExp(`(${NUM})\\s*(${UNIT})?`).exec(t);
    out.load = 'corporal';
    if (m) {
      out.weight = -num(m[1]);
      out.unit = unitOf(m[2]);
    }
    return out;
  }

  if (t === '' || /^[—–-]+$/.test(t) || /^(peso corporal|corporal)$/.test(t)) {
    out.load = 'corporal';
    return out;
  }

  if (/^(pura barra|barra|b)$/.test(t)) {
    out.load = 'lado';
    out.weight = 0;
    return out;
  }

  // "50 kg + barra": discos en total + barra → por lado
  const plusBar = new RegExp(`^(${NUM})\\s*(${UNIT})?\\s*\\+\\s*barra$`).exec(t);
  if (plusBar) {
    out.load = 'lado';
    out.weight = num(plusBar[1]) / 2;
    out.unit = unitOf(plusBar[2]);
    return out;
  }

  // Discos por lado: "2x25", "25x2", "2x45lbs"
  const plates = new RegExp(`^(${NUM})\\s*x\\s*(${NUM})\\s*(${UNIT})?$`).exec(t);
  if (plates) {
    const a = num(plates[1]);
    const b = num(plates[2]);
    out.load = 'lado';
    out.weight = a === 2 ? b : b === 2 ? a : b;
    out.unit = unitOf(plates[3]);
    return out;
  }

  // Dos partes: "32/18kg", "18kg/32 kg"
  if (t.includes('/')) {
    const [p1, p2] = t.split('/').map((s) => s.trim());
    const re = new RegExp(`^(${NUM})\\s*(${UNIT})?$`);
    const m1 = re.exec(p1);
    const m2 = re.exec(p2 ?? '');
    if (m1) {
      out.weight = num(m1[1]);
      out.weight2 = m2 ? num(m2[1]) : null;
      out.unit = unitOf(m1[2]) ?? unitOf(m2?.[2]);
      return out;
    }
  }

  const plain = new RegExp(`^(${NUM})\\s*(${UNIT})?$`).exec(t);
  if (plain) {
    out.weight = num(plain[1]);
    out.unit = unitOf(plain[2]);
    return out;
  }

  out.unreadable = true;
  return out;
}

/** Normaliza separadores de lista: " / " (formato viejo) se vuelve " - ". */
function listify(text: string): string {
  if (/\s\/(\s|$)/.test(text) || /^\s*\//.test(text)) return text.replace(/\//g, ' - ');
  return text;
}

/** Columna Peso completa → lista de pesos (con la unidad heredada dentro de la misma celda). */
export function parseWeightCell(text: string): ParsedWeight[] {
  const t = listify(text.replace(/c\/mano|c\/u/gi, ' ').replace(/\/c\b/gi, ' '));
  if (isEmptyCell(t)) return [];
  const list = t
    .split(/\s*-\s*/)
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map(parseWeightToken);
  // Unidad: hereda de la anterior; si no hay, toma la primera que aparezca después.
  let last: Unit | null = null;
  for (const w of list) {
    if (w.unit) last = w.unit;
    else if (last && w.weight !== null && w.weight !== 0) w.unit = last;
  }
  const firstUnit = list.find((w) => w.unit)?.unit ?? null;
  if (firstUnit) for (const w of list) if (!w.unit && w.weight !== null && w.weight !== 0) w.unit = firstUnit;
  return list;
}

/** Columna Reps completa → lista de reps (o segundos para ejercicios por tiempo). */
export function parseRepsCell(text: string): ParsedReps[] {
  let t = text.trim();
  if (!t) return [];
  const cellDoubtful = /creo|aprox/i.test(t);
  t = t
    .replace(/\([^)]*\)/g, ' ')
    .replace(/creo|aprox\.?/gi, ' ')
    .replace(new RegExp(`(${NUM})\\s*c\\/u\\s*\\+\\s*(${NUM})\\s*ambos`, 'gi'), '$1/$2')
    .replace(/c\/u/gi, ' ');
  const timeUnit = /\d\s*(s|seg|segs|sgs|segundos|min|mins|minuto|minutos)\b/i.exec(t);
  const isTime = !!timeUnit;
  const cellIsMinutes = timeUnit ? /^min/i.test(timeUnit[1]) : false;
  t = listify(t);
  // Rangos de plantilla sin espacios ("8-10", "15-20 s"): se marcan para no partirlos.
  t = t.replace(new RegExp(`(${NUM})\\s*[–]\\s*(${NUM})|(${NUM})-(${NUM})`, 'g'), (_m, a, b, c, d) => {
    const x = a ?? c;
    const y = b ?? d;
    return num(x) < num(y) ? `${x}~${y}` : `${x} - ${y}`;
  });

  const out: ParsedReps[] = [];
  for (const raw of t.split(/\s*-\s*/)) {
    const tok = raw.trim();
    if (!tok) continue;
    let doubtful = cellDoubtful;
    if (isTime) {
      const m = new RegExp(`(${NUM})(?:~${NUM})?\\s*(s|seg|segs|sgs|segundos|min|mins|minuto|minutos)?`, 'i').exec(tok);
      if (!m) continue;
      if (tok.includes('~')) doubtful = true;
      const minutes = m[2] ? /^min/i.test(m[2]) : cellIsMinutes;
      out.push({ reps: null, reps2: null, seconds: Math.round(num(m[1]) * (minutes ? 60 : 1)), doubtful });
      continue;
    }
    if (tok.includes('~')) {
      const m = new RegExp(`(${NUM})~`).exec(tok);
      if (m) out.push({ reps: num(m[1]), reps2: null, seconds: null, doubtful: true });
      continue;
    }
    if (tok.includes('/')) {
      const [a, b] = tok.split('/');
      const ma = new RegExp(NUM).exec(a);
      const mb = new RegExp(NUM).exec(b ?? '');
      if (ma) out.push({ reps: num(ma[0]), reps2: mb ? num(mb[0]) : null, seconds: null, doubtful });
      continue;
    }
    const m = new RegExp(NUM).exec(tok);
    if (m) out.push({ reps: num(m[0]), reps2: null, seconds: null, doubtful });
  }
  return out;
}

/**
 * Expande una fila (Series, Peso, Reps) en series individuales.
 * `bodyweight` = sin peso anotado se guarda como peso corporal.
 */
export function expandRow(series: string, peso: string, reps: string, { bodyweight = false } = {}): Expansion {
  const issues: string[] = [];
  const W = parseWeightCell(peso);
  const R = parseRepsCell(reps);
  let groups = parseCounts(series);

  if (!groups) {
    const n = Math.max(W.length, R.length);
    if (n === 0) return { sets: [], issues };
    // Sin series legibles: cada peso/rep anotado es una serie.
    groups = Array(n).fill(1);
    // Si pesos y reps coinciden en cantidad (ej. el typo "10 - " del 15 oct) no hay duda.
    if (!isEmptyCell(series) && !(W.length === R.length && n > 1)) issues.push(`Series ilegibles ("${series.trim()}")`);
  }

  const G = groups.length;
  let total = groups.reduce((a, b) => a + b, 0);

  // Más reps anotadas que series: la columna Series quedó a medias ("1 - 1 -") o no se actualizó.
  if (R.length > total && R.length !== G) {
    if (W.length === R.length) groups = Array(R.length).fill(1);
    else {
      issues.push('Hay más reps que series');
      groups = [...groups, ...Array(R.length - total).fill(1)];
    }
    total = groups.reduce((a, b) => a + b, 0);
  }

  const byGroup = <T,>(list: T[], i: number) => list[Math.min(i, list.length - 1)];

  let weights: (ParsedWeight | null)[];
  if (W.length === 0) weights = Array(total).fill(null);
  else if (W.length === 1) weights = Array(total).fill(W[0]);
  else if (W.length === groups.length) weights = groups.flatMap((g, i) => Array(g).fill(W[i]));
  else if (W.length === total) weights = W;
  else {
    // Menos pesos que grupos: solo se anota cuando cambia, el último se repite
    // ("1 - 1 - 1 - 1 | 14 - 18 - 23 | …" = 14, 18, 23, 23). Más pesos que grupos sí es raro.
    if (W.length > groups.length) issues.push('Los pesos no cuadran con las series');
    weights = groups.flatMap((g, i) => Array(g).fill(byGroup(W, i)));
  }

  let repsList: (ParsedReps | null)[];
  if (R.length === 0) repsList = Array(total).fill(null);
  else if (R.length === total) repsList = R;
  else if (R.length === groups.length) repsList = groups.flatMap((g, i) => Array(g).fill(R[i]));
  else if (R.length === 1) repsList = Array(total).fill(R[0]);
  else {
    issues.push('Las reps no cuadran con las series');
    repsList = Array.from({ length: total }, (_, i) => byGroup(R, i));
  }

  if (W.some((w) => w.unreadable)) issues.push(`Peso ilegible ("${peso.trim()}")`);

  const sets: ExpandedSet[] = [];
  for (let i = 0; i < total; i++) {
    const w = weights[i];
    const r = repsList[i];
    sets.push({
      weight: w?.weight ?? null,
      weight2: w?.weight2 ?? null,
      unit: w?.unit ?? null,
      load: w ? w.load : bodyweight ? 'corporal' : 'normal',
      reps: r?.reps ?? null,
      reps2: r?.reps2 ?? null,
      seconds: r?.seconds ?? null,
      doubtful: !!(w?.doubtful || r?.doubtful),
    });
  }
  return { sets, issues };
}
