import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

import { loginUser, hasRoleAccess, requireAuth, requireRoles, auditMutation } from './auth';
import { validateLogin, handleValidationErrors, validateComerciante, validateCobro } from './validation';
import {
  initializeDatabase,
  recordAudit,
  getDbStats,
  verifyAuditChain,
  getRubros,
  getZonas,
  getCalles,
  insertZona,
  updateZona,
  deleteZona,
  insertCalle,
  updateCalle,
  deleteCalle,
  getComerciantes,
  countComerciantes,
  insertComerciante,
  updateComerciante,
  deactivateComerciante,
  getPuestos,
  insertPuesto,
  updatePuesto,
  deactivatePuesto,
  getTarifas,
  insertTarifa,
  updateTarifa,
  getZoneTariffs,
  setZoneTariff,
  calculateLiquidation,
  getCobros,
  insertCobro,
  syncOfflineCobro,
  getComerciantePreferencias,
  updateComerciantePreferencias,
  getAuditTrail,
  getOperationalDashboard,
  getReportRows,
  buildReportCsv,
  getMerchantPortal,
  createNotification,
  getNotifications,
  generateForecastProjection,
  getRiskDashboard
} from './db.js';
import { importPadronPreview, previewPadronSheets, readPadronWorkbook } from './padronImport.js';
import { buildPadronTemplate } from './padronTemplate.js';

dotenv.config();

export const app = express();
const port = process.env.PORT || 4000;

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  ...(process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',') : [])
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Origen no permitido por CORS'));
  },
  credentials: true
}));
// Configurar rate limiting
const rateLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 900000), // 15 minutos por defecto
  max: Number(process.env.RATE_LIMIT_MAX_REQUESTS || 100), // límite de requests por ventana
  // En desarrollo no se limita el tráfico local (el SPA hace ~12 peticiones por carga)
  skip: (req) => process.env.NODE_ENV !== 'production' && /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(req.ip || ''),
  standardHeaders: true, // devolver información de rate limit en los headers
  legacyHeaders: false, // desactivar headers X-RateLimit-*
  message: {
    error: 'Demasiadas requests desde esta IP, por favor intente de nuevo después de 15 minutos'
  }
});

// Aplicar rate limiting a todas las requests
app.use(rateLimiter);

// Headers de seguridad
app.use((req, res, next) => {
  // Prevenir ataques de tipo clickjacking
  res.setHeader('X-Frame-Options', 'DENY');

  // Prevenir MIME sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Protección contra XSS (heredado pero aún útil en navegadores antiguos)
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Referrer Policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // HSTS en producción (descomentar si se usa HTTPS)
  // if (process.env.NODE_ENV === 'production') {
  //   res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // }

  next();
});

app.use(express.json());

const padronUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const allowed = /\.xlsx$/i.test(file.originalname) || file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (allowed) callback(null, true);
    else callback(new Error('Solo se aceptan libros Excel .xlsx'));
  }
});

function receivePadronWorkbook(req, res, next) {
  padronUpload.single('file')(req, res, (error) => {
    if (error) return res.status(400).json({ message: error.message || 'No se pudo recibir el archivo' });
    return next();
  });
}

// Libros ya leídos en la previsualización: la confirmación envía el token y no vuelve a subir el Excel.
// La validación contra la base se repite al confirmar (son pocas consultas) por si algo cambió entretanto.
const PADRON_PREVIEW_TTL_MS = 15 * 60 * 1000;
const PADRON_PREVIEW_MAX = 20;
const padronPreviews = new Map();

function rememberPadronSheets(userId, filename, sheets, fechaFeria) {
  const now = Date.now();
  for (const [token, entry] of padronPreviews) {
    if (entry.expiresAt <= now) padronPreviews.delete(token);
  }
  while (padronPreviews.size >= PADRON_PREVIEW_MAX) padronPreviews.delete(padronPreviews.keys().next().value);
  const token = randomUUID();
  padronPreviews.set(token, { userId, filename, sheets, fechaFeria, expiresAt: now + PADRON_PREVIEW_TTL_MS });
  return token;
}

function takePadronSheets(token, userId) {
  const entry = padronPreviews.get(token);
  if (!entry || entry.expiresAt <= Date.now() || entry.userId !== userId) return null;
  padronPreviews.delete(token);
  return entry;
}

