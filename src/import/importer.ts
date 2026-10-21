// Convierte la nota de gym de la app Notas en un respaldo (Backup) de App Gym.
// Funciones puras: el script de terminal solo lee la nota y escribe los archivos.

import type { Backup, Entry, Exercise, LoadMode, Routine, RoutineSlot, Session, SlotKind, Unit, WorkSet } from '../db/types';
import { addDays, isSeparator, noonLocal, parseDateHeading } from './dates';
import { parseNotesHtml, type Row } from './html';
import { canonicalName, groupOf, isBodyweightName, isSkippedName, muscleOf, nameKey, slugify, UNSURE_ALIASES, type Group, type Muscle } from './names';
import { expandRow, isEmptyCell, parseCounts, parseWeightCell, type ExpandedSet } from './notation';

export interface ReviewItem {
  date: string;
  exercise: string;
  raw: string;
  reason: string;
}
export interface SkipItem {
  date: string | null;
  text: string;
  reason: string;
}
export interface DateFix {
  heading: string;
  parsed: string;
  used: string;
}
export interface MergeInfo {
  name: string;
  rawNames: string[];
  unsure: string[];
  sessions: number;
  unit: Unit;
  load: LoadMode;
}
export interface ReportData {
  sessions: number;
  entries: number;
  sets: number;
  exercises: number;
  firstDate: string | null;
  lastDate: string | null;
  dateFixes: DateFix[];
  review: ReviewItem[];
  skipped: SkipItem[];
  skippedTables: SkipItem[];
  merges: MergeInfo[];
  routines: { name: string; source: string; slots: string[] }[];
  sessionTitles: { date: string; title: string; routine: string | null }[];
}

export interface ImportResult {
  backup: Backup;
  report: ReportData;
}

// ---------------------------------------------------------------- secciones

interface Section {
  heading: string;
  date: string;
  label: string | null;
  tables: Row[][];
}

function splitSections(html: string) {
  const sections: Section[] = [];
  const skippedTables: SkipItem[] = [];
  const dateFixes: DateFix[] = [];
  let current: Section | null = null;
  let prev: string | null = null;
  let lastText = '';

  for (const b of parseNotesHtml(html)) {
    if (b.type === 'text') {
      lastText = b.text;
      if (isSeparator(b.text)) {
        current = null;
        continue;
      }
      const h = parseDateHeading(b.text, prev);
      if (!h) continue;
      let date = h.date;
      if (prev && date <= prev) {
        // Año equivocado ("20 de Octubre 2025" después de 2026) → mismo día con el año correcto;
        // si aun así va hacia atrás, es el día siguiente a la sesión anterior.
        const sameYear = `${prev.slice(0, 4)}${date.slice(4)}`;
        const used = date.slice(0, 4) !== prev.slice(0, 4) && sameYear > prev ? sameYear : addDays(prev, 1);
        dateFixes.push({ heading: b.text, parsed: date, used });
        date = used;
      }
      current = { heading: b.text, date, label: h.label, tables: [] };
      sections.push(current);
      prev = date;
    } else if (current) {
      current.tables.push(b.rows);
    } else {
      const first = b.rows.find((r) => !/^ejercicio/i.test(nameKey((r[1] ?? []).join(' '))) && !/ejercicio/i.test(nameKey((r[0] ?? []).join(' '))));
      skippedTables.push({
        date: null,
        text: `Después de "${lastText}" — ${b.rows.length} filas, ej. "${(first ?? b.rows[0] ?? []).map((c) => c.join(' / ')).join(' | ')}"`,
        reason: 'Tabla sin fecha (parece un plan, no un entrenamiento)',
      });
    }
  }
  return { sections, skippedTables, dateFixes };
}

// ---------------------------------------------------------------- notas

const DROP_NOTE_LINES = new Set(
  [
    'final',
    'calentamiento',
    'ultima serie',
    'series normales',
    'nuevo peso',
    'bajaste el peso',
    'la maquina estaba mal',
    'solo para probar',
    'solo practica tecnica',
    'no hubo buena postura',
    'ultima con esfuerzo',
    'ultima con ayuda',
    'costaron trabajo',
    'que me paso hoy',
    'dos series en 15 kg',
    'barra',
    'barra la segunda serie costo mas trabajo',
    'no subir mas',
  ].map(nameKey),
);

