// Subir un respaldo completo (por ejemplo el historial importado de Notas) directo a la hoja.
// Sin Dexie: lo usa scripts/subir-a-sheets.ts desde Node.

import type { Backup, RowByTable, TableName } from '../db/types';
import { TABLES } from '../db/types';
import { encodeRow, type SheetRow } from './schema';
import { callApi, chunk, type SyncConfig } from './transport';

export const UPLOAD_BATCH = 500;

export interface UploadProgress {
  sent: number;
  total: number;
  written: number;
  skipped: number;
}

export async function uploadBackup(
  cfg: SyncConfig,
  backup: Backup,
  onProgress?: (p: UploadProgress) => void,
): Promise<UploadProgress> {
  if (backup.app !== 'app-gym') throw new Error('El archivo no es un respaldo de App Gym');
  const names = new Map(backup.exercises.map((e) => [e.id, e.name]));
  const ctx = { exerciseName: (id: string) => names.get(id) };

  const all: { name: TableName; row: SheetRow }[] = [];
  for (const name of TABLES) {
    for (const row of (backup[name] ?? []) as RowByTable[TableName][]) {
      all.push({ name, row: encodeRow(name, row as never, ctx) });
    }
  }

  const progress: UploadProgress = { sent: 0, total: all.length, written: 0, skipped: 0 };
  for (const batch of chunk(all, UPLOAD_BATCH)) {
    const tables: Partial<Record<TableName, SheetRow[]>> = {};
    for (const { name, row } of batch) (tables[name] ??= []).push(row);
    const res = await callApi(cfg, { action: 'push', tables });
    progress.sent += batch.length;
    progress.written += res.written;
    progress.skipped += res.skipped;
    onProgress?.({ ...progress });
  }
  return progress;
}
