// Puestos y mapa de sitios.
import express from 'express';
import { getPuestos, insertPuesto, updatePuesto, liberarPuesto, deactivatePuesto, getAsistencias, marcarAsistencias, getObservacionesCobro, getCobrosEnOtraZona, getMarcasFueraDeAsignacion } from '../db.js';
import { requireAuth, requireRoles, auditMutation } from '../auth.js';
import { staffOnly, rowById, auditContext } from '../http/comunes.js';
import { pool as db } from '../pg.js';

export const router = express.Router();

// Aviso al cobrador (RN-64): la marca se guarda igual, pero queda señalada para la oficina.
const fueraDeZona = (marcas: { fuera_de_asignacion?: boolean }[]) => {
  const fuera = marcas.filter((marca) => marca.fuera_de_asignacion).length;
  return fuera ? `. ${fuera} en una zona que no tiene asignada: queda registrado` : '';
};

// La marca "zona por regularizar" solo la pone la importación del padrón (migrations/0018); por la API no se escribe.
const sinMarcaDelPadron = (body) => {
  const { zona_por_regularizar: _marca, ...cambios } = body || {};
  return cambios;
};

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
    const puesto = await insertPuesto(db, sinMarcaDelPadron(req.body), { soloZonaDelTitular: req.user?.rol !== 'super_admin' });
    if (puesto.ya_registrado) return res.json({ data: puesto, message: 'El puesto ya estaba registrado' });
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
      ...sinMarcaDelPadron(req.body),
      comerciante_id: req.body.comerciante_id ?? req.body.comercianteId,
      zona_id: req.body.zona_id ?? req.body.zonaId,
      direccion: req.body.direccion || req.body.sector || req.body.codigoPuesto,
      metros_cuadrados: req.body.metros_cuadrados ?? req.body.metros ?? 1,
      estado: req.body.estado // sin estado: ocupado si tiene titular, disponible si no
    }, { soloZonaDelTitular: req.user?.rol !== 'super_admin' });
    // Reenvío de la cola del mapa con la misma clave: el puesto ya existía y no se crea otro.
    if (puesto.ya_registrado) return res.json({ data: puesto, message: 'El puesto ya estaba registrado' });
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
    const puesto = await updatePuesto(db, req.params.id, sinMarcaDelPadron(req.body), req.user?.rol === 'super_admin' ? {} : { puedeCambiarZona: false, soloUbicacion: true });
    return res.json({ data: puesto, message: 'Puesto geolocalizado actualizado correctamente' });
  }
);

router.post('/api/v1/puestos/:id/liberar',
  requireAuth,
  requireRoles(['super_admin']),
  auditMutation({
    db,
    accion: 'LIBERAR_PUESTO',
    entidad: 'puestos',
    getPreviousState: async (req) => rowById('puestos', Number(req.params.id)),
    serializeResponse: (body) => body?.data ?? body
  }),
  async (req, res) => {
    const data = await liberarPuesto(db, req.params.id);
    return res.json({ data, message: data.ya_libre ? 'El puesto ya estaba libre' : 'Puesto liberado: queda disponible para otro comerciante' });
  }
);

router.delete('/api/v1/puestos-mapa/:id',
  requireAuth,
  requireRoles(['super_admin']),
  auditMutation({
    db,
    accion: 'DAR_DE_BAJA_PUESTO_MAPA',
    entidad: 'puestos',
    getPreviousState: async (req) => rowById('puestos', Number(req.params.id)),
    serializeResponse: (body) => body?.data ?? body
  }),
  async (req, res) => {
    const data = await deactivatePuesto(db, req.params.id);
    return res.json({ data, message: data.ya_dado_de_baja ? 'El puesto ya estaba dado de baja' : 'Puesto dado de baja lógicamente' });
  }
);

// Asistencia ferial del día: el ferial paga solo los días que asistió.
router.get('/api/v1/asistencias', ...staffOnly, async (req, res) => {
  const data = await getAsistencias(db, { fecha: req.query.fecha });
  res.json({ data, total: data.puestos.length });
});

// Reporte de observaciones del cobrador (no salió, no vendió, se negó a pagar…) entre dos fechas.
// El cobrador ve solo las que registró él.
router.get('/api/v1/asistencias/observaciones', requireAuth, requireRoles(['super_admin', 'auditor', 'cobrador']), async (req, res) => {
  const data = await getObservacionesCobro(db, {
    desde: req.query.desde || undefined,
    hasta: req.query.hasta || undefined,
    comercianteId: req.query.comerciante_id || undefined,
    cobradorId: req.user?.rol === 'cobrador' ? req.user.id : req.query.cobrador_id || undefined
  });
  res.json({ data, total: data.observaciones.length });
});

// Cobros en otra zona por cobrador (RN-63): control mensual del super_admin; el auditor lo consulta.
// El cobrador no lo ve: es un reporte sobre su propio trabajo.
router.get('/api/v1/asistencias/otra-zona', requireAuth, requireRoles(['super_admin', 'auditor']), async (req, res) => {
  const data = await getCobrosEnOtraZona(db, { desde: req.query.desde || undefined, hasta: req.query.hasta || undefined });
  res.json({ data, total: data.cobradores.length });
});

// Una marca ({ puesto_id, fecha?, asistio, motivo?, observacion? }) o varias ({ marcas: [...] }, p. ej. las guardadas sin señal).
// Reenviar la misma marca no duplica nada.
// Un lote ({ marcas }) responde marca por marca: las inválidas vuelven en `rechazadas` sin frenar a las demás.
// Marcas hechas en una zona que el cobrador no tenía asignada (RN-64): control sobre el trabajo del cobrador.
router.get('/api/v1/asistencias/fuera-de-asignacion', requireAuth, requireRoles(['super_admin', 'auditor']), async (req, res) => {
  return res.json({ data: await getMarcasFueraDeAsignacion(db, { desde: req.query.desde, hasta: req.query.hasta }) });
});

router.post('/api/v1/asistencias', requireAuth, requireRoles(['super_admin', 'cobrador']), async (req, res) => {
  const opciones = { usuarioId: req.user.id, rol: req.user.rol, audit: auditContext(req, 'MARCAR_ASISTENCIA_FERIAL') };
  if (!Array.isArray(req.body?.marcas)) {
    const data = await marcarAsistencias(db, [req.body || {}], opciones);
    return res.status(201).json({ data, message: `${data.length} marca(s) de asistencia guardadas${fueraDeZona(data)}` });
  }
  const { guardadas, rechazadas } = await marcarAsistencias(db, req.body.marcas, { ...opciones, parcial: true });
  return res.status(201).json({
    data: guardadas,
    rechazadas,
    message: `${guardadas.length} marca(s) de asistencia guardadas${fueraDeZona(guardadas)}${rechazadas.length ? `, ${rechazadas.length} rechazada(s): ${rechazadas[0].error}` : ''}`
  });
});
