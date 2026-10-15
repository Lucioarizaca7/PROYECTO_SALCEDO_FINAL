/**
 * Pruebas de seguridad (node:test): validación de entrada, JWT y control de acceso.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { requireAuth, requireRoles } from '../src/auth.ts';
import { validateLogin } from '../src/validation.ts';

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    setHeader() { return this; }
  };
}

async function runValidators(validators, body) {
  const req = { body, headers: {}, params: {}, query: {} };
  const res = mockRes();
  let nexted = false;
  for (const validator of validators) {
    await new Promise((resolve) => {
      const maybe = validator(req, res, () => { nexted = true; resolve(); });
      if (res.body !== undefined) resolve();
      if (maybe && typeof maybe.then === 'function') maybe.then(() => resolve());
    });
    if (res.body !== undefined) break;
  }
  return { res, nexted };
}

test('el secreto JWT viene del entorno (config.ts) y no está fijo en el código', () => {
  assert.ok(process.env.JWT_SECRET, 'JWT_SECRET debe estar definido en el entorno de pruebas');
  const configSource = readFileSync(new URL('../src/config.ts', import.meta.url), 'utf8');
  const authSource = readFileSync(new URL('../src/auth.ts', import.meta.url), 'utf8');
  assert.match(configSource, /env\.JWT_SECRET/);
  assert.match(authSource, /config\.jwtSecret/);
  assert.doesNotMatch(authSource, /jwtSecret\s*=\s*['"`]/);
});

test('validateLogin rechaza un correo con formato inválido', async () => {
  const { res } = await runValidators(validateLogin, { email: 'no-es-correo', password: 'admin123' });
  assert.equal(res.statusCode, 400);
  assert.ok(res.body.message);
});

test('validateLogin acepta credenciales con formato válido', async () => {
  const { res, nexted } = await runValidators(validateLogin, { email: 'admin@salcedo.gob.pe', password: 'admin123' });
  assert.equal(res.body, undefined);
  assert.equal(nexted, true);
});

test('requireAuth responde 401 sin token', () => {
  const res = mockRes();
  let nexted = false;
  requireAuth({ headers: {} }, res, () => { nexted = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(nexted, false);
});

test('requireRoles responde 403 para un rol sin permiso', () => {
  const res = mockRes();
  let nexted = false;
  requireRoles(['super_admin'])({ user: { rol: 'cobrador' } }, res, () => { nexted = true; });
  assert.equal(res.statusCode, 403);
  assert.equal(nexted, false);
});
