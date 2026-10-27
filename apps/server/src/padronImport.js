import { createHash, randomUUID } from 'node:crypto';
import readExcelFile from 'read-excel-file/node';

import { AppError } from './errors.js';
import { withTransaction } from './pg.js';
import { insertComerciante, insertPuesto, updateComerciante, updatePuesto, getRubros, getZonas, validateDocument, esDocumentoTemporal } from './db.js';

// Hoja oculta de la plantilla oficial con las listas desplegables: no es parte del padrón.
export const HOJA_LISTAS_PLANTILLA = 'LISTAS_SISREC';

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

// Titular sin DNI: documento provisional estable (el mismo nombre da el mismo documento), así reimportar no
// lo duplica. Mismo formato que la semilla ferial (TEMP_DNIZAP_), con su propio prefijo.
function documentoTemporal(name) {
  return `TEMP_DNI_${createHash('sha256').update(normalize(name)).digest('hex').slice(0, 12).toUpperCase()}`;
}

// Misma comparación que validatePuestoPlacement (db.js): zona + dirección sin mayúsculas ni espacios de borde.
const ubicacion = (zonaId, direccion) => `${Number(zonaId)}|${String(direccion || '').trim().toLowerCase()}`;
const nombreComparable = (name) => String(name || '').trim().toLowerCase();

export async function readPadronWorkbook(buffer) {
  const sheets = await readExcelFile(buffer);
  return sheets.map(({ sheet, data }) => ({ name: sheet, rows: data }));
}

// Vista previa guardada para confirmar sin volver a subir el Excel. Vive en la memoria del proceso: vale
// mientras la API corra en una sola instancia (el despliegue actual) y se pierde al reiniciarla.
const VISTA_PREVIA_TTL_MS = 15 * 60 * 1000;
const MAX_VISTAS_PREVIAS = 50;
const vistasPrevias = new Map();

export function guardarVistaPrevia(usuarioId, datos, ahora = Date.now()) {
  for (const [token, item] of vistasPrevias) if (item.venceEn <= ahora) vistasPrevias.delete(token);
  // Tope de memoria: se descarta la más antigua (el Map conserva el orden de inserción).
  while (vistasPrevias.size >= MAX_VISTAS_PREVIAS) vistasPrevias.delete(vistasPrevias.keys().next().value);
  const token = randomUUID();
  vistasPrevias.set(token, { usuarioId: Number(usuarioId), datos, venceEn: ahora + VISTA_PREVIA_TTL_MS });
  return token;
}

// null si no existe, ya venció o la guardó otro usuario.
export function tomarVistaPrevia(token, usuarioId, ahora = Date.now()) {
  const item = vistasPrevias.get(String(token || ''));
  if (!item || item.venceEn <= ahora || item.usuarioId !== Number(usuarioId)) return null;
  return item.datos;
}

export function descartarVistaPrevia(token) {
  vistasPrevias.delete(String(token || ''));
}

