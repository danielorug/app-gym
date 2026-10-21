// Sincronización con Google Sheets.
// Todo se guarda primero en el teléfono (funciona sin señal en el gym) y se sube cuando hay internet.
// Regla: gana el cambio con `updatedAt` más reciente.

import { useSyncExternalStore } from 'react';
import { db, getMeta, onLocalChange, setMeta, table } from '../db/db';
import type { RowByTable, TableName } from '../db/types';
import { TABLES } from '../db/types';
import { decodeRow, encodeRow, type SheetRow } from './schema';
import { callApi, chunk, errorMessage, SyncError, validateUrl, type SyncConfig } from './transport';

export type { SyncConfig } from './transport';

export type SyncState = 'off' | 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncStatus {
  state: SyncState;
  lastSyncAt: number | null;
  pending: number;
  error: string | null;
}

const CONFIG_KEY = 'sync.config';
const SINCE_KEY = 'sync.since';
const LAST_SYNC_KEY = 'sync.lastSyncAt';

const PUSH_BATCH = 500;
const PULL_LIMIT = 2000;
const DEBOUNCE_MS = 4000;
const INTERVAL_MS = 5 * 60 * 1000;

// ---------- Estado observable ----------

let status: SyncStatus = { state: 'off', lastSyncAt: null, pending: 0, error: null };
const listeners = new Set<(s: SyncStatus) => void>();

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((fn) => fn(status));
}

export function getSyncStatus(): SyncStatus {
  return status;
}

export function subscribeSyncStatus(fn: (s: SyncStatus) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeSyncStatus, getSyncStatus, getSyncStatus);
}

async function countPending(): Promise<number> {
  const counts = await Promise.all(TABLES.map((t) => table(t).where('dirty').equals(1).count()));
  return counts.reduce((a, b) => a + b, 0);
}

async function refreshPending() {
  setStatus({ pending: await countPending() });
}

// ---------- Configuración ----------

export async function getSyncConfig(): Promise<SyncConfig | null> {
  return getMeta<SyncConfig | null>(CONFIG_KEY, null);
}

/** Guarda la conexión. `null` = desconectar (los datos locales se quedan). */
export async function setSyncConfig(cfg: SyncConfig | null): Promise<void> {
  const prev = await getSyncConfig();
  if (!cfg) {
    await setMeta(CONFIG_KEY, null);
    setStatus({ state: 'off', error: null });
    return;
  }
  const clean = { url: cfg.url.trim(), token: cfg.token.trim() };
  await setMeta(CONFIG_KEY, clean);
  if (!prev || prev.url !== clean.url) {
    // Hoja nueva: bajar todo desde cero y subir todo lo que hay en el teléfono
    // (si la hoja ya tiene una versión más nueva de algo, la hoja gana).
    await setMeta(SINCE_KEY, 0);
    await markAllDirty();
  }
  setStatus({ state: 'idle', error: null });
  await refreshPending();
  if (autoStarted) void syncNow();
}

async function markAllDirty() {
  await db.transaction('rw', TABLES.map((t) => table(t)), async () => {
    for (const t of TABLES) await table(t).toCollection().modify({ dirty: 1 });
  });
}

export async function testConnection(cfg: SyncConfig): Promise<{ ok: boolean; error?: string }> {
  const urlError = validateUrl(cfg.url);
  if (urlError) return { ok: false, error: urlError };
  if (!cfg.token.trim()) return { ok: false, error: 'Falta el token' };
  try {
    await callApi(cfg, { action: 'ping' });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// ---------- Sincronizar ----------

export interface SyncResult {
  ok: boolean;
  pushed: number;
  pulled: number;
  error?: string;
}

let running: Promise<SyncResult> | null = null;
let again = false;

/** Sube cambios pendientes y baja lo nuevo. Si ya hay una sincronización corriendo, se encadena otra al terminar. */
export function syncNow(): Promise<SyncResult> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    let result: SyncResult;
    do {
      again = false;
      result = await runSync();
    } while (again && result.ok);
    return result;
  })().finally(() => {
    running = null;
  });
  return running;
}

async function runSync(): Promise<SyncResult> {
  const cfg = await getSyncConfig();
  if (!cfg) {
    setStatus({ state: 'off', error: null });
    await refreshPending();
    return { ok: false, pushed: 0, pulled: 0, error: 'Google Sheets no está conectado' };
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setStatus({ state: 'offline', error: null });
    await refreshPending();
    return { ok: false, pushed: 0, pulled: 0, error: 'Sin conexión' };
  }
  setStatus({ state: 'syncing', error: null });
  try {
    const pushed = await pushAll(cfg);
    const pulled = await pullAll(cfg);
    const now = Date.now();
    await setMeta(LAST_SYNC_KEY, now);
    setStatus({ state: 'idle', lastSyncAt: now, error: null, pending: await countPending() });
    return { ok: true, pushed, pulled };
  } catch (err) {
    const message = errorMessage(err);
    const offline = err instanceof SyncError && err.kind === 'offline';
    setStatus({ state: offline ? 'offline' : 'error', error: offline ? null : message, pending: await countPending() });
    return { ok: false, pushed: 0, pulled: 0, error: message };
  }
}

