const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export const WEEKDAY_LETTERS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
export const WEEKDAY_NAMES = DIAS;

export function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayISO(): string {
  return toISO(new Date());
}

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function weekdayOf(iso: string): number {
  return parseISO(iso).getDay();
}

/** "lun 12 oct" */
export function formatShort(iso: string): string {
  const d = parseISO(iso);
  return `${DIAS_CORTOS[d.getDay()]} ${d.getDate()} ${MESES_CORTOS[d.getMonth()]}`;
}

/** "12 oct" (agrega el año si no es el actual) */
export function formatDayMonth(iso: string): string {
  const d = parseISO(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${d.getDate()} ${MESES_CORTOS[d.getMonth()]}${sameYear ? '' : ` ${d.getFullYear()}`}`;
}

/** "lunes 12 de octubre" */
export function formatLong(iso: string): string {
  const d = parseISO(iso);
  return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`;
}

/** "octubre 2026" */
export function formatMonthYear(iso: string): string {
  const d = parseISO(iso);
  return `${MESES[d.getMonth()]} ${d.getFullYear()}`;
}

/** "hoy", "ayer", "hace 5 días", "hace 3 semanas" */
export function relativeDays(iso: string, from = todayISO()): string {
  const days = Math.round((parseISO(from).getTime() - parseISO(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 14) return `hace ${days} días`;
  if (days < 60) return `hace ${Math.round(days / 7)} semanas`;
  return `hace ${Math.round(days / 30)} meses`;
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** "martes 20 de octubre" → "Martes 20 de octubre" */
export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
