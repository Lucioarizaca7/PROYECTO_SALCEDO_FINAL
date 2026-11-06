import test from 'node:test';
import assert from 'node:assert/strict';

import { initializeDatabase, getDbStats, getOperationalDashboard, buildReportCsv, getComerciantePreferencias, updateComerciantePreferencias, insertZona, getZonas, insertCalle, getCalles, updateCalle, insertComerciante, getRiskDashboard, todayInLima, indicadoresPanel } from '../src/db.js';

test('initializeDatabase crea las tablas principales del modelo', async () => {
  const db = await initializeDatabase();
  const tables = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY table_name");
  const tableNames = tables.rows.map((row) => row.table_name);

  assert.ok(tableNames.includes('usuarios'));
  assert.ok(tableNames.includes('zonas'));
  assert.ok(tableNames.includes('rubros'));
  assert.ok(tableNames.includes('comerciantes'));
  assert.ok(tableNames.includes('tarifas'));
  assert.ok(tableNames.includes('transacciones'));
  assert.ok(tableNames.includes('auditoria_logs'));
  assert.ok(tableNames.includes('roles'));
  assert.ok(tableNames.includes('colas_sincronizacion'));
  assert.ok(tableNames.includes('modelos_ia_metricas'));
});

test('getDbStats devuelve números básicos del sistema', async () => {
  const db = await initializeDatabase();
  const stats = await getDbStats(db);

  assert.ok(stats.totalUsuarios >= 0);
  assert.ok(stats.totalComerciantes >= 0);
  assert.ok(stats.totalCobros >= 0);
});

test('las preferencias del comerciante se guardan como clave/valor y se reemplazan', async () => {
  const db = await initializeDatabase();
  const merchant = (await db.query('SELECT id FROM comerciantes ORDER BY id LIMIT 1')).rows[0];

  const updated = await updateComerciantePreferencias(db, merchant.id, {
    metodo_pago_preferido: 'yape',
    monto_sugerido: 75.5
  });
  assert.equal(updated.length, 2);

  const stored = await getComerciantePreferencias(db, merchant.id);
  const asMap = Object.fromEntries(stored.map((item) => [item.clave, item.valor]));
  assert.equal(asMap.metodo_pago_preferido, 'yape');
  assert.equal(asMap.monto_sugerido, '75.5');

  await assert.rejects(updateComerciantePreferencias(db, 999999, {}), { name: 'NotFoundError' });
});

test('las zonas y calles se gestionan con validación y conteo', async () => {
  const db = await initializeDatabase();

  const zone = await insertZona(db, {
    nombre: 'Zona Este',
    descripcion: 'Sector este del mercado'
  });

  const calle = await insertCalle(db, {
    zona_id: zone.id,
    nombre: 'Jr. Los Rosales',
    descripcion: 'Calle principal',
    estado: 'activo'
  });

  const zones = await getZonas(db);
  const calles = await getCalles(db, { zona_id: zone.id });

  assert.equal(zones.find((item) => Number(item.id) === Number(zone.id))?.total_calles, 1, 'la pantalla muestra cuántas calles tiene la zona');
  assert.equal(calles[0].nombre, 'Jr. Los Rosales');
  assert.equal(Number(calles[0].zona_id), Number(zone.id));

  const updated = await updateCalle(db, calle.id, {
    nombre: 'Jr. Los Rosales Sur',
    estado: 'activo'
  });

  assert.equal(updated.nombre, 'Jr. Los Rosales Sur');
});

test('getOperationalDashboard produce KPIs reales y buildReportCsv exporta CSV auditables', async () => {
  const db = await initializeDatabase();
  const metrics = await getOperationalDashboard(db, { periodo: '2026-09' });

  assert.equal(typeof metrics.recaudacion, 'number');
  assert.equal(typeof metrics.deudaPendiente, 'number');
  assert.ok(Array.isArray(metrics.porZona));
  assert.ok(Array.isArray(metrics.porRubro));

  const csv = await buildReportCsv(db, { periodo: '2026-09' });
  assert.match(csv, /fecha,comerciante/);
  assert.match(csv, /recaudacion|monto|comprobante/i);
});

test('el riesgo de morosidad se recalcula cada día y no muestra a los dados de baja', async () => {
  const db = await initializeDatabase();
  const rubro = (await db.query("SELECT id FROM rubros ORDER BY id LIMIT 1")).rows[0].id;
  const zona = (await db.query("SELECT id FROM zonas ORDER BY id LIMIT 1")).rows[0].id;
  const vigente = await insertComerciante(db, { dni_ruc: '70990011', nombre: 'Riesgo Vigente', rubro_id: rubro, zona_id: zona, tipo_comerciante: 'permanente', estado: 'activo', usuario_creador: 1 });
  const deBaja = await insertComerciante(db, { dni_ruc: '70990012', nombre: 'Riesgo De Baja', rubro_id: rubro, zona_id: zona, tipo_comerciante: 'permanente', estado: 'activo', usuario_creador: 1 });
  await db.query("UPDATE comerciantes SET estado = 'inactivo' WHERE id = $1", [deBaja.id]);
  // Puntajes viejos: el de hace 3 días ya no vale; el de baja no se muestra aunque sea alto.
  await db.query(`INSERT INTO modelos_ia_metricas (modelo, version, entidad_tipo, entidad_id, periodo, score, nivel, metricas, generado_en)
    VALUES ('riesgo_morosidad', 'heuristico-v1', 'comerciante', $1, '2026-01', 0.99, 'critico', '{"motivo_principal":"puntaje viejo"}', now() - interval '3 days'),
           ('riesgo_morosidad', 'heuristico-v1', 'comerciante', $2, '2026-01', 0.99, 'critico', '{"motivo_principal":"puntaje viejo"}', now() - interval '3 days')`,
  [vigente.id, deBaja.id]);
  await db.query("UPDATE modelos_ia_metricas SET generado_en = now() - interval '3 days' WHERE modelo = 'riesgo_morosidad'");

  const riesgo = await getRiskDashboard(db, { limit: 20 });
  assert.ok(riesgo.records.length > 0);
  assert.ok(riesgo.records.every((item) => item.motivo_principal !== 'puntaje viejo'));
  assert.ok(riesgo.records.every((item) => Number(item.comerciante_id) !== Number(deBaja.id)));
  assert.ok(riesgo.records.every((item) => todayInLima(new Date(item.fecha_calculo)) === todayInLima()));
});

test('la morosidad del panel es la parte de lo devengado en el periodo que sigue impaga', () => {
  assert.equal(indicadoresPanel({ recaudacion: 75, deudaPendiente: 25 }).morosidad, 25);
  assert.equal(indicadoresPanel({ recaudacion: 75, deudaPendiente: 25 }).deudaTotal, 100);
  assert.equal(indicadoresPanel({ recaudacion: 120, deudaPendiente: 0 }).morosidad, 0);
  assert.equal(indicadoresPanel({ recaudacion: 0, deudaPendiente: 0 }).morosidad, 0);
  assert.equal(indicadoresPanel({ recaudacion: 0, deudaPendiente: 3 }).morosidad, 100);
});