interface Pending {
  name: TableName;
  row: RowByTable[TableName];
}

async function pushAll(cfg: SyncConfig): Promise<number> {
  const pending: Pending[] = [];
  for (const name of TABLES) {
    const rows = await table(name).where('dirty').equals(1).toArray();
    for (const row of rows) pending.push({ name, row });
  }
  if (pending.length === 0) return 0;

  const names = new Map((await db.exercises.toArray()).map((e) => [e.id, e.name]));
  const ctx = { exerciseName: (id: string) => names.get(id) };

  let pushed = 0;
  for (const batch of chunk(pending, PUSH_BATCH)) {
    const tables: Partial<Record<TableName, SheetRow[]>> = {};
    for (const { name, row } of batch) {
      (tables[name] ??= []).push(encodeRow(name, row as never, ctx));
    }
    await callApi(cfg, { action: 'push', tables });
    await clearDirty(batch);
    pushed += batch.length;
  }
  return pushed;
}

/** Quita la marca de pendiente solo si la fila no cambió mientras se subía. */
async function clearDirty(batch: Pending[]) {
  await db.transaction('rw', TABLES.map((t) => table(t)), async () => {
    for (const name of TABLES) {
      const sent = batch.filter((p) => p.name === name).map((p) => p.row);
      if (sent.length === 0) continue;
      const current = await table(name).bulkGet(sent.map((r) => r.id));
      const done = current
        .filter((cur, i): cur is NonNullable<typeof cur> => !!cur && cur.updatedAt === sent[i].updatedAt && cur.dirty === 1)
        .map((cur) => ({ ...cur, dirty: 0 as const }));
      if (done.length) await table(name).bulkPut(done as never[]);
    }
  });
}

async function pullAll(cfg: SyncConfig): Promise<number> {
  let since = await getMeta<number>(SINCE_KEY, 0);
  let pulled = 0;
  for (let page = 0; page < 10_000; page++) {
    const res = await callApi(cfg, { action: 'pull', since, limit: PULL_LIMIT });
    pulled += await applyPulled(res.tables);
    since = res.serverTime;
    await setMeta(SINCE_KEY, since);
    if (!res.more) break;
  }
  return pulled;
}

/** Aplica lo que viene de la hoja. Solo gana si es más nuevo que lo local. */
async function applyPulled(tables: Partial<Record<TableName, Record<string, unknown>[]>>): Promise<number> {
  let applied = 0;
  await db.transaction('rw', TABLES.map((t) => table(t)), async () => {
    for (const name of TABLES) {
      const incoming = (tables[name] ?? []).map((raw) => decodeRow(name, raw)).filter((r) => r.id);
      if (incoming.length === 0) continue;
      const local = await table(name).bulkGet(incoming.map((r) => r.id));
      const toPut = incoming
        .filter((r, i) => !local[i] || local[i]!.updatedAt < r.updatedAt)
        .map((r) => ({ ...r, dirty: 0 as const }));
      if (toPut.length) await table(name).bulkPut(toPut as never[]);
      applied += toPut.length;
    }
  });
  return applied;
}

// ---------- Automático ----------

let autoStarted = false;

/** Sincroniza al abrir, al volver la señal, al regresar a la app, unos segundos después de cada cambio y cada 5 min. */
export function startAutoSync(): void {
  if (autoStarted) return;
  autoStarted = true;

  void (async () => {
    const [cfg, lastSyncAt] = await Promise.all([getSyncConfig(), getMeta<number | null>(LAST_SYNC_KEY, null)]);
    setStatus({ state: cfg ? 'idle' : 'off', lastSyncAt });
    await refreshPending();
    if (cfg) void syncNow();
  })();

  let timer: ReturnType<typeof setTimeout> | null = null;
  onLocalChange(() => {
    void refreshPending();
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void syncNow();
    }, DEBOUNCE_MS);
  });

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => void syncNow());
    window.addEventListener('offline', () => {
      if (status.state !== 'off') setStatus({ state: 'offline' });
    });
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void syncNow();
    });
  }
  setInterval(() => {
    if (typeof document === 'undefined' || document.visibilityState === 'visible') void syncNow();
  }, INTERVAL_MS);
}
