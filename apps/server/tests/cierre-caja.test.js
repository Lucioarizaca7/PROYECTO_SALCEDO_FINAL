/**
 * Cierre de caja diario por cobrador (migrations/0012_cierre_caja.sql), contra la API levantada.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../src/index.ts';
import { closeDatabase, calcularLiquidacion, getComerciantes } from '../src/db.js';
import { pool } from '../src/pg.js';

let server;
let baseUrl;

before(async () => {
  server = await startServer(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closeDatabase();
});

async function api(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function login(email, password) {
  const { status, body } = await api('/auth/login', { method: 'POST', body: { email, password, device_id: `caja-${email}` } });
  assert.equal(status, 200, body?.message);
  return { token: body.token, id: Number(body.user?.id) };
}

async function merchantWithBalance(periodo, minimo) {
  for (const merchant of await getComerciantes(pool, { limit: 100 })) {
    const liquidation = await calcularLiquidacion(pool, merchant.id, periodo).catch(() => null);
    if (liquidation && !liquidation.no_devengo && !liquidation.cobro_diario && liquidation.saldo >= minimo) return merchant;
  }
  throw new Error(`La semilla no tiene un comerciante con saldo en ${periodo}`);
}

test('el cobrador cierra su caja: lo esperado lo calcula el servidor y se ve la diferencia', async () => {
  const cobrador = await login('cobrador@salcedo.gob.pe', 'cobro123');
  const admin = await login('admin@salcedo.gob.pe', 'admin123');
  const dia = '2026-01-15';
  const periodo = dia.slice(0, 7);
  const merchant = await merchantWithBalance(periodo, 8);
  const cobrar = (monto, metodo_pago, extra = {}) => api('/cobros', {
    method: 'POST', token: cobrador.token,
    body: { comerciante_id: merchant.id, monto, metodo_pago, periodo, fecha_cobro: `${dia}T15:00:00Z`, ...extra }
  });
  assert.equal((await cobrar(3, 'efectivo')).status, 201);
  assert.equal((await cobrar(2, 'efectivo')).status, 201);
  assert.equal((await cobrar(1.5, 'yape', { codigo_operacion: `YP-CAJA-${process.pid}` })).status, 201);

  const resumen = await api(`/caja/resumen?fecha=${dia}`, { token: cobrador.token });
  assert.equal(resumen.status, 200, resumen.body?.message);
  assert.deepEqual(resumen.body.data.esperado, { efectivo: 5, yape: 1.5, plin: 0, pos: 0 });
  assert.equal(resumen.body.data.cobros, 3);
  assert.equal(resumen.body.data.cierre, null);

  // Faltan S/ 1 en efectivo.
  const cierre = await api('/caja/cierre', {
    method: 'POST', token: cobrador.token,
    body: { fecha: dia, declarado: { efectivo: 4, yape: 1.5 }, esperado: { efectivo: 999 } }
  });
  assert.equal(cierre.status, 201, cierre.body?.message);
  assert.equal(cierre.body.data.esperado_efectivo, 5, 'lo esperado no lo decide el celular');
  assert.equal(cierre.body.data.diferencia, -1);
  assert.match(cierre.body.message, /faltan S\/ 1\.00/);

  const otraVez = await api('/caja/cierre', { method: 'POST', token: cobrador.token, body: { fecha: dia, declarado: { efectivo: 5 } } });
  assert.equal(otraVez.status, 409);

  // Un cobro sincronizado después del cierre aparece aparte.
  assert.equal((await cobrar(1, 'efectivo')).status, 201);
  const despues = await api(`/caja/resumen?fecha=${dia}`, { token: cobrador.token });
  assert.deepEqual(despues.body.data.posteriores_al_cierre, { cobros: 1, monto: 1 });

  assert.equal((await api(`/caja/resumen?fecha=${dia}&cobrador_id=${admin.id}`, { token: cobrador.token })).status, 403, 'no ve la caja de otro');
  assert.equal((await api('/caja/cierres', { token: cobrador.token })).status, 403);
  const delAdmin = await api(`/caja/resumen?fecha=${dia}&cobrador_id=${cobrador.id}`, { token: admin.token });
  assert.equal(delAdmin.body.data.cierre.diferencia, -1);
  const cierres = await api(`/caja/cierres?desde=${dia}&hasta=${dia}`, { token: admin.token });
  assert.equal(cierres.body.data.length, 1);
  assert.equal(cierres.body.data[0].cobrador_id, cobrador.id);
});

test('el cierre valida montos y fechas', async () => {
  const cobrador = await login('cobrador@salcedo.gob.pe', 'cobro123');
  assert.equal((await api('/caja/cierre', { method: 'POST', token: cobrador.token, body: { fecha: '2999-01-01' } })).status, 400);
  assert.equal((await api('/caja/cierre', { method: 'POST', token: cobrador.token, body: { fecha: '2026-01-16', declarado: { efectivo: -5 } } })).status, 400);
});
