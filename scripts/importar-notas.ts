// Importa el historial de la nota de gym (app Notas) a un respaldo de App Gym.
//
//   npm run importar                          → lee la nota "23 Julio 2026" directo de Notas
//   npm run importar -- --nota "Otra nota"    → otra nota
//   npm run importar -- --html archivo.html   → desde un HTML guardado (sin abrir Notas)
//
// Escribe en importado/: historial.json (para cargar en la app), reporte.md y notas.html.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { importNotes } from '../src/import/importer';
import { renderReport } from '../src/import/report';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const outDir = resolve(arg('out') ?? 'importado');
const htmlPath = arg('html');
const noteName = arg('nota') ?? '23 Julio 2026';

let html: string;
let source: string;
if (htmlPath) {
  html = readFileSync(htmlPath, 'utf8');
  source = `archivo ${htmlPath}`;
} else {
  const script = `tell application "Notes" to get body of note ${JSON.stringify(noteName)}`;
  try {
    html = execFileSync('osascript', ['-e', script], { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 });
  } catch (err) {
    console.error(`No pude leer la nota "${noteName}" de la app Notas.`);
    console.error('Revisa que exista y que la Terminal tenga permiso para controlar Notas (Ajustes del Sistema → Privacidad → Automatización).');
    throw err;
  }
  source = `nota "${noteName}" de la app Notas`;
}

const { backup, report } = importNotes(html);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'notas.html'), html);
writeFileSync(join(outDir, 'historial.json'), JSON.stringify(backup, null, 1));
writeFileSync(join(outDir, 'reporte.md'), renderReport(report, source));

console.log(`Leído: ${source}`);
console.log(`Sesiones: ${report.sessions} (${report.firstDate} a ${report.lastDate})`);
console.log(`Ejercicios: ${report.exercises} · Series: ${report.sets} · Para revisar: ${report.review.length}`);
if (report.dateFixes.length) console.log(`Fechas corregidas: ${report.dateFixes.map((f) => `"${f.heading}" → ${f.used}`).join(', ')}`);
console.log(`Archivos en ${outDir}: historial.json, reporte.md, notas.html`);
