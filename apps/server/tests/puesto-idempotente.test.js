/**
 * Alta de puesto idempotente (migrations/0022_puesto_clave_cliente.sql, revisión del 11/11/2026). La cola del
 * mapa reenvía un alta si no supo la respuesta: antes, si el primer envío sí había llegado, quedaba otro puesto
 * igual (mismo titular y dirección). Con la clave que genera el celular, el reenvío devuelve el mismo puesto.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { closeDatabase, initializeDatabase, insertComerciante, insertPuesto } from '../src/db.js';
import { pool } from '../src/pg.js';

before(async () => { await initializeDatabase(); });
after(async () => { await closeDatabase(); });

let documento = 20666000000;
const nuevoComerciante = () => insertComerciante(pool, {
  dni_ruc: String(documento += 1), nombre: `Idempotente ${documento}`, rubro_id: 1, zona_id: 1,
  tipo_comerciante: 'permanente', estado: 'activo', usuario_creador: 1
});
const contar = async (clave) => Number((await pool.query('SELECT COUNT(*) AS n FROM puestos WHERE clave_cliente = $1', [clave])).rows[0].n);

test('reenviar el alta con la misma clave no crea otro puesto', async () => {
  const comerciante = await nuevoComerciante();
  const clave = `clave-${process.pid}-uno`;
  const datos = { zona_id: 1, metros_cuadrados: 4, direccion: `Mapa ${clave}`, comerciante_id: comerciante.id, clave_cliente: clave };

  const primero = await insertPuesto(pool, datos);
  assert.equal(primero.ya_registrado, undefined);
  const reenvio = await insertPuesto(pool, datos);
  assert.equal(reenvio.ya_registrado, true);
  assert.equal(reenvio.id, primero.id);
  assert.equal(await contar(clave), 1, 'antes quedaban dos puestos iguales');

  // Sin clave (padrón, pantallas viejas) se crea como siempre.
  const sinClave = await insertPuesto(pool, { ...datos, clave_cliente: undefined });
  assert.notEqual(sinClave.id, primero.id);
});

test('dos envíos a la vez con la misma clave dejan un solo puesto', async () => {
  const comerciante = await nuevoComerciante();
  const clave = `clave-${process.pid}-dos`;
  const datos = { zona_id: 1, metros_cuadrados: 4, direccion: `Mapa ${clave}`, comerciante_id: comerciante.id, clave_cliente: clave };
  const [a, b] = await Promise.all([insertPuesto(pool, datos), insertPuesto(pool, datos)]);
  assert.equal(a.id, b.id);
  assert.equal(await contar(clave), 1);
});

test('una clave con caracteres raros se rechaza', async () => {
  await assert.rejects(insertPuesto(pool, { zona_id: 1, metros_cuadrados: 4, direccion: 'Mapa clave rara', clave_cliente: "x'; DROP" }),
    /clave del puesto nuevo no es válida/);
});
