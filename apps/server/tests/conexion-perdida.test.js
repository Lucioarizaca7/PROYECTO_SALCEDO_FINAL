/**
 * Una conexión a PostgreSQL que se corta no tumba la API (revisión del 12/11/2026). Antes el pool no escuchaba su
 * evento 'error': si PostgreSQL se reiniciaba o la red parpadeaba con una conexión inactiva, Node lanzaba la
 * excepción y el proceso terminaba para todos los cobradores.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { closeDatabase, initializeDatabase } from '../src/db.js';
import { pool } from '../src/pg.js';

before(async () => { await initializeDatabase({ seed: false }); });
after(async () => { await closeDatabase(); });

test('el pool escucha los errores de conexión', () => {
  assert.ok(pool.listenerCount('error') >= 1, 'sin listener, un error de conexión inactiva cierra el proceso');
});

test('una conexión cortada no lanza y la base sigue respondiendo', async () => {
  assert.doesNotThrow(() => pool.emit('error', new Error('conexión cortada (prueba)')));
  // Se corta de verdad una conexión inactiva del pool desde otra sesión.
  const inactiva = await pool.connect();
  const { rows: [{ pid }] } = await inactiva.query('SELECT pg_backend_pid() AS pid');
  inactiva.release();
  await pool.query('SELECT pg_terminate_backend($1)', [pid]).catch(() => null);
  await new Promise((resolve) => setTimeout(resolve, 200));
  const { rows } = await pool.query('SELECT 1 AS uno');
  assert.equal(rows[0].uno, 1);
});

test('conseguir una conexión tiene espera máxima', () => {
  assert.ok(pool.options.connectionTimeoutMillis > 0, 'con 0 una base que no contesta deja la petición colgada');
});
