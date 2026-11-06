/**
 * Cola de cambios del mapa hechos sin señal (src/services/colaMapa.js) con un almacén en memoria y un
 * servidor simulado: un rechazo no traba la cola, queda guardado y no se reenvía solo.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { describirCambioMapa, esRechazoPermanente, subirCambiosMapa } from '../src/services/colaMapa.js';

const respuesta = (status, body = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function cola(pendientes) {
  const data = new Map(pendientes.map((cambio) => [cambio.id, { ...cambio }]));
  return {
    data,
    pendientes: () => [...data.values()],
    quitar: async (cambio) => { data.delete(cambio.id); },
    marcarRechazado: async (cambio, mensaje, status) => { data.set(cambio.id, { ...cambio, rechazado: true, mensaje, status }); }
  };
}

const tres = () => [
  { id: 1, operation: 'update', payload: { id: 10, latitud: -15.88 } },
  { id: 2, operation: 'update', payload: { id: 11, zona_id: 3 } },
  { id: 3, operation: 'delete', payload: { id: 12 } }
];

test('un cambio rechazado en medio no traba la cola: los otros suben y él queda marcado', async () => {
  const almacen = cola(tres());
  const enviados = [];
  const resumen = await subirCambiosMapa({
    pendientes: almacen.pendientes(),
    enviar: async (cambio) => {
      enviados.push(cambio.id);
      return cambio.id === 2 ? respuesta(403, { message: 'Solo el super administrador puede cambiar la zona de un puesto' }) : respuesta(200);
    },
    quitar: almacen.quitar,
    marcarRechazado: almacen.marcarRechazado
  });

  assert.deepEqual(enviados, [1, 2, 3], 'en orden y sin detenerse en el rechazo');
  assert.deepEqual(resumen, { enviados: 2, rechazados: 1, detenido: false });
  assert.deepEqual([...almacen.data.keys()], [2], 'el rechazado no se borra solo');
  assert.equal(almacen.data.get(2).rechazado, true);
  assert.equal(almacen.data.get(2).status, 403);
  assert.match(almacen.data.get(2).mensaje, /super administrador/);
});

test('un cambio ya rechazado no se reenvía en la siguiente sincronización', async () => {
  const almacen = cola([{ id: 5, operation: 'update', payload: { id: 1 }, rechazado: true, mensaje: 'x' }, { id: 6, operation: 'update', payload: { id: 2 } }]);
  const enviados = [];
  await subirCambiosMapa({ pendientes: almacen.pendientes(), enviar: async (c) => { enviados.push(c.id); return respuesta(200); }, quitar: almacen.quitar, marcarRechazado: almacen.marcarRechazado });
  assert.deepEqual(enviados, [6]);
  assert.ok(almacen.data.has(5), 'sigue guardado hasta que el usuario lo reintente o lo descarte');
});

test('sin conexión, sesión vencida, límite o error del servidor: se para y no marca nada', async () => {
  for (const enviar of [
    async () => { throw new TypeError('Failed to fetch'); },
    async () => respuesta(401),
    async () => respuesta(429),
    async () => respuesta(503)
  ]) {
    const almacen = cola(tres());
    const resumen = await subirCambiosMapa({ pendientes: almacen.pendientes(), enviar, quitar: almacen.quitar, marcarRechazado: almacen.marcarRechazado });
    assert.deepEqual(resumen, { enviados: 0, rechazados: 0, detenido: true });
    assert.equal(almacen.data.size, 3);
    assert.ok([...almacen.data.values()].every((cambio) => !cambio.rechazado), 'reintentar más tarde puede funcionar');
  }
});

test('qué errores son permanentes y cómo se describe cada cambio', () => {
  for (const status of [400, 403, 404, 409, 410, 422]) assert.equal(esRechazoPermanente(status), true, String(status));
  for (const status of [401, 408, 429, 500, 502, 503]) assert.equal(esRechazoPermanente(status), false, String(status));
  assert.equal(describirCambioMapa({ operation: 'update', payload: { id: 12 } }), 'Cambio de puesto 12');
  assert.equal(describirCambioMapa({ operation: 'delete', payload: { id: 7 } }), 'Baja de puesto 7');
  assert.equal(describirCambioMapa({ operation: 'create', payload: { codigo_puesto: 'S-014' } }), 'Puesto nuevo S-014');
});
