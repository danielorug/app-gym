import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backup, Entry, Exercise, Routine, RoutineSlot, Session, WorkSet } from '../db/types';
import { TABLES } from '../db/types';
import { createFakeServer, FAKE_URL, installFakeFetch, type FakeServer, type FetchControl } from './fakeAppsScript.testutil';
import { COLUMN_ORDER, decodeRow, encodeRow, FIELDS, SHEET_NAMES, textColumns } from './schema';
import { uploadBackup } from './upload';

// ---------- Dispositivos simulados (cada uno con su propia base IndexedDB y su propio módulo de sync) ----------

type Device = typeof import('../db/db') & typeof import('./sync');

async function newDevice(): Promise<Device> {
  vi.resetModules();
  const factory = new IDBFactory();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = factory;
  Dexie.dependencies.indexedDB = factory;
  Dexie.dependencies.IDBKeyRange = IDBKeyRange;
  const dbMod = await import('../db/db');
  const syncMod = await import('./sync');
  await dbMod.db.open(); // queda amarrada a su propia base
  return { ...dbMod, ...syncMod };
}

async function dump(dev: Device) {
  const out: Record<string, unknown[]> = {};
  for (const t of TABLES) {
    const rows = await dev.table(t).toArray();
    out[t] = rows.map(({ dirty: _d, ...r }) => r).sort((a, b) => a.id.localeCompare(b.id));
  }
  return out;
}

// ---------- Datos de prueba con valores "tramposos" para Sheets ----------

const base = { updatedAt: 0, deleted: 0 as const };

const exPress: Exercise = { ...base, id: 'ex-press', name: 'Press de banca', unit: 'lb', load: 'lado', notes: 'Asiento en hoyo 4\nNo al fallo', archived: 0, createdAt: 1 };
const exConv: Exercise = { ...base, id: 'ex-conv', name: 'Converging Chest Press', unit: 'kg', load: 'normal', notes: '=SUM(A1)', archived: 0, createdAt: 2 };
const exDom: Exercise = { ...base, id: 'ex-dom', name: 'Dominadas', unit: 'kg', load: 'corporal', notes: '', archived: 1, createdAt: 3 };
const routine: Routine = { ...base, id: 'r-push', name: 'Pecho, hombro y tríceps', weekdays: [1, 4], order: 0 };
const slot: RoutineSlot = { ...base, id: 'sl-1', routineId: 'r-push', order: 0, exerciseIds: ['ex-press', 'ex-conv'], kind: 'normal' };
const session: Session = { ...base, id: 'ses-1', date: '2026-10-12', routineId: 'r-push', title: '10', notes: '2026-10-15', startedAt: null, finishedAt: 1760300000000, source: 'notas' };
const sessionFree: Session = { ...base, id: 'ses-2', date: '2026-10-16', routineId: null, title: 'Brazo', notes: '', startedAt: 1760600000000, finishedAt: null, source: 'app' };
const entry: Entry = { ...base, id: 'en-1', sessionId: 'ses-1', exerciseId: 'ex-press', slotId: null, order: 1, note: '5.5', raw: '1 - 2 | 41kg - 45kg | 10 - 7 - 6', review: 1, reviewReason: 'Series y reps no cuadran' };
const entry2: Entry = { ...base, id: 'en-2', sessionId: 'ses-1', exerciseId: 'ex-dom', slotId: 'sl-1', order: 2, note: '', raw: '', review: 0, reviewReason: '' };
const set1: WorkSet = { ...base, id: 'st-1', entryId: 'en-1', sessionId: 'ses-1', exerciseId: 'ex-press', date: '2026-10-12', order: 1, weight: 25, unit: 'lb', load: 'lado', reps: 5.5, weight2: null, reps2: null, seconds: null, done: 1, doubtful: 0 };
const set2: WorkSet = { ...base, id: 'st-2', entryId: 'en-2', sessionId: 'ses-1', exerciseId: 'ex-dom', date: '2026-10-12', order: 1, weight: -4.5, unit: 'kg', load: 'corporal', reps: 6, weight2: 18, reps2: 4, seconds: 50, done: 0, doubtful: 1 };

