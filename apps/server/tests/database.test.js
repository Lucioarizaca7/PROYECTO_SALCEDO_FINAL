import test from 'node:test';
import assert from 'node:assert/strict';

import { initializeDatabase, getDbStats, getOperationalDashboard, buildReportCsv, getComerciantePreferencias, updateComerciantePreferencias, insertZona, getZonas, insertCalle, getCalles, updateCalle } from '../src/db.js';

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

  assert.ok(zones.some((item) => Number(item.id) === Number(zone.id)));
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
