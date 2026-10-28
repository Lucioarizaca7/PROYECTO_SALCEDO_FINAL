// Portal del comerciante y notificaciones.
import express from 'express';
import { createNotification, getNotifications } from '../db.js';
import { ingresarAlPortal } from '../portalAcceso.js';
import { requireAuth, requireRoles } from '../auth.js';
import { staffOnly, loginLimiter } from '../http/comunes.js';
import { pool as db } from '../pg.js';
import { buscarRecibo, generarReciboPdf, leerTokenDescarga, verificarRecibo } from '../reciboPdf.js';

export const router = express.Router();

// DNI o código + llave del carnet, o la llave sola (QR del reverso). El PIN ya no existe (0017).
// Credenciales erradas: 401 (sin decir cuál falló); 5 errores seguidos: 429.
router.post('/api/v1/portal/login', loginLimiter, async (req, res) => {
  const { identifier, llave } = req.body || {};
  const data = await ingresarAlPortal(db, { identifier, llave });
  return res.json({ data, message: 'Portal del comerciante consultado correctamente' });
});

// Descarga del recibo desde el portal: el enlace firmado lo recibe solo quien entró con su llave,
// vence a los 30 minutos y abre únicamente ese recibo.
router.get('/api/v1/portal/recibos/:token/pdf', async (req, res) => {
  const transaccionId = leerTokenDescarga(req.params.token);
  const recibo = transaccionId ? await buscarRecibo(db, transaccionId) : null;
  if (!recibo) return res.status(404).json({ message: 'El enlace del recibo no es válido o ya venció; vuelva a ingresar al portal' });
  const pdf = await generarReciboPdf(recibo);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="recibo-${recibo.numero}.pdf"`);
  return res.send(pdf);
});

// Verificación pública del QR del recibo: solo número, fecha, monto y estado (sin datos personales).
router.get('/api/v1/publico/verificar/:token', async (req, res) => {
  const data = await verificarRecibo(db, req.params.token);
  if (!data) return res.status(404).json({ message: 'Recibo no encontrado: el código no corresponde a un recibo emitido por la municipalidad' });
  return res.json({ data });
});

router.get('/api/v1/portal/:comercianteId/notificaciones', ...staffOnly, async (req, res) => {
  const comercianteId = Number(req.params.comercianteId || 0);
  const data = await getNotifications(db, comercianteId);
  return res.json({ data, total: data.length });
});

router.post('/api/v1/notificaciones',
  requireAuth,
  requireRoles(['super_admin', 'cobrador', 'auditor']),
  async (req, res) => {
    const notification = await createNotification(db, req.body || {});
    return res.status(201).json({ data: notification, message: 'Notificación registrada correctamente' });
  }
);
