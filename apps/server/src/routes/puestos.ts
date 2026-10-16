// Puestos y mapa de sitios.
import express from 'express';
import { getPuestos, insertPuesto, updatePuesto, liberarPuesto, deactivatePuesto } from '../db.js';
import { requireAuth, requireRoles, auditMutation } from '../auth.js';
import { staffOnly, rowById } from '../http/comunes.js';
import { pool as db } from '../pg.js';

export const router = express.Router();

// Cada puesto trae su estado de pago del mes (saldo_pendiente, monto_total, monto_pagado, estado_pago).
router.get('/api/v1/puestos', ...staffOnly, async (req, res) => {
  const data = await getPuestos(db, { incluirInactivos: req.query.incluirInactivos === '1' });
  res.json({ data, total: data.length });
});

router.post('/api/v1/puestos',
  requireAuth,
  requireRoles(['super_admin', 'cobrador']),
  auditMutation({
    db,
    accion: 'ASIGNAR_PUESTO',
    entidad: 'puestos',
    serializeResponse: (body) => body?.data ?? body
  }),
  async (req, res) => {
    const puesto = await insertPuesto(db, req.body || {});
    return res.status(201).json({ data: puesto, message: 'Puesto asignado correctamente' });
  }
);

router.post('/api/v1/puestos-mapa',
  requireAuth,
  requireRoles(['super_admin', 'cobrador']),
  auditMutation({
    db,
    accion: 'CREAR_PUESTO_MAPA',
    entidad: 'puestos',
    serializeResponse: (body) => body?.data ?? body
  }),
  async (req, res) => {
    const puesto = await insertPuesto(db, {
      ...req.body,
      comerciante_id: req.body.comerciante_id ?? req.body.comercianteId,
      zona_id: req.body.zona_id ?? req.body.zonaId,
      direccion: req.body.direccion || req.body.sector || req.body.codigoPuesto,
      metros_cuadrados: req.body.metros_cuadrados ?? req.body.metros ?? 1,
      estado: req.body.estado // sin estado: ocupado si tiene titular, disponible si no
    });
    return res.status(201).json({ data: puesto, message: 'Puesto geolocalizado registrado correctamente' });
  }
);

router.put('/api/v1/puestos-mapa/:id',
  requireAuth,
  requireRoles(['super_admin', 'cobrador']),
  auditMutation({
    db,
    accion: 'ACTUALIZAR_PUESTO_MAPA',
    entidad: 'puestos',
    getPreviousState: async (req) => rowById('puestos', Number(req.params.id)),
    serializeResponse: (body) => body?.data ?? body
  }),
  async (req, res) => {
    return res.json({ data: await updatePuesto(db, req.params.id, req.body || {}), message: 'Puesto geolocalizado actualizado correctamente' });
  }
);

router.post('/api/v1/puestos/:id/liberar',
  requireAuth,
  requireRoles(['super_admin', 'cobrador']),
  auditMutation({
    db,
    accion: 'LIBERAR_PUESTO',
    entidad: 'puestos',
    getPreviousState: async (req) => rowById('puestos', Number(req.params.id)),
    serializeResponse: (body) => body?.data ?? body
  }),
  async (req, res) => {
    return res.json({ data: await liberarPuesto(db, req.params.id), message: 'Puesto liberado: queda disponible para otro comerciante' });
  }
);

router.delete('/api/v1/puestos-mapa/:id',
  requireAuth,
  requireRoles(['super_admin', 'cobrador']),
  auditMutation({
    db,
    accion: 'DAR_DE_BAJA_PUESTO_MAPA',
    entidad: 'puestos',
    getPreviousState: async (req) => rowById('puestos', Number(req.params.id)),
    serializeResponse: (body) => body?.data ?? body
  }),
  async (req, res) => {
    return res.json({ data: await deactivatePuesto(db, req.params.id), message: 'Puesto dado de baja lógicamente' });
  }
);