const roles = ['super_admin', 'cobrador', 'auditor', 'comerciante'];

let db;

async function rowById(table: string, id: number) {
  const result = await db.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

app.get('/api/v1/health', (_req, res) => {
  res.json({ status: 'ok', message: 'SISREC Salcedo API funcionando' });
});

app.get('/api/v1/dashboard', async (req, res) => {
  const period = String(req.query.periodo || new Date().toISOString().slice(0, 7));
  const metrics = await getOperationalDashboard(db, { periodo: period });
  const totalDeuda = Number(metrics.deudaPendiente || 0);
  const totalCobrado = Number(metrics.recaudacion || 0);
  const totalComerciantes = Number(metrics.comerciantesActivos || 0);
  const deudaPendiente = Number(metrics.deudaPendiente || totalDeuda || 0);
  const totaleDeuda = totalDeuda > 0 ? totalDeuda : deudaPendiente;
  const morosidad = totaleDeuda > 0 ? Number(((deudaPendiente / totaleDeuda) * 100).toFixed(1)) : 0;

  res.json({
    stats: {
      recaudacion: Number(metrics.recaudacion || totalCobrado || 0),
      pagos: Number(metrics.pagos || 0),
      deudaPendiente,
      deudaTotal: totaleDeuda,
      comerciantesActivos: totalComerciantes,
      morosidad,
      totalRecaudado: Number(metrics.recaudacion || totalCobrado || 0),
      totalCobros: Number(metrics.pagos || 0),
      totalComerciantes,
      ...getDbStats(db)
    },
    operational: {
      porZona: metrics.porZona || [],
      porRubro: metrics.porRubro || [],
      porCobrador: metrics.porCobrador || []
    }
  });
});

app.get('/api/v1/analitica/prediccion', async (req, res) => {
  try {
    const period = String(req.query.periodo || new Date().toISOString().slice(0, 7));
    const forecast = await generateForecastProjection(db, { period, horizonteDias: Number(req.query.horizonte_dias || req.query.horizon || 90) });
    return res.json({ data: forecast, message: 'Proyección de recaudación generada correctamente' });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'No se pudo generar la predicción' });
  }
});

app.get('/api/v1/analitica/riesgo', async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 5), 1), 20);
    const data = await getRiskDashboard(db, { limit });
    return res.json({ data, message: 'Scoring de morosidad actualizado' });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'No se pudo calcular el riesgo de morosidad' });
  }
});

app.get('/api/v1/roles', (_req, res) => {
  res.json({ roles });
});

app.get('/api/v1/catalogos', async (_req, res) => {
  res.json({
    rubros: await getRubros(db),
    zonas: await getZonas(db)
  });
});

app.get('/api/v1/zonas', async (_req, res) => {
  try {
    res.json({
      data: await getZonas(db),
      calles: await getCalles(db),
      message: 'Zonas y calles consultadas correctamente'
    });
  } catch (error) {
    return res.status(400).json({ message: error.message || 'No se pudieron consultar las zonas' });
  }
});

app.post('/api/v1/zonas', requireAuth, requireRoles(['super_admin', 'auditor']), auditMutation({ db, accion: 'CREAR_ZONA', entidad: 'zonas', serializeResponse: (body) => body?.data ?? body }), async (req, res) => {
  try {
    const data = await insertZona(db, req.body || {});
    return res.status(201).json({ data, message: 'Zona creada correctamente' });
  } catch (error) {
    return res.status(400).json({ message: error.message || 'No se pudo crear la zona' });
  }
});

app.put('/api/v1/zonas/:id', requireAuth, requireRoles(['super_admin', 'auditor']), auditMutation({ db, accion: 'ACTUALIZAR_ZONA', entidad: 'zonas', getPreviousState: async (req) => rowById('zonas', Number(req.params.id)), serializeResponse: (body) => body?.data ?? body }), async (req, res) => {
  try {
    const data = await updateZona(db, req.params.id, req.body || {});
    return res.json({ data, message: 'Zona actualizada correctamente' });
  } catch (error) {
    return res.status(400).json({ message: error.message || 'No se pudo actualizar la zona' });
  }
});

