import { createHash } from 'node:crypto';
import readExcelFile from 'read-excel-file/node';

import { withTransaction } from './pg.js';
import { FERIA_WEEKDAYS, getRubros, getZonas, validateDocument } from './db.js';

export const TEMPLATE_LISTS_SHEET = 'LISTAS';

const aliases = {
  document: ['dni', 'ruc', 'dni ruc', 'documento', 'documento identidad', 'nro documento', 'numero documento'],
  name: ['titular', 'comerciante', 'nombre', 'nombres', 'razon social', 'titular comerciante'],
  code: ['codigo puesto', 'codigo', 'cod puesto', 'puesto', 'stand', 'nro puesto', 'numero puesto', 'n puesto'],
  sector: ['sector', 'bloque', 'ubicacion', 'direccion', 'tramo'],
  zone: ['zona', 'zona municipal'],
  category: ['tipo comerciante', 'categoria comerciante', 'categoria'],
  rubro: ['rubro', 'giro', 'actividad'],
  area: ['m2', 'm²', 'area', 'metraje', 'metros cuadrados', 'superficie'],
  status: ['asistencia', 'estado', 'presencia', 'incidencia', 'situacion', 'condicion', 'observacion', 'observaciones'],
  date: ['fecha feria', 'fecha de feria', 'dia feria', 'fecha']
};

// Marca con la que el padrón registra la asistencia de una fecha; se reemplaza al reimportar.
const PADRON_ATTENDANCE_SESSION = 'padron';
const TEMP_DOCUMENT_PREFIX = 'TEMP_DNI_';

// Titular sin DNI: documento temporal estable a partir del nombre, para reconocerlo al reimportar.
export function temporaryDocument(name) {
  return `${TEMP_DOCUMENT_PREFIX}${createHash('sha256').update(normalize(name)).digest('hex').slice(0, 12).toUpperCase()}`;
}

function isTemporaryDocument(document) {
  return String(document || '').startsWith('TEMP_');
}

// Nombre comparable en SQL con normalize(): sin tildes, minúsculas y solo letras y números.
const SQL_NORMALIZED_NAME = `btrim(lower(regexp_replace(translate(nombre, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'), '[^A-Za-z0-9]+', ' ', 'g')))`;

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function cellText(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? '').trim();
}

function findColumn(header, candidates) {
  const normalizedHeader = header.map(normalize);
  for (const candidate of candidates) {
    const exactIndex = normalizedHeader.findIndex((value) => value === normalize(candidate));
    if (exactIndex >= 0) return exactIndex;
  }
  for (const candidate of candidates) {
    const normalizedCandidate = normalize(candidate);
    const partialIndex = normalizedHeader.findIndex((value) => value && value.includes(normalizedCandidate));
    if (partialIndex >= 0) return partialIndex;
  }
  return -1;
}

function headerMapping(rows) {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 20); rowIndex += 1) {
    const header = rows[rowIndex] || [];
    const mapping = Object.fromEntries(Object.entries(aliases).map(([key, values]) => [key, findColumn(header, values)]));
    if (mapping.document >= 0 && mapping.name >= 0) return { rowIndex, mapping, header: header.map(cellText) };
  }
  return null;
}

function isAttendanceMarker(value) {
  const marker = normalize(value);
  return ['p', 'f', 'n', 'n s', 'ns', '-', 'p 1 mn', 'p 1 manana'].includes(marker);
}

