/**
 * App Gym — conexión con Google Sheets.
 *
 * Este código va en la hoja de cálculo (Extensiones → Apps Script).
 * La app manda y recibe tus entrenamientos por aquí; cada tabla es una pestaña.
 *
 * - configurar(): créalo todo y muestra el token (correr una vez).
 * - doPost(): lo usa la app (ping / push / pull).
 * - onEdit(): si corriges algo a mano en la hoja, la app lo recibe en la siguiente sincronización.
 *
 * Instrucciones completas: apps-script/INSTRUCCIONES.md
 */

// Debe coincidir con src/sync/schema.ts (COLUMN_ORDER y textColumns).
var SCHEMA = {
  exercises: {
    sheet: 'Ejercicios',
    cols: ['name', 'unit', 'load', 'notes', 'archived', 'createdAt', 'id', 'updatedAt', 'deleted'],
    text: ['name', 'unit', 'load', 'notes', 'id'],
  },
  routines: {
    sheet: 'Rutinas',
    cols: ['name', 'weekdays', 'order', 'id', 'updatedAt', 'deleted'],
    text: ['name', 'weekdays', 'id'],
  },
  slots: {
    sheet: 'RutinaLugares',
    cols: ['routineId', 'order', 'kind', 'exerciseIds', 'id', 'updatedAt', 'deleted'],
    text: ['routineId', 'kind', 'exerciseIds', 'id'],
  },
  sessions: {
    sheet: 'Sesiones',
    cols: ['date', 'title', 'routineId', 'notes', 'startedAt', 'finishedAt', 'source', 'id', 'updatedAt', 'deleted'],
    text: ['date', 'title', 'routineId', 'notes', 'source', 'id'],
  },
  entries: {
    sheet: 'EjerciciosSesion',
    cols: ['sessionId', 'order', 'exerciseId', 'note', 'raw', 'review', 'reviewReason', 'slotId', 'id', 'updatedAt', 'deleted'],
    text: ['sessionId', 'exerciseId', 'note', 'raw', 'reviewReason', 'slotId', 'id'],
  },
  sets: {
    sheet: 'Series',
    cols: [
      'date', 'ejercicio', 'order', 'weight', 'unit', 'load', 'reps', 'weight2', 'reps2', 'seconds', 'done', 'doubtful',
      'entryId', 'sessionId', 'exerciseId', 'id', 'updatedAt', 'deleted',
    ],
    text: ['date', 'ejercicio', 'unit', 'load', 'entryId', 'sessionId', 'exerciseId', 'id'],
  },
};

var SRV_COL = '_srv';
var RESUMEN = 'Resumen';

// ---------------------------------------------------------------------------
// Para ti (desde el editor o el menú "App Gym")
// ---------------------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('App Gym')
    .addItem('Configurar / ver token', 'configurar')
    .addItem('Generar token nuevo', 'nuevoToken')
    .addToUi();
}

/** Crea las pestañas y el token. Se puede correr varias veces sin borrar nada. */
function configurar() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  for (var table in SCHEMA) ensureSheet_(ss, table);
  crearResumen_(ss);
  quitarHojaVacia_(ss);
  var token = getToken_();
  if (!token) token = guardarTokenNuevo_();
  mostrarToken_(token);
  return token;
}

/** Cambia el token (la app dejará de conectarse hasta que pegues el nuevo). */
function nuevoToken() {
  var token = guardarTokenNuevo_();
  mostrarToken_(token);
  return token;
}

function guardarTokenNuevo_() {
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  PropertiesService.getScriptProperties().setProperty('TOKEN', token);
  return token;
}

function mostrarToken_(token) {
  var msg = 'Token para la app (cópialo en Más → Respaldo en Google Sheets):\n\n' + token;
  Logger.log(msg);
  try {
    SpreadsheetApp.getUi().alert('App Gym', msg, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (err) {
    // Desde el editor a veces no se puede mostrar la alerta; el token queda en el "Registro de ejecución".
  }
}

// ---------------------------------------------------------------------------
// API para la app
// ---------------------------------------------------------------------------

function doGet() {
  return json_({ ok: true, app: 'app-gym', message: 'App Gym API OK' });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e && e.postData && e.postData.contents ? e.postData.contents : '{}');
  } catch (err) {
    return json_({ ok: false, error: 'json' });
  }
  return json_(handle_(req));
}

