// Zonas y calles.
import express from 'express';
import { getZonas, getCalles, insertZona, updateZona, deleteZona, insertCalle, updateCalle, deleteCalle } from '../db.js';
import { requireAuth, requireRoles, auditMutation } from '../auth.js';
import { rowById } from '../http/comunes.js';
import { pool as db } from '../pg.js';

export const router = express.Router();

router.get('/api/v1/zonas', requireAuth, async (_req, res) => {
  res.json({
    data: await getZonas(db),
    calles: await getCalles(db),
    message: 'Zonas y calles consultadas correctamente'
  });
});

router.post('/api/v1/zonas', requireAuth, requireRoles(['super_admin', 'auditor']), auditMutation({ db, accion: 'CREAR_ZONA', entidad: 'zonas', serializeResponse: (body) => body?.data ?? body }), async (req, res) => {
  const data = await insertZona(db, req.body || {});
  return res.status(201).json({ data, message: 'Zona creada correctamente' });
});

router.put('/api/v1/zonas/:id', requireAuth, requireRoles(['super_admin', 'auditor']), auditMutation({ db, accion: 'ACTUALIZAR_ZONA', entidad: 'zonas', getPreviousState: async (req) => rowById('zonas', Number(req.params.id)), serializeResponse: (body) => body?.data ?? body }), async (req, res) => {
  const data = await updateZona(db, req.params.id, req.body || {});
  return res.json({ data, message: 'Zona actualizada correctamente' });
});

router.delete('/api/v1/zonas/:id', requireAuth, requireRoles(['super_admin', 'auditor']), auditMutation({ db, accion: 'ELIMINAR_ZONA', entidad: 'zonas', getPreviousState: async (req) => rowById('zonas', Number(req.params.id)), serializeResponse: (body) => body?.data ?? body }), async (req, res) => {
  const data = await deleteZona(db, req.params.id);
  return res.json({ data, message: 'Zona eliminada correctamente' });
});

router.get('/api/v1/calles', requireAuth, async (_req, res) => {
  const zonaId = Number(_req.query.zona_id || 0);
  res.json({
    data: await getCalles(db, { zona_id: zonaId }),
    message: 'Calles consultadas correctamente'
  });
});

router.post('/api/v1/calles', requireAuth, requireRoles(['super_admin', 'auditor']), auditMutation({ db, accion: 'CREAR_CALLE', entidad: 'calles', serializeResponse: (body) => body?.data ?? body }), async (req, res) => {
  const data = await insertCalle(db, req.body || {});
  return res.status(201).json({ data, message: 'Calle creada correctamente' });
});

router.put('/api/v1/calles/:id', requireAuth, requireRoles(['super_admin', 'auditor']), auditMutation({ db, accion: 'ACTUALIZAR_CALLE', entidad: 'calles', getPreviousState: async (req) => rowById('calles', Number(req.params.id)), serializeResponse: (body) => body?.data ?? body }), async (req, res) => {
  const data = await updateCalle(db, req.params.id, req.body || {});
  return res.json({ data, message: 'Calle actualizada correctamente' });
});

router.delete('/api/v1/calles/:id', requireAuth, requireRoles(['super_admin', 'auditor']), auditMutation({ db, accion: 'ELIMINAR_CALLE', entidad: 'calles', getPreviousState: async (req) => rowById('calles', Number(req.params.id)), serializeResponse: (body) => body?.data ?? body }), async (req, res) => {
  const data = await deleteCalle(db, req.params.id);
  return res.json({ data, message: 'Calle eliminada correctamente' });
});
