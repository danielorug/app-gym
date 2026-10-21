// Llamadas al Apps Script de Google Sheets. Sin Dexie, para poder usarse desde Node.

import type { TableName } from '../db/types';
import type { SheetRow } from './schema';

export interface SyncConfig {
  url: string;
  token: string;
}

export type SyncErrorKind = 'offline' | 'token' | 'badurl' | 'config' | 'server';

export class SyncError extends Error {
  kind: SyncErrorKind;
  constructor(kind: SyncErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = 'SyncError';
  }
}

export interface PingResponse {
  ok: true;
  serverTime: number;
}
export interface PushResponse {
  ok: true;
  serverTime: number;
  written: number;
  skipped: number;
}
export interface PullResponse {
  ok: true;
  serverTime: number;
  more: boolean;
  tables: Partial<Record<TableName, Record<string, unknown>[]>>;
}

export type ApiRequest =
  | { action: 'ping' }
  | { action: 'push'; tables: Partial<Record<TableName, SheetRow[]>> }
  | { action: 'pull'; since: number; limit?: number };

type ResponseFor<R extends ApiRequest> = R extends { action: 'ping' }
  ? PingResponse
  : R extends { action: 'push' }
    ? PushResponse
    : PullResponse;

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export function validateUrl(url: string): string | null {
  const u = url.trim();
  if (!u) return 'Falta la URL';
  if (!/^https:\/\//i.test(u)) return 'La URL debe empezar con https://';
  return null;
}

/** Con señal mala (el gym) una petición puede quedarse colgada; sin límite, la sincronización se trababa. */
export const REQUEST_TIMEOUT_MS = 60_000;

export async function callApi<R extends ApiRequest>(cfg: SyncConfig, req: R): Promise<ResponseFor<R>> {
  const urlError = validateUrl(cfg.url);
  if (urlError) throw new SyncError('badurl', urlError);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const slow = () => new SyncError('offline', 'Conexión muy lenta; se reintentará después');
  let res: Response;
  let data: unknown;
  try {
    try {
      res = await fetch(cfg.url.trim(), {
        method: 'POST',
        // text/plain evita el "preflight" de CORS, que Apps Script no contesta.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...req, token: cfg.token.trim() }),
        redirect: 'follow',
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) throw slow();
      if (isOffline()) throw new SyncError('offline', 'Sin conexión');
      throw new SyncError(
        'badurl',
        'No se pudo conectar con Google Sheets. Revisa la URL y que el acceso de la implementación sea "Cualquier persona".',
      );
    }
    if (!res.ok) throw new SyncError('badurl', `La URL no responde como App Gym (error ${res.status})`);

    try {
      data = await res.json();
    } catch {
      if (controller.signal.aborted) throw slow();
      throw new SyncError(
        'badurl',
        'La URL no responde como App Gym. ¿Copiaste la URL que termina en /exec y el acceso es "Cualquier persona"?',
      );
    }
  } finally {
    clearTimeout(timer);
  }
  if (!data || typeof data !== 'object' || !('ok' in data)) {
    throw new SyncError('badurl', 'La URL no responde como App Gym');
  }
  const body = data as { ok: boolean; error?: string };
  if (!body.ok) {
    if (body.error === 'token') throw new SyncError('token', 'Token incorrecto');
    if (body.error === 'config') throw new SyncError('config', 'Falta correr "configurar" en Apps Script');
    if (body.error === 'ocupado') throw new SyncError('server', 'Google Sheets está ocupado, intenta en un momento');
    throw new SyncError('server', `Error en Google Sheets: ${body.error ?? 'desconocido'}`);
  }
  return data as ResponseFor<R>;
}

export function errorMessage(err: unknown): string {
  if (err instanceof SyncError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Divide una lista en grupos de `size`. */
export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
