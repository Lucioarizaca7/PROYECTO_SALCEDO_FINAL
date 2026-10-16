/**
 * Portal del comerciante con PIN (src/portalAcceso.js), contra la API levantada de verdad:
 * sin PIN no se entra, el PIN lo genera el personal y se ve una sola vez, 5 PIN errados bloquean
 * y la respuesta no trae el DNI completo.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../src/index.ts';
import { loginUser } from '../src/auth.ts';
import { closeDatabase, getAuditTrail, getComerciantes } from '../src/db.js';
import { pool } from '../src/pg.js';
import { ocultarDocumento, PIN_MAX_INTENTOS } from '../src/portalAcceso.js';

let server;
let baseUrl;
let merchant;
const tokens = {};

before(async () => {
  server = await startServer(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  for (const [rol, email, password] of [
    ['admin', 'admin@salcedo.gob.pe', 'admin123'],
    ['cobrador', 'cobrador@salcedo.gob.pe', 'cobro123']
  ]) {
    tokens[rol] = (await loginUser({ email, password }, pool)).token;
  }
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

const portalLogin = (identifier, pin) => api('/portal/login', { body: { identifier, pin } });
const newPin = (token = tokens.admin) => api(`/comerciantes/${merchant.id}/portal-pin`, { token });

test('el documento se oculta salvo sus 3 últimos dígitos', () => {
  assert.equal(ocultarDocumento('20123456780'), '********780');
  assert.equal(ocultarDocumento('12'), '12');
});

test('sin PIN generado, el DNI solo no abre el portal', async () => {
  const sinPin = await portalLogin(merchant.dni_ruc, '');
  assert.equal(sinPin.status, 400);

  const conPinInventado = await portalLogin(merchant.dni_ruc, '482913');
  assert.equal(conPinInventado.status, 401);
  assert.doesNotMatch(JSON.stringify(conPinInventado.body), /Comerciante Demo|20123456780/);
});

test('solo el personal autorizado genera el PIN, y la auditoría no lo guarda', async () => {
  assert.equal((await newPin(tokens.cobrador)).status, 403);
  assert.equal((await api(`/comerciantes/${merchant.id}/portal-pin`)).status, 401);

  const { status, body } = await newPin();
  assert.equal(status, 201, body.message);
  assert.match(body.data.pin, /^\d{6}$/);

  const audit = await getAuditTrail(pool, { entidad: 'comerciante_portal_acceso' });
  assert.ok(audit.some((item) => item.accion === 'GENERAR_PIN_PORTAL'), 'la generación del PIN queda auditada');
  // La fila completa, con los estados previo y nuevo que guarda la auditoría.
  const { rows: [entry] } = await pool.query("SELECT * FROM auditoria_logs WHERE accion = 'GENERAR_PIN_PORTAL' ORDER BY id DESC LIMIT 1");
  // payload_nuevo puede venir como texto JSON dentro del JSON: las comillas pueden estar escapadas.
  assert.doesNotMatch(JSON.stringify(entry), /pin\\?"\s*:\s*\\?"\d{6}/, 'el PIN en claro no queda en la auditoría');
  assert.match(JSON.stringify(entry), /pin_generado/);
});

test('con DNI y PIN correctos entra, sin ver el DNI completo', async () => {
  const { body: { data: { pin } } } = await newPin();
  const { status, body } = await portalLogin(merchant.dni_ruc, pin);
  assert.equal(status, 200, body.message);
  assert.equal(body.data.comerciante.nombre, 'Comerciante Demo');
  assert.equal(body.data.comerciante.documento, ocultarDocumento(merchant.dni_ruc));
  assert.equal(typeof body.data.deuda.saldo, 'number');
  assert.ok(body.data.pagos.length <= 24);
  assert.ok(!JSON.stringify(body).includes(merchant.dni_ruc), 'el DNI completo no viaja al portal');

  // El código de comerciante también sirve como identificador.
  assert.equal((await portalLogin(merchant.codigo, pin)).status, 200);
});

test('un DNI desconocido y un PIN errado responden igual', async () => {
  await newPin();
  const desconocido = await portalLogin('99999999', '482913');
  const errado = await portalLogin(merchant.dni_ruc, '000001');
  assert.equal(desconocido.status, 401);
  assert.equal(errado.status, 401);
  assert.equal(desconocido.body.message, errado.body.message);
});

test(`${PIN_MAX_INTENTOS} PIN errados bloquean el acceso aunque luego llegue el correcto; un PIN nuevo lo libera`, async () => {
  const { body: { data: { pin } } } = await newPin();
  const wrong = pin === '000001' ? '000002' : '000001';
  const statuses = [];
  for (let i = 0; i < PIN_MAX_INTENTOS; i += 1) statuses.push((await portalLogin(merchant.dni_ruc, wrong)).status);
  assert.deepEqual(statuses, [...Array(PIN_MAX_INTENTOS - 1).fill(401), 429]);

  const locked = await portalLogin(merchant.dni_ruc, pin);
  assert.equal(locked.status, 429);
  assert.match(locked.body.message, /minutos/);

  const { body: { data: { pin: otro } } } = await newPin();
  assert.equal((await portalLogin(merchant.dni_ruc, pin)).status, pin === otro ? 200 : 401, 'el PIN anterior deja de servir');
  assert.equal((await portalLogin(merchant.dni_ruc, otro)).status, 200);
});
