import type { ReportData } from './importer';

const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ⏎ ');

/** Reporte en Markdown (español) de lo que hizo el importador. */
export function renderReport(r: ReportData, source: string): string {
  const out: string[] = [];
  out.push('# Importación del historial de Notas', '');
  out.push(`Fuente: ${source}`, '');
  out.push('## Resumen', '');
  out.push(`- Sesiones importadas: **${r.sessions}** (${r.firstDate ?? '—'} a ${r.lastDate ?? '—'})`);
  out.push(`- Ejercicios: **${r.exercises}**`);
  out.push(`- Ejercicios registrados en sesiones: ${r.entries}`);
  out.push(`- Series: **${r.sets}**`);
  out.push(`- Para revisar: **${r.review.length}**`);
  out.push(`- Filas omitidas: ${r.skipped.length} · Tablas sin fecha omitidas: ${r.skippedTables.length}`, '');

  if (r.dateFixes.length) {
    out.push('## Fechas corregidas', '');
    out.push('Las fechas tienen que ir en orden. Si una va hacia atrás es un typo: si el año está mal se corrige el año; si no, se usa el día siguiente a la sesión anterior.', '');
    for (const f of r.dateFixes) out.push(`- "${f.heading}" → se leyó ${f.parsed}, se usó **${f.used}**`);
    out.push('');
  }

  out.push('## Para revisar', '');
  if (r.review.length === 0) out.push('Nada. 🎉', '');
  else {
    out.push('| Fecha | Ejercicio | Texto original | Motivo |', '|---|---|---|---|');
    for (const i of r.review) out.push(`| ${i.date} | ${esc(i.exercise)} | ${esc(i.raw)} | ${esc(i.reason)} |`);
    out.push('');
  }

  out.push('## Rutinas creadas', '');
  for (const rt of r.routines) {
    out.push(`### ${rt.name} (desde la sesión del ${rt.source})`, '');
    rt.slots.forEach((s, i) => out.push(`${i + 1}. ${s}`));
    out.push('');
  }

  out.push('## Sesiones', '');
  out.push('| Fecha | Título | Rutina |', '|---|---|---|');
  for (const s of r.sessionTitles) out.push(`| ${s.date} | ${esc(s.title)} | ${s.routine ?? '—'} |`);
  out.push('');

  out.push('## Ejercicios', '');
  out.push('Nombres como aparecían en la nota y a qué ejercicio se unieron. ⚠️ = unión no 100% segura.', '');
  out.push('| Ejercicio | Escrito en la nota como | Sesiones | Unidad | Peso |', '|---|---|---|---|---|');
  for (const m of r.merges) {
    const raws = m.rawNames.map((n) => (m.unsure.includes(n) ? `⚠️ ${n}` : n)).join(' · ');
    out.push(`| ${esc(m.name)} | ${esc(raws)} | ${m.sessions} | ${m.unit} | ${m.load} |`);
  }
  out.push('');

  out.push('## Omitido', '');
  if (r.skippedTables.length) {
    out.push('### Tablas sin fecha', '');
    for (const t of r.skippedTables) out.push(`- ${esc(t.text)} — ${t.reason}`);
    out.push('');
  }
  const byReason = new Map<string, typeof r.skipped>();
  for (const s of r.skipped) byReason.set(s.reason, [...(byReason.get(s.reason) ?? []), s]);
  for (const [reason, items] of byReason) {
    out.push(`### ${reason} (${items.length})`, '');
    for (const s of items) out.push(`- ${s.date ?? '—'}: ${esc(s.text)}`);
    out.push('');
  }
  return out.join('\n');
}