function detectAttendanceSheet(sheet) {
  const rows = sheet.rows || [];
  const sheetLabel = normalize(sheet.name);
  const titleHasBlock = sheetLabel.includes('bloque')
    || rows.slice(0, 3).some((row) => row.some((cell) => normalize(cell).includes('bloque')));
  if (!titleHasBlock) return null;

  let dataStart = -1;
  let dataRows = [];
  for (let start = 0; start < Math.min(rows.length, 5); start += 1) {
    const candidateRows = rows.slice(start).filter((row) => (
      /^\d+(?:\.0+)?$/.test(cellText(row?.[0])) && cellText(row?.[1]).length > 1
    ));
    if (candidateRows.length >= 3) {
      dataStart = start;
      dataRows = candidateRows;
      break;
    }
  }
  if (dataStart < 0) return null;

  const marks = {};
  let markedCells = 0;
  for (const row of dataRows) {
    for (const cell of row.slice(2)) {
      const marker = normalize(cell);
      if (isAttendanceMarker(cell) && marker !== '-') {
        marks[marker] = (marks[marker] || 0) + 1;
        markedCells += 1;
      }
    }
  }

  const dates = rows.slice(0, dataStart || 2).flatMap((row) => row.slice(2).map((cell) => {
    if (cell instanceof Date) return cell.toISOString().slice(0, 10);
    const text = cellText(cell);
    return /^(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/.test(text) ? text : null;
  })).filter(Boolean);

  return { dataStart, records: dataRows.length, markedCells, marks, dates: [...new Set(dates)] };
}

function validCategory(value, fallback = 'ferial') {
  const normalized = normalize(value);
  if (normalized.includes('eventual')) return 'eventual';
  if (normalized.includes('permanente')) return 'permanente';
  if (normalized.includes('ferial') || normalized.includes('feria')) return 'ferial';
  return fallback;
}

function documentValue(value) {
  const raw = cellText(value).replace(/\D/g, '');
  if (typeof value === 'number' && raw.length > 0 && raw.length <= 8) return raw.padStart(8, '0');
  return raw;
}

function numericArea(value) {
  if (typeof value === 'number') return value;
  const normalized = cellText(value).replace(',', '.').match(/\d+(?:\.\d+)?/);
  return normalized ? Number(normalized[0]) : 0;
}

function resolveCatalogId(items, value, fallbackId) {
  const target = normalize(value);
  const found = items.find((item) => normalize(item.nombre) === target)
    || items.find((item) => target && (normalize(item.nombre).includes(target) || target.includes(normalize(item.nombre))));
  return found?.id ?? fallbackId;
}

function generatedCode(sheetName, rowNumber) {
  const prefix = normalize(sheetName).replace(/\s+/g, '-').slice(0, 12) || 'PADRON';
  return `${prefix}-${String(rowNumber).padStart(4, '0')}`.toUpperCase();
}

// Fecha de feria desde una celda o del formulario: Date, AAAA-MM-DD o DD/MM/AAAA.
export function parseFeriaDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const text = cellText(value);
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!match) return null;
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

function isFeriaDay(date) {
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date && FERIA_WEEKDAYS.includes(parsed.getUTCDay());
}

function isAbsent(value) {
  const status = normalize(value);
  return ['ausente', 'inasistente', 'inasistencia', 'no asistio', 'no asistencia'].some((term) => status.includes(term));
}

async function groupByKey(db, sql, keys) {
  const groups = new Map();
  const unique = [...new Set(keys)];
  if (!unique.length) return groups;
  for (const row of (await db.query(sql, [unique])).rows) {
    if (!groups.has(row.key)) groups.set(row.key, []);
    groups.get(row.key).push(row);
  }
  return groups;
}

// Para columnas con restricción UNIQUE (dni_ruc, codigo_puesto): una fila por clave.
async function lookupByKey(db, sql, keys) {
  const groups = await groupByKey(db, sql, keys);
  return new Map([...groups].map(([key, rows]) => [key, rows[0]]));
}

export async function readPadronWorkbook(buffer) {
  const sheets = await readExcelFile(buffer);
  return sheets.map(({ sheet, data }) => ({ name: sheet, rows: data }));
}

