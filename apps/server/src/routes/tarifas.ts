// Tarifas, liquidación y saldo del comerciante.
import express from 'express';
import { getTarifas, insertTarifa, updateTarifa, calcularLiquidacion } from '../db.js';
import { requireAuth, requireRoles, auditMutation } from '../auth.js';
import { staffOnly, rowById, resolveComercianteParam } from '../http/comunes.js';
import { pool as db } from '../pg.js';

export const router = express.Router();

router.get('/api/v1/tarifas', requireAuth, async (_req, res) => {
  const data = await getTarifas(db, { rubro_id: _req.query.rubro_id });
  res.json({ data, total: data.length });
});

router.post('/api/v1/tarifas',
  requireAuth,
  requireRoles(['super_admin']),
  auditMutation({
    db,
    accion: 'CREAR_TARIFA',
    entidad: 'tarifas',
    serializeResponse: (body) => body?.data ?? body
  }),
  async (req, res) => {
    return res.status(201).json({ data: await insertTarifa(db, req.body || {}), message: 'Tarifa creada correctamente' });
  }
);

router.put('/api/v1/tarifas/:id',
  requireAuth,
  requireRoles(['super_admin']),
  auditMutation({
    db,
    accion: 'ACTUALIZAR_TARIFA',
    entidad: 'tarifas',
    getPreviousState: async (req) => {
      return rowById('tarifas', Number(req.params.id));
    },
    serializeResponse: (body) => body?.data ?? body
  }),
  async (req, res) => {
    return res.json({ data: await updateTarifa(db, req.params.id, req.body || {}), message: 'Tarifa actualizada correctamente' });
  }
);

router.get('/api/v1/liquidaciones/:comercianteId', ...staffOnly, async (req, res) => {
  return res.json({ data: await calcularLiquidacion(db, await resolveComercianteParam(String(req.params.comercianteId)), String(req.query.periodo || '')) });
});

router.get('/api/v1/comerciantes/:comercianteId/saldo', ...staffOnly, async (req, res) => {
  return res.json({ data: await calcularLiquidacion(db, await resolveComercianteParam(String(req.params.comercianteId)), String(req.query.periodo || '')) });
});