function handle_(req) {
  var token = getToken_();
  if (!token) return { ok: false, error: 'config' };
  if (!req || req.token !== token) return { ok: false, error: 'token' };

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return { ok: false, error: 'ocupado' };
  }
  try {
    if (req.action === 'ping') return { ok: true, serverTime: lastStamp_() };
    if (req.action === 'push') return push_(req.tables || {});
    if (req.action === 'pull') return pull_(Number(req.since) || 0, Number(req.limit) || 2000);
    return { ok: false, error: 'acción desconocida' };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// push: guardar filas (gana el updatedAt más reciente)
// ---------------------------------------------------------------------------

function push_(tables) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var written = 0;
  var skipped = 0;
  for (var table in tables) {
    if (!SCHEMA.hasOwnProperty(table)) continue;
    var rows = tables[table];
    if (!rows || !rows.length) continue;
    var sheet = getSheet_(ss, table);
    var r = writeRows_(sheet, table, rows);
    written += r.written;
    skipped += r.skipped;
  }
  return { ok: true, serverTime: lastStamp_(), written: written, skipped: skipped };
}

function writeRows_(sheet, table, rows) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var values = lastRow > 0 && lastCol > 0 ? sheet.getRange(1, 1, lastRow, lastCol).getValues() : [[]];
  var header = trimHeader_(values[0]);
  var data = values.slice(1);

  var res = mergeRows_(header, data, rows, SCHEMA[table].cols, reserveStamps_);
  var width = res.header.length;
  if (res.headerChanged) writeHeader_(sheet, res.header);
  var textCols = SCHEMA[table].text.concat(res.newTextCols);

  var runs = runs_(res.updates);
  for (var i = 0; i < runs.length; i++) {
    var startRow = runs[i].start + 2;
    var block = runs[i].rows;
    ensureSize_(sheet, startRow + block.length - 1, width);
    formatText_(sheet, res.header, textCols, startRow, block.length);
    sheet.getRange(startRow, 1, block.length, width).setValues(block);
  }
  if (res.appends.length) {
    var start = Math.max(lastRow, 1) + 1;
    ensureSize_(sheet, start + res.appends.length - 1, width);
    formatText_(sheet, res.header, textCols, start, res.appends.length);
    sheet.getRange(start, 1, res.appends.length, width).setValues(res.appends);
  }
  return { written: res.written, skipped: res.skipped };
}

/**
 * Lógica pura del merge (sin tocar la hoja), para poder probarla.
 * header: nombres de columna; data: filas existentes (sin encabezado); rows: objetos que llegan.
 * reserve(n): reserva n sellos de servidor consecutivos y regresa el primero.
 */
