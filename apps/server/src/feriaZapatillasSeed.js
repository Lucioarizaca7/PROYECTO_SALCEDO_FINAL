import { createHash } from 'node:crypto';
import { DEFAULT_TARIFF_CATEGORIES, createZoneCategories, getDefaultCategoryId, recordAudit, recordPostAssignment } from './db.js';
import { withTransaction } from './pg.js';

function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function blockCode(value) {
  return String(value || 'BLOQUE')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^\s*bloque\s*/i, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toUpperCase() || 'BLOQUE';
}

function temporaryDocument(normalizedName) {
  const digest = createHash('sha256').update(normalizedName).digest('hex').slice(0, 12).toUpperCase();
  return `TEMP_DNIZAP_${digest}`;
}

function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const match = String(value ?? '').trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (!match) return null;
  const [, day, month, rawYear] = match;
  const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function isNumberCell(value) {
  return (typeof value === 'number' && Number.isInteger(value) && value > 0)
    || /^\d+$/.test(String(value ?? '').trim());
}

function isAttendanceMark(value) {
  const mark = String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
  return ['P', 'F', 'N', 'N/S', 'NS', '-', 'P/1 MÑN', 'P/1 MANANA', 'P/1 MN'].includes(mark);
}

function postNumber(value) {
  const text = String(value ?? '').trim();
  return text ? text.padStart(2, '0') : '';
}

export async function buildFeriaZapatillasSeedPlan(sheets, db) {
  const rubroRow = (await db.query("SELECT id FROM rubros WHERE LOWER(nombre) IN ('zapatillas', 'calzado') ORDER BY CASE LOWER(nombre) WHEN 'zapatillas' THEN 0 ELSE 1 END LIMIT 1")).rows[0];
  const rubroId = Number(rubroRow?.id ?? 0);
  const blocks = [];
  const postsByCode = new Map();
  const merchantsByDocument = new Map();
  const merchantDocumentByName = new Map();
  const duplicatePostCodes = [];
  let skippedRows = 0;
  let attendanceCells = 0;
  let attendanceWithoutDate = 0;

  for (const sheet of sheets) {
    const sheetName = String(sheet.sheet || sheet.name || '').trim();
    const block = blockCode(sheetName);
    const datesByColumn = new Map();
    (sheet.data || sheet.rows || []).slice(0, 6).forEach((row) => {
      row.forEach((value, columnIndex) => {
        if (columnIndex >= 2) {
          const date = parseDate(value);
          if (date) datesByColumn.set(columnIndex, date);
        }
      });
    });

    const rows = sheet.data || sheet.rows || [];
    const blockPlan = { sheet: sheetName, block, candidates: 0, skipped: 0, attendanceMarks: 0 };
    const blockStart = rows.findIndex((row) => isNumberCell(row?.[0]) && normalizeName(row?.[1]));
    if (blockStart < 0) {
      blocks.push(blockPlan);
      continue;
    }

    for (let rowIndex = blockStart; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] || [];
      const rawPostNumber = row[0];
      const name = normalizeName(row[1]);
      if (!isNumberCell(rawPostNumber) || !name) {
        if (row.some((value) => String(value ?? '').trim())) {
          blockPlan.skipped += 1;
          skippedRows += 1;
        }
        continue;
      }

      const number = postNumber(rawPostNumber);
      const code = `ZAP-${block}-${number}`;
      const workbookDuplicate = postsByCode.get(code);
      if (workbookDuplicate) {
        blockPlan.skipped += 1;
        skippedRows += 1;
        duplicatePostCodes.push({ code, firstName: workbookDuplicate.name, duplicateName: name, sheet: sheetName });
        continue;
      }
      const existingByCode = (await db.query('SELECT id, comerciante_id FROM puestos WHERE codigo_puesto = $1', [code])).rows[0];
      const linkedMerchant = existingByCode
        ? (await db.query('SELECT id, dni_ruc, estado_empadronamiento FROM comerciantes WHERE id = $1', [Number(existingByCode.comerciante_id)])).rows[0]
        : null;
      const generatedDocument = temporaryDocument(name);
      const document = linkedMerchant?.dni_ruc || merchantDocumentByName.get(name) || generatedDocument;
      const post = {
        code,
        number,
        block,
        sheet: sheetName,
        name,
        document,
        areaM2: null,
        status: 'ocupado',
        attendance: []
      };

      for (let columnIndex = 2; columnIndex < row.length; columnIndex += 1) {
        const mark = String(row[columnIndex] ?? '').trim();
        const date = datesByColumn.get(columnIndex);
        if (!mark) continue;
        if (!date) {
          if (isAttendanceMark(mark)) attendanceWithoutDate += 1;
          continue;
        }
        post.attendance.push({ date, session: String(columnIndex), mark });
        post.attendanceCount = (post.attendanceCount || 0) + 1;
        blockPlan.attendanceMarks += 1;
        attendanceCells += 1;
      }

      if (existingByCode) post.existingPostId = Number(existingByCode.id);
      const existingMerchant = linkedMerchant
        || (await db.query('SELECT id, dni_ruc, estado_empadronamiento FROM comerciantes WHERE dni_ruc = $1', [document])).rows[0];
      if (existingMerchant) post.existingMerchantId = Number(existingMerchant.id);
      postsByCode.set(code, post);
      if (!merchantDocumentByName.has(name)) merchantDocumentByName.set(name, document);
      if (!merchantsByDocument.has(document)) merchantsByDocument.set(document, { document, name, id: post.existingMerchantId || null });
      blockPlan.candidates += 1;
    }
    blocks.push(blockPlan);
  }

  return {
    rubroId,
    blocks,
    posts: [...postsByCode.values()],
    merchants: [...merchantsByDocument.values()],
    duplicatePostCodes,
    totals: {
      blocksProcessed: blocks.filter((block) => block.candidates > 0).length,
      sourceRows: blocks.reduce((total, block) => total + block.candidates + block.skipped, 0),
      validPosts: postsByCode.size,
      uniqueMerchants: merchantsByDocument.size,
      existingMerchants: [...merchantsByDocument.values()].filter((merchant) => merchant.id).length,
      newMerchants: [...merchantsByDocument.values()].filter((merchant) => !merchant.id).length,
      existingPosts: [...postsByCode.values()].filter((post) => post.existingPostId).length,
      newPosts: [...postsByCode.values()].filter((post) => !post.existingPostId).length,
      skippedRows,
      attendanceCells,
      duplicatePostCodes: duplicatePostCodes.length,
      attendanceWithoutDate
    }
  };
}

