/**
 * Pruebas de la API levantada de verdad (puerto libre, esquema de prueba propio):
 * ninguna ruta GET queda abierta, el cobro toma el cobrador del token y se audita
 * en la misma transacción, y los periodos se cuentan con la hora de Lima.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { app, startServer } from '../src/index.ts';
import { loginUser } from '../src/auth.ts';
import { closeDatabase, currentPeriod, findUserByEmail, getAuditTrail, getComerciantes, getReportRows, insertCobro } from '../src/db.js';
import { pool } from '../src/pg.js';

// Únicas rutas GET que se pueden consultar sin iniciar sesión.
const PUBLIC_GET = new Set(['/api/v1/health', '/api/v1/publico/resumen']);

let server;
let baseUrl;
const tokens = {};

before(async () => {
  server = await startServer(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  for (const [rol, email, password] of [
    ['cobrador', 'cobrador@salcedo.gob.pe', 'cobro123'],
    ['admin', 'admin@salcedo.gob.pe', 'admin123'],
    ['comerciante', 'comerciante@salcedo.gob.pe', 'comercio123']
  ]) {
    tokens[rol] = (await loginUser({ email, password }, pool)).token;
  }
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closeDatabase();
});

function registeredGetRoutes() {
  return app.router.stack
    .filter((layer) => layer.route?.methods?.get)
    .map((layer) => layer.route.path)
    .filter((path) => typeof path === 'string');
}

const concrete = (path) => path.replace(/:[A-Za-z_]+/g, '1');

test('toda ruta GET de la API exige token, salvo las públicas declaradas', async () => {
  const routes = registeredGetRoutes();
  assert.ok(routes.length > 15, `se esperaban más rutas GET, hay ${routes.length}`);

  const open = [];
  for (const path of routes) {
    if (PUBLIC_GET.has(path)) continue;
    const response = await fetch(`${baseUrl}${concrete(path)}`);
    if (response.status !== 401) open.push(`${path} → ${response.status}`);
  }
  assert.deepEqual(open, [], `Rutas GET accesibles sin token:\n${open.join('\n')}`);
});

test('las rutas con datos personales rechazan al rol comerciante', async () => {
  for (const path of ['/api/v1/comerciantes', '/api/v1/cobros', '/api/v1/reportes', '/api/v1/dashboard']) {
    const response = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${tokens.comerciante}` } });
    assert.equal(response.status, 403, path);
  }
});

test('el resumen público solo entrega cifras agregadas', async () => {
  const response = await fetch(`${baseUrl}/api/v1/publico/resumen`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(typeof body.stats.recaudacion, 'number');
  assert.deepEqual(body.operational.porCobrador, []);
  assert.doesNotMatch(JSON.stringify(body), /dni|dni_ruc|email|cobrador@/i);
});

test('una ruta inexistente de la API responde 404 en JSON', async () => {
  const response = await fetch(`${baseUrl}/api/v1/no-existe`, { headers: { Authorization: `Bearer ${tokens.admin}` } });
  assert.equal(response.status, 404);
  assert.ok((await response.json()).message);
});

test('POST /cobros usa el cobrador del token, rechaza "manual" y audita en la misma transacción', async () => {
  const cobrador = await findUserByEmail(pool, 'cobrador@salcedo.gob.pe');
  const admin = await findUserByEmail(pool, 'admin@salcedo.gob.pe');
  const [merchant] = await getComerciantes(pool, { search: 'Comerciante Demo', limit: 1 });
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.cobrador}` };

  const manual = await fetch(`${baseUrl}/api/v1/cobros`, {
    method: 'POST', headers, body: JSON.stringify({ comerciante_id: merchant.id, monto: 1, metodo_pago: 'manual' })
  });
  assert.equal(manual.status, 400);

  const response = await fetch(`${baseUrl}/api/v1/cobros`, {
    method: 'POST',
    headers,
    // El navegador intenta registrar el cobro a nombre del administrador.
    body: JSON.stringify({ comerciante_id: merchant.id, cobrador_id: admin.id, monto: 1, metodo_pago: 'efectivo' })
  });
  const body = await response.json();
  assert.equal(response.status, 201, body.message);
  assert.equal(body.data.cobrador_id, Number(cobrador.id));

  const audit = await getAuditTrail(pool, { entidad: 'cobros' });
  const entry = audit.find((item) => item.accion === 'REGISTRAR_COBRO' && item.detalle.includes(body.data.comprobante));
  assert.ok(entry, 'el cobro debe quedar en la auditoría');
  assert.equal(Number(entry.usuario_id), Number(cobrador.id));
});

test('un cobro fallido no deja comprobante ni auditoría a medias', async () => {
  const cobrador = await findUserByEmail(pool, 'cobrador@salcedo.gob.pe');
  const [merchant] = await getComerciantes(pool, { search: 'Comerciante Demo', limit: 1 });
  const count = async (table) => Number((await pool.query(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n);
  const before = { comprobantes: await count('comprobantes'), auditoria: await count('auditoria_logs') };

  await assert.rejects(
    insertCobro(pool, { comerciante_id: merchant.id, cobrador_id: cobrador.id, monto: 999999, metodo_pago: 'efectivo' },
      { audit: { accion: 'REGISTRAR_COBRO' } }),
    /excede el saldo/
  );
  assert.equal(await count('comprobantes'), before.comprobantes);
  assert.equal(await count('auditoria_logs'), before.auditoria);
});

test('un cobro de las 19:30 del 31 de octubre en Salcedo cuenta para octubre', async () => {
  // 2026-10-31 19:30 en Lima = 2026-11-01 00:30 UTC
  const fechaCobro = '2026-11-01T00:30:00.000Z';
  assert.equal(currentPeriod(new Date(fechaCobro)), '2026-10');

  const cobrador = await findUserByEmail(pool, 'cobrador@salcedo.gob.pe');
  const [merchant] = await getComerciantes(pool, { search: 'Comerciante Demo', limit: 1 });
  const cobro = await insertCobro(pool, {
    comerciante_id: merchant.id, cobrador_id: cobrador.id, monto: 2, metodo_pago: 'efectivo',
    periodo: '2026-10', fecha_cobro: fechaCobro, codigo_operacion: `TZ-${Date.now()}`
  });

  const octubre = await getReportRows(pool, { periodo: '2026-10' });
  const noviembre = await getReportRows(pool, { periodo: '2026-11' });
  assert.ok(octubre.some((row) => row.id === cobro.id), 'debe aparecer en el reporte de octubre');
  assert.ok(!noviembre.some((row) => row.id === cobro.id), 'no debe aparecer en el reporte de noviembre');
  assert.equal(octubre.find((row) => row.id === cobro.id).fecha, '2026-10-31 19:30:00');
});