app.delete('/api/v1/zonas/:id', requireAuth, requireRoles(['super_admin', 'auditor']), auditMutation({ db, accion: 'ELIMINAR_ZONA', entidad: 'zonas', getPreviousState: async (req) => rowById('zonas', Number(req.params.id)), serializeResponse: (body) => body?.data ?? body }), async (req, res) => {
  try {
    const data = await deleteZona(db, req.params.id);
    return res.json({ data, message: 'Zona eliminada correctamente' });
  } catch (error) {
    return res.status(400).json({ message: error.message || 'No se pudo eliminar la zona' });
  }
});

app.get('/api/v1/calles', async (_req, res) => {
  try {
    const zonaId = Number(_req.query.zona_id || 0);
    res.json({
      data: await getCalles(db, { zona_id: zonaId }),
      message: 'Calles consultadas correctamente'
    });
  } catch (error) {
    return res.status(400).json({ message: error.message || 'No se pudieron consultar las calles' });
  }
});

app.post('/api/v1/calles', requireAuth, requireRoles(['super_admin', 'auditor']), auditMutation({ db, accion: 'CREAR_CALLE', entidad: 'calles', serializeResponse: (body) => body?.data ?? body }), async (req, res) => {
  try {
    const data = await insertCalle(db, req.body || {});
    return res.status(201).json({ data, message: 'Calle creada correctamente' });
  } catch (error) {
    return res.status(400).json({ message: error.message || 'No se pudo crear la calle' });
  }
});

app.put('/api/v1/calles/:id', requireAuth, requireRoles(['super_admin', 'auditor']), auditMutation({ db, accion: 'ACTUALIZAR_CALLE', entidad: 'calles', getPreviousState: async (req) => rowById('calles', Number(req.params.id)), serializeResponse: (body) => body?.data ?? body }), async (req, res) => {
  try {
    const data = await updateCalle(db, req.params.id, req.body || {});
    return res.json({ data, message: 'Calle actualizada correctamente' });
  } catch (error) {
    return res.status(400).json({ message: error.message || 'No se pudo actualizar la calle' });
  }
});

app.delete('/api/v1/calles/:id', requireAuth, requireRoles(['super_admin', 'auditor']), auditMutation({ db, accion: 'ELIMINAR_CALLE', entidad: 'calles', getPreviousState: async (req) => rowById('calles', Number(req.params.id)), serializeResponse: (body) => body?.data ?? body }), async (req, res) => {
  try {
    const data = await deleteCalle(db, req.params.id);
    return res.json({ data, message: 'Calle eliminada correctamente' });
  } catch (error) {
    return res.status(400).json({ message: error.message || 'No se pudo eliminar la calle' });
  }
});

app.post('/api/v1/portal/login', async (req, res) => {
  try {
    const identifier = String(req.body?.identifier || '').trim();
    if (!identifier) {
      return res.status(400).json({ message: 'Debe ingresar su DNI o código de comerciante' });
    }

    const data = await getMerchantPortal(db, identifier);
    return res.json({ data, message: 'Portal del comerciante consultado correctamente' });
  } catch (error) {
    return res.status(404).json({ message: error.message || 'No se encontró el comerciante en el padrón' });
  }
});

app.get('/api/v1/portal/:comercianteId/notificaciones', async (req, res) => {
  try {
    const comercianteId = Number(req.params.comercianteId || 0);
    const data = await getNotifications(db, comercianteId);
    return res.json({ data, total: data.length });
  } catch (error) {
    return res.status(400).json({ message: error.message || 'No se pudieron consultar las notificaciones' });
  }
});

app.post('/api/v1/notificaciones',
  requireAuth,
  requireRoles(['super_admin', 'cobrador', 'auditor']),
  async (req, res) => {
    try {
      const notification = await createNotification(db, req.body || {});
      return res.status(201).json({ data: notification, message: 'Notificación registrada correctamente' });
    } catch (error) {
      return res.status(400).json({ message: error.message || 'No se pudo registrar la notificación' });
    }
  }
);

