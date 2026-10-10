import test from 'node:test';
import assert from 'node:assert/strict';

import { initializeDatabase, getDbStats, getOperationalDashboard, buildReportCsv, initializeComerciantePreferencias, getComerciantePreferencias, updateComerciantePreferencias, insertZona, getZonas, insertCalle, getCalles, updateCalle } from '../src/db.js';

test('initializeDatabase crea las tablas principales del modelo', async () => {
  const db = await initializeDatabase();
  const tables = db.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  const tableNames = tables[0]?.values.map((row) => row[0]) || [];

  assert.ok(tableNames.includes('usuarios'));
  assert.ok(tableNames.includes('zonas'));
  assert.ok(tableNames.includes('rubros'));
  assert.ok(tableNames.includes('comerciantes'));
  assert.ok(tableNames.includes('tarifas'));
  assert.ok(tableNames.includes('cobros'));
  assert.ok(tableNames.includes('auditoria'));
});

test('getDbStats devuelve números básicos del sistema', async () => {
  const db = await initializeDatabase();
  const stats = getDbStats(db);

  assert.ok(stats.totalUsuarios >= 0);
  assert.ok(stats.totalComerciantes >= 0);
  assert.ok(stats.totalCobros >= 0);
});

test('las preferencias express se inicializan y quedan persistidas por comerciante', async () => {
  const db = await initializeDatabase();
  initializeComerciantePreferencias(db);

  const merchantId = Number(db.exec('SELECT id FROM comerciantes ORDER BY id LIMIT 1')[0].values[0][0]);
  const initial = getComerciantePreferencias(db, merchantId);

  assert.equal(initial.metodo_pago_preferido, 'efectivo');
  assert.equal(typeof initial.monto_sugerido, 'number');

  const updated = updateComerciantePreferencias(db, merchantId, {
    monto_sugerido: 75.5,
    metodo_pago_preferido: 'yape',
    ultimo_monto: 75.5,
    ultimo_metodo_pago: 'yape',
    ultimo_cobro_fecha: '2026-09-15T09:00:00.000Z'
  });

  assert.equal(updated.monto_sugerido, 75.5);
  assert.equal(updated.metodo_pago_preferido, 'yape');

  const stored = getComerciantePreferencias(db, merchantId);
  assert.equal(stored.monto_sugerido, 75.5);
  assert.equal(stored.metodo_pago_preferido, 'yape');
  assert.equal(stored.ultimo_metodo_pago, 'yape');
});

test('las zonas y calles se gestionan con validación y conteo', async () => {
  const db = await initializeDatabase();

  const zone = insertZona(db, {
    nombre: 'Zona Este',
    descripcion: 'Sector este del mercado'
  });

  const calle = insertCalle(db, {
    zona_id: zone.id,
    nombre: 'Jr. Los Rosales',
    descripcion: 'Calle principal',
    estado: 'activo'
  });

  const zones = getZonas(db);
  const calles = getCalles(db, { zona_id: zone.id });

  assert.ok(zones.some((item) => Number(item.id) === Number(zone.id)));
  assert.equal(calles[0].nombre, 'Jr. Los Rosales');
  assert.equal(Number(calles[0].zona_id), Number(zone.id));

  const updated = updateCalle(db, calle.id, {
    nombre: 'Jr. Los Rosales Sur',
    estado: 'activo'
  });

  assert.equal(updated.nombre, 'Jr. Los Rosales Sur');
});

test('getOperationalDashboard produce KPIs reales y buildReportCsv exporta CSV auditables', async () => {
  const db = await initializeDatabase();
  const metrics = getOperationalDashboard(db, { periodo: '2026-09' });

  assert.equal(typeof metrics.recaudacion, 'number');
  assert.equal(typeof metrics.deudaPendiente, 'number');
  assert.ok(Array.isArray(metrics.porZona));
  assert.ok(Array.isArray(metrics.porRubro));

  const csv = buildReportCsv(db, { periodo: '2026-09' });
  assert.match(csv, /fecha,comerciante/);
  assert.match(csv, /recaudacion|monto|comprobante/i);
});
