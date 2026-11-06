// Tickets preimpresos: el administrador asigna, reasigna y devuelve lotes; el cobrador consulta los suyos y
// anula los dañados. El cobro con ticket va por /cobros (campo tickets).
import express from 'express';
import { getSeriesTicket, getCobradoresTickets, getLotes, asignarLote, reasignarTickets, devolverTickets, ticketsDelCobrador, anularTickets } from '../db.js';
import { requireAuth, requireRoles } from '../auth.js';
import { staffOnly, auditContext } from '../http/comunes.js';
import { pool as db } from '../pg.js';

export const router = express.Router();

router.get('/api/v1/tickets/series', ...staffOnly, async (_req, res) => {
  const data = await getSeriesTicket(db);
  return res.json({ data, total: data.length });
});

router.get('/api/v1/tickets/lotes', requireAuth, requireRoles(['super_admin', 'auditor']), async (req, res) => {
  const data = await getLotes(db, { cobradorId: req.query.cobrador_id, estado: req.query.estado });
  return res.json({ data, total: data.length });
});

router.get('/api/v1/tickets/cobradores', requireAuth, requireRoles(['super_admin', 'auditor']), async (_req, res) => {
  const data = await getCobradoresTickets(db);
  return res.json({ data, total: data.length });
});

router.post('/api/v1/tickets/lotes', requireAuth, requireRoles(['super_admin']), async (req, res) => {
  const data = await asignarLote(db, req.body || {}, { usuarioId: req.user.id, audit: auditContext(req, 'ASIGNAR_LOTE_TICKETS') });
  return res.status(201).json({ data, message: `Lote asignado: ${data.total} tickets` });
});

router.post('/api/v1/tickets/lotes/:id/reasignar', requireAuth, requireRoles(['super_admin']), async (req, res) => {
  const data = await reasignarTickets(db, Number(req.params.id), req.body || {}, { usuarioId: req.user.id, audit: auditContext(req, 'REASIGNAR_TICKETS') });
  return res.json({ data, message: `${data.movidos} tickets reasignados` });
});

router.post('/api/v1/tickets/lotes/:id/devolver', requireAuth, requireRoles(['super_admin']), async (req, res) => {
  const data = await devolverTickets(db, Number(req.params.id), req.body || {}, { usuarioId: req.user.id, audit: auditContext(req, 'DEVOLVER_TICKETS') });
  return res.json({ data, message: `${data.devueltos} tickets devueltos` });
});

// Los tickets disponibles del cobrador que inició sesión (también vienen en el paquete de jornada).
router.get('/api/v1/tickets/mios', requireAuth, requireRoles(['cobrador', 'super_admin']), async (req, res) => {
  return res.json({ data: await ticketsDelCobrador(db, req.user.id) });
});

// Una o varias anulaciones (las hechas sin señal llegan juntas). Responde el resultado de cada una.
router.post('/api/v1/tickets/anulaciones', requireAuth, requireRoles(['cobrador', 'super_admin']), async (req, res) => {
  const items = Array.isArray(req.body?.anulaciones) ? req.body.anulaciones : req.body;
  const data = await anularTickets(db, items, { usuarioId: req.user.id, rol: req.user.rol, audit: auditContext(req, 'ANULAR_TICKET') });
  const anulados = data.resultados.filter((item) => item.estado === 'anulado' || item.estado === 'ya_anulado').length;
  return res.json({ data, message: `${anulados} de ${data.resultados.length} tickets anulados` });
});
