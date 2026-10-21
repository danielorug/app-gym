// Simulación mínima de Google Sheets + Apps Script para probar apps-script/Code.gs de verdad.
// Imita lo que más importa: Sheets convierte textos como "2026-10-12" en fecha y "5.5" en número,
// salvo en celdas con formato de texto plano ('@').

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

type Value = string | number | boolean | Date;

function letterToCol(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function mangle(v: unknown, format: string | undefined): Value {
  if (v === null || v === undefined) return '';
  if (format === '@') return v as Value;
  if (typeof v === 'string') {
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  return v as Value;
}

export class FakeRange {
  constructor(
    private sheet: FakeSheet,
    private row: number,
    private col: number,
    private numRows: number,
    private numCols: number,
  ) {}
  getRow() {
    return this.row;
  }
  getNumRows() {
    return this.numRows;
  }
  getSheet() {
    return this.sheet;
  }
  getValues(): Value[][] {
    const out: Value[][] = [];
    for (let r = 0; r < this.numRows; r++) {
      const line: Value[] = [];
      for (let c = 0; c < this.numCols; c++) line.push(this.sheet.get(this.row + r, this.col + c));
      out.push(line);
    }
    return out;
  }
  setValues(values: unknown[][]) {
    if (values.length !== this.numRows || values.some((l) => l.length !== this.numCols)) {
      throw new Error(`The number of rows or columns in the data does not match the range (${values.length}x${values[0]?.length} vs ${this.numRows}x${this.numCols})`);
    }
    for (let r = 0; r < this.numRows; r++) {
      for (let c = 0; c < this.numCols; c++) {
        const R = this.row + r;
        const C = this.col + c;
        this.sheet.set(R, C, mangle(values[r][c], this.sheet.getFormat(R, C)));
      }
    }
    return this;
  }
  setValue(v: unknown) {
    return this.setValues([[v]]);
  }
  setNumberFormat(f: string) {
    for (let r = 0; r < this.numRows; r++) for (let c = 0; c < this.numCols; c++) this.sheet.setFormat(this.row + r, this.col + c, f);
    return this;
  }
  setFormula(f: string) {
    this.sheet.set(this.row, this.col, f);
    return this;
  }
  setFontWeight() {
    return this;
  }
}

export class FakeSheet {
  private cells: Value[][] = [];
  private formats: string[][] = [];
  maxRows = 1000;
  maxCols = 26;
  frozen = 0;
  constructor(public name: string) {}

  get(r: number, c: number): Value {
    return this.cells[r - 1]?.[c - 1] ?? '';
  }
  set(r: number, c: number, v: Value) {
    (this.cells[r - 1] ??= [])[c - 1] = v;
  }
  getFormat(r: number, c: number): string | undefined {
    return this.formats[r - 1]?.[c - 1];
  }
  setFormat(r: number, c: number, f: string) {
    (this.formats[r - 1] ??= [])[c - 1] = f;
  }

  getName() {
    return this.name;
  }
  getLastRow() {
    for (let r = this.cells.length - 1; r >= 0; r--) if (this.cells[r]?.some((v) => v !== '' && v !== undefined)) return r + 1;
    return 0;
  }
  getLastColumn() {
    let max = 0;
    for (const row of this.cells) {
      if (!row) continue;
      for (let c = row.length - 1; c >= 0; c--) {
        if (row[c] !== '' && row[c] !== undefined) {
          max = Math.max(max, c + 1);
          break;
        }
      }
    }
    return max;
  }
  getMaxRows() {
    return this.maxRows;
  }
  getMaxColumns() {
    return this.maxCols;
  }
  insertRowsAfter(_after: number, n: number) {
    this.maxRows += n;
  }
  insertColumnsAfter(_after: number, n: number) {
    this.maxCols += n;
  }
  setFrozenRows(n: number) {
    this.frozen = n;
  }
  getRange(row: number | string, col = 1, numRows = 1, numCols = 1): FakeRange {
    if (typeof row === 'string') {
      const m = /^([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/.exec(row);
      if (!m) throw new Error('Bad A1 ' + row);
      const c1 = letterToCol(m[1]);
      const r1 = m[2] ? Number(m[2]) : 1;
      const c2 = m[3] ? letterToCol(m[3]) : c1;
      const r2 = m[4] ? Number(m[4]) : m[3] || !m[2] ? this.maxRows : r1;
      return this.getRange(r1, c1, r2 - r1 + 1, c2 - c1 + 1);
    }
    if (row < 1 || col < 1 || numRows < 1 || numCols < 1 || row + numRows - 1 > this.maxRows || col + numCols - 1 > this.maxCols) {
      throw new Error(`Range out of bounds: ${row},${col} ${numRows}x${numCols} (max ${this.maxRows}x${this.maxCols})`);
    }
    return new FakeRange(this, row, col, numRows, numCols);
  }
  getRangeList(a1s: string[]) {
    const ranges = a1s.map((a) => this.getRange(a));
    const list = {
      setNumberFormat(f: string) {
        ranges.forEach((r) => r.setNumberFormat(f));
        return list;
      },
    };
    return list;
  }
  /** Para pruebas: tabla como objetos usando el encabezado. */
  rows(): Record<string, Value>[] {
    const lastRow = this.getLastRow();
    const lastCol = this.getLastColumn();
    if (lastRow < 1) return [];
    const header = this.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
    if (lastRow < 2) return [];
    return this.getRange(2, 1, lastRow - 1, lastCol)
      .getValues()
      .map((line) => Object.fromEntries(header.map((h, i) => [h, line[i]])));
  }
  header(): string[] {
    const lastCol = this.getLastColumn();
    return lastCol ? this.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  }
}

export class FakeSpreadsheet {
  sheets: FakeSheet[] = [new FakeSheet('Hoja 1')];
  getSheetByName(name: string) {
    return this.sheets.find((s) => s.name === name) ?? null;
  }
  insertSheet(name: string, index?: number) {
    if (this.getSheetByName(name)) throw new Error('Ya existe ' + name);
    const sheet = new FakeSheet(name);
    if (index === undefined) this.sheets.push(sheet);
    else this.sheets.splice(index, 0, sheet);
    return sheet;
  }
  deleteSheet(sheet: FakeSheet) {
    this.sheets = this.sheets.filter((s) => s !== sheet);
  }
  getSheets() {
    return this.sheets;
  }
  getSpreadsheetTimeZone() {
    return 'America/Mexico_City';
  }
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export interface FakeServer {
  ss: FakeSpreadsheet;
  props: Map<string, string>;
  logs: string[];
  /** Funciones globales de Code.gs (doPost, configurar, mergeRows_, …). */
  gs: Record<string, (...args: never[]) => unknown> & { SCHEMA: Record<string, { sheet: string; cols: string[]; text: string[] }> };
  /** Llama doPost como lo haría Google y regresa el texto de respuesta. */
  post(body: string): string;
  /** Hace que Date.now() dentro de Apps Script regrese este valor (null = reloj real). */
  setNow(ms: number | null): void;
}

export function createFakeServer(): FakeServer {
  const code = readFileSync(fileURLToPath(new URL('../../apps-script/Code.gs', import.meta.url)), 'utf8');
  const ss = new FakeSpreadsheet();
  const props = new Map<string, string>();
  const logs: string[] = [];
  let fixedNow: number | null = null;

  const context: Record<string, unknown> = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      getActive: () => ss,
      getUi: () => {
        throw new Error('Cannot call SpreadsheetApp.getUi() from this context.');
      },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => (props.has(k) ? props.get(k)! : null),
        setProperty: (k: string, v: unknown) => {
          props.set(k, String(v));
        },
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: 'application/json', TEXT: 'text/plain' },
      createTextOutput: (s: string) => {
        const out = { setMimeType: () => out, getContent: () => s };
        return out;
      },
    },
    Utilities: {
      getUuid: () => randomUUID(),
      formatDate: (d: Date, _tz: string, fmt: string) => {
        const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        if (fmt === 'yyyy-MM-dd') return date;
        if (fmt === 'HH:mm:ss') return time;
        return `${date}T${time}`;
      },
    },
    Logger: { log: (...a: unknown[]) => logs.push(a.join(' ')) },
    __now: () => fixedNow,
  };
  vm.createContext(context);
  vm.runInContext('(function(){ var real = Date.now; Date.now = function(){ var n = __now(); return n === null ? real() : n; }; })();', context);
  vm.runInContext(code, context, { filename: 'Code.gs' });

  return {
    ss,
    props,
    logs,
    gs: context as FakeServer['gs'],
    post(body: string) {
      const doPost = context.doPost as (e: unknown) => { getContent(): string };
      return doPost({ postData: { contents: body, type: 'text/plain' } }).getContent();
    },
    setNow(ms) {
      fixedNow = ms;
    },
  };
}

export interface FetchControl {
  calls: { action: string; body: Record<string, unknown> }[];
  offline: boolean;
  /** Se llama antes de contestar cada petición (para simular cambios a media sincronización). */
  beforeResponse: ((body: Record<string, unknown>) => Promise<void> | void) | null;
  /** Reemplaza la respuesta (para simular URLs que no son App Gym). */
  override: ((body: Record<string, unknown>) => Response) | null;
}

export const FAKE_URL = 'https://script.google.com/macros/s/FAKE/exec';

/** Reemplaza fetch global para que hable con el servidor simulado. */
export function installFakeFetch(server: FakeServer): FetchControl {
  const control: FetchControl = { calls: [], offline: false, beforeResponse: null, override: null };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (control.offline) throw new TypeError('Failed to fetch');
    if (String(input) !== FAKE_URL) throw new TypeError('Failed to fetch');
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    control.calls.push({ action: String(body.action), body });
    if (control.override) return control.override(body);
    if (control.beforeResponse) await control.beforeResponse(body);
    return new Response(server.post(String(init?.body ?? '')), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return control;
}
