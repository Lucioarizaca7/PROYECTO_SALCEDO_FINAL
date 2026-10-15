import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import type { Server } from 'node:http';
import { pathToFileURL } from 'node:url';

import { config } from './config.js';
import { loginUser, hasRoleAccess, requireAuth, requireRoles, auditMutation } from './auth.js';
import { validateLogin, handleValidationErrors, validateComerciante, validateCobro } from './validation.js';
import {
  initializeDatabase,
  closeDatabase,
  currentPeriod,
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

export const app = express();
const port = config.port;

// Detrás de Caddy/Nginx, req.ip debe ser la IP real del usuario y no la del proxy;
// si no, todos comparten el mismo contador del límite de peticiones.
app.set('trust proxy', config.trustProxy);

// Cabeceras de seguridad. HSTS solo en producción (en localhost no hay HTTPS).
app.use(helmet({
  strictTransportSecurity: config.isProduction ? { maxAge: 31536000, includeSubDomains: true } : false
}));

const devOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174'
];
const allowedOrigins = new Set([...(config.isProduction ? [] : devOrigins), ...config.frontendOrigins]);

app.use(cors({
  origin: (origin, callback) => {
    const localDev = !config.isProduction && /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin || '');
    // Un origen no permitido simplemente no recibe cabeceras CORS: el navegador bloquea la respuesta.
    callback(null, !origin || allowedOrigins.has(origin) || localDev);
  },
  credentials: true
}));

const isLocalRequest = (req: Request) => /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(req.ip || '');

// Límite general alto: protege la API sin bloquear a una oficina que comparte IP.
app.use(rateLimit({
  windowMs: config.rateLimit.windowMs,
  limit: config.rateLimit.max,
  skip: (req) => !config.isProduction && isLocalRequest(req),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Demasiadas peticiones desde esta IP. Intente de nuevo en unos minutos.' }
}));

// Límite estricto solo para los accesos: frena la adivinación de claves y de DNI.
const loginLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  limit: config.rateLimit.loginMax,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Demasiados intentos de acceso. Espere 15 minutos e intente de nuevo.' }
});

app.use(express.json({ limit: '1mb' }));

// Roles internos que pueden ver datos personales del padrón y de los cobros (Ley 29733).
const STAFF = ['super_admin', 'cobrador', 'auditor'];
const staffOnly = [requireAuth, requireRoles(STAFF)];

// Contexto de auditoría tomado del token, nunca del cuerpo de la petición.
function auditContext(req: Request, accion: string) {
  return {
    usuarioId: Number(req.user?.id),
    usuarioRol: req.user?.rol,
    rolUsuario: req.user?.rol,
    accion,
    metodoHttp: req.method,
    ipOrigen: req.ip || 'unknown',
    rutaEndpoint: req.originalUrl
  };
}

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

const roles = ['super_admin', 'cobrador', 'auditor', 'comerciante'];

let db;

async function rowById(table: string, id: number) {
  const result = await db.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

app.get('/api/v1/health', (_req, res) => {
  res.json({ status: 'ok', message: 'SISREC Salcedo API funcionando' });
});

function dashboardStats(metrics) {
  const totalDeuda = Number(metrics.deudaPendiente || 0);
  const totalCobrado = Number(metrics.recaudacion || 0);
  const totalComerciantes = Number(metrics.comerciantesActivos || 0);
  const deudaPendiente = Number(metrics.deudaPendiente || totalDeuda || 0);
  const totaleDeuda = totalDeuda > 0 ? totalDeuda : deudaPendiente;
  const morosidad = totaleDeuda > 0 ? Number(((deudaPendiente / totaleDeuda) * 100).toFixed(1)) : 0;
  return {
    recaudacion: Number(metrics.recaudacion || totalCobrado || 0),
    pagos: Number(metrics.pagos || 0),
    deudaPendiente,
    deudaTotal: totaleDeuda,
    comerciantesActivos: totalComerciantes,
    morosidad,
    totalRecaudado: Number(metrics.recaudacion || totalCobrado || 0),
    totalCobros: Number(metrics.pagos || 0),
    totalComerciantes
  };
}

app.get('/api/v1/dashboard', ...staffOnly, async (req, res) => {
  const period = String(req.query.periodo || currentPeriod());
  const metrics = await getOperationalDashboard(db, { periodo: period });

  res.json({
    stats: {
      ...(await getDbStats(db)),
      ...dashboardStats(metrics)
    },
    operational: {
      porZona: metrics.porZona || [],
      porRubro: metrics.porRubro || [],
      porCobrador: metrics.porCobrador || []
    }
  });
});

// Transparencia para la página de inicio: solo cifras agregadas, sin nombres ni DNI.
// Se guarda 60 s en memoria porque calcular la deuda recorre todo el padrón.
let publicSummaryCache: { at: number; body: unknown } | null = null;

app.get('/api/v1/publico/resumen', async (_req, res) => {
  if (publicSummaryCache && Date.now() - publicSummaryCache.at < 60_000) {
    return res.json(publicSummaryCache.body);
  }
  const periodo = currentPeriod();
  const [metrics, puestos] = await Promise.all([getOperationalDashboard(db, { periodo }), getPuestos(db)]);
  const stats = dashboardStats(metrics);
  const body = {
    periodo,
    stats: {
      recaudacion: stats.recaudacion,
      pagos: stats.pagos,
      deudaPendiente: stats.deudaPendiente,
      morosidad: stats.morosidad,
      totalComerciantes: stats.totalComerciantes,
      sitios: puestos.length
    },
    operational: {
      porZona: (metrics.porZona || []).map(({ zona, comerciantes, recaudado }) => ({ zona, comerciantes, recaudado })),
      porRubro: (metrics.porRubro || []).map(({ rubro, recaudado, pagos }) => ({ rubro, recaudado, pagos })),
      porCobrador: []
    }
  };
  publicSummaryCache = { at: Date.now(), body };
  return res.json(body);
});

app.get('/api/v1/analitica/prediccion', ...staffOnly, async (req, res) => {
  try {
    const period = String(req.query.periodo || currentPeriod());
    const forecast = await generateForecastProjection(db, { period, horizonteDias: Number(req.query.horizonte_dias || req.query.horizon || 90) });
    return res.json({ data: forecast, message: 'Proyección de recaudación generada correctamente' });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'No se pudo generar la predicción' });
  }
});