export async function seedFeriaZapatillas(_db, plan, sourceFile, userId = 1) {
  let createdMerchants = 0;
  let updatedMerchants = 0;
  let assignedPosts = 0;
  let createdPosts = 0;
  let updatedPosts = 0;
  let savedAttendanceMarks = 0;

  await withTransaction(async (c) => {
    const one = async (text, params = []) => (await c.query(text, params)).rows[0];

    await c.query("INSERT INTO rubros (nombre, descripcion, activo) SELECT 'zapatillas', 'Calzado y zapatillas de feria', TRUE WHERE NOT EXISTS (SELECT 1 FROM rubros WHERE LOWER(nombre) IN ('zapatillas', 'calzado'))");
    const rubroId = Number((await one("SELECT id FROM rubros WHERE LOWER(nombre) IN ('zapatillas', 'calzado') ORDER BY CASE LOWER(nombre) WHEN 'zapatillas' THEN 0 ELSE 1 END LIMIT 1")).id);

    for (const block of plan.blocks.filter((item) => item.candidates > 0)) {
      await c.query('INSERT INTO zonas (nombre, descripcion) SELECT $1::text, $2::text WHERE NOT EXISTS (SELECT 1 FROM zonas WHERE LOWER(nombre) = LOWER($1::text))', [block.sheet, `Sector ferial ${block.sheet}`]);
      // El cobro es fijo por día de feria: cada bloque nuevo nace con las tarifas estándar de zona.
      const zone = await one('SELECT z.id, EXISTS (SELECT 1 FROM categorias_cobro cc WHERE cc.zona_id = z.id) AS tiene_tarifas FROM zonas z WHERE LOWER(z.nombre) = LOWER($1) ORDER BY z.id LIMIT 1', [block.sheet]);
      if (!zone.tiene_tarifas) await createZoneCategories(c, zone.id, DEFAULT_TARIFF_CATEGORIES, '2026-01-01');
    }

    const userRow = await one('SELECT id FROM usuarios WHERE id = $1', [userId]);
    const creatorId = userRow ? userId : null;

    for (const merchant of plan.merchants) {
      const existing = await one('SELECT id, estado_empadronamiento FROM comerciantes WHERE dni_ruc = $1', [merchant.document]);
      let merchantId = Number(existing?.id || 0);
      const zoneName = plan.posts.find((post) => post.document === merchant.document)?.sheet || plan.blocks[0]?.sheet || 'BLOQUE';
      const zoneId = Number((await one('SELECT id FROM zonas WHERE LOWER(nombre) = LOWER($1) ORDER BY id LIMIT 1', [zoneName]))?.id || 0);
      if (!merchantId) {
        merchantId = Number((await one(`INSERT INTO comerciantes (dni_ruc, nombre, rubro_id, zona_id, categoria, tipo_comerciante, estado, estado_empadronamiento, usuario_creador_id)
          VALUES ($1, $2, $3, $4, 'ferial', 'ferial', 'pendiente', 'PENDIENTE_REGULARIZACION', $5) RETURNING id`, [merchant.document, merchant.name, rubroId, zoneId, creatorId])).id);
        createdMerchants += 1;
      } else {
        const empadronamiento = existing.estado_empadronamiento === 'REGULARIZADO' ? 'REGULARIZADO' : 'PENDIENTE_REGULARIZACION';
        const status = empadronamiento === 'REGULARIZADO' ? 'activo' : 'pendiente';
        await c.query(`UPDATE comerciantes SET nombre = $1, rubro_id = $2, categoria = 'ferial', tipo_comerciante = 'ferial', estado = $3, estado_empadronamiento = $4 WHERE id = $5`, [merchant.name, rubroId, status, empadronamiento, merchantId]);
        updatedMerchants += 1;
      }
      merchant.id = merchantId;
    }

    for (const post of plan.posts) {
      const merchantId = plan.merchants.find((merchant) => merchant.document === post.document)?.id;
      const zoneId = Number((await one('SELECT id FROM zonas WHERE LOWER(nombre) = LOWER($1) ORDER BY id LIMIT 1', [post.sheet]))?.id || 0);
      const address = `${post.sheet} - Puesto ${post.number}`;
      let postId = Number((await one('SELECT id FROM puestos WHERE codigo_puesto = $1', [post.code]))?.id || 0);
      if (postId) {
        await c.query("UPDATE puestos SET comerciante_id = $1, zona_id = $2, direccion = $3, metros_cuadrados = NULL, estado = 'ocupado' WHERE id = $4", [merchantId, zoneId, address, postId]);
        updatedPosts += 1;
      } else {
        postId = Number((await one("INSERT INTO puestos (comerciante_id, zona_id, direccion, metros_cuadrados, estado, codigo_puesto) VALUES ($1, $2, $3, NULL, 'ocupado', $4) RETURNING id", [merchantId, zoneId, address, post.code])).id);
        createdPosts += 1;
      }
      post.id = postId;
      assignedPosts += 1;
      // Asignado desde su primera asistencia registrada (o hoy si la planilla no trae fechas).
      const firstDate = post.attendance.map((attendance) => attendance.date).filter(Boolean).sort()[0] || new Date().toISOString().slice(0, 10);
      await recordPostAssignment(c, postId, { zonaId: zoneId, categoriaId: await getDefaultCategoryId(c, zoneId), desde: firstDate });

      for (const attendance of post.attendance) {
        await c.query(`INSERT INTO asistencias_feriales (puesto_id, fecha, sesion, marca, fuente) VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (puesto_id, fecha, sesion) DO UPDATE SET marca = EXCLUDED.marca, fuente = EXCLUDED.fuente`, [postId, attendance.date, attendance.session, attendance.mark, sourceFile]);
        savedAttendanceMarks += 1;
      }
    }
  });

  await recordAudit(null, {
    usuarioId: userId,
    usuarioRol: 'super_admin',
    entidad: 'padron',
    accion: 'SEED_FERIA_ZAPATILLAS',
    detalle: `Carga ${sourceFile}: ${createdMerchants} comerciantes nuevos, ${assignedPosts} puestos vinculados, ${savedAttendanceMarks} marcas de asistencia`,
    metodoHttp: 'CLI',
    ipOrigen: 'local',
    rutaEndpoint: 'scripts/seed-feria-zapatillas.js',
    payloadNuevo: { createdMerchants, assignedPosts, createdPosts, updatedPosts, savedAttendanceMarks }
  });

  return {
    createdMerchants,
    updatedMerchants,
    assignedPosts,
    createdPosts,
    updatedPosts,
    savedAttendanceMarks,
    blocksProcessed: plan.totals.blocksProcessed,
    skippedRows: plan.totals.skippedRows,
    areaMissingPosts: assignedPosts
  };
}
