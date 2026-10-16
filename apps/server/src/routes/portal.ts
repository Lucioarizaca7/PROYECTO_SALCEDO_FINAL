// Portal del comerciante y notificaciones.
import express from 'express';
import { obtenerPortalComerciante, createNotification, getNotifications } from '../db.js';
import { requireAuth, requireRoles } from '../auth.js';
import { staffOnly, loginLimiter } from '../http/comunes.js';
import { pool as db } from '../pg.js';

export const router = express.Router();

router.post('/api/v1/portal/login', loginLimiter, async (req, res) => {
  const identifier = String(req.body?.identifier || '').trim();
  if (!identifier) {
    return res.status(400).json({ message: 'Debe ingresar su DNI o código de comerciante' });
  }

  const data = await obtenerPortalComerciante(db, identifier);
  return res.json({ data, message: 'Portal del comerciante consultado correctamente' });
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