export async function previewPadronSheets(sheets, { filename = '', db }) {
  const rubros = await getRubros(db);
  const zonas = await getZonas(db);
  const defaultRubroId = resolveCatalogId(rubros, filename, null);
  const defaultZonaId = zonas[0]?.id;
  // En una zona con tipo de vía el cobro es por día cobrado y no usa metros: ahí el metraje es opcional.
  const zonasConVia = new Set(zonas.filter((zona) => zona.tipo_via).map((zona) => Number(zona.id)));
  const seenCodes = new Set();
  const candidates = [];
  const sheetSummaries = [];
  let attendanceWorkbook = true;
  let attendanceRecords = 0;
  let attendanceMarks = 0;

  // 1) Leer las filas del libro, sin consultar la base.
  for (const sheet of sheets) {
    if (sheet.name === HOJA_LISTAS_PLANTILLA) continue;
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
      const rawDocument = documentValue(value(detected.mapping.document));
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
      // Sin DNI/RUC el titular entra como pendiente de regularización, con un documento provisional.
      const temporal = !rawDocument;
      const document = temporal ? (name ? documentoTemporal(name) : '') : rawDocument;
      if (!temporal) {
        try {
          validateDocument(rawDocument);
        } catch (error) {
          rowErrors.push(error.message);
        }
      }
      const sinMetraje = !Number.isFinite(area) || area <= 0;
      if (!name) rowErrors.push('Falta el nombre del titular.');
      if (sinMetraje && zonaId && !zonasConVia.has(Number(zonaId))) {
        rowErrors.push('Falta un metraje mayor que cero: la zona no tiene tipo de vía y su tarifa puede ser por metro cuadrado.');
      }
      if (!rubroId) rowErrors.push(`No hay un rubro configurado que coincida con "${rubroValue}".`);
      if (!zonaId) rowErrors.push(`No hay una zona configurada para "${zoneValue}".`);
      if (seenCodes.has(code)) rowErrors.push(`Código de puesto ${code} duplicado dentro del libro.`);
      seenCodes.add(code);

      candidates.push({
        sheet: sheet.name,
        row: rowNumber,
        document,
        temporal,
        name,
        normalizedName: normalize(name),
        rubroId,
        zonaId,
        category,
        code,
        sector,
        direccion: `${sector} - ${code}`,
        area: sinMetraje ? null : area,
        absence,
        existingMerchantId: null,
        existingMerchantState: null,
        existingPostId: null,
        reactivates: false,
        regularizes: false,
        errors: rowErrors,
        warnings: []
      });
      sheetRows += 1;
    }

    sheetSummaries.push({ sheet: sheet.name, rows: sheetRows, columns: detected.header });
  }

  // 2) Mismo DNI/RUC y mismo nombre = un titular con varios puestos; el mismo documento con otro nombre es error.
  const titulares = new Map();
  for (const row of candidates) {
    if (!row.document) continue;
    const titular = titulares.get(row.document);
    if (!titular) titulares.set(row.document, { normalizedName: row.normalizedName, first: row });
    else if (titular.normalizedName !== row.normalizedName) {
      row.errors.push(`El DNI/RUC ${row.document} ya aparece con otro titular (${titular.first.sheet}, fila ${titular.first.row}).`);
    }
  }

  // 3) Cruce con la base en lote: comerciantes por documento, puestos por código, ocupantes de cada ubicación y
  // homónimos con DNI de los titulares sin DNI. Antes eran dos consultas por fila.
  const merchantsByDocument = new Map((await db.query(
    'SELECT id, dni_ruc, nombre, estado FROM comerciantes WHERE dni_ruc = ANY($1::text[])', [[...titulares.keys()]]
  )).rows.map((item) => [item.dni_ruc, item]));
  const postsByCode = new Map((await db.query(`
    SELECT p.id, p.codigo_puesto, p.comerciante_id, c.dni_ruc, c.nombre
    FROM puestos p LEFT JOIN comerciantes c ON c.id = p.comerciante_id
    WHERE p.codigo_puesto = ANY($1::text[])`, [[...seenCodes]])).rows.map((item) => [item.codigo_puesto, item]));
  const located = candidates.filter((row) => row.zonaId);
  const occupantsByPlace = new Map();
  for (const item of (await db.query(`
    SELECT DISTINCT p.id, p.comerciante_id, p.zona_id, p.direccion
    FROM puestos p
    JOIN unnest($1::int[], $2::text[]) AS u(zona_id, direccion)
      ON p.zona_id = u.zona_id AND lower(btrim(p.direccion)) = lower(btrim(u.direccion))
    WHERE p.estado <> 'inactivo'`, [located.map((row) => Number(row.zonaId)), located.map((row) => row.direccion)])).rows) {
    const key = ubicacion(item.zona_id, item.direccion);
    occupantsByPlace.set(key, [...(occupantsByPlace.get(key) || []), item]);
  }
  const homonymsWithDocument = new Set([
    ...(await db.query(`
      SELECT lower(btrim(nombre)) AS nombre FROM comerciantes
      WHERE left(dni_ruc, 5) <> 'TEMP_' AND lower(btrim(nombre)) = ANY($1::text[])`,
    [[...new Set(candidates.filter((row) => row.temporal && row.name).map((row) => nombreComparable(row.name)))]])).rows.map((item) => item.nombre),
    ...candidates.filter((row) => !row.temporal && row.name).map((row) => nombreComparable(row.name))
  ]);

  for (const row of candidates) {
    if (row.errors.length) continue;
    const existing = merchantsByDocument.get(row.document) || null;
    const post = postsByCode.get(row.code) || null;
    let merchantId = existing ? Number(existing.id) : null;
    if (post?.comerciante_id && Number(post.comerciante_id) !== merchantId) {
      // Titular importado antes sin DNI que ahora llega con su DNI: mismo puesto y mismo nombre.
      const sameHolder = !existing && !row.temporal && esDocumentoTemporal(post.dni_ruc) && normalize(post.nombre) === row.normalizedName;
      if (sameHolder) {
        merchantId = Number(post.comerciante_id);
        row.regularizes = true;
      } else {
        row.errors.push(`El código de puesto ${row.code} ya está asignado a otro comerciante.`);
        continue;
      }
    }
    // Igual que validatePuestoPlacement: otro puesto activo en el mismo lugar con otro titular (o libre).
    const occupied = (occupantsByPlace.get(ubicacion(row.zonaId, row.direccion)) || []).some((item) => (
      Number(item.id) !== Number(post?.id) && (merchantId === null || item.comerciante_id === null || Number(item.comerciante_id) !== merchantId)
    ));
    if (occupied) {
      row.errors.push(`El puesto físico "${row.direccion}" de esa zona ya está asignado a otro comerciante.`);
      continue;
    }
    row.existingMerchantId = merchantId;
    row.existingMerchantState = existing?.estado || null;
    row.reactivates = existing?.estado === 'inactivo';
    row.existingPostId = post ? Number(post.id) : null;
    if (row.temporal && homonymsWithDocument.has(nombreComparable(row.name))) {
      row.warnings.push(`${row.name} no trae DNI y hay un comerciante con DNI con el mismo nombre: revisa que no sea la misma persona.`);
    }
  }

  const valid = candidates.filter((row) => row.errors.length === 0);
  const distinctDocuments = (list) => new Set(list.map((row) => row.document)).size;
  const postsPerDocument = valid.reduce((map, row) => map.set(row.document, (map.get(row.document) || 0) + 1), new Map());
  return {
    workbookType: attendanceWorkbook ? 'attendance' : 'merchant-padron',
    attendanceRecords,
    attendanceMarks,
    sheets: sheetSummaries,
    rows: candidates.length,
    validRows: valid.length,
    invalidRows: candidates.length - valid.length,
    existingMerchants: distinctDocuments(valid.filter((row) => row.existingMerchantId)),
    newMerchants: distinctDocuments(valid.filter((row) => !row.existingMerchantId)),
    newPosts: valid.filter((row) => !row.existingPostId).length,
    absentRows: valid.filter((row) => row.absence).length,
    pendingMerchants: distinctDocuments(valid.filter((row) => row.temporal)),
    merchantsWithSeveralPosts: [...postsPerDocument.values()].filter((count) => count > 1).length,
    regularizedMerchants: valid.filter((row) => row.regularizes).map((row) => ({ sheet: row.sheet, row: row.row, name: row.name })),
    reactivatedMerchants: [...new Map(valid.filter((row) => row.reactivates).map((row) => [row.document, { sheet: row.sheet, row: row.row, name: row.name }])).values()],
    warnings: valid.flatMap((row) => row.warnings.map((message) => ({ sheet: row.sheet, row: row.row, message }))),
    errors: candidates.filter((row) => row.errors.length).map((row) => ({ sheet: row.sheet, row: row.row, message: row.errors.join(' ') })),
    candidates
  };
}