export function cleanNote(text: string): string {
  return text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l !== '')
    .filter((l) => !/^[?¿\s]+$/.test(l))
    .filter((l) => !/acostado:\s*prone leg curl/i.test(l))
    .filter((l) => !/si est[aá] ocupad/i.test(l))
    .filter((l) => !l.startsWith('('))
    .filter((l) => !DROP_NOTE_LINES.has(nameKey(l)))
    .join('\n');
}

// ---------------------------------------------------------------- registro de ejercicios

interface ExInfo {
  name: string;
  muscle: Muscle | null;
  rawNames: Set<string>;
  firstDate: string;
  lastDate: string;
  sessionDates: Set<string>;
  notes: { date: string; seq: number; text: string }[];
  /** Tiene una fila "NO" (se guarda para no perder el récord). */
  keep: boolean;
}

interface EntryDraft {
  exercise: string;
  note: string;
  raw: string;
  issues: string[];
  sets: ExpandedSet[];
}

interface SlotRow {
  names: string[];
  kind: SlotKind;
}

interface SessionDraft {
  date: string;
  label: string | null;
  entries: EntryDraft[];
  slotRows: SlotRow[];
}

const CONTINUATION_WEIGHT = /^\d+(?:[.,]\d+)?\s*(kgs?|lbs?|k)\b/i;
const ORDER_WORDS = new Set(['no', 'opcional', 'ultimo', 'oc', '']);

function sig(series: string, peso: string, reps: string): string {
  return [series, peso, reps].map((s) => s.toLowerCase().replace(/\s+/g, ' ').replace(/\s*-\s*$/g, '').trim()).join('|');
}

function noteUnit(note: string): Unit | null {
  const m = /\d+(?:[.,]\d+)?\s*(lbs?|kg)\b/i.exec(note);
  if (!m) return null;
  return m[1].toLowerCase().startsWith('l') ? 'lb' : 'kg';
}

function lineUnit(peso: string): Unit | null {
  return parseWeightCell(peso).find((w) => w.load === 'normal' && w.unit)?.unit ?? null;
}

// ---------------------------------------------------------------- importador

const ROUTINES: Record<Group, { id: string; name: string; weekdays: number[]; order: number }> = {
  push: { id: 'rt-push', name: 'Pecho, hombro y tríceps', weekdays: [1, 4], order: 1 },
  pull: { id: 'rt-pull', name: 'Espalda y bíceps', weekdays: [2, 5], order: 2 },
  legs: { id: 'rt-legs', name: 'Pierna', weekdays: [3, 6], order: 3 },
};

const MUSCLE_LABEL: Record<Muscle, string> = {
  pecho: 'Pecho',
  hombro: 'Hombro',
  triceps: 'Tríceps',
  espalda: 'Espalda',
  biceps: 'Bíceps',
  pierna: 'Pierna',
  core: 'Abdomen',
};