async function seed(dev: Device) {
  await dev.save('exercises', [exPress, exConv, exDom]);
  await dev.save('routines', routine);
  await dev.save('slots', slot);
  await dev.save('sessions', [session, sessionFree]);
  await dev.save('entries', [entry, entry2]);
  await dev.save('sets', [set1, set2]);
}
const SEEDED_ROWS = 11;

// ---------- Esquema ----------

describe('esquema', () => {
  it('Code.gs y schema.ts tienen las mismas columnas, pestañas y columnas de texto', () => {
    const server = createFakeServer();
    for (const t of TABLES) {
      const def = server.gs.SCHEMA[t];
      expect(def.sheet).toBe(SHEET_NAMES[t]);
      expect([...def.cols]).toEqual(COLUMN_ORDER[t]);
      expect([...def.text].sort()).toEqual(textColumns(t).sort());
    }
  });

  it('el orden de columnas cubre todos los campos', () => {
    for (const t of TABLES) {
      for (const field of Object.keys(FIELDS[t])) expect(COLUMN_ORDER[t]).toContain(field);
    }
  });

  it('decode tolera lo que puede regresar Sheets', () => {
    const row = decodeRow('sets', { id: 'x', updatedAt: '17', deleted: '', weight: '45,5', reps: '', exerciseIds: 'no', done: true, extra: 'ignorado' });
    expect(row.updatedAt).toBe(17);
    expect(row.deleted).toBe(0);
    expect(row.weight).toBe(45.5);
    expect(row.reps).toBeNull();
    expect(row.done).toBe(1);
    expect('extra' in row).toBe(false);
    expect(decodeRow('slots', { exerciseIds: 'roto[' }).exerciseIds).toEqual([]);
    expect(encodeRow('sets', set1, { exerciseName: () => 'Press de banca' }).ejercicio).toBe('Press de banca');
    expect('dirty' in encodeRow('exercises', { ...exPress, dirty: 1 })).toBe(false);
  });
});

// ---------- Apps Script ----------