app.get('/api/v1/comprobantes/:id/pdf', async (req, res) => {
  try {
    const payment = (await getCobros(db)).find((item) => item.id === Number(req.params.id) || String(item.comprobante) === String(req.params.id) || String(item.codigo_operacion) === String(req.params.id));
    if (!payment) {
      return res.status(404).json({ message: 'Comprobante no encontrado' });
    }

    const merchant = (await getComerciantes(db, { includeInactive: true, limit: 1000 })).find((item) => item.id === Number(payment.comerciante_id));
    const textLines = [
      `Comerciante: ${merchant?.nombre || 'N/D'}`,
      `Comprobante: ${payment.comprobante || payment.codigo_operacion || `COBRO-${payment.id}`}`,
      `Concepto: ${payment.concepto || 'Liquidación de deuda'}`,
      `Monto: S/ ${Number(payment.monto || 0).toFixed(2)}`,
      `Método: ${payment.metodo_pago || 'efectivo'}`,
      `Fecha: ${payment.fecha_cobro || new Date().toISOString()}`,
      `Hash: ${payment.hash_transaccion || 'sha256:local'}`
    ];

    const content = [
      'BT',
      '/F1 16 Tf',
      '72 760 Td',
      '(SISREC SALCEDO) Tj',
      '0 -28 Td',
      '(COMPROBANTE DE PAGO) Tj',
      '0 -28 Td',
      `(${textLines.join(' | ')}) Tj`,
      'ET'
    ].join('\n');

    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
    ];

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((object, index) => {
      offsets.push(Buffer.byteLength(pdf, 'latin1'));
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });

    const xrefStart = Buffer.byteLength(pdf, 'latin1');
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f\n`;
    for (let i = 1; i <= objects.length; i += 1) {
      pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n\n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="comprobante-${req.params.id}.pdf"`);
    return res.send(Buffer.from(pdf, 'latin1'));
  } catch (error) {
    return res.status(400).json({ message: error.message || 'No se pudo generar el comprobante PDF' });
  }
});

app.get('/api/v1/reportes', async (req, res) => {
  const options = {
    periodo: req.query.periodo,
    zona_id: req.query.zona_id,
    rubro_id: req.query.rubro_id,
    cobrador_id: req.query.cobrador_id
  };
  const data = await getReportRows(db, options);
  const formato = String(req.query.formato || 'json').toLowerCase();

  if (formato === 'csv') {
    const csv = await buildReportCsv(db, options);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="reporte-cobros.csv"');
    return res.send(csv);
  }

  return res.json({ data, total: data.length, periodo: options.periodo || null });
});

app.get('/api/v1/comerciantes', async (req, res) => {
  const page = Math.max(Number(req.query.page || 1), 1);
  const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 100);
  const filters = {
    search: req.query.search,
    rubro_id: req.query.rubro_id,
    zona_id: req.query.zona_id,
    includeInactive: req.query.includeInactive === 'true',
    page,
    limit
  };
  const total = await countComerciantes(db, filters);
  const result = await getComerciantes(db, filters);
  res.json({ data: result, total, page, limit, totalPages: Math.max(Math.ceil(total / limit), 1) });
});

app.get('/api/v1/comerciantes/plantilla-padron',
  requireAuth,
  requireRoles(['super_admin', 'auditor']),
  async (_req, res) => {
    try {
      const buffer = await buildPadronTemplate(db);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="plantilla-padron-sisrec.xlsx"');
      return res.send(buffer);
    } catch (error) {
      return res.status(500).json({ message: error.message || 'No se pudo generar la plantilla' });
    }
  }
);

