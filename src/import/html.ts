// Convierte el HTML que devuelve la app Notas en bloques de texto y tablas.
// Sin DOM: corre igual en Node (script de importación) que en el navegador.

/** Una celda = sus renglones (cada <div> o <br> de Notas es un renglón). */
export type Cell = string[];
export type Row = Cell[];

export type Block = { type: 'text'; text: string } | { type: 'table'; rows: Row[] };

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

function clean(s: string): string {
  return decodeEntities(s).replace(/[\s ]+/g, ' ').trim();
}

const LINE_BREAK_TAGS = new Set(['div', 'br', 'p', 'h1', 'h2', 'h3', 'li', 'tr']);

export function parseNotesHtml(html: string): Block[] {
  const blocks: Block[] = [];
  const tokenRe = /<(\/?)([a-zA-Z0-9]+)[^>]*>|([^<]+)/g;

  let tableDepth = 0;
  let rows: Row[] = [];
  let row: Row | null = null;
  let cell: Cell | null = null;
  let cellLine = '';
  let textLine = '';

  const flushText = () => {
    const t = clean(textLine);
    if (t) blocks.push({ type: 'text', text: t });
    textLine = '';
  };
  const flushCellLine = () => {
    const t = clean(cellLine);
    if (t && cell) cell.push(t);
    cellLine = '';
  };

  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(html))) {
    const [, closing, rawTag, text] = m;
    if (text !== undefined) {
      if (cell) cellLine += text;
      else if (tableDepth === 0) textLine += text;
      continue;
    }
    const tag = rawTag.toLowerCase();
    if (tag === 'table') {
      if (!closing) {
        flushText();
        tableDepth++;
        if (tableDepth === 1) rows = [];
      } else {
        tableDepth = Math.max(0, tableDepth - 1);
        if (tableDepth === 0) blocks.push({ type: 'table', rows });
      }
      continue;
    }
    if (tableDepth > 0) {
      if (tag === 'tr') {
        if (!closing) row = [];
        else if (row) {
          rows.push(row);
          row = null;
        }
      } else if (tag === 'td' || tag === 'th') {
        if (!closing) {
          cell = [];
          cellLine = '';
        } else if (cell) {
          flushCellLine();
          row?.push(cell);
          cell = null;
        }
      } else if (cell && LINE_BREAK_TAGS.has(tag)) {
        flushCellLine();
      }
      continue;
    }
    if (LINE_BREAK_TAGS.has(tag)) flushText();
  }
  flushText();
  return blocks;
}
