/**
 * El servidor que no respondió bien (revisión del 12/11/2026):
 * - un cobro en línea que recibe un 5xx se guarda en el celular con el mismo hash (antes se perdía con
 *   "Unexpected token" o, al reintentar, se duplicaba con un hash nuevo);
 * - la cola sin señal sigue igual: 502/503/504 es "sin conexión" y un 500 es un error que se reintenta.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { crearTransporteLote, proxySinServidor, servidorNoDisponible } from '../src/services/offlineQueue.js';

test('el cobro en línea trata todo 5xx como servidor no disponible', () => {
  for (const status of [500, 502, 503, 504]) assert.equal(servidorNoDisponible({ status }), true, String(status));
  for (const status of [200, 201, 400, 401, 409]) assert.equal(servidorNoDisponible({ status }), false, String(status));
  assert.equal(proxySinServidor({ status: 500 }), false);
  assert.equal(proxySinServidor({ status: 504 }), true);
});

const respuesta = (status, body) => ({ status, ok: status < 400, json: async () => body });

test('la cola sin señal: 502 es sin conexión, 500 es un error que se reintenta', async () => {
  const conStatus = (status) => crearTransporteLote({ url: '/x', deviceId: 'd', fetchImpl: async () => respuesta(status, { message: 'Error interno del servidor' }) });
  await assert.rejects(conStatus(502)([]), (error) => error.sinConexion === true);
  await assert.rejects(conStatus(500)([]), (error) => !error.sinConexion && /Error interno/.test(error.message));
  const ok = crearTransporteLote({ url: '/x', deviceId: 'd', fetchImpl: async () => respuesta(200, { data: [{ status: 'SUCCESS' }] }) });
  assert.deepEqual(await ok([]), [{ status: 'SUCCESS' }]);
});

test('leerJson: una página del proxy da un mensaje claro y un error con JSON pasa su mensaje', async () => {
  const { leerJson, MENSAJE_SIN_SERVIDOR } = await import('../src/services/session.js');
  const html = { status: 502, json: async () => { throw new SyntaxError("Unexpected token '<'"); } };
  await assert.rejects(leerJson(html), { message: MENSAJE_SIN_SERVIDOR }, 'antes la pantalla decía "Unexpected token"');
  const htmlConOk = { status: 200, json: async () => { throw new SyntaxError("Unexpected token '<'"); } };
  await assert.rejects(leerJson(htmlConOk), { message: MENSAJE_SIN_SERVIDOR });
  await assert.rejects(leerJson({ status: 500, json: async () => ({ message: 'Error interno del servidor' }) }), { message: MENSAJE_SIN_SERVIDOR });
  assert.deepEqual(await leerJson({ status: 200, json: async () => ({ data: [1] }) }), { data: [1] });
  assert.deepEqual(await leerJson({ status: 409, json: async () => ({ message: 'El registro ya existe' }) }), { message: 'El registro ya existe' });
});