app.post('/api/v1/comerciantes/importar-padron',
  requireAuth,
  requireRoles(['super_admin', 'auditor']),
  receivePadronWorkbook,
  async (req, res) => {
    const userId = Number(req.user?.id || 1);
    const dryRun = String(req.body?.dryRun).toLowerCase() === 'true';
    const previewToken = String(req.body?.previewToken || '');
    let fechaFeria = String(req.body?.fechaFeria || '').trim();
    let filename;
    let sheets;
    if (req.file) {
      filename = req.file.originalname;
    } else if (previewToken && !dryRun) {
      const cached = takePadronSheets(previewToken, userId);
      if (!cached) return res.status(410).json({ message: 'La previsualización expiró; vuelve a seleccionar el archivo.' });
      // La fecha de feria es la que se usó al previsualizar, para confirmar exactamente lo que se revisó.
      ({ filename, sheets, fechaFeria } = cached);
    } else {
      return res.status(400).json({ message: 'Selecciona un archivo .xlsx para importar' });
    }

    try {
      sheets = sheets || await readPadronWorkbook(req.file.buffer);
      const preview = await previewPadronSheets(sheets, { filename, db, fechaFeria });
      const publicPreview = {
        filename,
        workbookType: preview.workbookType,
        attendanceRecords: preview.attendanceRecords,
        attendanceMarks: preview.attendanceMarks,
        sheets: preview.sheets,
        rows: preview.rows,
        validRows: preview.validRows,
        invalidRows: preview.invalidRows,
        existingMerchants: preview.existingMerchants,
        newMerchants: preview.newMerchants,
        newPosts: preview.newPosts,
        pendingMerchants: preview.pendingMerchants,
        multiPostMerchants: preview.multiPostMerchants,
        regularizedMerchants: preview.regularizedMerchants,
        reactivatedMerchants: preview.reactivatedMerchants,
        warnings: preview.warnings.slice(0, 100),
        absentRows: preview.absentRows,
        attendanceRows: preview.attendanceRows,
        feriaDates: preview.feriaDates,
        errors: preview.errors.slice(0, 100)
      };

      if (dryRun) {
        const token = preview.validRows ? rememberPadronSheets(userId, filename, sheets, fechaFeria) : null;
        return res.json({ data: { ...publicPreview, previewToken: token }, message: 'Previsualización lista; aún no se modificó el padrón.' });
      }
      if (!preview.validRows) {
        return res.status(422).json({ data: publicPreview, message: 'No hay filas válidas para importar. Corrige los errores del libro.' });
      }

      const result = await importPadronPreview(db, preview, userId);
      await recordAudit(db, {
        usuarioId: userId,
        usuarioRol: req.user?.rol || 'anonimo',
        entidad: 'padron',
        accion: 'IMPORTAR_PADRON_EXCEL',
        detalle: `Importación ${filename}: ${result.createdMerchants} comerciantes nuevos (${result.pendingMerchants} pendientes de regularización), ${result.reactivatedMerchants} reactivados, ${result.regularizedMerchants} regularizados, ${result.createdPosts} puestos nuevos, ${result.attendanceMarks} asistencias registradas (${result.absentPosts} faltas que no se cobran)`,
        metodoHttp: 'POST',
        ipOrigen: req.ip || 'unknown',
        rutaEndpoint: req.originalUrl,
        payloadNuevo: result
      });
      return res.json({ data: { ...publicPreview, result }, message: 'Padrón importado y auditado correctamente.' });
    } catch (error) {
      return res.status(400).json({ message: error.message || 'No se pudo procesar el libro Excel' });
    }
  }
);

app.get('/api/v1/comerciantes/:id', async (req, res) => {
  const comerciante = (await getComerciantes(db, { search: String(Number(req.params.id)), limit: 100 })).find((item) => item.id === Number(req.params.id));

  if (!comerciante) {
    return res.status(404).json({ message: 'Comerciante no encontrado' });
  }

  return res.json({ data: comerciante });
});

app.get('/api/v1/comerciantes/:id/preferencias', async (req, res) => {
  try {
    const comercianteId = Number(req.params.id || 0);
    const data = await getComerciantePreferencias(db, comercianteId);
    return res.json({ data, message: 'Preferencias del comerciante consultadas correctamente' });
  } catch (error) {
    return res.status(400).json({ message: error.message || 'No se pudieron consultar las preferencias' });
  }
});

app.post('/api/v1/comerciantes/:id/preferencias',
  requireAuth,
  requireRoles(['super_admin', 'cobrador', 'auditor']),
  auditMutation({
    db,
    accion: 'ACTUALIZAR_PREFERENCIAS',
    entidad: 'comerciante_preferencias',
    serializeResponse: (body) => body?.data ?? body
  }),
  async (req, res) => {
    try {
      const comercianteId = Number(req.params.id || 0);
      const payload = req.body || {};
      const data = await updateComerciantePreferencias(db, comercianteId, payload);
      return res.status(201).json({ data, message: 'Preferencias actualizadas correctamente' });
    } catch (error) {
      return res.status(400).json({ message: error.message || 'No se pudieron guardar las preferencias' });
    }
  }
);