function mergeRows_(header, data, rows, schemaCols, reserve) {
  header = header.slice();
  var headerChanged = false;
  var newTextCols = [];
  var skipped = 0;

  function ensureCol(name) {
    if (header.indexOf(name) < 0) {
      header.push(name);
      headerChanged = true;
    }
  }
  for (var s = 0; s < schemaCols.length; s++) ensureCol(schemaCols[s]);
  ensureCol(SRV_COL);
  for (var r = 0; r < rows.length; r++) {
    for (var key in rows[r]) {
      if (key === SRV_COL || !rows[r].hasOwnProperty(key)) continue;
      ensureCol(key);
      if (typeof rows[r][key] === 'string' && schemaCols.indexOf(key) < 0 && newTextCols.indexOf(key) < 0) newTextCols.push(key);
    }
  }

  var idCol = header.indexOf('id');
  var upCol = header.indexOf('updatedAt');
  var srvCol = header.indexOf(SRV_COL);

  var byId = {};
  for (var i = 0; i < data.length; i++) {
    var existingId = data[i][idCol];
    if (existingId !== '' && existingId !== null && existingId !== undefined) byId[String(existingId)] = i;
  }

  // Si llega el mismo id dos veces, se queda el más nuevo.
  var incoming = {};
  var order = [];
  for (var k = 0; k < rows.length; k++) {
    var row = rows[k];
    var id = row && row.id !== undefined && row.id !== null ? String(row.id) : '';
    if (!id) {
      skipped++;
      continue;
    }
    if (!incoming.hasOwnProperty(id)) order.push(id);
    else if (Number(incoming[id].updatedAt) > Number(row.updatedAt)) continue;
    incoming[id] = row;
  }

  var toWrite = [];
  for (var o = 0; o < order.length; o++) {
    var rid = order[o];
    var idx = byId.hasOwnProperty(rid) ? byId[rid] : -1;
    if (idx >= 0 && Number(data[idx][upCol]) > Number(incoming[rid].updatedAt)) {
      skipped++;
      continue;
    }
    toWrite.push({ idx: idx, row: incoming[rid] });
  }

  var base = toWrite.length ? reserve(toWrite.length) : 0;
  var updatesByIdx = {};
  var appends = [];
  for (var w = 0; w < toWrite.length; w++) {
    var item = toWrite[w];
    var arr = item.idx >= 0 ? pad_(data[item.idx].slice(), header.length) : pad_([], header.length);
    for (var c = 0; c < header.length; c++) {
      var col = header[c];
      if (col === SRV_COL) continue;
      if (item.row.hasOwnProperty(col)) arr[c] = toCell_(item.row[col]);
    }
    arr[srvCol] = base + w;
    if (item.idx >= 0) {
      updatesByIdx[item.idx] = arr;
      data[item.idx] = arr;
    } else {
      appends.push(arr);
    }
  }

  var updates = [];
  for (var u in updatesByIdx) updates.push({ index: Number(u), values: updatesByIdx[u] });
  updates.sort(function (a, b) {
    return a.index - b.index;
  });

  return {
    header: header,
    headerChanged: headerChanged,
    newTextCols: newTextCols,
    updates: updates,
    appends: appends,
    written: toWrite.length,
    skipped: skipped,
  };
}

/** Agrupa actualizaciones en bloques de filas contiguas (menos llamadas a la hoja). */
function runs_(updates) {
  var out = [];
  for (var i = 0; i < updates.length; i++) {
    var last = out[out.length - 1];
    if (last && last.start + last.rows.length === updates[i].index) last.rows.push(updates[i].values);
    else out.push({ start: updates[i].index, rows: [updates[i].values] });
  }
  return out;
}

function toCell_(v) {
  if (v === null || v === undefined) return '';
  if (v === true) return 1;
  if (v === false) return 0;
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

function pad_(arr, n) {
  while (arr.length < n) arr.push('');
  return arr;
}

// ---------------------------------------------------------------------------
// pull: regresar lo que cambió desde `since`
// ---------------------------------------------------------------------------

function pull_(since, limit) {
  limit = Math.max(1, Math.min(limit, 5000));
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();
  var found = [];
  for (var table in SCHEMA) {
    var sheet = ss.getSheetByName(SCHEMA[table].sheet);
    if (!sheet) continue;
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 1) continue;
    var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    found = found.concat(selectSince_(table, trimHeader_(values[0]), values.slice(1), since, tz));
  }
  found.sort(function (a, b) {
    return a.srv - b.srv;
  });
  var more = found.length > limit;
  if (more) found = found.slice(0, limit);

  var serverTime;
  if (more) {
    serverTime = found[found.length - 1].srv;
  } else {
    serverTime = Math.max(lastStamp_(), since);
    if (found.length) serverTime = Math.max(serverTime, found[found.length - 1].srv);
  }
  var tables = {};
  for (var i = 0; i < found.length; i++) {
    if (!tables[found[i].table]) tables[found[i].table] = [];
    tables[found[i].table].push(found[i].row);
  }
  return { ok: true, serverTime: serverTime, more: more, tables: tables };
}

