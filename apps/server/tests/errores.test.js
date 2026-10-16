/**
 * Respuestas de error de la API: el código HTTP corresponde a la causa (400 dato inválido,
 * 404 no existe, 409 conflicto) y nunca se envía al usuario un mensaje técnico de PostgreSQL.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../src/index.ts';
import { loginUser } from '../src/auth.ts';
import { closeDatabase } from '../src/db.js';
import { pool } from '../src/pg.js';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../src/errors.js';

let server;
let baseUrl;
let token;

before(async () => {
  server = await startServer(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  token = (await loginUser({ email: 'admin@salcedo.gob.pe', password: 'admin123' }, pool)).token;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closeDatabase();
});

const api = (path, { method = 'GET', body, raw } = {}) => fetch(`${baseUrl}${path}`, {
  method,
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: raw ?? (body === undefined ? undefined : JSON.stringify(body))
});

test('cada error de negocio lleva su código HTTP', () => {
  assert.equal(new ValidationError('x').status, 400);
  assert.equal(new NotFoundError('x').status, 404);
  assert.equal(new ConflictError('x').status, 409);
  assert.ok(new NotFoundError('x') instanceof AppError);
  assert.equal(new NotFoundError('x').name, 'NotFoundError');
});

test('un recurso que no existe responde 404', async () => {
  const response = await api('/api/v1/zonas/999999', { method: 'PUT', body: { nombre: 'Zona fantasma' } });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).message, 'Zona no encontrada');
});

test('un nombre repetido responde 409', async () => {
  const nombre = `Zona errores ${Date.now()}`;
  assert.equal((await api('/api/v1/zonas', { method: 'POST', body: { nombre } })).status, 201);
  const repetida = await api('/api/v1/zonas', { method: 'POST', body: { nombre } });
  assert.equal(repetida.status, 409);
  assert.equal((await repetida.json()).message, 'Ya existe una zona con ese nombre');
});

test('borrar una zona en uso responde 409 con un mensaje claro', async () => {
  const response = await api('/api/v1/zonas/1', { method: 'DELETE' });
  assert.equal(response.status, 409);
  assert.match((await response.json()).message, /No se puede eliminar la zona/);
});

test('datos incompletos responden 400 en español', async () => {
  const response = await api('/api/v1/puestos-mapa', { method: 'POST', body: {} });
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /obligatorio|válid/i);
});

test('un error de PostgreSQL no revela su detalle técnico', async () => {
  const response = await api('/api/v1/zonas/abc', { method: 'PUT', body: { nombre: 'Zona abc' } });
  assert.ok(response.status === 400 || response.status === 404, `estado ${response.status}`);
  const { message } = await response.json();
  assert.doesNotMatch(message, /syntax|sintaxis|integer|relation|column|violates/i);
});

test('un JSON mal formado responde 400 sin el mensaje interno de Express', async () => {
  const response = await api('/api/v1/zonas', { method: 'POST', raw: '{"nombre":' });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).message, 'Petición inválida');
});
