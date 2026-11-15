// Cierre de caja diario por cobrador: lo esperado (calculado en el servidor) frente a lo declarado.
import express from 'express';
import { resumenCaja, cerrarCaja, getCierresCaja, registrarEntregaCaja, rectificarCierreCaja } from '../db.js';
import { requireAuth, requireRoles } from '../auth.js';
import { auditContext } from '../http/comunes.js';
import { ValidationError } from '../errors.js';
import { pool as db } from '../pg.js';

export const router = express.Router();

// El cobrador ve solo su caja; el administrador y el auditor pueden ver la de cualquiera (?cobrador_id=).
router.get('/api/v1/caja/resumen', requireAuth, requireRoles(['super_admin', 'auditor', 'cobrador']), async (req, res) => {
  const pedido = Number(req.query.cobrador_id || 0);
  if (req.user.rol === 'cobrador' && pedido && pedido !== Number(req.user.id)) {
    return res.status(403).json({ message: 'Solo puede ver su propia caja' });
  }
  const cobradorId = pedido || Number(req.user.id);
  if (!cobradorId) throw new ValidationError('Indique el cobrador');
  return res.json({ data: await resumenCaja(db, cobradorId, req.query.fecha) });
});

router.post('/api/v1/caja/cierre', requireAuth, requireRoles(['cobrador', 'super_admin']), async (req, res) => {
  const data = await cerrarCaja(db, req.user.id, req.body || {}, { audit: auditContext(req, 'CERRAR_CAJA') });
  const texto = data.diferencia === 0 ? 'cuadra' : data.diferencia > 0 ? `sobran S/ ${data.diferencia.toFixed(2)}` : `faltan S/ ${Math.abs(data.diferencia).toFixed(2)}`;
  return res.status(201).json({ data, message: `Caja cerrada: ${texto}` });
});

// Entrega del dinero de un cierre (RN-41, RN-44): la registra el super_admin que lo recibe, nunca el propio cobrador.
router.post('/api/v1/caja/cierres/:id/entrega', requireAuth, requireRoles(['super_admin']), async (req, res) => {
  const data = await registrarEntregaCaja(db, req.params.id, req.body || {}, { usuarioId: req.user.id, audit: auditContext(req, 'ENTREGA_CAJA') });
  return res.status(201).json({ data, message: 'Entrega registrada' });
});

// Rectificación de un cierre (RN-43): el cierre original no se edita.
router.post('/api/v1/caja/cierres/:id/rectificacion', requireAuth, requireRoles(['super_admin']), async (req, res) => {
  const data = await rectificarCierreCaja(db, req.params.id, req.body || {}, { usuarioId: req.user.id, audit: auditContext(req, 'RECTIFICAR_CAJA') });
  return res.status(201).json({ data, message: 'Cierre rectificado' });
});

router.get('/api/v1/caja/cierres', requireAuth, requireRoles(['super_admin', 'auditor']), async (req, res) => {
  const data = await getCierresCaja(db, { desde: req.query.desde, hasta: req.query.hasta });
  return res.json({ data, total: data.length });
});
