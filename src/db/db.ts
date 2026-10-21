import Dexie, { type Table } from 'dexie';
import type { Backup, Entry, Exercise, Routine, RoutineSlot, RowByTable, Session, TableName, WorkSet } from './types';
import { TABLES } from './types';

export interface Meta {
  key: string;
  value: unknown;
}

class GymDB extends Dexie {
  exercises!: Table<Exercise, string>;
  routines!: Table<Routine, string>;
  slots!: Table<RoutineSlot, string>;
  sessions!: Table<Session, string>;
  entries!: Table<Entry, string>;
  sets!: Table<WorkSet, string>;
  meta!: Table<Meta, string>;

  constructor(name = 'app-gym') {
    super(name);
    this.version(1).stores({
      exercises: 'id, name, dirty',
      routines: 'id, order, dirty',
      slots: 'id, routineId, dirty',
      sessions: 'id, date, routineId, dirty',
      entries: 'id, sessionId, exerciseId, review, dirty',
      sets: 'id, entryId, sessionId, exerciseId, date, dirty, [exerciseId+date]',
      meta: 'key',
    });
  }
}

export const db = new GymDB();

export function table<T extends TableName>(name: T): Table<RowByTable[T], string> {
  return db.table(name);
}

export function newId(prefix = ''): string {
  return prefix + crypto.randomUUID();
}

/** Guarda filas marcándolas como cambio local pendiente de sincronizar. */
export async function save<T extends TableName>(name: T, rows: RowByTable[T] | RowByTable[T][]): Promise<void> {
  const list = Array.isArray(rows) ? rows : [rows];
  const now = Date.now();
  await table(name).bulkPut(list.map((r) => ({ ...r, updatedAt: now, dirty: 1 as const })));
  notifyChange();
}

/** Borrado lógico (para que el borrado también llegue a Sheets). */
export async function remove<T extends TableName>(name: T, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const now = Date.now();
  await db.transaction('rw', table(name), async () => {
    const rows = await table(name).bulkGet(ids);
    const updated = rows.filter((r): r is NonNullable<typeof r> => !!r).map((r) => ({ ...r, deleted: 1 as const, updatedAt: now, dirty: 1 as const }));
    await table(name).bulkPut(updated);
  });
  notifyChange();
}

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key);
  return row === undefined ? fallback : (row.value as T);
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

// Aviso de "hubo cambios locales" para que el módulo de sync suba en segundo plano.
type Listener = () => void;
const listeners = new Set<Listener>();
export function onLocalChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notifyChange() {
  listeners.forEach((fn) => fn());
}

export async function exportBackup(): Promise<Backup> {
  const [exercises, routines, slots, sessions, entries, sets] = await Promise.all(TABLES.map((t) => table(t).toArray()));
  const strip = <R extends { dirty?: unknown }>(rows: R[]) => rows.map(({ dirty: _d, ...r }) => r as R);
  return {
    app: 'app-gym',
    version: 1,
    exportedAt: Date.now(),
    exercises: strip(exercises as Exercise[]),
    routines: strip(routines as Routine[]),
    slots: strip(slots as RoutineSlot[]),
    sessions: strip(sessions as Session[]),
    entries: strip(entries as Entry[]),
    sets: strip(sets as WorkSet[]),
  };
}

/**
 * Mete un respaldo (o el historial importado) a la base local.
 * Gana la versión con `updatedAt` más reciente, así que reimportar no pisa lo que ya editaste.
 * `markDirty` = subirlo a Sheets en la siguiente sincronización.
 */
export async function importBackup(data: Backup, { markDirty = true } = {}): Promise<number> {
  if (data.app !== 'app-gym') throw new Error('El archivo no es un respaldo de App Gym');
  let count = 0;
  await db.transaction('rw', TABLES.map((t) => table(t)), async () => {
    for (const name of TABLES) {
      const incoming = (data[name] ?? []) as RowByTable[typeof name][];
      if (incoming.length === 0) continue;
      const existing = await table(name).bulkGet(incoming.map((r) => r.id));
      const toPut = incoming
        .filter((r, i) => !existing[i] || existing[i]!.updatedAt < r.updatedAt)
        .map((r) => ({ ...r, dirty: markDirty ? (1 as const) : (0 as const) }));
      await table(name).bulkPut(toPut as never[]);
      count += toPut.length;
    }
  });
  notifyChange();
  return count;
}