describe('Code.gs', () => {
  let server: FakeServer;
  let token: string;
  const post = (body: object) => JSON.parse(server.post(JSON.stringify({ token, ...body })));

  beforeEach(() => {
    server = createFakeServer();
    server.gs.configurar();
    token = server.props.get('TOKEN')!;
  });

  it('configurar crea pestañas, encabezados, resumen y token', () => {
    const names = server.ss.getSheets().map((s) => s.name);
    expect(names[0]).toBe('Resumen');
    for (const t of TABLES) expect(names).toContain(SHEET_NAMES[t]);
    expect(names).not.toContain('Hoja 1');
    expect(token).toMatch(/^[0-9a-f]{40}$/);
    expect(server.logs.join('\n')).toContain(token);
    expect(server.ss.getSheetByName('Series')!.header()).toEqual([...COLUMN_ORDER.sets, '_srv']);
    const formula = String(server.ss.getSheetByName('Resumen')!.get(1, 1));
    expect(formula).toMatch(/^=QUERY\(Series!A:S, "select A, B, C\+1, D, E, F, G, H, I, J where R = 0 order by A desc, B, C label A 'Fecha', B 'Ejercicio', C\+1 'Serie'/);
    // Correrlo otra vez no cambia el token ni duplica nada
    server.gs.configurar();
    expect(server.props.get('TOKEN')).toBe(token);
    expect(server.ss.getSheets().filter((s) => s.name === 'Series')).toHaveLength(1);
  });

  it('rechaza token incorrecto y avisa si falta configurar', () => {
    expect(JSON.parse(server.post(JSON.stringify({ token: 'malo', action: 'ping' })))).toEqual({ ok: false, error: 'token' });
    const fresh = createFakeServer();
    expect(JSON.parse(fresh.post(JSON.stringify({ token: 'x', action: 'ping' })))).toEqual({ ok: false, error: 'config' });
    expect(JSON.parse(server.post('no es json'))).toEqual({ ok: false, error: 'json' });
  });

  it('gana el updatedAt más reciente y el id repetido se queda con el más nuevo', () => {
    const row = (updatedAt: number, name: string) => ({ id: 'e1', updatedAt, deleted: 0, name, unit: 'kg', load: 'normal', notes: '', archived: 0, createdAt: 1 });
    expect(post({ action: 'push', tables: { exercises: [row(10, 'diez')] } })).toMatchObject({ ok: true, written: 1, skipped: 0 });
    expect(post({ action: 'push', tables: { exercises: [row(5, 'cinco')] } })).toMatchObject({ written: 0, skipped: 1 });
    expect(post({ action: 'push', tables: { exercises: [row(20, 'veinte'), row(15, 'quince')] } })).toMatchObject({ written: 1 });
    const rows = server.ss.getSheetByName('Ejercicios')!.rows();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('veinte');
  });

  it('los sellos nunca se repiten ni van para atrás aunque el reloj cambie', () => {
    const row = (id: string) => ({ id, updatedAt: 1, deleted: 0, name: id, weekdays: '[]', order: 0 });
    server.setNow(5000);
    post({ action: 'push', tables: { routines: [row('a'), row('b')] } });
    server.setNow(1000);
    post({ action: 'push', tables: { routines: [row('c')] } });
    const srv = server.ss.getSheetByName('Rutinas')!.rows().map((r) => r._srv);
    expect(srv).toEqual([5000, 5001, 5002]);
  });

  it('pull pagina sin perder ni repetir filas', () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ id: `r${i}`, updatedAt: 1, deleted: 0, name: `R${i}`, weekdays: '[1]', order: i }));
    post({ action: 'push', tables: { routines: rows.slice(0, 4) } });
    post({ action: 'push', tables: { routines: rows.slice(4) } });
    const seen: string[] = [];
    let since = 0;
    let more = true;
    let pages = 0;
    while (more) {
      const res = post({ action: 'pull', since, limit: 3 });
      seen.push(...(res.tables.routines ?? []).map((r: { id: string }) => r.id));
      expect(res.serverTime).toBeGreaterThan(since);
      since = res.serverTime;
      more = res.more;
      pages++;
    }
    expect(pages).toBe(3);
    expect(seen.sort()).toEqual(rows.map((r) => r.id).sort());
    expect(post({ action: 'pull', since, limit: 3 }).tables).toEqual({});
  });

  it('agrega columnas nuevas solas', () => {
    post({ action: 'push', tables: { exercises: [{ id: 'e1', updatedAt: 1, deleted: 0, name: 'A', campoNuevo: '2026-01-01' }] } });
    const sheet = server.ss.getSheetByName('Ejercicios')!;
    expect(sheet.header()).toContain('campoNuevo');
    expect(sheet.rows()[0].campoNuevo).toBe('2026-01-01');
    const res = post({ action: 'pull', since: 0 });
    expect(res.tables.exercises[0]).toMatchObject({ id: 'e1', name: 'A', campoNuevo: '2026-01-01' });
  });
});

// ---------- Cliente ----------