app.post('/api/v1/comerciantes',
  requireAuth,
  requireRoles(['super_admin', 'auditor']),
  validateComerciante,
  handleValidationErrors,
  auditMutation({
    db,
    accion: 'CREAR_COMERCIANTE',
    entidad: 'comerciantes',
    serializeResponse: (body) => body?.data ?? body
  }),
  async (req, res) => {
    try {
      const comerciante = await insertComerciante(db, {
        ...req.body,
        usuario_creador: req.body.usuario_creador || req.user?.id || 1
      });

      return res.status(201).json({ data: comerciante, message: 'Comerciante registrado correctamente' });
    } catch (error) {
      return res.status(400).json({ message: error.message || 'No se pudo registrar el comerciante' });
    }
  }
);

app.put('/api/v1/comerciantes/:id',
  requireAuth,
  requireRoles(['super_admin', 'auditor']),
  auditMutation({
    db,
    accion: 'ACTUALIZAR_COMERCIANTE',
    entidad: 'comerciantes',
    getPreviousState: async (req) => {
      return rowById('comerciantes', Number(req.params.id));
    },
    serializeResponse: (body) => body?.data ?? body
  }),
  async (req, res) => {
    try {
      const comerciante = await updateComerciante(db, req.params.id, req.body || {});
      return res.json({ data: comerciante, message: 'Comerciante actualizado correctamente' });
    } catch (error) {
      return res.status(400).json({ message: error.message || 'No se pudo actualizar el comerciante' });
    }
  }
);

app.delete('/api/v1/comerciantes/:id',
  requireAuth,
  requireRoles(['super_admin', 'auditor']),
  auditMutation({
    db,
    accion: 'DAR_DE_BAJA_COMERCIANTE',
    entidad: 'comerciantes',
    getPreviousState: async (req) => {
      return rowById('comerciantes', Number(req.params.id));
    },
    serializeResponse: (body) => body?.data ?? body
  }),
  async (req, res) => {
    try {
      const comerciante = await deactivateComerciante(db, req.params.id);
      return res.json({ data: comerciante, message: 'Comerciante dado de baja correctamente' });
    } catch (error) {
      return res.status(404).json({ message: error.message || 'No se pudo dar de baja el comerciante' });
    }
  }
);

app.get('/api/v1/puestos', async (_req, res) => {
  const data = await getPuestos(db);
  res.json({ data, total: data.length });
});

app.post('/api/v1/puestos',
  requireAuth,
  requireRoles(['super_admin', 'cobrador']),
  auditMutation({
    db,
    accion: 'ASIGNAR_PUESTO',
    entidad: 'puestos',
    serializeResponse: (body) => body?.data ?? body
  }),
  async (req, res) => {
    try {
      const puesto = await insertPuesto(db, req.body || {});
      return res.status(201).json({ data: puesto, message: 'Puesto asignado correctamente' });
    } catch (error) {
      return res.status(400).json({ message: error.message || 'No se pudo asignar el puesto' });
    }
  }
);

app.post('/api/v1/puestos-mapa',
  requireAuth,
  requireRoles(['super_admin', 'cobrador']),
  auditMutation({
    db,
    accion: 'CREAR_PUESTO_MAPA',
    entidad: 'puestos',
    serializeResponse: (body) => body?.data ?? body
  }),
  async (req, res) => {
    try {
      const puesto = await insertPuesto(db, {
        ...req.body,
        comerciante_id: req.body.comerciante_id ?? req.body.comercianteId,
        zona_id: req.body.zona_id ?? req.body.zonaId,
        direccion: req.body.direccion || req.body.sector || req.body.codigoPuesto,
        metros_cuadrados: req.body.metros_cuadrados ?? req.body.metros ?? 1,
        estado: req.body.estado || 'ocupado'
      });
      return res.status(201).json({ data: puesto, message: 'Puesto geolocalizado registrado correctamente' });
    } catch (error) {
      return res.status(400).json({ message: error.message || 'No se pudo registrar el puesto geolocalizado' });
    }
  }
);

