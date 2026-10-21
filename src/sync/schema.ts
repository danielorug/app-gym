// Cómo se guarda cada tabla en Google Sheets.
// Sheets cambia los tipos (convierte "2026-10-12" en fecha, "5.5" en número, etc.),
// así que cada campo tiene un tipo explícito y se convierte al subir y al bajar.
// Este archivo no importa Dexie: lo usa también scripts/subir-a-sheets.ts.

import type { Entry, Exercise, Routine, RoutineSlot, RowByTable, Session, TableName, WorkSet } from '../db/types';

/**
 * str:  texto (vacío → '')
 * strN: texto o null (vacío → null)
 * num:  número (vacío → 0)
 * numN: número o null (vacío → null)
 * flag: 0/1
 * json: arreglo guardado como texto JSON
 */
export type FieldType = 'str' | 'strN' | 'num' | 'numN' | 'flag' | 'json';

type FieldMap<T> = { [K in Exclude<keyof T, 'dirty'>]-?: FieldType };

const exercises: FieldMap<Exercise> = {
  id: 'str', updatedAt: 'num', deleted: 'flag',
  name: 'str', unit: 'str', load: 'str', notes: 'str', archived: 'flag', createdAt: 'num',
};
const routines: FieldMap<Routine> = {
  id: 'str', updatedAt: 'num', deleted: 'flag',
  name: 'str', weekdays: 'json', order: 'num',
};
const slots: FieldMap<RoutineSlot> = {
  id: 'str', updatedAt: 'num', deleted: 'flag',
  routineId: 'str', order: 'num', exerciseIds: 'json', kind: 'str',
};
const sessions: FieldMap<Session> = {
  id: 'str', updatedAt: 'num', deleted: 'flag',
  date: 'str', routineId: 'strN', title: 'str', notes: 'str', startedAt: 'numN', finishedAt: 'numN', source: 'str',
};
const entries: FieldMap<Entry> = {
  id: 'str', updatedAt: 'num', deleted: 'flag',
  sessionId: 'str', exerciseId: 'str', slotId: 'strN', order: 'num', note: 'str', raw: 'str', review: 'flag', reviewReason: 'str',
};
const sets: FieldMap<WorkSet> = {
  id: 'str', updatedAt: 'num', deleted: 'flag',
  entryId: 'str', sessionId: 'str', exerciseId: 'str', date: 'str', order: 'num',
  weight: 'numN', unit: 'str', load: 'str', reps: 'numN', weight2: 'numN', reps2: 'numN', seconds: 'numN',
  done: 'flag', doubtful: 'flag',
};

export const FIELDS: { [T in TableName]: FieldMap<RowByTable[T]> } = { exercises, routines, slots, sessions, entries, sets };

/** Columnas que solo se escriben para que la hoja se lea mejor (se ignoran al bajar). */
export const EXTRA_COLUMNS: { [T in TableName]?: string[] } = { sets: ['ejercicio'] };

/** Nombre de cada pestaña en la hoja. */
export const SHEET_NAMES: Record<TableName, string> = {
  exercises: 'Ejercicios',
  routines: 'Rutinas',
  slots: 'RutinaLugares',
  sessions: 'Sesiones',
  entries: 'EjerciciosSesion',
  sets: 'Series',
};

/** Orden de columnas en la hoja: primero lo que sirve para leer, al final los ids. */
export const COLUMN_ORDER: Record<TableName, string[]> = {
  exercises: ['name', 'unit', 'load', 'notes', 'archived', 'createdAt', 'id', 'updatedAt', 'deleted'],
  routines: ['name', 'weekdays', 'order', 'id', 'updatedAt', 'deleted'],
  slots: ['routineId', 'order', 'kind', 'exerciseIds', 'id', 'updatedAt', 'deleted'],
  sessions: ['date', 'title', 'routineId', 'notes', 'startedAt', 'finishedAt', 'source', 'id', 'updatedAt', 'deleted'],
  entries: ['sessionId', 'order', 'exerciseId', 'note', 'raw', 'review', 'reviewReason', 'slotId', 'id', 'updatedAt', 'deleted'],
  sets: [
    'date', 'ejercicio', 'order', 'weight', 'unit', 'load', 'reps', 'weight2', 'reps2', 'seconds', 'done', 'doubtful',
    'entryId', 'sessionId', 'exerciseId', 'id', 'updatedAt', 'deleted',
  ],
};

/** Columnas que la hoja debe guardar como texto plano (formato '@'). */
export function textColumns(name: TableName): string[] {
  const fields = FIELDS[name] as Record<string, FieldType>;
  return COLUMN_ORDER[name].filter((c) => {
    const t = fields[c];
    return t === undefined || t === 'str' || t === 'strN' || t === 'json';
  });
}

export type Cell = string | number | null;
export type SheetRow = Record<string, Cell>;

export interface EncodeContext {
  exerciseName?: (id: string) => string | undefined;
}

/** Fila local → fila para la hoja. Nunca incluye `dirty`. */
export function encodeRow<T extends TableName>(name: T, row: RowByTable[T], ctx: EncodeContext = {}): SheetRow {
  const fields = FIELDS[name] as Record<string, FieldType>;
  const src = row as unknown as Record<string, unknown>;
  const out: SheetRow = {};
  for (const [key, type] of Object.entries(fields)) {
    out[key] = encodeValue(src[key], type);
  }
  if (name === 'sets') {
    out.ejercicio = ctx.exerciseName?.(String(src.exerciseId ?? '')) ?? '';
  }
  return out;
}

function encodeValue(v: unknown, type: FieldType): Cell {
  if (v === undefined || v === null) {
    if (type === 'json') return '[]';
    if (type === 'str') return '';
    if (type === 'num' || type === 'flag') return 0;
    return null;
  }
  switch (type) {
    case 'json':
      return JSON.stringify(v);
    case 'str':
    case 'strN':
      return String(v);
    case 'flag':
      return v === 1 || v === true || v === '1' ? 1 : 0;
    case 'num':
    case 'numN': {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? n : type === 'num' ? 0 : null;
    }
  }
}

/** Fila de la hoja → fila local (sin `dirty`). Columnas desconocidas se ignoran. */
export function decodeRow<T extends TableName>(name: T, raw: Record<string, unknown>): RowByTable[T] {
  const fields = FIELDS[name] as Record<string, FieldType>;
  const out: Record<string, unknown> = {};
  for (const [key, type] of Object.entries(fields)) {
    out[key] = decodeValue(raw[key], type);
  }
  return out as unknown as RowByTable[T];
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === '';
}

function decodeValue(v: unknown, type: FieldType): unknown {
  switch (type) {
    case 'str':
      return isEmpty(v) ? '' : String(v);
    case 'strN':
      return isEmpty(v) ? null : String(v);
    case 'flag':
      return v === 1 || v === '1' || v === true || v === 'TRUE' ? 1 : 0;
    case 'num': {
      if (isEmpty(v)) return 0;
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    }
    case 'numN': {
      if (isEmpty(v)) return null;
      const n = Number(typeof v === 'string' ? v.replace(',', '.') : v);
      return Number.isFinite(n) ? n : null;
    }
    case 'json': {
      if (Array.isArray(v)) return v;
      if (isEmpty(v)) return [];
      try {
        const parsed = JSON.parse(String(v));
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
  }
}