export function importNotes(html: string): ImportResult {
  const { sections, skippedTables, dateFixes } = splitSections(html);
  const skipped: SkipItem[] = [];
  const exReg = new Map<string, ExInfo>();
  const seenSigs = new Map<string, Set<string>>();
  const sessions: SessionDraft[] = [];
  let noteSeq = 0;

  const register = (name: string, raw: string, date: string, muscle: Muscle | null) => {
    let info = exReg.get(name);
    if (!info) {
      info = { name, muscle, rawNames: new Set(), firstDate: date, lastDate: date, sessionDates: new Set(), notes: [], keep: false };
      exReg.set(name, info);
    }
    info.rawNames.add(raw);
    if (date < info.firstDate) info.firstDate = date;
    if (date > info.lastDate) info.lastDate = date;
    return info;
  };
  // La última nota escrita manda, aunque al limpiarla quede vacía (ej. "?" o "si está ocupada…").
  const addNote = (name: string, date: string, text: string) => {
    if (!text.trim()) return;
    exReg.get(name)?.notes.push({ date, seq: noteSeq++, text: cleanNote(text) });
  };
  const seen = (name: string) => {
    let s = seenSigs.get(name);
    if (!s) seenSigs.set(name, (s = new Set()));
    return s;
  };

  for (const section of sections) {
    const date = section.date;
    const session: SessionDraft = { date, label: section.label, entries: [], slotRows: [] };
    const skip = (text: string, reason: string) => skipped.push({ date, text, reason });

    for (const table of section.tables) {
      // Tabla en formato compacto ("1 - 2 - 1"): ahí las filas sueltas son sobrantes de copias.
      const isCompact = table.some(
        (r) => !CONTINUATION_WEIGHT.test((r[1] ?? [])[0] ?? '') && (r[2] ?? []).some((l) => /\d\s+-\s*\d|\d\s*-\s+\d/.test(l) && !/min/i.test(l)),
      );
      let lastEntry: EntryDraft | null = null;

      for (const rawRow of table) {
        const cells: Row = Array.from({ length: 6 }, (_, i) => rawRow[i] ?? []);
        const hash = cells[0].join(' ').trim();
        const exLines = cells[1];
        const rowText = cells.map((c) => c.join(' / ')).join(' | ');

        // Encabezado
        if (/^ejercicio/.test(nameKey(exLines.join(' '))) || /^(#|orden)$/i.test(hash)) continue;

        // Fila "suelta" del formato viejo: | 2 | 25 kg | 10 | = 2 series más del ejercicio anterior
        if (exLines.length === 1 && CONTINUATION_WEIGHT.test(exLines[0]) && /^\d+$/.test(hash)) {
          if (!isCompact && lastEntry) {
            const exp = expandRow(hash, exLines[0], cells[2].join(' '), { bodyweight: isBodyweightName(lastEntry.exercise) });
            lastEntry.sets.push(...exp.sets);
            lastEntry.issues.push(...exp.issues);
            lastEntry.raw += `\n${rowText}`;
          } else {
            skip(rowText, 'Fila suelta sin ejercicio (sobrante de una copia)');
          }
          continue;
        }
        lastEntry = null;

        if (exLines.length === 0 || hash.includes('🏀')) {
          if (rowText.replace(/[|\s/]/g, '')) skip(rowText, 'Fila sin ejercicio');
          continue;
        }
        if (exLines.some(isSkippedName)) {
          skip(rowText, 'Calentamiento / cardio (no se registra)');
          continue;
        }

        const fire = hash.includes('🔥');
        const hashKey = nameKey(hash);
        const kind: SlotKind = hashKey === 'no' ? 'no' : hashKey === 'opcional' ? 'opcional' : 'normal';
        const dayNote = /[a-záéíóúñ]/i.test(hash) && !ORDER_WORDS.has(hashKey) ? hash : '';
        const nLines = Math.max(1, ...[1, 2, 3, 4].map((c) => cells[c].length));
        const col = (c: number, i: number) => {
          const lines = cells[c];
          if (nLines === 1) return lines.join(' ');
          if (lines.length === nLines) return lines[i] ?? '';
          if (lines.length === 1) return lines[0];
          return lines[i] ?? '';
        };
        const noteText = cells[5].join('\n');
        const isVariantRow = nLines > 1;

        // "Sentadilla con barra | 50lbs" sin series ni reps: apunte suelto, se ignora.
        if (!isVariantRow && !isEmptyCell(col(2, 0)) && !parseCounts(col(2, 0)) && isEmptyCell(col(3, 0)) && isEmptyCell(col(4, 0))) {
          skip(rowText, 'Apunte sin series ni reps (se ignora)');
          continue;
        }

        // Resolver el nombre de cada renglón (variante)
        const lines = Array.from({ length: nLines }, (_, i) => {
          const series = col(2, i);
          const peso = col(3, i);
          const reps = col(4, i);
          let raw = exLines[i] ?? '';
          if (!raw) {
            // "Mancuernas: 12.5 lbs/c" en la columna Peso = nombre de la variante
            const prefix = /^\s*([A-Za-zÁÉÍÓÚáéíóúñ ]+):/.exec(peso);
            raw = prefix ? prefix[1].trim() : exLines[0];
          }
          let name: string;
          let muscle: Muscle | null;
          if (nameKey(raw) === 'elevacion de hombros') {
            // Mancuernas (lb) hasta fin de septiembre; máquina (kg) desde octubre.
            name = lineUnit(peso) === 'kg' ? 'Elevación de hombros en máquina' : 'Elevación de hombros con mancuernas';
            muscle = 'hombro';
          } else {
            const r = canonicalName(raw);
            name = r.name;
            muscle = r.muscle;
          }
          return { raw, name, muscle, series, peso, reps };
        });

        for (const l of lines) register(l.name, l.raw, date, l.muscle);

        // Notas de la fila: si mencionan una unidad, van a la variante con esa unidad.
        const nu = noteUnit(noteText);
        const targets = nu && isVariantRow ? lines.filter((l) => lineUnit(l.peso) === nu) : [];
        for (const l of targets.length ? targets : lines) addNote(l.name, date, noteText);

        const names = [...new Set(lines.map((l) => l.name))];
        if (!fire) session.slotRows.push({ names, kind });

        if (kind === 'no') {
          // No está en la rutina: no son series de hoy, solo se guarda el récord (en las notas).
          for (const n of names) exReg.get(n)!.keep = true;
          continue;
        }

        for (const l of lines) {
          const s = sig(l.series, l.peso, l.reps);
          const label = `${l.name}${isVariantRow ? ' (variante)' : ''}`;
          const variantSeen = isVariantRow && names.some((n) => seenSigs.get(n)?.has(s));
          const selfSeen = seenSigs.get(l.name)?.has(s) ?? false;
          seen(l.name).add(s);

          if (isEmptyCell(l.series) && isEmptyCell(l.peso) && isEmptyCell(l.reps)) {
            if (!fire) skip(`${label} | ${rowText}`, 'Sin datos');
            continue;
          }
          const weights = parseWeightCell(l.peso);
          if (weights.length > 0 && weights.every((w) => w.placeholder || w.weight === null) && /_{2,}/.test(l.peso)) {
            skip(`${label} | ${rowText}`, 'Plantilla sin llenar ("___")');
            continue;
          }
          const exp = expandRow(l.series, l.peso, l.reps, { bodyweight: isBodyweightName(l.name) });
          const hasReps = exp.sets.some((x) => x.reps !== null || x.seconds !== null);
          const hasWeight = exp.sets.some((x) => x.weight !== null && x.weight !== 0);
          if (exp.sets.length === 0 || (!hasReps && !hasWeight)) {
            skip(`${label} | ${rowText}`, 'Sin reps ni peso');
            continue;
          }
          if (variantSeen) {
            skip(`${label} | ${rowText}`, 'Variante no hecha ese día (mismos números que la última vez)');
            continue;
          }
          const issues = [...exp.issues];
          if (selfSeen) {
            if (fire || kind === 'opcional') {
              skip(`${label} | ${rowText}`, fire ? 'Calentamiento repetido igual (se asume no hecho)' : 'Opcional repetido igual (se asume no hecho)');
              continue;
            }
            issues.unshift('Igual que la vez pasada — ¿lo hiciste?');
          }
          if (!hasReps) issues.push('Sin repeticiones anotadas');

          const entry: EntryDraft = {
            exercise: l.name,
            note: dayNote,
            raw: isVariantRow ? `${hash} | ${l.raw} | ${l.series} | ${l.peso} | ${l.reps} | ${cells[5].join(' / ')}` : rowText,
            issues,
            sets: exp.sets,
          };
          session.entries.push(entry);
          exReg.get(l.name)!.sessionDates.add(date);
          if (!isVariantRow) lastEntry = entry;
        }
      }
    }

    if (session.entries.length === 0) {
      skipped.push({ date, text: section.heading, reason: 'Sesión sin ejercicios importables' });
      continue;
    }
    sessions.push(session);
  }

  // ------------------------------------------------ unidades por defecto
  const unitCounts = new Map<string, Map<Unit, number>>();
  for (const s of sessions)
    for (const e of s.entries)
      for (const x of e.sets)
        if (x.unit && x.load === 'normal') {
          const m = unitCounts.get(e.exercise) ?? new Map<Unit, number>();
          m.set(x.unit, (m.get(x.unit) ?? 0) + 1);
          unitCounts.set(e.exercise, m);
        }
  const mostCommon = <T,>(m: Map<T, number> | undefined): T | null => {
    if (!m || m.size === 0) return null;
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };
  for (const s of sessions)
    for (const e of s.entries)
      for (const x of e.sets) {
        if (x.unit) continue;
        if (x.load === 'lado') x.unit = 'lb'; // los discos son en libras
        else x.unit = mostCommon(unitCounts.get(e.exercise)) ?? 'kg';
      }

  // ------------------------------------------------ clasificación de sesiones y rutinas
  const classify = (s: SessionDraft) => {
    const counts = new Map<Group, number>();
    let known = 0;
    for (const r of s.slotRows) {
      if (r.kind === 'no') continue;
      const g = groupOf(r.names[0]);
      if (!g) continue;
      known++;
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    const top = mostCommon(counts);
    const share = top ? counts.get(top)! / known : 0;
    return { top, share, known, groups: new Set(counts.keys()) };
  };

  const sourceByGroup = new Map<Group, SessionDraft>();
  for (const s of sessions) {
    const c = classify(s);
    if (c.top && c.share >= 0.75 && c.known >= 3) sourceByGroup.set(c.top, s); // la más reciente gana
  }

  // ------------------------------------------------ ejercicios
  const exId = (name: string) => `ex-${slugify(name)}`;
  // Unidad y modo por defecto = como se anotó la última vez (refleja cómo lo hace ahora).
  const exDefaults = new Map<string, { unit: Unit; load: LoadMode }>();
  for (const s of sessions)
    for (const e of s.entries) {
      const last = e.sets[e.sets.length - 1];
      if (last) exDefaults.set(e.exercise, { unit: last.unit ?? 'kg', load: last.load });
    }
  // Solo ejercicios con series importadas, en una rutina o marcados "NO" (récord).
  const usedInRoutines = new Set<string>();
  for (const g of ['push', 'pull', 'legs'] as Group[]) for (const r of sourceByGroup.get(g)?.slotRows ?? []) r.names.forEach((n) => usedInRoutines.add(n));
  const exercises: Exercise[] = [...exReg.values()]
    .filter((info) => info.sessionDates.size > 0 || info.keep || usedInRoutines.has(info.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    .map((info) => {
      const latest = [...info.notes].sort((a, b) => (a.date === b.date ? a.seq - b.seq : a.date < b.date ? -1 : 1)).pop();
      const d = exDefaults.get(info.name) ?? { unit: 'kg' as Unit, load: (isBodyweightName(info.name) ? 'corporal' : 'normal') as LoadMode };
      return {
        id: exId(info.name),
        name: info.name,
        unit: d.unit,
        load: d.load,
        notes: latest?.text ?? '',
        archived: 0,
        createdAt: noonLocal(info.firstDate),
        updatedAt: noonLocal(info.lastDate),
        deleted: 0,
      };
    });

  const routines: Routine[] = [];
  const slots: RoutineSlot[] = [];
  const routineReport: ReportData['routines'] = [];
  for (const g of ['push', 'pull', 'legs'] as Group[]) {
    const src = sourceByGroup.get(g);
    if (!src) continue;
    const def = ROUTINES[g];
    const ts = noonLocal(src.date);
    routines.push({ id: def.id, name: def.name, weekdays: def.weekdays, order: def.order, updatedAt: ts, deleted: 0 });
    const slotNames: string[] = [];
    src.slotRows.forEach((r, i) => {
      slots.push({
        id: `sl-${g}-${i + 1}`,
        routineId: def.id,
        order: i + 1,
        exerciseIds: r.names.map(exId),
        kind: r.kind,
        updatedAt: ts,
        deleted: 0,
      });
      slotNames.push(`${r.names.join(' / ')}${r.kind !== 'normal' ? ` (${r.kind})` : ''}`);
    });
    routineReport.push({ name: def.name, source: src.date, slots: slotNames });
  }
  const routineIds = new Set(routines.map((r) => r.id));

  // ------------------------------------------------ sesiones, entradas, series
  const outSessions: Session[] = [];
  const entries: Entry[] = [];
  const sets: WorkSet[] = [];
  const review: ReviewItem[] = [];
  const sessionTitles: ReportData['sessionTitles'] = [];

  for (const s of sessions) {
    const c = classify(s);
    const ts = noonLocal(s.date);
    const routineGroup = c.top && c.share > 0.5 ? c.top : null;
    const routineId = routineGroup && routineIds.has(ROUTINES[routineGroup].id) ? ROUTINES[routineGroup].id : null;
    let title: string;
    if (s.label) title = s.label;
    else if (routineGroup && c.share >= 0.75) title = ROUTINES[routineGroup].name;
    else if (c.groups.size === 3) title = 'Full body';
    else {
      const muscles: Muscle[] = [];
      for (const r of s.slotRows) {
        if (r.kind === 'no') continue;
        const m = muscleOf(r.names[0]);
        if (m && !muscles.includes(m)) muscles.push(m);
      }
      if (muscles.length > 0 && muscles.every((m) => m === 'hombro' || m === 'triceps' || m === 'biceps')) title = 'Brazo';
      else {
        const labels = muscles.slice(0, 3).map((m) => MUSCLE_LABEL[m]);
        title = labels.length <= 1 ? (labels[0] ?? 'Entrenamiento') : `${labels.slice(0, -1).join(', ')} y ${labels[labels.length - 1]}`;
      }
    }
    const sessionId = `ss-${s.date}`;
    outSessions.push({
      id: sessionId,
      date: s.date,
      routineId,
      title,
      notes: '',
      startedAt: null,
      // Las sesiones de Notas ya están terminadas (si no, la app las mostraría "en curso").
      finishedAt: ts,
      source: 'notas',
      updatedAt: ts,
      deleted: 0,
    });
    sessionTitles.push({ date: s.date, title, routine: routineId });

    s.entries.forEach((e, idx) => {
      const n = idx + 1;
      const entryId = `en-${s.date}-${n}`;
      const exerciseId = exId(e.exercise);
      const slot = routineId ? slots.find((sl) => sl.routineId === routineId && sl.exerciseIds.includes(exerciseId)) : undefined;
      const issues = [...new Set(e.issues)];
      entries.push({
        id: entryId,
        sessionId,
        exerciseId,
        slotId: slot?.id ?? null,
        order: n,
        note: e.note,
        raw: e.raw,
        review: issues.length > 0 ? 1 : 0,
        reviewReason: issues.join('; '),
        updatedAt: ts,
        deleted: 0,
      });
      if (issues.length) review.push({ date: s.date, exercise: e.exercise, raw: e.raw, reason: issues.join('; ') });
      e.sets.forEach((x, k) => {
        sets.push({
          id: `st-${s.date}-${n}-${k + 1}`,
          entryId,
          sessionId,
          exerciseId,
          date: s.date,
          order: k + 1,
          weight: x.weight,
          unit: x.unit ?? 'kg',
          load: x.load,
          reps: x.reps,
          weight2: x.weight2,
          reps2: x.reps2,
          seconds: x.seconds,
          done: 1,
          doubtful: x.doubtful ? 1 : 0,
          updatedAt: ts,
          deleted: 0,
        });
      });
    });
  }

  const merges: MergeInfo[] = exercises.map((ex) => {
    const info = exReg.get(ex.name)!;
    const rawNames = [...info.rawNames].sort();
    return {
      name: ex.name,
      rawNames,
      unsure: rawNames.filter((r) => UNSURE_ALIASES.has(nameKey(r))),
      sessions: info.sessionDates.size,
      unit: ex.unit,
      load: ex.load,
    };
  });

  const backup: Backup = {
    app: 'app-gym',
    version: 1,
    exportedAt: Date.now(),
    exercises,
    routines,
    slots,
    sessions: outSessions,
    entries,
    sets,
  };

  return {
    backup,
    report: {
      sessions: outSessions.length,
      entries: entries.length,
      sets: sets.length,
      exercises: exercises.length,
      firstDate: outSessions[0]?.date ?? null,
      lastDate: outSessions[outSessions.length - 1]?.date ?? null,
      dateFixes,
      review,
      skipped,
      skippedTables,
      merges,
      routines: routineReport,
      sessionTitles,
    },
  };
}
