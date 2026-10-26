import test from 'node:test';
import assert from 'node:assert/strict';

import { loginUser, requireAuth, requirePortalOrStaff, signPortalToken } from '../src/auth.ts';
import {
  authenticatePortal,
  deactivateComerciante,
  getComerciantes,
  getMerchantPortal,
  initializeDatabase,
  insertComerciante,
  issuePortalKeys,
  PORTAL_LOGIN_ERROR,
  PORTAL_MAX_ATTEMPTS
} from '../src/db.js';

let sequence = 0;

async function newMerchant(db, overrides = {}) {
  sequence += 1;
  return insertComerciante(db, {
    dni_ruc: `7${String(process.pid % 1000).padStart(3, '0')}${String(sequence).padStart(4, '0')}`,
    nombre: `Comerciante Carnet ${sequence}`,
    rubro_id: 1,
    zona_id: 1,
    tipo_comerciante: 'ferial',
    ...overrides
  });
}

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

async function runMiddleware(middleware, token) {
  const req = { headers: token ? { authorization: `Bearer ${token}` } : {} };
  const res = mockRes();
  let nexted = false;
  await middleware(req, res, () => { nexted = true; });
  return { req, res, nexted };
}

test('el carnet entrega una llave legible que solo se muestra al emitirla', async () => {
  const db = await initializeDatabase();
  const merchant = await newMerchant(db);
  const [carnet] = await issuePortalKeys(db, [merchant.id]);

  assert.match(carnet.llave, /^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{2}$/);
  assert.equal(carnet.codigo, `CM-${String(merchant.id).padStart(3, '0')}`);

  const stored = (await db.query('SELECT llave_hash FROM comerciantes WHERE id = $1', [merchant.id])).rows[0];
  assert.match(stored.llave_hash, /^[0-9a-f]{64}$/);
  assert.ok(!stored.llave_hash.includes(carnet.llave.replace(/-/g, '')));

  const listed = (await getComerciantes(db, { search: merchant.dni_ruc })).find((item) => item.id === merchant.id);
  assert.equal(listed.tiene_llave, true);
  assert.ok(listed.llave_emitida_en);
  assert.equal('llave_hash' in listed, false);
});

test('se ingresa con DNI, con código CM o con la llave sola, sin importar guiones ni minúsculas', async () => {
  const db = await initializeDatabase();
  const merchant = await newMerchant(db);
  const [carnet] = await issuePortalKeys(db, [merchant.id]);
  const plain = carnet.llave.replace(/-/g, '').toLowerCase();

  assert.equal((await authenticatePortal(db, { identifier: merchant.dni_ruc, llave: carnet.llave })).id, merchant.id);
  assert.equal((await authenticatePortal(db, { identifier: `cm-${String(merchant.id).padStart(3, '0')}`, llave: plain })).id, merchant.id);
  assert.equal((await authenticatePortal(db, { llave: ` ${carnet.llave} ` })).id, merchant.id);

  const portal = await getMerchantPortal(db, merchant.id);
  assert.equal(portal.comerciante.nombre, merchant.nombre);
  assert.equal(typeof portal.deuda.saldo, 'number');
});

test('sin carnet o con otra llave el error es el mismo y no revela si el comerciante existe', async () => {
  const db = await initializeDatabase();
  const withoutCard = await newMerchant(db);
  const other = await newMerchant(db);
  const [otherCard] = await issuePortalKeys(db, [other.id]);

  await assert.rejects(authenticatePortal(db, { identifier: withoutCard.dni_ruc, llave: otherCard.llave }), { message: PORTAL_LOGIN_ERROR });
  await assert.rejects(authenticatePortal(db, { identifier: '00000000', llave: otherCard.llave }), { message: PORTAL_LOGIN_ERROR });
  await assert.rejects(authenticatePortal(db, { identifier: other.dni_ruc, llave: 'corta' }), { message: PORTAL_LOGIN_ERROR });
});

test(`tras ${PORTAL_MAX_ATTEMPTS} llaves erradas se bloquea aunque luego acierte`, async () => {
  const db = await initializeDatabase();
  const merchant = await newMerchant(db);
  const [carnet] = await issuePortalKeys(db, [merchant.id]);

  for (let attempt = 0; attempt < PORTAL_MAX_ATTEMPTS; attempt += 1) {
    await assert.rejects(authenticatePortal(db, { identifier: merchant.dni_ruc, llave: 'ZZZZ-ZZZZ-ZZ' }), { message: PORTAL_LOGIN_ERROR });
  }
  await assert.rejects(authenticatePortal(db, { identifier: merchant.dni_ruc, llave: carnet.llave }), /Demasiados intentos/);
  await assert.rejects(authenticatePortal(db, { llave: carnet.llave }), { message: PORTAL_LOGIN_ERROR });

  // Un carnet nuevo en caja levanta el bloqueo.
  const [replacement] = await issuePortalKeys(db, [merchant.id]);
  assert.equal((await authenticatePortal(db, { identifier: merchant.dni_ruc, llave: replacement.llave })).id, merchant.id);
});

