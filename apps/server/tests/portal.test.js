/**
 * Portal del comerciante (src/portalAcceso.js), contra la API levantada de verdad: el PIN ya no existe
 * (migrations/0017_portal_solo_llave.sql), solo la llave del carnet abre el portal y la respuesta no trae el
 * DNI completo. Las reglas de la llave (bloqueo, lote, baja) están en portal-llave.test.js.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../src/index.ts';
import { loginUser } from '../src/auth.ts';
import { closeDatabase, getComerciantes } from '../src/db.js';
import { pool } from '../src/pg.js';
import { ocultarDocumento } from '../src/portalAcceso.js';

let server;
let baseUrl;
let merchant;
let adminToken;

before(async () => {
  server = await startServer(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  adminToken = (await loginUser({ email: 'admin@salcedo.gob.pe', password: 'admin123' }, pool)).token;
  [merchant] = await getComerciantes(pool, { search: 'Comerciante Demo', limit: 1 });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closeDatabase();
});

async function api(path, { method = 'POST', token, body } = {}) {
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

test('el documento se oculta salvo sus 3 últimos dígitos', () => {
  assert.equal(ocultarDocumento('20123456780'), '********780');
  assert.equal(ocultarDocumento('12'), '12');
});

test('el PIN ya no existe: no se genera ni abre el portal', async () => {
  assert.equal((await api(`/comerciantes/${merchant.id}/portal-pin`, { token: adminToken })).status, 404);
  const conPin = await api('/portal/login', { body: { identifier: merchant.dni_ruc, pin: '482913' } });
  assert.equal(conPin.status, 400);
  assert.match(conPin.body.message, /llave/);

  const { rows } = await pool.query(`
    SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'comerciante_portal_acceso' AND column_name = 'pin_hash'`);
  assert.equal(rows.length, 0, 'la columna del PIN se quitó en la 0017');
});

test('con DNI o código y la llave entra, sin ver el DNI completo', async () => {
  const { body: emision } = await api(`/comerciantes/${merchant.id}/carnet`, { token: adminToken });
  const llave = emision.data[0].llave;

  const { status, body } = await api('/portal/login', { body: { identifier: merchant.dni_ruc, llave } });
  assert.equal(status, 200, body.message);
  assert.equal(body.data.comerciante.nombre, 'Comerciante Demo');
  assert.equal(body.data.comerciante.documento, ocultarDocumento(merchant.dni_ruc));
  assert.equal(typeof body.data.deuda.saldo, 'number');
  assert.ok(body.data.pagos.length <= 24);
  assert.ok(!JSON.stringify(body).includes(merchant.dni_ruc), 'el DNI completo no viaja al portal');

  assert.equal((await api('/portal/login', { body: { identifier: merchant.codigo, llave } })).status, 200);
});
