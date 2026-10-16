// Portal del comerciante y notificaciones.
import express from 'express';
import { createNotification, getNotifications } from '../db.js';
import { ingresarAlPortal } from '../portalAcceso.js';
import { requireAuth, requireRoles } from '../auth.js';
import { staffOnly, loginLimiter } from '../http/comunes.js';
import { pool as db } from '../pg.js';

export const router = express.Router();

// DNI o código + PIN del carnet. Credenciales erradas: 401 (sin decir cuál falló); 5 PIN errados: 429.
router.post('/api/v1/portal/login', loginLimiter, async (req, res) => {
  const data = await ingresarAlPortal(db, req.body?.identifier, req.body?.pin);
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
