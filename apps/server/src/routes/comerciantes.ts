// Padrón de comerciantes, importación del Excel y preferencias.
import express from 'express';
import { recordAudit, getComerciantes, findComerciante, countComerciantes, insertComerciante, updateComerciante, deactivateComerciante, getComerciantePreferencias, updateComerciantePreferencias } from '../db.js';
import { requireAuth, requireRoles, auditMutation } from '../auth.js';
import { handleValidationErrors, validateComerciante } from '../validation.js';
import { importPadronPreview, previewPadronSheets, readPadronWorkbook } from '../padronImport.js';
import { AppError } from '../errors.js';
import { staffOnly, receivePadronWorkbook, rowById, resolveComercianteParam } from '../http/comunes.js';
import { pool as db } from '../pg.js';

export const router = express.Router();

router.get('/api/v1/comerciantes', ...staffOnly, async (req, res) => {
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

router.post('/api/v1/comerciantes/importar-padron',
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
      // Errores de negocio o de la base van al manejador global; el resto es un libro ilegible.
      if (error instanceof AppError || error?.code) throw error;
      return res.status(400).json({ message: error.message || 'No se pudo procesar el libro Excel' });
    }
  }
);

router.get('/api/v1/comerciantes/:id', ...staffOnly, async (req, res) => {
  const id = await resolveComercianteParam(String(req.params.id));
  const comerciante = id ? await findComerciante(db, id) : null;

  if (!comerciante) {
    return res.status(404).json({ message: 'Comerciante no encontrado' });
  }

  return res.json({ data: comerciante });
});

router.get('/api/v1/comerciantes/:id/preferencias', ...staffOnly, async (req, res) => {
  const comercianteId = Number(req.params.id || 0);
  const data = await getComerciantePreferencias(db, comercianteId);
  return res.json({ data, message: 'Preferencias del comerciante consultadas correctamente' });
});

router.post('/api/v1/comerciantes/:id/preferencias',
  requireAuth,
  requireRoles(['super_admin', 'cobrador', 'auditor']),
  auditMutation({
    db,
    accion: 'ACTUALIZAR_PREFERENCIAS',
    entidad: 'comerciante_preferencias',
    serializeResponse: (body) => body?.data ?? body
  }),
  async (req, res) => {
    const comercianteId = Number(req.params.id || 0);
    const payload = req.body || {};
    const data = await updateComerciantePreferencias(db, comercianteId, payload);
    return res.status(201).json({ data, message: 'Preferencias actualizadas correctamente' });
  }
);

router.post('/api/v1/comerciantes',
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
    const comerciante = await insertComerciante(db, {
      ...req.body,
      usuario_creador: req.body.usuario_creador || req.user?.id || 1
    });

    return res.status(201).json({ data: comerciante, message: 'Comerciante registrado correctamente' });
  }
);

router.put('/api/v1/comerciantes/:id',
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
    const comerciante = await updateComerciante(db, req.params.id, req.body || {});
    return res.json({ data: comerciante, message: 'Comerciante actualizado correctamente' });
  }
);

router.delete('/api/v1/comerciantes/:id',
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
    const comerciante = await deactivateComerciante(db, req.params.id);
    return res.json({ data: comerciante, message: 'Comerciante dado de baja correctamente' });
  }
);