export async function previewPadronSheets(sheets, { filename = '', db, fechaFeria = '' }) {
  const defaultFeriaDate = fechaFeria ? parseFeriaDate(fechaFeria) : null;
  if (fechaFeria && (!defaultFeriaDate || !isFeriaDay(defaultFeriaDate))) {
    throw new Error('La fecha de la feria debe ser un martes o miércoles válido (AAAA-MM-DD).');
  }
  const rubros = await getRubros(db);
  const zonas = await getZonas(db);
  const defaultRubroId = resolveCatalogId(rubros, filename, null);
  const defaultZonaId = zonas[0]?.id;
  const firstRowByDocument = new Map();
  const seenCodes = new Set();
  const candidates = [];
  const sheetSummaries = [];
  const errors = [];
  const warnings = [];
  let attendanceWorkbook = true;
  let attendanceRecords = 0;
  let attendanceMarks = 0;

  for (const sheet of sheets) {
    const detected = headerMapping(sheet.rows);
    if (!detected) {
      // La hoja oculta de listas de la plantilla oficial no es parte del padrón.
      if (normalize(sheet.name) === normalize(TEMPLATE_LISTS_SHEET)) continue;
      const attendance = detectAttendanceSheet(sheet);
      if (attendance) {
        attendanceRecords += attendance.records;
        attendanceMarks += attendance.markedCells;
        sheetSummaries.push({
          sheet: sheet.name,
          rows: attendance.records,
          attendanceMarks: attendance.markedCells,
          marks: attendance.marks,
          dates: attendance.dates,
          attendanceSheet: true,
          skipped: true,
          reason: 'Padrón de asistencia: incluye correlativo, nombre y marcas por fecha; faltan DNI/RUC y metraje para crear registros fiscales.'
        });
        continue;
      }
      attendanceWorkbook = false;
      sheetSummaries.push({ sheet: sheet.name, rows: 0, skipped: true, reason: 'No se detectaron encabezados reconocibles de DNI/RUC y titular ni formato de asistencia por bloque.' });
      continue;
    }
    attendanceWorkbook = false;

    let sheetRows = 0;
    for (let index = detected.rowIndex + 1; index < sheet.rows.length; index += 1) {
      const source = sheet.rows[index] || [];
      if (source.every((cell) => cell === null || cell === undefined || cellText(cell) === '')) continue;
      const rowNumber = index + 1;
      const value = (column) => column < 0 ? '' : source[column];
      const name = cellText(value(detected.mapping.name));
      const rawDocument = documentValue(value(detected.mapping.document));
      // Sin DNI/RUC se importa como pendiente de regularización con un documento temporal.
      const temporary = !rawDocument && Boolean(name);
      const document = temporary ? temporaryDocument(name) : rawDocument;
      // El metraje es informativo: el cobro es fijo por zona y por día de feria.
      const rawArea = numericArea(value(detected.mapping.area));
      const area = Number.isFinite(rawArea) && rawArea > 0 ? rawArea : null;
      const sector = cellText(value(detected.mapping.sector)) || sheet.name;
      const code = cellText(value(detected.mapping.code)) || generatedCode(sheet.name, rowNumber);
      const rawCategory = cellText(value(detected.mapping.category));
      const category = validCategory(rawCategory, 'ferial');
      const absence = isAbsent(value(detected.mapping.status));
      const rawDate = value(detected.mapping.date);
      const feriaDate = cellText(rawDate) ? parseFeriaDate(rawDate) : defaultFeriaDate;
      const rubroValue = cellText(value(detected.mapping.rubro)) || (defaultRubroId ? filename : sheet.name);
      const zoneValue = cellText(value(detected.mapping.zone)) || sheet.name;
      const rubroId = resolveCatalogId(rubros, rubroValue, defaultRubroId);
      const zonaId = resolveCatalogId(zonas, zoneValue, defaultZonaId);
      const rowErrors = [];

      if (!name) rowErrors.push(rawDocument ? 'Falta el nombre del titular.' : 'Faltan el DNI/RUC y el nombre del titular.');
      if (rawDocument) {
        try {
          validateDocument(rawDocument);
        } catch (error) {
          rowErrors.push(error.message);
        }
      }
      if (!rubroId) rowErrors.push(`No hay un rubro configurado que coincida con "${rubroValue}".`);
      if (!zonaId) rowErrors.push(`No hay una zona configurada para "${zoneValue}".`);
      // Un titular puede tener varios puestos: el mismo DNI se acepta si el nombre coincide.
      const previous = document ? firstRowByDocument.get(document) : null;
      if (previous && normalize(previous.name) !== normalize(name)) {
        rowErrors.push(`El DNI/RUC ${document} ya figura en la fila ${previous.row} (${previous.sheet}) con otro titular: ${previous.name}.`);
      }
      if (document && !previous) firstRowByDocument.set(document, { name, row: rowNumber, sheet: sheet.name });
      if (seenCodes.has(code)) rowErrors.push(`Código de puesto ${code} duplicado dentro del libro.`);
      seenCodes.add(code);
      // La falta se registra para una feria concreta; sin fecha no se puede saber qué día no se cobra.
      if (cellText(rawDate) && !feriaDate) rowErrors.push(`La fecha "${cellText(rawDate)}" no es válida.`);
      else if (feriaDate && !isFeriaDay(feriaDate)) rowErrors.push(`La fecha ${feriaDate} no es día de feria (martes o miércoles).`);
      else if (absence && !feriaDate) rowErrors.push('Ausente sin fecha de feria: agrega la columna "Fecha Feria" o elige la fecha al subir el archivo.');

      candidates.push({
        sheet: sheet.name,
        row: rowNumber,
        document,
        temporary,
        name,
        rubroId,
        zonaId,
        category,
        code,
        sector,
        address: `${sector} - ${code}`,
        area,
        absence,
        feriaDate,
        existingMerchantId: null,
        existingMerchantState: null,
        existingPostId: null,
        reactivate: false,
        regularize: false,
        errors: rowErrors
      });
      sheetRows += 1;
    }

    sheetSummaries.push({ sheet: sheet.name, rows: sheetRows, columns: detected.header });
  }

  // Cruce con la base en lote: unas pocas consultas para todo el libro en vez de dos por fila.
  const merchantsByDocument = await lookupByKey(db,
    'SELECT id, estado, nombre, dni_ruc AS key FROM comerciantes WHERE dni_ruc = ANY($1::text[])',
    candidates.map((row) => row.document).filter(Boolean));
  const postsByCode = await lookupByKey(db, `
    SELECT p.id, p.comerciante_id, c.dni_ruc AS dueno_dni, c.nombre AS dueno_nombre, c.estado AS dueno_estado, p.codigo_puesto AS key
    FROM puestos p JOIN comerciantes c ON c.id = p.comerciante_id
    WHERE p.codigo_puesto = ANY($1::text[])`,
  candidates.map((row) => row.code));
  const postsByAddress = await groupByKey(db, `
    SELECT comerciante_id, zona_id || ':' || lower(btrim(direccion)) AS key FROM puestos
    WHERE estado <> 'inactivo' AND lower(btrim(direccion)) = ANY($1::text[])`,
  candidates.map((row) => row.address.trim().toLowerCase()));
  // Posibles duplicados: un titular sin DNI cuyo nombre ya existe con DNI real.
  const namesWithDocument = await groupByKey(db, `
    SELECT id, dni_ruc, nombre, ${SQL_NORMALIZED_NAME} AS key FROM comerciantes
    WHERE left(dni_ruc, 5) <> 'TEMP_' AND ${SQL_NORMALIZED_NAME} = ANY($1::text[])`,
  candidates.filter((row) => row.temporary).map((row) => normalize(row.name)));

  // Comerciante de cada DNI del libro: el que ya existe con ese documento o, si un puesto suyo
  // lo tiene un titular temporal con el mismo nombre, ese titular (se regulariza con el DNI real).
  const merchantByDocument = new Map();
  for (const row of candidates) {
    if (!row.document || merchantByDocument.has(row.document)) continue;
    const existing = merchantsByDocument.get(row.document);
    if (existing) {
      merchantByDocument.set(row.document, { id: Number(existing.id), estado: existing.estado, regularize: false });
      continue;
    }
    if (row.temporary) continue;
    const temporaryOwner = candidates
      .filter((other) => other.document === row.document)
      .map((other) => postsByCode.get(other.code))
      .find((post) => post && isTemporaryDocument(post.dueno_dni) && normalize(post.dueno_nombre) === normalize(row.name));
    if (temporaryOwner) merchantByDocument.set(row.document, { id: Number(temporaryOwner.comerciante_id), estado: temporaryOwner.dueno_estado, regularize: true });
  }

  for (const row of candidates) {
    const merchant = row.document ? merchantByDocument.get(row.document) : null;
    const existingPost = postsByCode.get(row.code);
    const merchantId = merchant ? merchant.id : null;
    if (existingPost && Number(existingPost.comerciante_id) !== merchantId) {
      row.errors.push(`El código de puesto ${row.code} ya está asignado a otro comerciante.`);
    }
    if (!existingPost) {
      const samePlace = postsByAddress.get(`${row.zonaId}:${row.address.trim().toLowerCase()}`) || [];
      if (samePlace.some((post) => Number(post.comerciante_id) !== merchantId)) {
        row.errors.push(`El puesto físico "${row.address}" ya está asignado a otro comerciante.`);
      }
    }
    row.existingMerchantId = merchantId;
    row.existingMerchantState = merchant?.estado || null;
    row.existingPostId = existingPost ? Number(existingPost.id) : null;
    // Un dado de baja que vuelve a figurar en el padrón se reactiva; se avisa antes de confirmar.
    row.reactivate = merchant?.estado === 'inactivo';
    row.regularize = Boolean(merchant?.regularize);
    if (row.errors.length) errors.push({ sheet: row.sheet, row: row.row, message: row.errors.join(' ') });
    if (row.temporary && !row.errors.length) {
      const sameName = namesWithDocument.get(normalize(row.name)) || [];
      const sameNameInBook = candidates.find((other) => !other.temporary && other.document && normalize(other.name) === normalize(row.name));
      if (sameName.length || sameNameInBook) {
        const match = sameName[0] ? `${sameName[0].nombre} (${sameName[0].dni_ruc})` : `${sameNameInBook.name} (${sameNameInBook.document}, fila ${sameNameInBook.row})`;
        warnings.push({ sheet: row.sheet, row: row.row, message: `Titular sin DNI con el mismo nombre que ${match}: revisa si es la misma persona.` });
      }
    }
  }

  const valid = candidates.filter((row) => row.errors.length === 0);
  const uniqueBy = (list, key) => [...new Map(list.map((row) => [key(row), row])).values()];
  const validMerchants = uniqueBy(valid, (row) => row.document);
  return {
    workbookType: attendanceWorkbook ? 'attendance' : 'merchant-padron',
    attendanceRecords,
    attendanceMarks,
    sheets: sheetSummaries,
    rows: candidates.length,
    validRows: valid.length,
    invalidRows: candidates.length - valid.length,
    existingMerchants: validMerchants.filter((row) => row.existingMerchantId).length,
    newMerchants: validMerchants.filter((row) => !row.existingMerchantId).length,
    pendingMerchants: validMerchants.filter((row) => row.temporary && !row.existingMerchantId).length,
    multiPostMerchants: validMerchants.filter((row) => valid.filter((other) => other.document === row.document).length > 1).length,
    regularizedMerchants: validMerchants.filter((row) => row.regularize).map((row) => ({ nombre: row.name, dni_ruc: row.document })),
    reactivatedMerchants: validMerchants.filter((row) => row.reactivate).map((row) => ({ nombre: row.name, dni_ruc: row.document })),
    newPosts: valid.filter((row) => !row.existingPostId).length,
    absentRows: valid.filter((row) => row.absence).length,
    attendanceRows: valid.filter((row) => row.feriaDate).length,
    feriaDates: [...new Set(valid.filter((row) => row.feriaDate).map((row) => row.feriaDate))].sort(),
    source: filename,
    errors,
    warnings,
    candidates
  };
}

