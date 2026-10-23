/**
 * Fase 4 — preparación para producción: cuentas reales sin semilla, revisión de coordenadas y salud.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { startServer } from '../src/index.ts';
import { closeDatabase, createUser, insertPuesto, puestosLejosDelCentro, distanciaKm } from '../src/db.js';
import { loginUser } from '../src/auth.ts';
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

test('Caddy impide mostrar la app dentro de un iframe de otro sitio (clickjacking)', () => {
  const caddyfile = readFileSync(fileURLToPath(new URL('../../../Caddyfile', import.meta.url)), 'utf8');
  assert.match(caddyfile, /X-Frame-Options "DENY"/);
  assert.match(caddyfile, /Content-Security-Policy "[^"]*frame-ancestors 'none'/);
  assert.match(caddyfile, /Content-Security-Policy "[^"]*object-src 'none'/);
});

test('crear-usuario da de alta cobradores y auditores reales, nunca un rol inventado', async () => {
  const email = `cobrador.real.${process.pid}@salcedo.gob.pe`;
  const cobrador = await createUser({ nombre: 'Cobrador Real', email, password: 'clave-larga-123', rol: 'cobrador' });
  assert.equal(cobrador.rol, 'cobrador');
  const sesion = await loginUser({ email, password: 'clave-larga-123' }, pool);
  assert.equal(sesion.user.rol, 'cobrador');

  await assert.rejects(() => createUser({ nombre: 'Otro', email, password: 'clave-larga-123', rol: 'cobrador' }), /Ya existe/);
  await assert.rejects(() => createUser({ nombre: 'X', email: `x.${process.pid}@salcedo.gob.pe`, password: 'clave-larga-123', rol: 'comerciante' }), /rol/);
  await assert.rejects(() => createUser({ nombre: 'X', email: `y.${process.pid}@salcedo.gob.pe`, password: 'corta', rol: 'auditor' }), /10 caracteres/);
});

test('la revisión de coordenadas encuentra los puestos lejos de Salcedo', async () => {
  assert.ok(Math.abs(distanciaKm({ lat: -15.8740, lng: -69.9966 }, { lat: -15.8997, lng: -70.5881 }) - 63.4) < 1, 'S-001 de la semilla está a ~63 km');
  const lejos = await insertPuesto(pool, { zona_id: 1, metros_cuadrados: 1, direccion: 'Puesto mal ubicado', codigo_puesto: `LEJOS-${process.pid}`, latitud: -15.70, longitud: -69.99 });
  const cerca = await insertPuesto(pool, { zona_id: 1, metros_cuadrados: 1, direccion: 'Puesto bien ubicado', codigo_puesto: `CERCA-${process.pid}`, latitud: -15.8745, longitud: -69.9970 });
  const encontrados = await puestosLejosDelCentro(pool, { maxKm: 2 });
  assert.ok(encontrados.some((p) => p.id === Number(lejos.id) && p.distancia_km > 19));
  assert.ok(!encontrados.some((p) => p.id === Number(cerca.id)));
});

test('/health informa la base de datos para el monitoreo', async () => {
  const response = await fetch(`${baseUrl}/api/v1/health`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.base_de_datos, 'ok');
  assert.equal(body.analitica, 'no_configurada');
});
