// Tarifas, liquidación y saldo del comerciante.
import express from 'express';
import { getTarifas, insertTarifa, updateTarifa, calcularLiquidacion, calcularDeudaAcumulada, getParametros, setInicioCobro, seriesDelComerciante } from '../db.js';
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

// Liquidación del mes pedido más la deuda acumulada (meses impagos desde el inicio de cobro).
async function liquidacionConDeuda(req) {
  const comercianteId = await resolveComercianteParam(String(req.params.comercianteId));
  const liquidacion = await calcularLiquidacion(db, comercianteId, String(req.query.periodo || ''));
  return {
    ...liquidacion,
    deuda_acumulada: await calcularDeudaAcumulada(db, comercianteId),
    // Series de ticket del periodo (un ticket por puesto y día cobrado); vacía = el cobro no lleva ticket.
    series_cobro: await seriesDelComerciante(db, liquidacion.comerciante, liquidacion.periodo)
  };
}

router.get('/api/v1/liquidaciones/:comercianteId', ...staffOnly, async (req, res) => {
  return res.json({ data: await liquidacionConDeuda(req) });
});

router.get('/api/v1/comerciantes/:comercianteId/saldo', ...staffOnly, async (req, res) => {
  return res.json({ data: await liquidacionConDeuda(req) });
});

// Parámetros del sistema (hoy: inicio_cobro, primer mes desde el que se suma la deuda acumulada).
router.get('/api/v1/parametros', ...staffOnly, async (_req, res) => {
  const data = await getParametros(db);
  return res.json({ data, total: data.length });
});

router.put('/api/v1/parametros/inicio_cobro',
  requireAuth,
  requireRoles(['super_admin']),
  auditMutation({
    db,
    accion: 'CAMBIAR_INICIO_COBRO',
    entidad: 'parametros_sistema',
    getPreviousState: async () => (await db.query(`SELECT * FROM parametros_sistema WHERE clave = 'inicio_cobro'`)).rows[0] ?? null,
    serializeResponse: (body) => body?.data ?? body
  }),
  async (req, res) => {
    const data = await setInicioCobro(db, req.body?.valor, { usuarioId: req.user.id });
    return res.json({ data, message: `La deuda acumulada se suma desde ${data.valor}` });
  }
);
