// Sube un respaldo de App Gym (por defecto el historial importado de Notas) directo a Google Sheets.
// Uso:
//   npx tsx scripts/subir-a-sheets.ts --url <URL /exec> --token <token> [--file importado/historial.json]
// Después, la app del teléfono baja todo en su primera sincronización.

import { readFileSync } from 'node:fs';
import type { Backup } from '../src/db/types';
import { errorMessage } from '../src/sync/transport';
import { uploadBackup } from '../src/sync/upload';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const url = arg('url');
  const token = arg('token');
  const file = arg('file') ?? 'importado/historial.json';
  if (!url || !token) {
    console.error('Uso: npx tsx scripts/subir-a-sheets.ts --url <URL /exec> --token <token> [--file importado/historial.json]');
    process.exit(1);
  }

  let backup: Backup;
  try {
    backup = JSON.parse(readFileSync(file, 'utf8')) as Backup;
  } catch (err) {
    console.error(`No se pudo leer ${file}: ${errorMessage(err)}`);
    process.exit(1);
  }

  console.log(
    `Subiendo ${file}: ${backup.sessions.length} sesiones, ${backup.entries.length} ejercicios, ${backup.sets.length} series…`,
  );
  const result = await uploadBackup({ url, token }, backup, (p) => {
    console.log(`  ${p.sent}/${p.total} filas enviadas`);
  });
  console.log(
    `Listo: ${result.written} filas guardadas en la hoja` +
      (result.skipped ? `, ${result.skipped} sin cambios (la hoja ya tenía una versión más nueva)` : '') +
      '.',
  );
}

main().catch((err) => {
  console.error(`Error: ${errorMessage(err)}`);
  process.exit(1);
});
