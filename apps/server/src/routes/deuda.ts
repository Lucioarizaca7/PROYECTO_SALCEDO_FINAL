// Avisos de deuda, baja de deuda con resolución y reclamos de un día marcado (RN-53, RN-54 y RN-27).
// El auditor consulta; solo el super_admin escribe.
import express from 'express';
import { getAvisosDeuda, emitirAvisoDeuda, getBajasDeuda, darDeBajaDeuda, getReclamos, registrarReclamo, resolverReclamo } from '../db.js';
import { requireAuth, requireRoles } from '../auth.js';
import { auditContext } from '../http/comunes.js';
import { pool as db } from '../pg.js';

export const router = express.Router();

const consulta = [requireAuth, requireRoles(['super_admin', 'auditor'])];
const soloAdmin = [requireAuth, requireRoles(['super_admin'])];

// Quiénes deben un día cobrado desde hace 30 días o más y aún no tienen aviso, y los avisos ya emitidos.
router.get('/api/v1/deuda/avisos', ...consulta, async (_req, res) => {
  return res.json({ data: await getAvisosDeuda(db) });
});

router.post('/api/v1/deuda/avisos', ...soloAdmin, async (req, res) => {
  const data = await emitirAvisoDeuda(db, req.body || {}, { usuarioId: req.user.id, audit: auditContext(req, 'AVISO_DEUDA') });
  return res.status(201).json({ data, message: 'Aviso de deuda registrado' });
});

router.get('/api/v1/deuda/bajas', ...consulta, async (_req, res) => {
  const data = await getBajasDeuda(db);
  return res.json({ data, total: data.length });
});

router.post('/api/v1/deuda/bajas', ...soloAdmin, async (req, res) => {
  const data = await darDeBajaDeuda(db, req.body || {}, { usuarioId: req.user.id, audit: auditContext(req, 'BAJA_DEUDA') });
  return res.status(201).json({ data, message: `Deuda dada de baja: S/ ${data.total.toFixed(2)}` });
});

router.get('/api/v1/reclamos', ...consulta, async (req, res) => {
  const data = await getReclamos(db, { estado: req.query.estado ? String(req.query.estado) : null });
  return res.json({ data, total: data.length });
});

router.post('/api/v1/reclamos', ...soloAdmin, async (req, res) => {
  const data = await registrarReclamo(db, req.body || {}, { usuarioId: req.user.id, audit: auditContext(req, 'REGISTRAR_RECLAMO') });
  return res.status(201).json({ data, message: 'Reclamo registrado' });
});

router.post('/api/v1/reclamos/:id/resolver', ...soloAdmin, async (req, res) => {
  const data = await resolverReclamo(db, Number(req.params.id), {
    decision: String(req.body?.decision || ''),
    resolucion: req.body?.resolucion,
    usuarioId: req.user.id,
    audit: auditContext(req, 'RESOLVER_RECLAMO')
  });
  return res.json({ data, message: data.estado === 'procedente' ? 'Reclamo procedente' : 'Reclamo no procedente' });
});
