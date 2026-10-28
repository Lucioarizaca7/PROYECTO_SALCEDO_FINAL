/**
 * Carnet con llave del portal (migrations/0016_llave_portal.sql, src/portalAcceso.js), contra la API
 * levantada de verdad: solo super_admin emite, la llave se ve una sola vez, es la única credencial (0017), se
 * entra con DNI/código + llave o con la llave sola, 5 errores bloquean y la baja anula el carnet.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../src/index.ts';
import { loginUser } from '../src/auth.ts';
import { closeDatabase, deactivateComerciante, getComerciantes, insertComerciante } from '../src/db.js';
import { pool } from '../src/pg.js';
import { LLAVE_ALFABETO, LLAVE_LARGO, MAX_CARNETS_POR_LOTE, MAX_INTENTOS_PORTAL } from '../src/portalAcceso.js';

let server;
let baseUrl;
const tokens = {};
let documento = 71000000 + (process.pid % 900000);

before(async () => {
  server = await startServer(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  for (const [rol, email, password] of [
    ['admin', 'admin@salcedo.gob.pe', 'admin123'],
    ['cobrador', 'cobrador@salcedo.gob.pe', 'cobro123'],
    ['auditor', 'auditor@salcedo.gob.pe', 'audit123']
  ]) {
    tokens[rol] = (await loginUser({ email, password }, pool)).token;
  }
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

// Cada prueba usa su propio comerciante: las pruebas del archivo corren a la vez.
async function nuevoComerciante(extra = {}, opciones = {}) {
  documento += 1;
  return insertComerciante(pool, {
    // El nombre no lleva el DNI: las pruebas buscan que el DNI completo no salga en el portal.
    dni_ruc: String(documento), nombre: `Titular carnet ${(documento % 1000).toString(36)}`, rubro_id: 1, zona_id: 1,
    tipo_comerciante: 'permanente', estado: 'activo', usuario_creador: 1, ...extra
  }, opciones);
}

const emitir = (id, token = tokens.admin) => api(`/comerciantes/${id}/carnet`, { token });
const ingresar = (body) => api('/portal/login', { body });
const llaveDe = async (id) => (await emitir(id)).body.data[0].llave;
const LLAVE_RE = new RegExp(`^[${LLAVE_ALFABETO}]{4}-[${LLAVE_ALFABETO}]{4}-[${LLAVE_ALFABETO}]{${LLAVE_LARGO - 8}}$`);

test('el carnet entrega una llave legible que solo se ve al emitirla', async () => {
  const comerciante = await nuevoComerciante();
  const { status, body } = await emitir(comerciante.id);
  assert.equal(status, 201, body.message);
  assert.match(body.data[0].llave, LLAVE_RE);

  const { rows: [acceso] } = await pool.query('SELECT llave_hash FROM comerciante_portal_acceso WHERE comerciante_id = $1', [comerciante.id]);
  assert.match(acceso.llave_hash, /^[0-9a-f]{64}$/, 'en la base queda solo la huella');

  const { rows: [entry] } = await pool.query("SELECT * FROM auditoria_logs WHERE accion = 'EMITIR_CARNET' ORDER BY id DESC LIMIT 1");
  assert.ok(!JSON.stringify(entry).includes(body.data[0].llave), 'la llave en claro no queda en la auditoría');
  assert.ok(!JSON.stringify(entry).includes(body.data[0].llave.replace(/-/g, '')));

  const [listado] = await getComerciantes(pool, { search: comerciante.dni_ruc, limit: 1 });
  assert.match(listado.carnet_emitido_en, /^\d{4}-\d{2}-\d{2}$/, 'el padrón muestra la fecha del carnet');
  assert.ok(!JSON.stringify(listado).includes(acceso.llave_hash), 'el padrón no trae la huella');
});

test('se entra con DNI, con código o con la llave sola, sin importar guiones ni minúsculas', async () => {
  const comerciante = await nuevoComerciante();
  const llave = await llaveDe(comerciante.id);

  const conDni = await ingresar({ identifier: comerciante.dni_ruc, llave });
  assert.equal(conDni.status, 200, conDni.body.message);
  assert.equal(conDni.body.data.comerciante.nombre, comerciante.nombre);
  assert.ok(!JSON.stringify(conDni.body).includes(comerciante.dni_ruc), 'el DNI completo no viaja al portal');

  assert.equal((await ingresar({ identifier: comerciante.codigo, llave })).status, 200);
  assert.equal((await ingresar({ llave: llave.replace(/-/g, '').toLowerCase() })).status, 200, 'QR del reverso: la llave sola');
});

test('sin carnet o con otra llave el error es el mismo y no revela si el comerciante existe', async () => {
  const comerciante = await nuevoComerciante();
  const otro = await nuevoComerciante();
  const llaveAjena = await llaveDe(otro.id);

  const sinCarnet = await ingresar({ identifier: comerciante.dni_ruc, llave: llaveAjena });
  const desconocido = await ingresar({ identifier: '99999998', llave: llaveAjena });
  const llaveInventada = await ingresar({ llave: 'ZZZZ-ZZZZ-ZZ' });
  for (const respuesta of [sinCarnet, desconocido, llaveInventada]) assert.equal(respuesta.status, 401);
  assert.equal(sinCarnet.body.message, desconocido.body.message);
  assert.equal(desconocido.body.message, llaveInventada.body.message);
  assert.doesNotMatch(JSON.stringify(sinCarnet.body), new RegExp(comerciante.nombre));

  assert.equal((await ingresar({ identifier: comerciante.dni_ruc })).status, 400, 'sin llave no se consulta');
});

test(`tras ${MAX_INTENTOS_PORTAL} llaves erradas se bloquea aunque luego acierte`, async () => {
  const comerciante = await nuevoComerciante();
  const llave = await llaveDe(comerciante.id);
  const errada = llave.startsWith('2') ? '3333-3333-33' : '2222-2222-22';

  const estados = [];
  for (let i = 0; i < MAX_INTENTOS_PORTAL; i += 1) estados.push((await ingresar({ identifier: comerciante.dni_ruc, llave: errada })).status);
  assert.deepEqual(estados, [...Array(MAX_INTENTOS_PORTAL - 1).fill(401), 429]);
  assert.equal((await ingresar({ identifier: comerciante.dni_ruc, llave })).status, 429);
  assert.equal((await ingresar({ llave })).status, 429, 'la llave sola tampoco entra mientras dure el bloqueo');
});

test('un carnet nuevo anula la llave anterior', async () => {
  const comerciante = await nuevoComerciante();
  const primera = await llaveDe(comerciante.id);
  const segunda = await llaveDe(comerciante.id);
  assert.notEqual(primera, segunda);

  assert.equal((await ingresar({ identifier: comerciante.dni_ruc, llave: primera })).status, 401, 'la llave anterior deja de servir');
  assert.equal((await ingresar({ identifier: comerciante.dni_ruc, llave: segunda })).status, 200);
});

test('la baja anula el carnet y no se emite carnet a un dado de baja', async () => {
  const comerciante = await nuevoComerciante();
  const llave = await llaveDe(comerciante.id);
  await deactivateComerciante(pool, comerciante.id);

  assert.equal((await ingresar({ llave })).status, 401);
  const { rows } = await pool.query('SELECT 1 FROM comerciante_portal_acceso WHERE comerciante_id = $1', [comerciante.id]);
  assert.equal(rows.length, 0, 'una reactivación no revive las credenciales viejas');

  const intento = await emitir(comerciante.id);
  assert.equal(intento.status, 400);
  assert.match(intento.body.message, /dado de baja/);
});

test('la emisión en lote entrega una llave distinta por comerciante', async () => {
  const ids = [];
  for (let i = 0; i < 3; i += 1) ids.push((await nuevoComerciante()).id);
  const { status, body } = await api('/comerciantes/carnets', { token: tokens.admin, body: { ids } });
  assert.equal(status, 201, body.message);
  assert.equal(body.data.length, 3);
  assert.equal(new Set(body.data.map((item) => item.llave)).size, 3);
  for (const item of body.data) assert.equal((await ingresar({ llave: item.llave })).status, 200);

  const demasiados = Array.from({ length: MAX_CARNETS_POR_LOTE + 1 }, (_, i) => i + 1);
  assert.equal((await api('/comerciantes/carnets', { token: tokens.admin, body: { ids: demasiados } })).status, 400);
});

test('un pendiente de regularización entra con su código y no ve su documento temporal', async () => {
  const pendiente = await nuevoComerciante({ dni_ruc: `TEMP_DNI_${String(documento).padStart(12, 'A').slice(-12)}` }, { documentoTemporal: true });
  const llave = await llaveDe(pendiente.id);
  const { status, body } = await ingresar({ identifier: pendiente.codigo, llave });
  assert.equal(status, 200, body.message);
  assert.equal(body.data.comerciante.documento, null);
  assert.ok(!JSON.stringify(body).includes('TEMP_DNI'));
});

test('solo super_admin emite carnets: cobrador y auditor reciben 403', async () => {
  const comerciante = await nuevoComerciante();
  for (const rol of ['cobrador', 'auditor']) {
    assert.equal((await emitir(comerciante.id, tokens[rol])).status, 403, rol);
    assert.equal((await api('/comerciantes/carnets', { token: tokens[rol], body: { ids: [comerciante.id] } })).status, 403, rol);
  }
  assert.equal((await api(`/comerciantes/${comerciante.id}/carnet`)).status, 401);
});
