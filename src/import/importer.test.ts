import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanNote, importNotes } from './importer';

// La nota real tiene datos personales: no vive en el repo. El script `npm run importar`
// guarda una copia en importado/notas.html (ignorado por git); si no existe, se salta.
const fixture = [resolve('importado/notas.html'), process.env.NOTAS_HTML ?? ''].find((p) => p && existsSync(p));

describe('cleanNote', () => {
  it('quita notas de un solo día y sobrantes', () => {
    expect(cleanNote('?')).toBe('');
    expect(cleanNote('Converging Chest Press si está ocupada la banca')).toBe('');
    expect(cleanNote('Acostado: Prone Leg curl')).toBe('');
    expect(cleanNote('(Anotaste 9 kg, pero también escribiste 4.5 kg)')).toBe('');
    expect(cleanNote('Pausa corta arriba\nFinal')).toBe('Pausa corta arriba');
    expect(cleanNote('En número 18')).toBe('En número 18');
  });
});

describe('estructura mínima', () => {
  it('fechas, separadores, variantes y filas sueltas', () => {
    const td = (s: string) => `<td><div>${s}</div></td>`;
    const row = (...c: string[]) => `<tr>${c.map(td).join('')}</tr>`;
    const varRow = (h: string, a: string[], b: string[], c: string[], d: string[], n: string) =>
      `<tr>${td(h)}<td>${a.map((x) => `<div>${x}</div>`).join('')}</td><td>${b.map((x) => `<div>${x}</div>`).join('')}</td><td>${c
        .map((x) => `<div>${x}</div>`)
        .join('')}</td><td>${d.map((x) => `<div>${x}</div>`).join('')}</td>${td(n)}</tr>`;
    const header = row('#', 'Ejercicio', 'Series', 'Peso', 'Reps', 'Notas');
    const html = [
      '<div>1 de Octubre 2026</div>',
      `<table>${header}${varRow('1', ['Convering chest', 'Press de banca'], ['1 - 2', '1 - 2 - 1'], ['39 kg', 'Barra - 5x2 - 7.5x2'], ['8 - 7', '12 - 10 - 7'], '')}</table>`,
      '<div>————————</div>',
      `<table>${row('1', 'Plan', '3', '20 kg', '8-10', '')}</table>`,
      '<div>5 de Octubre 2026</div>',
      `<table>${header}${varRow('1', ['Convering chest', 'Press de banca'], ['2 - 1', '1 - 2 - 1'], ['39 kg', 'Barra - 5x2 - 7.5x2'], ['10 - 8', '12 - 10 - 7'], '')}${row(
        'NO',
        'Dominadas',
        '1',
        'Peso corporal',
        '3',
        'Récord: 5.5',
      )}</table>`,
      '<div>3 de Octubre 2026</div>',
      `<table>${header}${row('1', 'Jalón al pecho', '3', '45 kg', '10', '')}</table>`,
      '<div>7 de Octubre 2025</div>',
      `<table>${header}${row('1', 'Jalón al pecho', '3', '45 kg', '11', '')}</table>`,
    ].join('\n');
    const { backup, report } = importNotes(html);
    expect(backup.sessions.map((s) => s.date)).toEqual(['2026-10-01', '2026-10-05', '2026-10-06', '2026-10-07']);
    expect(report.dateFixes).toEqual([
      { heading: '3 de Octubre 2026', parsed: '2026-10-03', used: '2026-10-06' },
      { heading: '7 de Octubre 2025', parsed: '2025-10-07', used: '2026-10-07' }, // año equivocado
    ]);
    expect(report.skippedTables).toHaveLength(1);
    // 1 oct: las dos variantes son nuevas → ambas cuentan. 5 oct: la banca quedó igual → no se hizo.
    const names = (date: string) =>
      backup.entries.filter((e) => e.sessionId === `ss-${date}`).map((e) => backup.exercises.find((x) => x.id === e.exerciseId)!.name);
    expect(names('2026-10-01')).toEqual(['Converging Chest Press', 'Press de banca']);
    expect(names('2026-10-05')).toEqual(['Converging Chest Press']);
    expect(backup.exercises.find((e) => e.name === 'Dominadas')?.notes).toBe('Récord: 5.5');
    // IDs deterministas
    expect(backup.sets.map((s) => s.id)).toContain('st-2026-10-05-1-3');
  });
});