test('emitir otro carnet anula la llave y la sesión anteriores', async () => {
  const db = await initializeDatabase();
  const merchant = await newMerchant(db);
  const [first] = await issuePortalKeys(db, [merchant.id]);
  const session = await authenticatePortal(db, { identifier: merchant.dni_ruc, llave: first.llave });
  const token = signPortalToken(session);

  const before = await runMiddleware(requirePortalOrStaff(db), token);
  assert.equal(before.nexted, true);
  assert.deepEqual(before.req.portal, { comercianteId: merchant.id });

  const [second] = await issuePortalKeys(db, [merchant.id]);
  assert.notEqual(second.llave, first.llave);
  await assert.rejects(authenticatePortal(db, { identifier: merchant.dni_ruc, llave: first.llave }), { message: PORTAL_LOGIN_ERROR });

  const after = await runMiddleware(requirePortalOrStaff(() => db), token);
  assert.equal(after.nexted, false);
  assert.equal(after.res.statusCode, 401);
});

test('la baja anula el carnet y no se emite carnet a un dado de baja', async () => {
  const db = await initializeDatabase();
  const merchant = await newMerchant(db);
  const [carnet] = await issuePortalKeys(db, [merchant.id]);
  const token = signPortalToken(await authenticatePortal(db, { llave: carnet.llave }));

  await deactivateComerciante(db, merchant.id);
  await assert.rejects(authenticatePortal(db, { llave: carnet.llave }), { message: PORTAL_LOGIN_ERROR });
  assert.equal((await runMiddleware(requirePortalOrStaff(db), token)).res.statusCode, 401);
  await assert.rejects(issuePortalKeys(db, [merchant.id]), /dados de baja/);
});

test('la sesión del portal no abre las rutas del personal y el personal sí pasa', async () => {
  const db = await initializeDatabase();
  const merchant = await newMerchant(db);
  const [carnet] = await issuePortalKeys(db, [merchant.id]);
  const portalToken = signPortalToken(await authenticatePortal(db, { llave: carnet.llave }));

  const blocked = await runMiddleware(requireAuth, portalToken);
  assert.equal(blocked.nexted, false);
  assert.equal(blocked.res.statusCode, 403);

  const staffToken = (await loginUser({ email: 'cobrador@salcedo.gob.pe', password: 'cobro123' }, db)).token;
  const staff = await runMiddleware(requirePortalOrStaff(db), staffToken);
  assert.equal(staff.nexted, true);
  assert.equal(staff.req.user.rol, 'cobrador');
  assert.equal(staff.req.portal, undefined);

  assert.equal((await runMiddleware(requirePortalOrStaff(db), null)).res.statusCode, 401);
});

test('un pendiente de regularización entra con su código CM y no ve su documento temporal', async () => {
  const db = await initializeDatabase();
  const merchant = await newMerchant(db);
  await db.query("UPDATE comerciantes SET dni_ruc = $2, estado = 'pendiente' WHERE id = $1", [merchant.id, `TEMP_DNI_${process.pid}${sequence}`]);
  const [carnet] = await issuePortalKeys(db, [merchant.id]);

  const session = await authenticatePortal(db, { identifier: `CM-${String(merchant.id).padStart(3, '0')}`, llave: carnet.llave });
  const portal = await getMerchantPortal(db, session.id);
  assert.equal(portal.comerciante.dni_ruc, null);
  assert.equal(portal.comerciante.estado, 'pendiente');
});

test('la emisión en lote entrega una llave distinta por comerciante', async () => {
  const db = await initializeDatabase();
  const a = await newMerchant(db);
  const b = await newMerchant(db);
  const issued = await issuePortalKeys(db, [a.id, b.id, a.id]);

  assert.equal(issued.length, 2);
  assert.notEqual(issued[0].llave, issued[1].llave);
  assert.equal((await authenticatePortal(db, { llave: issued[1].llave })).id, b.id);
  await assert.rejects(issuePortalKeys(db, []), /al menos un comerciante/);
  await assert.rejects(issuePortalKeys(db, [a.id, 999999999]), /no encontrado/);
});
