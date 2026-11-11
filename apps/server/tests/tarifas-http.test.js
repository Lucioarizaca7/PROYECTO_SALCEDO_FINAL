/**
 * Respuesta de la API al crear una tarifa que cierra otra o se cruza con ella (migrations/0020_tarifas_sin_cruces.sql).
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { startServer } from '../src/index.ts';
import { closeDatabase, createUser } from '../src/db.js';
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

async function api(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, body: await response.json() };
}

test('crear una tarifa avisa del cierre de la anterior, lo audita y un cruce responde 409', async () => {
  const email = `tarifas-${process.pid}-${Date.now()}@prueba.pe`;
  const password = randomBytes(16).toString('hex');
  await createUser({ nombre: 'Admin de tarifas', email, password, rol: 'super_admin' });
  const login = await api('/auth/login', { method: 'POST', body: { email, password, device_id: 'pc-tarifas' } });
  assert.equal(login.status, 200);
  const token = login.body.token;

  const rubro = await pool.query('INSERT INTO rubros (nombre) VALUES ($1) RETURNING id', [`Rubro http ${process.pid} ${Date.now()}`]);
  const tarifa = (extra) => api('/tarifas', { method: 'POST', token, body: { rubro_id: rubro.rows[0].id, tipo_tarifa: 'fija', monto_fijo: 10, unidad_medida: 'mensual', ...extra } });

  const primera = await tarifa({ vigencia_inicio: '2026-01-01' });
  assert.equal(primera.status, 201);
  assert.equal(primera.body.message, 'Tarifa creada correctamente');

  const segunda = await tarifa({ vigencia_inicio: '2026-03-01' });
  assert.equal(segunda.status, 201);
  assert.equal(segunda.body.message, 'Tarifa creada. La anterior termina el 2026-02-28');

  const cruce = await tarifa({ vigencia_inicio: '2026-03-01' });
  assert.equal(cruce.status, 409);
  assert.match(cruce.body.message, /desde el 2026-03-01 en adelante/);

  // La auditoría se escribe justo después de responder, sin que la respuesta la espere.
  let auditoria;
  for (let intento = 0; intento < 20 && !auditoria?.rowCount; intento += 1) {
    if (intento) await new Promise((resolve) => setTimeout(resolve, 100));
    auditoria = await pool.query(`SELECT payload_nuevo FROM auditoria_logs WHERE accion = 'CREAR_TARIFA' AND payload_nuevo->>'id' = $1`, [String(segunda.body.data.id)]);
  }
  assert.deepEqual(auditoria.rows[0].payload_nuevo.tarifas_cerradas, [{ id: primera.body.data.id, vigencia_fin: '2026-02-28' }]);
});