// Confirma con las mismas funciones que usa la API (código CM, ubicación única, reactivación de bajas), en una
// sola transacción. Cada fila va en su savepoint: un choque que la vista previa no vio se informa en esa fila y
// no deshace las demás.
export async function importPadronPreview(_db, preview, userId = 1) {
  const result = {
    createdMerchants: 0,
    updatedMerchants: 0,
    reactivatedMerchants: 0,
    regularizedMerchants: 0,
    createdPosts: 0,
    updatedPosts: 0,
    absentPosts: 0,
    skippedRows: preview.invalidRows,
    rowErrors: []
  };

  await withTransaction(async (client) => {
    // Titulares ya guardados en esta importación (sus otras filas solo agregan puestos).
    const savedMerchants = new Map();
    for (const row of preview.candidates) {
      if (row.errors.length) continue;
      await client.query('SAVEPOINT fila_padron');
      try {
        let merchantId = savedMerchants.get(row.document) ?? row.existingMerchantId;
        let merchantChange = null;
        if (!savedMerchants.has(row.document)) {
          const merchantPayload = {
            dni_ruc: row.document,
            nombre: row.name,
            rubro_id: row.rubroId,
            zona_id: row.zonaId,
            categoria: row.category,
            tipo_comerciante: row.category,
            usuario_creador: userId
          };
          if (merchantId) {
            // Sin estado se conserva el actual; la regularización pasa al pendiente a activo (updateComerciante).
            const estado = row.reactivates ? (row.temporal ? 'pendiente' : 'activo') : undefined;
            await updateComerciante(client, merchantId, { ...merchantPayload, estado });
            merchantChange = row.reactivates ? 'reactivatedMerchants' : row.regularizes ? 'regularizedMerchants' : 'updatedMerchants';
          } else {
            merchantId = (await insertComerciante(client, { ...merchantPayload, estado: row.temporal ? 'pendiente' : 'activo' }, { documentoTemporal: row.temporal })).id;
            merchantChange = 'createdMerchants';
          }
        }

        const postPayload = {
          comerciante_id: merchantId,
          zona_id: row.zonaId,
          direccion: row.direccion,
          codigo_puesto: row.code,
          estado: row.absence ? 'disponible' : 'ocupado'
        };
        if (row.existingPostId) {
          // Sin metraje en el libro se conserva el que tiene el puesto.
          await updatePuesto(client, row.existingPostId, { ...postPayload, metros_cuadrados: row.area ?? undefined }, { devolver: false });
        } else {
          await insertPuesto(client, { ...postPayload, metros_cuadrados: row.area }, { devolver: false });
        }
        await client.query('RELEASE SAVEPOINT fila_padron');

        savedMerchants.set(row.document, merchantId);
        if (merchantChange) result[merchantChange] += 1;
        result[row.existingPostId ? 'updatedPosts' : 'createdPosts'] += 1;
        if (row.absence) result.absentPosts += 1;
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT fila_padron');
        if (!(error instanceof AppError)) throw error;
        result.rowErrors.push({ sheet: row.sheet, row: row.row, message: error.message });
        result.skippedRows += 1;
      }
    }
  });

  return result;
}