/** Lógica pura: filas con sello > since, como objetos {columna: valor} (sin celdas vacías ni _srv). */
function selectSince_(table, header, data, since, tz) {
  var idCol = header.indexOf('id');
  var srvCol = header.indexOf(SRV_COL);
  var out = [];
  if (idCol < 0 || srvCol < 0) return out;
  for (var i = 0; i < data.length; i++) {
    var srv = Number(data[i][srvCol]);
    if (!(srv > since)) continue;
    if (data[i][idCol] === '' || data[i][idCol] === null) continue;
    out.push({ table: table, srv: srv, row: rowToObj_(header, data[i], tz) });
  }
  return out;
}

function rowToObj_(header, row, tz) {
  var obj = {};
  for (var c = 0; c < header.length; c++) {
    var key = header[c];
    if (!key || key === SRV_COL) continue;
    var v = row[c];
    if (v === '' || v === null || v === undefined) continue;
    if (Object.prototype.toString.call(v) === '[object Date]') v = formatDate_(v, tz);
    obj[key] = v;
  }
  return obj;
}

/** Por si Sheets convirtió un texto en fecha: lo regresamos como "2026-10-12". */
function formatDate_(d, tz) {
  if (Utilities.formatDate(d, tz, 'HH:mm:ss') === '00:00:00') return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  return Utilities.formatDate(d, tz, "yyyy-MM-dd'T'HH:mm:ss");
}

// ---------------------------------------------------------------------------
// Ediciones a mano en la hoja
// ---------------------------------------------------------------------------

/** Al editar una fila a mano, se marca como cambiada para que la app la baje. */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    var sheet = e.range.getSheet();
    var table = tableForSheet_(sheet.getName());
    if (!table) return;
    var first = e.range.getRow();
    var n = e.range.getNumRows();
    if (first === 1) {
      first = 2;
      n -= 1;
    }
    if (n <= 0) return;
    var header = trimHeader_(sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0]);
    var idCol = header.indexOf('id');
    var upCol = header.indexOf('updatedAt');
    var srvCol = header.indexOf(SRV_COL);
    if (idCol < 0 || upCol < 0 || srvCol < 0) return;

    var ids = sheet.getRange(first, idCol + 1, n, 1).getValues();
    var ups = sheet.getRange(first, upCol + 1, n, 1).getValues();
    var srvs = sheet.getRange(first, srvCol + 1, n, 1).getValues();
    var base = reserveStamps_(n);
    var now = Date.now();
    for (var i = 0; i < n; i++) {
      if (ids[i][0] === '' || ids[i][0] === null) continue;
      ups[i][0] = Math.max(now, (Number(ups[i][0]) || 0) + 1);
      srvs[i][0] = base + i;
    }
    sheet.getRange(first, upCol + 1, n, 1).setValues(ups);
    sheet.getRange(first, srvCol + 1, n, 1).setValues(srvs);
  } catch (err) {
    // No interrumpir la edición si algo falla.
  }
}

function tableForSheet_(name) {
  for (var table in SCHEMA) if (SCHEMA[table].sheet === name) return table;
  return null;
}

// ---------------------------------------------------------------------------
// Sellos de servidor (siempre crecientes, nunca se repiten)
// ---------------------------------------------------------------------------

function lastStamp_() {
  return Number(PropertiesService.getScriptProperties().getProperty('LAST_STAMP') || 0);
}

function reserveStamps_(n) {
  var props = PropertiesService.getScriptProperties();
  var last = Number(props.getProperty('LAST_STAMP') || 0);
  var base = Math.max(Date.now(), last + 1);
  props.setProperty('LAST_STAMP', String(base + n - 1));
  return base;
}

function getToken_() {
  return PropertiesService.getScriptProperties().getProperty('TOKEN');
}

// ---------------------------------------------------------------------------
// Pestañas y formato
// ---------------------------------------------------------------------------

function getSheet_(ss, table) {
  var sheet = ss.getSheetByName(SCHEMA[table].sheet);
  return sheet || ensureSheet_(ss, table);
}

