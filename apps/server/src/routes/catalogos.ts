// Zonas. Una zona es un área con un solo precio por día; no hay calles (decisión del 14/11/2026).
import express from 'express';
import { getZonas, insertZona, updateZona, deleteZona } from '../db.js';
import { requireAuth, requireRoles, auditMutation } from '../auth.js';
import { rowById } from '../http/comunes.js';
import { pool as db } from '../pg.js';

export const router = express.Router();

router.get('/api/v1/zonas', requireAuth, async (_req, res) => {
  res.json({
    data: await getZonas(db),
    message: 'Zonas consultadas correctamente'
  });
});

router.post('/api/v1/zonas', requireAuth, requireRoles(['super_admin']), auditMutation({ db, accion: 'CREAR_ZONA', entidad: 'zonas', serializeResponse: (body) => body?.data ?? body }), async (req, res) => {
  const data = await insertZona(db, req.body || {});
  return res.status(201).json({ data, message: 'Zona creada correctamente' });
});

router.put('/api/v1/zonas/:id', requireAuth, requireRoles(['super_admin']), auditMutation({ db, accion: 'ACTUALIZAR_ZONA', entidad: 'zonas', getPreviousState: async (req) => rowById('zonas', Number(req.params.id)), serializeResponse: (body) => body?.data ?? body }), async (req, res) => {
  const data = await updateZona(db, req.params.id, req.body || {});
  return res.json({ data, message: 'Zona actualizada correctamente' });
});

router.delete('/api/v1/zonas/:id', requireAuth, requireRoles(['super_admin']), auditMutation({ db, accion: 'ELIMINAR_ZONA', entidad: 'zonas', getPreviousState: async (req) => rowById('zonas', Number(req.params.id)), serializeResponse: (body) => body?.data ?? body }), async (req, res) => {
  const data = await deleteZona(db, req.params.id);
  return res.json({ data, message: 'Zona eliminada correctamente' });
});