// Inserta y actualiza en bloque con unnest: un puñado de consultas por libro en vez de ~9 por fila.
// Las reglas de insertComerciante/insertPuesto ya se verificaron en previewPadronSheets.
export async function importPadronPreview(_db, preview, userId = 1) {
  const rows = preview.candidates.filter((row) => row.errors.length === 0);
  // Un comerciante por DNI (con uno o varios puestos): sus datos salen de su primera fila.
  const merchants = [...new Map(rows.map((row) => [row.document, row])).values()];
  const newMerchants = merchants.filter((row) => !row.existingMerchantId);
  const knownMerchants = merchants.filter((row) => row.existingMerchantId);
  const newPosts = rows.filter((row) => !row.existingPostId);
  const knownPosts = rows.filter((row) => row.existingPostId);
  const attendance = rows.filter((row) => row.feriaDate);
  const column = (list, pick) => list.map(pick);

  try {
    await withTransaction(async (client) => {
      const creator = (await client.query('SELECT id FROM usuarios WHERE id = $1', [Number(userId)])).rows[0];
      const merchantIds = new Map(knownMerchants.map((row) => [row.document, row.existingMerchantId]));
      const postIds = new Map(knownPosts.map((row) => [row.code, row.existingPostId]));

      if (newMerchants.length) {
        const inserted = await client.query(`
          INSERT INTO comerciantes (dni_ruc, nombre, rubro_id, zona_id, categoria, tipo_comerciante, estado, estado_empadronamiento, usuario_creador_id)
          SELECT v.dni_ruc, v.nombre, v.rubro_id, v.zona_id, v.categoria, v.categoria,
                 CASE WHEN v.temporal THEN 'pendiente' ELSE 'activo' END,
                 CASE WHEN v.temporal THEN 'PENDIENTE_REGULARIZACION' ELSE 'REGULARIZADO' END, $7
          FROM unnest($1::text[], $2::text[], $3::int[], $4::int[], $5::text[], $6::boolean[]) AS v(dni_ruc, nombre, rubro_id, zona_id, categoria, temporal)
          RETURNING id, dni_ruc`,
        [column(newMerchants, (row) => row.document), column(newMerchants, (row) => row.name),
          column(newMerchants, (row) => row.rubroId), column(newMerchants, (row) => row.zonaId),
          column(newMerchants, (row) => row.category), column(newMerchants, (row) => row.temporary),
          creator ? Number(userId) : null]);
        for (const merchant of inserted.rows) merchantIds.set(merchant.dni_ruc, Number(merchant.id));
      }

      // Se conserva el estado, salvo al reactivar a un dado de baja o al regularizar con el DNI real.
      if (knownMerchants.length) {
        await client.query(`
          UPDATE comerciantes c
          SET nombre = v.nombre, rubro_id = v.rubro_id, zona_id = v.zona_id, categoria = v.categoria, tipo_comerciante = v.categoria,
              dni_ruc = CASE WHEN v.regularizar THEN v.dni_ruc ELSE c.dni_ruc END,
              estado_empadronamiento = CASE WHEN v.regularizar THEN 'REGULARIZADO' ELSE c.estado_empadronamiento END,
              estado = CASE
                WHEN v.regularizar AND c.estado IN ('pendiente', 'inactivo') THEN 'activo'
                WHEN v.reactivar THEN CASE WHEN c.estado_empadronamiento = 'PENDIENTE_REGULARIZACION' THEN 'pendiente' ELSE 'activo' END
                ELSE c.estado END,
              fecha_baja = CASE WHEN v.reactivar THEN NULL ELSE c.fecha_baja END
          FROM unnest($1::bigint[], $2::text[], $3::int[], $4::int[], $5::text[], $6::text[], $7::boolean[], $8::boolean[])
            AS v(id, nombre, rubro_id, zona_id, categoria, dni_ruc, regularizar, reactivar)
          WHERE c.id = v.id`,
        [column(knownMerchants, (row) => row.existingMerchantId), column(knownMerchants, (row) => row.name),
          column(knownMerchants, (row) => row.rubroId), column(knownMerchants, (row) => row.zonaId),
          column(knownMerchants, (row) => row.category), column(knownMerchants, (row) => row.document),
          column(knownMerchants, (row) => row.regularize), column(knownMerchants, (row) => row.reactivate)]);
      }

      if (newPosts.length) {
        const inserted = await client.query(`
          INSERT INTO puestos (comerciante_id, zona_id, codigo_puesto, direccion, metros_cuadrados, estado)
          SELECT v.comerciante_id, v.zona_id, v.codigo, v.direccion, v.metros, 'ocupado'
          FROM unnest($1::bigint[], $2::int[], $3::text[], $4::text[], $5::numeric[]) AS v(comerciante_id, zona_id, codigo, direccion, metros)
          RETURNING id, codigo_puesto`,
        [column(newPosts, (row) => merchantIds.get(row.document)), column(newPosts, (row) => row.zonaId),
          column(newPosts, (row) => row.code), column(newPosts, (row) => row.address),
          column(newPosts, (row) => row.area)]);
        for (const post of inserted.rows) postIds.set(post.codigo_puesto, Number(post.id));
      }

      if (knownPosts.length) {
        await client.query(`
          UPDATE puestos p
          SET zona_id = v.zona_id, direccion = v.direccion, metros_cuadrados = COALESCE(v.metros, p.metros_cuadrados), estado = 'ocupado'
          FROM unnest($1::bigint[], $2::int[], $3::text[], $4::numeric[]) AS v(id, zona_id, direccion, metros)
          WHERE p.id = v.id`,
        [column(knownPosts, (row) => row.existingPostId), column(knownPosts, (row) => row.zonaId),
          column(knownPosts, (row) => row.address), column(knownPosts, (row) => row.area)]);
      }

      // Ausente = falta (F) en esa feria, que no se cobra; presente = P. El puesto sigue asignado al titular.
      if (attendance.length) {
        await client.query(`
          INSERT INTO asistencias_feriales (puesto_id, fecha, sesion, marca, fuente)
          SELECT v.puesto_id, v.fecha, $4, v.marca, $5
          FROM unnest($1::bigint[], $2::date[], $3::text[]) AS v(puesto_id, fecha, marca)
          ON CONFLICT (puesto_id, fecha, sesion) DO UPDATE SET marca = EXCLUDED.marca, fuente = EXCLUDED.fuente, registrado_en = now()`,
        [column(attendance, (row) => postIds.get(row.code)), column(attendance, (row) => row.feriaDate),
          column(attendance, (row) => (row.absence ? 'F' : 'P')), PADRON_ATTENDANCE_SESSION, preview.source || 'padron']);
      }
    });
  } catch (error) {
    // Otro usuario registró el mismo DNI/RUC o código entre la previsualización y la confirmación.
    if (error.code === '23505') throw new Error('Otro registro tomó un DNI/RUC o código de puesto del libro mientras se importaba; vuelve a previsualizar el archivo.');
    throw error;
  }

  return {
    createdMerchants: newMerchants.length,
    updatedMerchants: knownMerchants.length,
    pendingMerchants: newMerchants.filter((row) => row.temporary).length,
    reactivatedMerchants: knownMerchants.filter((row) => row.reactivate).length,
    regularizedMerchants: knownMerchants.filter((row) => row.regularize).length,
    createdPosts: newPosts.length,
    updatedPosts: knownPosts.length,
    absentPosts: rows.filter((row) => row.absence).length,
    attendanceMarks: attendance.length,
    skippedRows: preview.invalidRows
  };
}