app.put('/api/v1/puestos-mapa/:id',
  requireAuth,
  requireRoles(['super_admin', 'cobrador']),
  auditMutation({
    db,
    accion: 'ACTUALIZAR_PUESTO_MAPA',
    entidad: 'puestos',
    getPreviousState: async (req) => rowById('puestos', Number(req.params.id)),
    serializeResponse: (body) => body?.data ?? body
  }),
  async (req, res) => {
    try {
      return res.json({ data: await updatePuesto(db, req.params.id, req.body || {}), message: 'Puesto geolocalizado actualizado correctamente' });
    } catch (error) {
      return res.status(400).json({ message: error.message || 'No se pudo actualizar el puesto geolocalizado' });
    }
  }
);

app.delete('/api/v1/puestos-mapa/:id',
  requireAuth,
  requireRoles(['super_admin', 'cobrador']),
  auditMutation({
    db,
    accion: 'DAR_DE_BAJA_PUESTO_MAPA',
    entidad: 'puestos',
    getPreviousState: async (req) => rowById('puestos', Number(req.params.id)),
    serializeResponse: (body) => body?.data ?? body
  }),
  async (req, res) => {
    try {
      return res.json({ data: await deactivatePuesto(db, req.params.id), message: 'Puesto dado de baja lógicamente' });
    } catch (error) {
      return res.status(404).json({ message: error.message || 'No se pudo dar de baja el puesto' });
    }
  }
);

app.get('/api/v1/tarifas', async (_req, res) => {
  const data = await getTarifas(db, { rubro_id: _req.query.rubro_id });
  res.json({ data, total: data.length });
});

app.post('/api/v1/tarifas',
  requireAuth,
  requireRoles(['super_admin']),
  auditMutation({
    db,
    accion: 'CREAR_TARIFA',
    entidad: 'tarifas',
    serializeResponse: (body) => body?.data ?? body
  }),
  async (req, res) => {
    try {
      return res.status(201).json({ data: await insertTarifa(db, req.body || {}), message: 'Tarifa creada correctamente' });
    } catch (error) {
      return res.status(400).json({ message: error.message || 'No se pudo crear la tarifa' });
    }
  }
);

app.put('/api/v1/tarifas/:id',
  requireAuth,
  requireRoles(['super_admin']),
  auditMutation({
    db,
    accion: 'ACTUALIZAR_TARIFA',
    entidad: 'tarifas',
    getPreviousState: async (req) => {
      return rowById('tarifas', Number(req.params.id));
    },
    serializeResponse: (body) => body?.data ?? body
  }),
  async (req, res) => {
    try {
      return res.json({ data: await updateTarifa(db, req.params.id, req.body || {}), message: 'Tarifa actualizada correctamente' });
    } catch (error) {
      return res.status(400).json({ message: error.message || 'No se pudo actualizar la tarifa' });
    }
  }
);

// Monto fijo por zona y por día de feria: consulta pública (transparencia) y cambio solo del super admin.
app.get('/api/v1/tarifas-zona', async (_req, res) => {
  try {
    const data = await getZoneTariffs(db);
    return res.json({ data, total: data.length });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'No se pudieron consultar los montos por zona' });
  }
});

app.put('/api/v1/tarifas-zona/:zonaId',
  requireAuth,
  requireRoles(['super_admin']),
  auditMutation({
    db,
    accion: 'ACTUALIZAR_TARIFA_ZONA',
    entidad: 'tarifas',
    getPreviousState: async (req) => (await getZoneTariffs(db)).find((item) => item.zona_id === Number(req.params.zonaId)) || null,
    serializeResponse: (body) => body?.data ?? body
  }),
  async (req, res) => {
    try {
      return res.json({ data: await setZoneTariff(db, req.params.zonaId, req.body || {}), message: 'Monto por zona actualizado correctamente' });
    } catch (error) {
      return res.status(400).json({ message: error.message || 'No se pudo actualizar el monto de la zona' });
    }
  }
);

app.get('/api/v1/liquidaciones/:comercianteId', async (req, res) => {
  try {
    return res.json({ data: await calculateLiquidation(db, req.params.comercianteId, String(req.query.periodo || '')) });
  } catch (error) {
    return res.status(400).json({ message: error.message || 'No se pudo calcular la liquidación' });
  }
});

