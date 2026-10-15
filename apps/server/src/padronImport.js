import readExcelFile from 'read-excel-file/node';

import { withTransaction } from './pg.js';
import { insertComerciante, insertPuesto, updateComerciante, updatePuesto, getRubros, getZonas, validateDocument } from './db.js';

const aliases = {
  document: ['dni', 'ruc', 'dni ruc', 'documento', 'documento identidad', 'nro documento', 'numero documento'],
  name: ['titular', 'comerciante', 'nombre', 'nombres', 'razon social', 'titular comerciante'],
  code: ['codigo puesto', 'codigo', 'cod puesto', 'puesto', 'stand', 'nro puesto', 'numero puesto', 'n puesto'],
  sector: ['sector', 'bloque', 'ubicacion', 'direccion', 'tramo'],
  zone: ['zona', 'zona municipal'],
  category: ['tipo comerciante', 'categoria comerciante', 'categoria'],
  rubro: ['rubro', 'giro', 'actividad'],
  area: ['m2', 'm²', 'area', 'metraje', 'metros cuadrados', 'superficie'],
  status: ['asistencia', 'estado', 'presencia', 'incidencia', 'situacion', 'condicion', 'observacion', 'observaciones']
};

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

function isAbsent(value) {
  const status = normalize(value);
  return ['ausente', 'inasistente', 'inasistencia', 'no asistio', 'no asistencia'].some((term) => status.includes(term));
}

export async function readPadronWorkbook(buffer) {
  const sheets = await readExcelFile(buffer);
  return sheets.map(({ sheet, data }) => ({ name: sheet, rows: data }));
}

export async function previewPadronSheets(sheets, { filename = '', db }) {
  const rubros = await getRubros(db);
  const zonas = await getZonas(db);
  const defaultRubroId = resolveCatalogId(rubros, filename, null);
  const defaultZonaId = zonas[0]?.id;
  const seenDocuments = new Set();
  const seenCodes = new Set();
  const candidates = [];
  const sheetSummaries = [];
  const errors = [];
  let attendanceWorkbook = true;
  let attendanceRecords = 0;
  let attendanceMarks = 0;

  for (const sheet of sheets) {
    const detected = headerMapping(sheet.rows);
    if (!detected) {
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
      const document = documentValue(value(detected.mapping.document));
      const name = cellText(value(detected.mapping.name));
      const area = numericArea(value(detected.mapping.area));
      const sector = cellText(value(detected.mapping.sector)) || sheet.name;
      const code = cellText(value(detected.mapping.code)) || generatedCode(sheet.name, rowNumber);
      const rawCategory = cellText(value(detected.mapping.category));
      const category = validCategory(rawCategory, 'ferial');
      const absence = isAbsent(value(detected.mapping.status));
      const rubroValue = cellText(value(detected.mapping.rubro)) || (defaultRubroId ? filename : sheet.name);
      const zoneValue = cellText(value(detected.mapping.zone)) || sheet.name;
      const rubroId = resolveCatalogId(rubros, rubroValue, defaultRubroId);
      const zonaId = resolveCatalogId(zonas, zoneValue, defaultZonaId);
      const rowErrors = [];

      if (!document) {
        rowErrors.push('Falta DNI/RUC.');
      } else {
        try {
          validateDocument(document);
        } catch (error) {
          rowErrors.push(error.message);
        }
      }
      if (!name) rowErrors.push('Falta el nombre del titular.');
      if (!Number.isFinite(area) || area <= 0) rowErrors.push('Falta un metraje mayor que cero.');
      if (!rubroId) rowErrors.push(`No hay un rubro configurado que coincida con "${rubroValue}".`);
      if (!zonaId) rowErrors.push(`No hay una zona configurada para "${zoneValue}".`);
      if (document && seenDocuments.has(document)) rowErrors.push('DNI/RUC duplicado dentro del libro.');
      if (document) seenDocuments.add(document);
      if (seenCodes.has(code)) rowErrors.push(`Código de puesto ${code} duplicado dentro del libro.`);
      seenCodes.add(code);

      const existingMerchant = document
        ? (await db.query('SELECT id, estado FROM comerciantes WHERE dni_ruc = $1', [document])).rows[0]
        : null;
      const existingPost = (await db.query('SELECT id, comerciante_id FROM puestos WHERE codigo_puesto = $1', [code])).rows[0];
      if (existingPost && (!existingMerchant || Number(existingPost.comerciante_id) !== Number(existingMerchant.id))) {
        rowErrors.push(`El código de puesto ${code} ya está asignado a otro comerciante.`);
      }

      const candidate = {
        sheet: sheet.name,
        row: rowNumber,
        document,
        name,
        rubroId,
        zonaId,
        category,
        code,
        sector,
        area,
        absence,
        existingMerchantId: existingMerchant ? Number(existingMerchant.id) : null,
        existingMerchantState: existingMerchant?.estado || null,
        existingPostId: existingPost ? Number(existingPost.id) : null,
        errors: rowErrors
      };
      candidates.push(candidate);
      if (rowErrors.length) errors.push({ sheet: sheet.name, row: rowNumber, message: rowErrors.join(' ') });
      sheetRows += 1;
    }

    sheetSummaries.push({ sheet: sheet.name, rows: sheetRows, columns: detected.header });
  }

  return {
    workbookType: attendanceWorkbook ? 'attendance' : 'merchant-padron',
    attendanceRecords,
    attendanceMarks,
    sheets: sheetSummaries,
    rows: candidates.length,
    validRows: candidates.filter((row) => row.errors.length === 0).length,
    invalidRows: candidates.filter((row) => row.errors.length > 0).length,
    existingMerchants: candidates.filter((row) => row.existingMerchantId && row.errors.length === 0).length,
    newMerchants: candidates.filter((row) => !row.existingMerchantId && row.errors.length === 0).length,
    newPosts: candidates.filter((row) => !row.existingPostId && row.errors.length === 0).length,
    absentRows: candidates.filter((row) => row.absence && row.errors.length === 0).length,
    errors,
    candidates
  };
}

