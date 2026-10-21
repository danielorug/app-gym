// Fechas de los encabezados de la nota: "23 Julio 2026", "3 de Agosto", "B28 Julio 2026",
// "16 de Oct 2026", "8 de Agosto (Full body)", "15" (mismo mes que la sesión anterior).

const MONTHS: Record<string, number> = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12,
};

export const DEFAULT_YEAR = 2026;

export interface DateHeading {
  date: string; // YYYY-MM-DD
  label: string | null; // texto entre paréntesis, ej. "Full body"
}

function monthNumber(word: string): number | null {
  const w = word
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  if (w.length < 3) return null;
  const n = MONTHS[w.slice(0, 3)];
  if (!n) return null;
  // Evita confundir palabras normales que empiezan igual ("marzo" sí, "martes" no).
  const full = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'setiembre', 'octubre', 'noviembre', 'diciembre'];
  return full.some((f) => f.startsWith(w) || w.startsWith(f)) ? n : null;
}

export function toISO(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function valid(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Interpreta un renglón de texto como encabezado de fecha, o null si no lo es.
 * `prev` = fecha de la sesión anterior (para "15" a secas y para el año por defecto).
 */
export function parseDateHeading(text: string, prev: string | null): DateHeading | null {
  const t = text.trim();
  // Solo el número del día: "15"
  const bare = /^(\d{1,2})$/.exec(t);
  if (bare) {
    if (!prev) return null;
    const [py, pm] = prev.split('-').map(Number);
    const d = Number(bare[1]);
    return valid(py, pm, d) ? { date: toISO(py, pm, d), label: null } : null;
  }
  // [basura de 0-2 letras] día [de] mes [de] [año] [(etiqueta)]
  const re = /^[^\d\s]{0,2}(\d{1,2})\s+(?:de\s+)?([A-Za-zÁÉÍÓÚáéíóúñÑ]+)\.?(?:\s+(?:de(?:l)?\s+)?(\d{4}))?\s*(?:\(([^)]*)\))?\s*$/;
  const m = re.exec(t);
  if (!m) return null;
  const month = monthNumber(m[2]);
  if (!month) return null;
  const day = Number(m[1]);
  const year = m[3] ? Number(m[3]) : prev ? Number(prev.slice(0, 4)) : DEFAULT_YEAR;
  if (!valid(year, month, day)) return null;
  return { date: toISO(year, month, day), label: m[4]?.trim() || null };
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** 12:00 hora local de esa fecha, en ms. */
export function noonLocal(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0).getTime();
}

/** 0=Dom … 6=Sáb */
export function weekday(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isSeparator(text: string): boolean {
  return /^[—–\-_=]{4,}$/.test(text.replace(/\s/g, ''));
}