app.get('/api/v1/comerciantes/:comercianteId/saldo', async (req, res) => {
  try {
    return res.json({ data: await calculateLiquidation(db, req.params.comercianteId, String(req.query.periodo || '')) });
  } catch (error) {
    return res.status(400).json({ message: error.message || 'No se pudo consultar el saldo' });
  }
});

app.get('/api/v1/cobros', async (_req, res) => {
  const data = await getCobros(db);
  res.json({ data, total: data.length });
});

app.post('/api/v1/cobros/sincronizar',
  requireAuth,
  requireRoles(['super_admin', 'cobrador']),
  auditMutation({
    db,
    accion: 'SINCRONIZAR_COBRO_OFFLINE',
    entidad: 'cobros',
    serializeResponse: (body) => body?.data ?? body
  }),
  async (req, res) => {
    const idempotencyKey = String(req.headers['x-idempotency-key'] || req.body.hash_transaccion || req.body.hashTransaccion || '').trim();
    const payload = {
      ...req.body,
      comerciante_id: req.body.comerciante_id ?? req.body.comercianteId,
      cobrador_id: req.body.cobrador_id ?? req.body.cobradorId ?? req.user?.id ?? 1,
      metodo_pago: req.body.metodo_pago ?? req.body.metodoPago ?? 'efectivo',
      hash_transaccion: idempotencyKey || req.body.hash_transaccion || req.body.hashTransaccion || undefined,
      codigo_operacion: req.body.codigo_operacion ?? req.body.codigoOperacion ?? (idempotencyKey || undefined),
      fecha_cobro: req.body.fecha_cobro || req.body.fechaCobro || new Date().toISOString(),
      periodo: req.body.periodo || new Date().toISOString().slice(0, 7)
    };

    try {
      const result = await syncOfflineCobro(db, payload);
      if (result.status === 'IGNORED') {
        return res.status(200).json(result);
      }
      return res.status(201).json(result);
    } catch (error) {
      return res.status(400).json({ message: error.message || 'No se pudo sincronizar el cobro offline' });
    }
  }
);

app.get('/api/v1/auditoria',
  requireAuth,
  requireRoles(['super_admin', 'auditor']),
  async (req, res) => {
    const { comerciante_id, entidad } = req.query || {};
    const data = await getAuditTrail(db, {
      comerciante_id: comerciante_id ? Number(comerciante_id) : undefined,
      entidad: entidad || undefined
    });
    res.json({ data, total: data.length });
  }
);

app.get('/api/v1/auditoria/verificacion',
  requireAuth,
  requireRoles(['super_admin', 'auditor']),
  async (_req, res) => {
    return res.json({ data: await verifyAuditChain(db) });
  }
);

app.post('/api/v1/cobros',
  requireAuth,
  requireRoles(['super_admin', 'cobrador']),
  validateCobro,
  handleValidationErrors,
  auditMutation({
    db,
    accion: 'REGISTRAR_COBRO',
    entidad: 'cobros',
    serializeResponse: (body) => body?.data ?? body
  }),
  async (req, res) => {
    try {
      return res.status(201).json({ data: await insertCobro(db, req.body || {}), message: 'Cobro registrado correctamente' });
    } catch (error) {
      return res.status(400).json({ message: error.message || 'No se pudo registrar el cobro' });
    }
  }
);

app.post('/api/v1/auth/login', validateLogin, handleValidationErrors, async (req, res) => {
  try {
    const result = await loginUser(req.body, db);
    return res.json(result);
  } catch (error) {
    // Mensaje genérico para no revelar si el usuario existe o no
    return res.status(401).json({ message: 'Credenciales inválidas' });
  }
});

app.get('/api/v1/auth/permissions/:role/:requiredRole', (req, res) => {
  const { role, requiredRole } = req.params;
  res.json({ allowed: hasRoleAccess(role, requiredRole) });
});

async function startServer() {
  db = await initializeDatabase();

  app.listen(port, () => {
    console.log(`SISREC API running on http://localhost:${port}`);
  });
}

// Exportar startServer para uso externo
export { startServer };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