app.get('/api/v1/analitica/riesgo', ...staffOnly, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 5), 1), 20);
    const data = await getRiskDashboard(db, { limit });
    return res.json({ data, message: 'Scoring de morosidad actualizado' });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'No se pudo calcular el riesgo de morosidad' });
  }
});

app.get('/api/v1/roles', requireAuth, (_req, res) => {
  res.json({ roles });
});

app.get('/api/v1/catalogos', requireAuth, async (_req, res) => {
  res.json({
    rubros: await getRubros(db),
    zonas: await getZonas(db)
  });
});

app.get('/api/v1/zonas', requireAuth, async (_req, res) => {
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

app.get('/api/v1/calles', requireAuth, async (_req, res) => {
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

app.post('/api/v1/portal/login', loginLimiter, async (req, res) => {
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

app.get('/api/v1/portal/:comercianteId/notificaciones', ...staffOnly, async (req, res) => {
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

app.get('/api/v1/comprobantes/:id/pdf', ...staffOnly, async (req, res) => {
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
      `Fecha: ${payment.fecha_cobro || 'N/D'}`,
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

app.get('/api/v1/reportes', ...staffOnly, async (req, res) => {
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

app.get('/api/v1/comerciantes', ...staffOnly, async (req, res) => {
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

app.post('/api/v1/comerciantes/importar-padron',
  requireAuth,
  requireRoles(['super_admin', 'auditor']),
  receivePadronWorkbook,
  async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'Selecciona un archivo .xlsx para importar' });

    try {
      const sheets = await readPadronWorkbook(req.file.buffer);
      const preview = await previewPadronSheets(sheets, { filename: req.file.originalname, db });
      const publicPreview = {
        filename: req.file.originalname,
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
        absentRows: preview.absentRows,
        errors: preview.errors.slice(0, 100)
      };

      if (String(req.body?.dryRun).toLowerCase() === 'true') {
        return res.json({ data: publicPreview, message: 'Previsualización lista; aún no se modificó el padrón.' });
      }
      if (!preview.validRows) {
        return res.status(422).json({ data: publicPreview, message: 'No hay filas válidas para importar. Corrige los errores del libro.' });
      }

      const result = await importPadronPreview(db, preview, req.user?.id || 1);
      await recordAudit(db, {
        usuarioId: Number(req.user?.id || 1),
        usuarioRol: req.user?.rol || 'anonimo',
        entidad: 'padron',
        accion: 'IMPORTAR_PADRON_EXCEL',
        detalle: `Importación ${req.file.originalname}: ${result.createdMerchants} comerciantes nuevos, ${result.createdPosts} puestos nuevos, ${result.absentPosts} ausentes sin devengo`,
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

app.get('/api/v1/comerciantes/:id', ...staffOnly, async (req, res) => {
  const comerciante = (await getComerciantes(db, { search: String(Number(req.params.id)), limit: 100 })).find((item) => item.id === Number(req.params.id));

  if (!comerciante) {
    return res.status(404).json({ message: 'Comerciante no encontrado' });
  }

  return res.json({ data: comerciante });
});

app.get('/api/v1/comerciantes/:id/preferencias', ...staffOnly, async (req, res) => {
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

app.get('/api/v1/puestos', ...staffOnly, async (_req, res) => {
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

app.get('/api/v1/tarifas', requireAuth, async (_req, res) => {
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

app.get('/api/v1/liquidaciones/:comercianteId', ...staffOnly, async (req, res) => {
  try {
    return res.json({ data: await calculateLiquidation(db, req.params.comercianteId, String(req.query.periodo || '')) });
  } catch (error) {
    return res.status(400).json({ message: error.message || 'No se pudo calcular la liquidación' });
  }
});

app.get('/api/v1/comerciantes/:comercianteId/saldo', ...staffOnly, async (req, res) => {
  try {
    return res.json({ data: await calculateLiquidation(db, req.params.comercianteId, String(req.query.periodo || '')) });
  } catch (error) {
    return res.status(400).json({ message: error.message || 'No se pudo consultar el saldo' });
  }
});

app.get('/api/v1/cobros', ...staffOnly, async (_req, res) => {
  const data = await getCobros(db);
  res.json({ data, total: data.length });
});

app.post('/api/v1/cobros/sincronizar',
  requireAuth,
  requireRoles(['super_admin', 'cobrador']),
  async (req, res) => {
    const idempotencyKey = String(req.headers['x-idempotency-key'] || req.body.hash_transaccion || req.body.hashTransaccion || '').trim();
    const payload = {
      ...req.body,
      comerciante_id: req.body.comerciante_id ?? req.body.comercianteId,
      // El cobrador es siempre quien inició sesión; el navegador no puede elegirlo.
      cobrador_id: req.user.id,
      metodo_pago: req.body.metodo_pago ?? req.body.metodoPago ?? 'efectivo',
      hash_transaccion: idempotencyKey || req.body.hash_transaccion || req.body.hashTransaccion || undefined,
      codigo_operacion: req.body.codigo_operacion ?? req.body.codigoOperacion ?? (idempotencyKey || undefined),
      fecha_cobro: req.body.fecha_cobro || req.body.fechaCobro || new Date().toISOString(),
      periodo: req.body.periodo || currentPeriod()
    };

    try {
      const result = await syncOfflineCobro(db, payload, { audit: auditContext(req, 'SINCRONIZAR_COBRO_OFFLINE') });
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
  async (req, res) => {
    try {
      // cobrador_id sale del token; comprobante, cobro y auditoría se graban en una sola transacción.
      const data = await insertCobro(db, { ...(req.body || {}), cobrador_id: req.user.id }, { audit: auditContext(req, 'REGISTRAR_COBRO') });
      return res.status(201).json({ data, message: 'Cobro registrado correctamente' });
    } catch (error) {
      return res.status(400).json({ message: error.message || 'No se pudo registrar el cobro' });
    }
  }
);

app.post('/api/v1/auth/login', loginLimiter, validateLogin, handleValidationErrors, async (req, res) => {
  try {
    const result = await loginUser(req.body, db);
    return res.json(result);
  } catch (error) {
    // Mensaje genérico para no revelar si el usuario existe o no
    return res.status(401).json({ message: 'Credenciales inválidas' });
  }
});

app.get('/api/v1/auth/permissions/:role/:requiredRole', requireAuth, (req, res) => {
  const { role, requiredRole } = req.params;
  res.json({ allowed: hasRoleAccess(String(role), String(requiredRole)) });
});

// Rutas de la API que no existen.
app.use('/api', (_req, res) => {
  res.status(404).json({ message: 'Ruta no encontrada' });
});

// Manejador global: Express 5 envía aquí los errores de las rutas async en lugar de tumbar el proceso.
app.use((error: any, req: Request, res: Response, _next: NextFunction) => {
  const status = Number(error?.status || error?.statusCode) || 500;
  if (status >= 500) console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, error);
  if (res.headersSent) return;
  res.status(status).json({
    message: status >= 500 ? 'Error interno del servidor' : (error?.message || 'Petición inválida')
  });
});

async function startServer(listenPort: number = port) {
  db = await initializeDatabase();

  const server = await new Promise<Server>((resolve) => {
    const instance = app.listen(listenPort, () => resolve(instance));
  });
  const address = server.address();
  console.log(`SISREC API (${config.nodeEnv}) escuchando en el puerto ${typeof address === 'object' && address ? address.port : listenPort}`);

  const shutdown = (signal: string) => {
    console.log(`Recibida ${signal}. Cerrando servidor...`);
    server.close(async () => {
      await closeDatabase();
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  return server;
}

// Último recurso: registrar en el log en vez de morir en silencio.
process.on('unhandledRejection', (reason) => {
  console.error('Promesa rechazada sin manejar:', reason);
});

// Exportar startServer para uso externo
export { startServer };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch((error) => {
    console.error('No se pudo iniciar SISREC API:', error);
    process.exit(1);
  });
}