function ensureSheet_(ss, table) {
  var def = SCHEMA[table];
  var sheet = ss.getSheetByName(def.sheet);
  if (!sheet) sheet = ss.insertSheet(def.sheet);
  var header = sheet.getLastColumn() > 0 ? trimHeader_(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]) : [];
  var wanted = def.cols.concat([SRV_COL]);
  var changed = false;
  for (var i = 0; i < wanted.length; i++) {
    if (header.indexOf(wanted[i]) < 0) {
      header.push(wanted[i]);
      changed = true;
    }
  }
  if (changed) writeHeader_(sheet, header);
  sheet.setFrozenRows(1);
  formatText_(sheet, header, def.text, 2, Math.max(sheet.getMaxRows() - 1, 1));
  return sheet;
}

function writeHeader_(sheet, header) {
  ensureSize_(sheet, 1, header.length);
  sheet.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
}

/** Quita columnas vacías al final del encabezado. */
function trimHeader_(row) {
  var header = [];
  for (var i = 0; i < row.length; i++) header.push(row[i] === null || row[i] === undefined ? '' : String(row[i]));
  while (header.length && header[header.length - 1] === '') header.pop();
  return header;
}

function ensureSize_(sheet, rows, cols) {
  var maxRows = sheet.getMaxRows();
  if (maxRows < rows) sheet.insertRowsAfter(maxRows, rows - maxRows + 200);
  var maxCols = sheet.getMaxColumns();
  if (maxCols < cols) sheet.insertColumnsAfter(maxCols, cols - maxCols);
}

/** Texto plano ('@') para que Sheets no convierta "2026-10-12" en fecha ni "5.5" en número. */
function formatText_(sheet, header, textCols, startRow, numRows) {
  if (numRows <= 0) return;
  var list = [];
  for (var i = 0; i < textCols.length; i++) {
    var idx = header.indexOf(textCols[i]);
    if (idx < 0) continue;
    var letter = colLetter_(idx + 1);
    list.push(letter + startRow + ':' + letter + (startRow + numRows - 1));
  }
  if (list.length) sheet.getRangeList(list).setNumberFormat('@');
}

function colLetter_(n) {
  var s = '';
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Pestaña "Resumen": tus series en orden, más reciente primero (solo lectura). */
function crearResumen_(ss) {
  if (ss.getSheetByName(RESUMEN)) return;
  var series = ss.getSheetByName(SCHEMA.sets.sheet);
  var header = trimHeader_(series.getRange(1, 1, 1, series.getLastColumn()).getValues()[0]);
  function L(name) {
    return colLetter_(header.indexOf(name) + 1);
  }
  var last = colLetter_(header.length);
  var cols = [
    ['date', 'Fecha'], ['ejercicio', 'Ejercicio'], ['order', 'Serie'], ['weight', 'Peso'], ['unit', 'Unidad'],
    ['load', 'Modo'], ['reps', 'Reps'], ['weight2', 'Peso 2'], ['reps2', 'Reps 2'], ['seconds', 'Segundos'],
  ];
  var select = [];
  var labels = [];
  for (var i = 0; i < cols.length; i++) {
    // "order" empieza en 0 en la app; en el resumen la serie se numera desde 1.
    var expr = cols[i][0] === 'order' ? L('order') + '+1' : L(cols[i][0]);
    select.push(expr);
    labels.push(expr + " '" + cols[i][1] + "'");
  }
  var query =
    'select ' + select.join(', ') +
    ' where ' + L('deleted') + ' = 0' +
    ' order by ' + L('date') + ' desc, ' + L('ejercicio') + ', ' + L('order') +
    ' label ' + labels.join(', ');
  var sheet = ss.insertSheet(RESUMEN, 0);
  sheet.getRange(1, 1).setFormula('=QUERY(' + SCHEMA.sets.sheet + '!A:' + last + ', "' + query + '", 1)');
  sheet.setFrozenRows(1);
}

/** Borra la pestaña vacía que trae una hoja nueva ("Hoja 1" / "Sheet1"). */
function quitarHojaVacia_(ss) {
  var names = ['Hoja 1', 'Hoja1', 'Sheet1'];
  for (var i = 0; i < names.length; i++) {
    var sheet = ss.getSheetByName(names[i]);
    if (sheet && sheet.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sheet);
  }
}