describe('sincronización', () => {
  let server: FakeServer;
  let control: FetchControl;
  let cfg: { url: string; token: string };

  beforeEach(() => {
    server = createFakeServer();
    server.gs.configurar();
    control = installFakeFetch(server);
    cfg = { url: FAKE_URL, token: server.props.get('TOKEN')! };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sube de un dispositivo y baja en otro sin cambiar tipos', async () => {
    const A = await newDevice();
    await seed(A);
    expect(await A.syncNow()).toMatchObject({ ok: false, error: 'Google Sheets no está conectado' });
    expect(A.getSyncStatus().state).toBe('off');

    await A.setSyncConfig(cfg);
    const resA = await A.syncNow();
    expect(resA).toEqual({ ok: true, pushed: SEEDED_ROWS, pulled: 0 });
    expect(A.getSyncStatus()).toMatchObject({ state: 'idle', pending: 0, error: null });
    for (const t of TABLES) expect(await A.table(t).where('dirty').equals(1).count()).toBe(0);

    // En la hoja: fechas y textos numéricos como texto, números como números, nombre del ejercicio legible
    const series = server.ss.getSheetByName('Series')!.rows();
    const s2 = series.find((r) => r.id === 'st-2')!;
    expect(s2.date).toBe('2026-10-12');
    expect(s2.ejercicio).toBe('Dominadas');
    expect(s2.weight).toBe(-4.5);
    expect(server.ss.getSheetByName('Sesiones')!.rows().find((r) => r.id === 'ses-1')!.title).toBe('10');
    expect(server.ss.getSheetByName('RutinaLugares')!.rows()[0].exerciseIds).toBe('["ex-press","ex-conv"]');

    const B = await newDevice();
    await B.setSyncConfig(cfg);
    const resB = await B.syncNow();
    expect(resB).toEqual({ ok: true, pushed: 0, pulled: SEEDED_ROWS });
    expect(await dump(B)).toEqual(await dump(A));
  });

  it('gana el cambio más reciente entre dispositivos', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    const A = await newDevice();
    await seed(A);
    await A.setSyncConfig(cfg);
    await A.syncNow();
    const B = await newDevice();
    await B.setSyncConfig(cfg);
    await B.syncNow();

    // A edita primero (sin señal), B después y sí sincroniza
    vi.setSystemTime(2_000_000);
    await A.save('exercises', { ...exPress, notes: 'de A' });
    vi.setSystemTime(3_000_000);
    await B.save('exercises', { ...exPress, notes: 'de B' });
    await B.syncNow();
    const res = await A.syncNow();
    expect(res.ok).toBe(true);
    expect((await A.db.exercises.get('ex-press'))!.notes).toBe('de B');
    expect((await A.db.exercises.get('ex-press'))!.dirty).toBe(0);

    // Ahora A edita después que todos: le gana a B
    vi.setSystemTime(4_000_000);
    await A.save('exercises', { ...exPress, notes: 'A otra vez' });
    await A.syncNow();
    await B.syncNow();
    expect((await B.db.exercises.get('ex-press'))!.notes).toBe('A otra vez');
  });

  it('los borrados llegan al otro dispositivo', async () => {
    const A = await newDevice();
    await seed(A);
    await A.setSyncConfig(cfg);
    await A.syncNow();
    const B = await newDevice();
    await B.setSyncConfig(cfg);
    await B.syncNow();

    await A.remove('sets', ['st-2']);
    expect(A.getSyncStatus().pending).toBeGreaterThanOrEqual(0);
    await A.syncNow();
    await B.syncNow();
    expect((await B.db.sets.get('st-2'))!.deleted).toBe(1);
    expect(server.ss.getSheetByName('Series')!.rows().find((r) => r.id === 'st-2')!.deleted).toBe(1);
  });

  it('un cambio hecho mientras se sube se queda pendiente', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    const A = await newDevice();
    await seed(A);
    await A.setSyncConfig(cfg);
    control.beforeResponse = async (body) => {
      if (body.action !== 'push') return;
      control.beforeResponse = null;
      vi.setSystemTime(1_500_000);
      await A.save('exercises', { ...exPress, notes: 'cambio a media subida' });
    };
    await A.syncNow();
    const row = (await A.db.exercises.get('ex-press'))!;
    expect(row.notes).toBe('cambio a media subida');
    expect(row.dirty).toBe(1);
    expect(A.getSyncStatus().pending).toBe(1);

    await A.syncNow();
    expect(A.getSyncStatus().pending).toBe(0);
    expect(server.ss.getSheetByName('Ejercicios')!.rows().find((r) => r.id === 'ex-press')!.notes).toBe('cambio a media subida');
  });

  it('las correcciones a mano en la hoja llegan a la app', async () => {
    const A = await newDevice();
    await seed(A);
    await A.setSyncConfig(cfg);
    await A.syncNow();

    const sheet = server.ss.getSheetByName('Series')!;
    const header = sheet.header();
    const rowNum = sheet.rows().findIndex((r) => r.id === 'st-1') + 2;
    const range = sheet.getRange(rowNum, header.indexOf('weight') + 1);
    range.setValue(30);
    (server.gs.onEdit as (e: unknown) => void)({ range });

    const res = await A.syncNow();
    expect(res.pulled).toBe(1);
    expect((await A.db.sets.get('st-1'))!.weight).toBe(30);
  });

  it('dos llamadas a la vez comparten la misma sincronización', async () => {
    const A = await newDevice();
    await seed(A);
    await A.setSyncConfig(cfg);
    const p1 = A.syncNow();
    const p2 = A.syncNow();
    expect(p1).toBe(p2);
    expect((await p1).ok).toBe(true);
  });

  it('cambiar de hoja vuelve a subir todo', async () => {
    const A = await newDevice();
    await seed(A);
    await A.setSyncConfig(cfg);
    await A.syncNow();

    const other = createFakeServer();
    other.gs.configurar();
    installFakeFetch(other);
    await A.setSyncConfig({ url: FAKE_URL + '?otra', token: other.props.get('TOKEN')! });
    expect(A.getSyncStatus().pending).toBe(SEEDED_ROWS);
  });

  it('errores entendibles', async () => {
    const A = await newDevice();
    expect(await A.testConnection(cfg)).toEqual({ ok: true });
    expect(await A.testConnection({ ...cfg, token: 'malo' })).toEqual({ ok: false, error: 'Token incorrecto' });
    expect(await A.testConnection({ ...cfg, url: 'http://inseguro' })).toEqual({ ok: false, error: 'La URL debe empezar con https://' });
    expect(await A.testConnection({ ...cfg, token: ' ' })).toEqual({ ok: false, error: 'Falta el token' });
    expect((await A.testConnection({ ...cfg, url: 'https://otra.cosa/exec' })).error).toMatch(/No se pudo conectar/);

    control.override = () => new Response('<html>Inicia sesión</html>', { status: 200 });
    expect((await A.testConnection(cfg)).error).toMatch(/no responde como App Gym/);
    control.override = null;

    const sinConfigurar = createFakeServer();
    installFakeFetch(sinConfigurar);
    expect(await A.testConnection(cfg)).toEqual({ ok: false, error: 'Falta correr "configurar" en Apps Script' });
  });

  it('sin señal no intenta y queda como "offline"', async () => {
    const A = await newDevice();
    await seed(A);
    await A.setSyncConfig(cfg);
    Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true });
    try {
      const res = await A.syncNow();
      expect(res).toMatchObject({ ok: false, error: 'Sin conexión' });
      expect(A.getSyncStatus()).toMatchObject({ state: 'offline', pending: SEEDED_ROWS });
      expect(control.calls).toHaveLength(0);
    } finally {
      delete (globalThis.navigator as { onLine?: boolean }).onLine;
    }
  });
});

