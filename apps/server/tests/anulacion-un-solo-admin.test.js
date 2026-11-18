/**
 * Anulación con un solo super administrador activo (decisión del usuario, 18/11/2026; migración 0038).
 *
 * Un cobro de otro día o de una caja cerrada pide la aprobación del otro super administrador (RN-38). Si quien
 * anula es el único super administrador activo, la anula él solo con motivo y la anulación queda señalada para
 * la revisión mensual (RN-61), hasta que otro super administrador la marque revisada.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../src/index.ts';
import { closeDatabase, currentPeriod, registrarCobro } from '../src/db.js';
import { pool } from '../src/pg.js';
import { comercianteConDeuda } from './_deuda.js';

let server;
let baseUrl;
let admin;
let suplente;
let auditor;
let cobrador;

async function api(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function login(email, password) {
  const { status, body } = await api('/auth/login', { method: 'POST', body: { email, password, device_id: `un-admin-${email}` } });
  assert.equal(status, 200, body?.message);
  return { token: body.token, id: Number(body.user?.id) };
}

// Deja activo solo a `admin` entre los super administradores, o vuelve a activar a todos.
async function soloUnAdmin(solo) {
  await pool.query(`
    UPDATE usuarios u SET activo = $2 FROM roles r
    WHERE r.id = u.rol_id AND r.codigo = 'super_admin' AND u.id <> $1`, [admin.id, !solo]);
}

// Un cobro de un día del mes pasado: su anulación siempre pide la segunda aprobación.
let diaDelMes = 3;
async function cobroDeOtroDia() {
  const [anio, mes] = currentPeriod().split('-').map(Number);
  const pasado = new Date(Date.UTC(anio, mes - 2, 1));
  const periodo = `${pasado.getUTCFullYear()}-${String(pasado.getUTCMonth() + 1).padStart(2, '0')}`;
  const dia = `${periodo}-${String(diaDelMes += 1).padStart(2, '0')}`;
  const { merchant } = await comercianteConDeuda(pool, { periodo });
  return registrarCobro(pool, {
    comerciante_id: merchant.id, cobrador_id: cobrador.id, monto: 30, metodo_pago: 'efectivo', periodo, fecha_cobro: `${dia}T15:00:00Z`
  });
}
const estadoDelCobro = async (id) => (await pool.query('SELECT estado FROM transacciones WHERE id = $1', [id])).rows[0].estado;
const anular = (cobro, token, motivo = 'Cobro al comerciante equivocado') => api(`/cobros/${cobro.id}/anular`, { method: 'POST', token, body: { motivo } });
const señaladas = async (token) => (await api('/cobros/anulaciones?estado=sin_segunda_aprobacion', { token })).body.data;

before(async () => {
  server = await startServer(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  admin = await login('admin@salcedo.gob.pe', 'admin123');
  suplente = await login('admin@sisrec.demo', 'sisrec2026');
  auditor = await login('auditor@salcedo.gob.pe', 'audit123');
  cobrador = await login('cobrador@salcedo.gob.pe', 'cobro123');
});

after(async () => {
  await soloUnAdmin(false);
  await new Promise((resolve) => server.close(resolve));
  await closeDatabase();
});

test('con un solo super administrador activo, anula él solo y la anulación queda señalada para la revisión', async () => {
  await soloUnAdmin(true);
  const cobro = await cobroDeOtroDia();

  const anulada = await anular(cobro, admin.token);
  assert.equal(anulada.status, 200, anulada.body?.message);
  assert.equal(anulada.body.data.sin_segunda_aprobacion, true);
  assert.match(anulada.body.message, /sin segunda aprobación.*revisión mensual/);
  assert.equal(await estadoDelCobro(cobro.id), 'anulado');

  const fila = (await señaladas(auditor.token)).find((item) => item.transaccion_id === Number(cobro.id));
  assert.ok(fila, 'el auditor la ve en la revisión');
  assert.deepEqual([fila.estado, fila.sin_segundo_admin, fila.revisada_por], ['aprobada', true, null]);

  const propia = await api(`/cobros/anulaciones/${fila.id}/revisar`, { method: 'POST', token: admin.token, body: {} });
  assert.equal(propia.status, 409, 'nadie revisa lo que él mismo anuló');
  assert.equal((await api(`/cobros/anulaciones/${fila.id}/revisar`, { method: 'POST', token: auditor.token, body: {} })).status, 403);

  // Llega el segundo super administrador: la revisa, y desde entonces se vuelve a pedir la segunda aprobación.
  await soloUnAdmin(false);
  const revisada = await api(`/cobros/anulaciones/${fila.id}/revisar`, { method: 'POST', token: suplente.token, body: { revision: 'Revisado con el recibo' } });
  assert.equal(revisada.status, 200, revisada.body?.message);
  assert.equal(revisada.body.data.revisada_por !== null, true);
  assert.equal((await api(`/cobros/anulaciones/${fila.id}/revisar`, { method: 'POST', token: suplente.token, body: {} })).status, 409);

  const conDos = await anular(await cobroDeOtroDia(), admin.token);
  assert.equal(conDos.status, 202, 'con dos activos vuelve la segunda aprobación');

  const acciones = (await pool.query(`SELECT accion FROM auditoria_logs WHERE entidad = 'cobros' AND recurso_id = $1 ORDER BY id`, [String(cobro.id)])).rows;
  assert.deepEqual(acciones.map((item) => item.accion), ['ANULAR_COBRO', 'REVISAR_ANULACION']);
});

test('si el otro se desactiva con una anulación pedida, quien la pidió la cierra él solo', async () => {
  await soloUnAdmin(false);
  const cobro = await cobroDeOtroDia();
  const pedida = await anular(cobro, admin.token);
  assert.equal(pedida.status, 202);

  await soloUnAdmin(true);
  const cerrada = await anular(cobro, admin.token, 'El suplente dejó el cargo');
  assert.equal(cerrada.status, 200, cerrada.body?.message);
  assert.equal(cerrada.body.data.solicitud_id, pedida.body.data.solicitud.id, 'se cierra la misma solicitud, no se crea otra');
  assert.equal(await estadoDelCobro(cobro.id), 'anulado');
  const fila = (await señaladas(admin.token)).find((item) => item.id === pedida.body.data.solicitud.id);
  assert.deepEqual([fila.estado, fila.motivo], ['aprobada', 'El suplente dejó el cargo']);
  await soloUnAdmin(false);
});

test('la base no deja que quien anuló sin segunda aprobación se revise a sí mismo', async () => {
  const cobro = await cobroDeOtroDia();
  await assert.rejects(pool.query(`
    INSERT INTO anulaciones_solicitadas (transaccion_id, motivo, solicitado_por, estado, resuelto_por, resuelto_en, sin_segundo_admin, revisada_por, revisada_en)
    VALUES ($1, 'Prueba de la base', $2, 'aprobada', $2, now(), true, $2, now())`, [cobro.id, admin.id]),
  (error) => error.constraint === 'anulaciones_revision_completa');
  await assert.rejects(pool.query(`
    INSERT INTO anulaciones_solicitadas (transaccion_id, motivo, solicitado_por, estado, resuelto_por, resuelto_en)
    VALUES ($1, 'Prueba de la base', $2, 'aprobada', $2, now())`, [cobro.id, admin.id]),
  (error) => error.constraint === 'anulaciones_otro_resuelve', 'sin la señal, sigue sin poder aprobarse a sí mismo');
});