describe.skipIf(!fixture)('nota real de gym', () => {
  const { backup, report } = importNotes(readFileSync(fixture!, 'utf8'));
  const ex = (name: string) => backup.exercises.find((e) => e.name === name)!;
  const setsOf = (date: string, name: string) => {
    const entry = backup.entries.find((e) => e.sessionId === `ss-${date}` && e.exerciseId === ex(name)?.id);
    return entry ? backup.sets.filter((s) => s.entryId === entry.id) : [];
  };

  it('importa las sesiones con fechas en orden', () => {
    expect(report.sessions).toBeGreaterThanOrEqual(47);
    const dates = backup.sessions.map((s) => s.date);
    expect([...dates].sort()).toEqual(dates);
    expect(new Set(dates).size).toBe(dates.length);
    expect(dates[0]).toBe('2026-07-23');
    expect(report.skippedTables).toHaveLength(2);
  });

  it('la pierna escrita como "15 de Octubre" después del 16 es el 17', () => {
    expect(report.dateFixes.some((f) => f.heading === '15 de Octubre 2026' && f.used === '2026-10-17')).toBe(true);
    expect(backup.sessions.find((s) => s.date === '2026-10-17')?.routineId).toBe('rt-legs');
  });

  it('15 oct: Converging sí, banca no; mancuernas terminan en 32.5 lb', () => {
    expect(setsOf('2026-10-15', 'Converging Chest Press').map((s) => s.weight)).toEqual([32, 39, 39, 45]);
    expect(setsOf('2026-10-15', 'Press de banca')).toEqual([]);
    const db = setsOf('2026-10-15', 'Press inclinado con mancuernas');
    expect(db.map((s) => [s.weight, s.unit, s.reps])).toEqual([
      [30, 'lb', 10],
      [30, 'lb', 10],
      [32.5, 'lb', 10],
    ]);
  });

  it('16 oct: shoulder press como lo explicó el usuario', () => {
    expect(setsOf('2026-10-16', 'Converging Shoulder Press').map((s) => [s.weight, s.reps])).toEqual([
      [14, 12],
      [18, 10],
      [23, 7],
      [23, 6],
    ]);
  });

  it('series combinadas, discos y marcas de revisión', () => {
    expect(setsOf('2026-10-13', 'Remo T en máquina')[0]).toMatchObject({ weight: 27, weight2: 32, reps: 8, reps2: 5 });
    expect(setsOf('2026-10-17', 'Sentadilla con barra').map((s) => [s.load, s.weight, s.unit])).toEqual([
      ['lado', 0, 'lb'],
      ['lado', 25, 'lb'],
      ['lado', 35, 'lb'],
    ]);
    const deadlift = backup.entries.find((e) => e.sessionId === 'ss-2026-10-17' && e.exerciseId === ex('Peso muerto').id)!;
    expect(deadlift.review).toBe(1);
  });

  it('rutinas desde las últimas sesiones de cada tipo', () => {
    const slots = (id: string) => backup.slots.filter((s) => s.routineId === id).sort((a, b) => a.order - b.order);
    expect(slots('rt-push')[0].exerciseIds).toEqual([ex('Converging Chest Press').id, ex('Press de banca').id]);
    expect(slots('rt-pull').at(-1)).toMatchObject({ kind: 'no', exerciseIds: [ex('Dominadas').id] });
    expect(slots('rt-push').at(-1)).toMatchObject({ kind: 'opcional', exerciseIds: [ex('Fondos').id] });
    expect(slots('rt-legs').map((s) => s.exerciseIds[0])).not.toContain(undefined);
    expect(new Set(slots('rt-legs').map((s) => s.exerciseIds[0])).size).toBe(slots('rt-legs').length);
  });

  it('todas las filas tienen los campos del modelo', () => {
    for (const s of backup.sets) {
      expect(s.deleted).toBe(0);
      expect(['kg', 'lb']).toContain(s.unit);
      expect(s).not.toHaveProperty('dirty');
    }
    expect(backup.sessions.every((s) => s.source === 'notas')).toBe(true);
  });
});