// ---------- Subir respaldo (historial importado) ----------

describe('uploadBackup', () => {
  it('sube un historial grande en partes y el teléfono lo baja completo', async () => {
    const server = createFakeServer();
    server.gs.configurar();
    const control = installFakeFetch(server);
    const cfg = { url: FAKE_URL, token: server.props.get('TOKEN')! };

    const sets: WorkSet[] = Array.from({ length: 1200 }, (_, i) => ({ ...set1, id: `big-${i}`, order: i, updatedAt: 1000 + i }));
    const backup: Backup = {
      app: 'app-gym', version: 1, exportedAt: 0,
      exercises: [exPress], routines: [], slots: [], sessions: [session], entries: [entry], sets,
    };
    const progress: number[] = [];
    const res = await uploadBackup(cfg, backup, (p) => progress.push(p.sent));
    expect(res).toEqual({ sent: 1203, total: 1203, written: 1203, skipped: 0 });
    expect(progress).toEqual([500, 1000, 1203]);
    expect(control.calls.filter((c) => c.action === 'push')).toHaveLength(3);

    const last = server.ss.getSheetByName('Series')!.rows().at(-1)!;
    expect(last.date).toBe('2026-10-12'); // filas nuevas más allá de las 1000 originales siguen en texto
    expect(last.ejercicio).toBe('Press de banca');

    // Subirlo otra vez no duplica
    expect((await uploadBackup(cfg, backup)).written).toBe(1203);
    expect(server.ss.getSheetByName('Series')!.rows()).toHaveLength(1200);

    const phone = await newDevice();
    await phone.setSyncConfig(cfg);
    const sync = await phone.syncNow();
    expect(sync).toEqual({ ok: true, pushed: 0, pulled: 1203 });
    expect(await phone.db.sets.count()).toBe(1200);
    expect((await phone.db.sets.get('big-1199'))!.reps).toBe(5.5);
  });
});