export async function importPadronPreview(_db, preview, userId = 1) {
  let createdMerchants = 0;
  let updatedMerchants = 0;
  let createdPosts = 0;
  let updatedPosts = 0;
  let absentPosts = 0;

  await withTransaction(async (client) => {
    for (const row of preview.candidates) {
      if (row.errors.length) continue;
      const merchantPayload = {
        dni_ruc: row.document,
        nombre: row.name,
        rubro_id: row.rubroId,
        zona_id: row.zonaId,
        categoria: row.category,
        tipo_comerciante: row.category,
        estado: row.existingMerchantState || 'activo',
        usuario_creador: userId
      };

      let merchantId = row.existingMerchantId;
      if (merchantId) {
        await updateComerciante(client, merchantId, merchantPayload);
        updatedMerchants += 1;
      } else {
        merchantId = (await insertComerciante(client, merchantPayload)).id;
        createdMerchants += 1;
      }

      const postPayload = {
        comerciante_id: merchantId,
        zona_id: row.zonaId,
        direccion: `${row.sector} - ${row.code}`,
        metros_cuadrados: row.area,
        codigo_puesto: row.code,
        estado: row.absence ? 'disponible' : 'ocupado'
      };
      if (row.existingPostId) {
        await updatePuesto(client, row.existingPostId, postPayload);
        updatedPosts += 1;
      } else {
        await insertPuesto(client, postPayload);
        createdPosts += 1;
      }
      if (row.absence) absentPosts += 1;
    }
  });

  return {
    createdMerchants,
    updatedMerchants,
    createdPosts,
    updatedPosts,
    absentPosts,
    skippedRows: preview.invalidRows
  };
}
