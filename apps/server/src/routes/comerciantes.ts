// Padrón de comerciantes, importación del Excel y preferencias.
import express from 'express';
import { recordAudit, getComerciantes, findComerciante, countComerciantes, insertComerciante, updateComerciante, deactivateComerciante, getComerciantePreferencias, updateComerciantePreferencias } from '../db.js';
import { requireAuth, requireRoles, auditMutation } from '../auth.js';
import { handleValidationErrors, validateComerciante } from '../validation.js';
import { importPadronPreview, previewPadronSheets, readPadronWorkbook, guardarVistaPrevia, tomarVistaPrevia, descartarVistaPrevia } from '../padronImport.js';
import { buildPadronTemplate } from '../padronPlantilla.js';
import { AppError } from '../errors.js';
import { staffOnly, receivePadronWorkbook, rowById, resolveComercianteParam } from '../http/comunes.js';
import { pool as db } from '../pg.js';
import { emitirCarnets } from '../portalAcceso.js';

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

// Plantilla oficial del padrón con listas desplegables del catálogo. Va antes de /comerciantes/:id.
router.get('/api/v1/comerciantes/plantilla-padron',
  requireAuth,
  requireRoles(['super_admin', 'auditor']),
  async (_req, res) => {
    const plantilla = await buildPadronTemplate(db);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="plantilla-padron-sisrec.xlsx"');
    return res.send(plantilla);
  }
);

// La vista previa (dryRun) devuelve un previewToken: la confirmación lo envía en vez de volver a subir el
// Excel. Si venció (15 min) o es de otro usuario responde 410 y el cliente reenvía el archivo.
router.post('/api/v1/comerciantes/importar-padron',
  requireAuth,
  requireRoles(['super_admin', 'auditor']),
  receivePadronWorkbook,
  async (req, res) => {
    const userId = Number(req.user?.id || 1);
    const previewToken = String(req.body?.previewToken || '');
    const dryRun = String(req.body?.dryRun).toLowerCase() === 'true';
    let libro = null;
    if (!req.file && previewToken && !dryRun) {
      libro = tomarVistaPrevia(previewToken, userId);
      if (!libro) return res.status(410).json({ message: 'La previsualización venció; vuelve a subir el archivo' });
    }
    if (!req.file && !libro) return res.status(400).json({ message: 'Selecciona un archivo .xlsx para importar' });

    try {
      const filename = req.file ? req.file.originalname : libro.filename;
      const sheets = req.file ? await readPadronWorkbook(req.file.buffer) : libro.sheets;
      // Al confirmar se vuelve a cruzar con la base: pudo cambiar desde la vista previa.
      const preview = await previewPadronSheets(sheets, { filename, db });
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
        absentRows: preview.absentRows,
        pendingMerchants: preview.pendingMerchants,
        zonePendingPosts: preview.zonePendingPosts,
        merchantsWithSeveralPosts: preview.merchantsWithSeveralPosts,
        regularizedMerchants: preview.regularizedMerchants.slice(0, 100),
        reactivatedMerchants: preview.reactivatedMerchants.slice(0, 100),
        warnings: preview.warnings.slice(0, 100),
        errors: preview.errors.slice(0, 100)
      };

      if (dryRun) {
        const token = preview.workbookType === 'merchant-padron' && preview.validRows ? guardarVistaPrevia(userId, { filename, sheets }) : null;
        return res.json({ data: { ...publicPreview, previewToken: token }, message: 'Previsualización lista; aún no se modificó el padrón.' });
      }
      if (!preview.validRows) {
        return res.status(422).json({ data: publicPreview, message: 'No hay filas válidas para importar. Corrige los errores del libro.' });
      }

      const result = await importPadronPreview(db, preview, userId);
      if (previewToken) descartarVistaPrevia(previewToken);
      await recordAudit(db, {
        usuarioId: userId,
        usuarioRol: req.user?.rol || 'anonimo',
        entidad: 'padron',
        accion: 'IMPORTAR_PADRON_EXCEL',
        detalle: `Importación ${filename}: ${result.createdMerchants} comerciantes nuevos, ${result.reactivatedMerchants} reactivados, ${result.regularizedMerchants} regularizados, ${result.createdPosts} puestos nuevos, ${result.absentPosts} ausentes sin devengo, ${result.skippedRows} filas omitidas`,
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

// Carnet con llave del portal (decisión del 28/10/2026: solo super_admin lo emite, uno o en lote).
// Las llaves se responden una sola vez; la auditoría guarda a quién se emitió, nunca la llave.
const carnetSinLlaves = (body) => ({ emitidos: (body?.data || []).map((item) => item.comerciante_id) });

router.post('/api/v1/comerciantes/carnets',
  requireAuth,
  requireRoles(['super_admin']),
  auditMutation({ db, accion: 'EMITIR_CARNETS', entidad: 'comerciante_portal_acceso', serializeResponse: carnetSinLlaves }),
  async (req, res) => {
    const data = await emitirCarnets(db, req.body?.ids, req.user?.id);
    return res.status(201).json({ data, total: data.length, message: `${data.length} carnet(s) emitido(s). Imprímalos ahora: las llaves no se vuelven a mostrar.` });
  }
);

router.post('/api/v1/comerciantes/:id/carnet',
  requireAuth,
  requireRoles(['super_admin']),
  auditMutation({ db, accion: 'EMITIR_CARNET', entidad: 'comerciante_portal_acceso', serializeResponse: carnetSinLlaves }),
  async (req, res) => {
    const data = await emitirCarnets(db, [Number(req.params.id)], req.user?.id);
    return res.status(201).json({ data, message: 'Carnet emitido. Imprímalo ahora: la llave no se vuelve a mostrar.' });
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
    // Quién dio de alta al comerciante sale del token, nunca del cuerpo: si no, se podría atribuir a otro.
    const comerciante = await insertComerciante(db, { ...req.body, usuario_creador: req.user.id });

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
