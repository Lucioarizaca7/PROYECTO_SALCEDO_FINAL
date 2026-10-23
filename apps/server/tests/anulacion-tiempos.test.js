/**
 * Fase 3 — anulación de cobros con motivo (solo admin) y tiempo de atención de cada cobro
 * (migrations/0008_anulacion_y_tiempo_cobro.sql), contra la API levantada de verdad.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../src/index.ts';
import { closeDatabase, calcularLiquidacion, getComerciantes, getAuditTrail, parseInicioAtencion, todayInLima } from '../src/db.js';
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
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function login(email, password) {
  const { status, body } = await api('/auth/login', { method: 'POST', body: { email, password, device_id: `pc-${email}` } });
  assert.equal(status, 200, body?.message);
  return body.token;
}

async function merchantWithBalance(periodo) {
  for (const merchant of await getComerciantes(pool, { limit: 100 })) {
    const liquidation = await calcularLiquidacion(pool, merchant.id, periodo).catch(() => null);
    if (liquidation && !liquidation.no_devengo && !liquidation.cobro_diario && liquidation.saldo >= 5) return { merchant, liquidation };
  }
  throw new Error(`La semilla no tiene un comerciante con saldo en ${periodo}`);
}

const inPeriod = (periodo, minute = 0) => new Date(Date.parse(`${periodo}-15T15:00:00Z`) + minute * 60_000).toISOString();

test('el administrador anula un cobro con motivo; deja de contar y queda en la auditoría', async () => {
  const admin = await login('admin@salcedo.gob.pe', 'admin123');
  const cobrador = await login('cobrador@salcedo.gob.pe', 'cobro123');
  const periodo = '2031-03';
  const { merchant, liquidation } = await merchantWithBalance(periodo);

  const cobro = await api('/cobros', {
    method: 'POST', token: cobrador,
    body: { comerciante_id: merchant.id, monto: 3, metodo_pago: 'efectivo', periodo, fecha_cobro: inPeriod(periodo) }
  });
  assert.equal(cobro.status, 201, cobro.body?.message);
  const id = cobro.body.data.id;
  assert.equal((await calcularLiquidacion(pool, merchant.id, periodo)).saldo, Number((liquidation.saldo - 3).toFixed(2)));

  const comoCobrador = await api(`/cobros/${id}/anular`, { method: 'POST', token: cobrador, body: { motivo: 'Me equivoqué de comerciante' } });
  assert.equal(comoCobrador.status, 403, 'un cobrador no puede anular');

  const sinMotivo = await api(`/cobros/${id}/anular`, { method: 'POST', token: admin, body: { motivo: 'no' } });
  assert.equal(sinMotivo.status, 400);
  assert.match(sinMotivo.body.message, /motivo/);

  const anulado = await api(`/cobros/${id}/anular`, { method: 'POST', token: admin, body: { motivo: 'Cobro registrado al comerciante equivocado' } });
  assert.equal(anulado.status, 200, anulado.body?.message);
  assert.equal(anulado.body.data.estado, 'anulado');
  assert.equal((await calcularLiquidacion(pool, merchant.id, periodo)).saldo, liquidation.saldo, 'el cobro anulado ya no descuenta');

  const otraVez = await api(`/cobros/${id}/anular`, { method: 'POST', token: admin, body: { motivo: 'Segunda anulación del mismo' } });
  assert.equal(otraVez.status, 409);

  const lista = await api('/cobros', { token: admin });
  const fila = lista.body.data.find((item) => Number(item.id) === id);
  assert.equal(fila.estado, 'anulado');
  assert.equal(fila.motivo_anulacion, 'Cobro registrado al comerciante equivocado');
  assert.ok(fila.anulado_por);

  const auditoria = await getAuditTrail(pool, { limit: 20 });
  assert.ok(auditoria.some((log) => log.accion === 'ANULAR_COBRO' && String(log.detalle).includes('equivocado')));
});

test('el tiempo de atención se guarda solo si es creíble y alimenta el indicador', async () => {
  const cobro = new Date('2031-04-15T15:00:00Z');
  assert.equal(parseInicioAtencion('2031-04-15T14:58:30Z', cobro).toISOString(), '2031-04-15T14:58:30.000Z');
  assert.equal(parseInicioAtencion('2031-04-15T15:00:05Z', cobro), null, 'después del cobro');
  assert.equal(parseInicioAtencion('2031-04-15T12:00:00Z', cobro), null, 'más de 2 horas antes');
  assert.equal(parseInicioAtencion('no es fecha', cobro), null);

  const admin = await login('admin@salcedo.gob.pe', 'admin123');
  const cobrador = await login('cobrador@salcedo.gob.pe', 'cobro123');
  const periodo = '2031-04';
  const { merchant } = await merchantWithBalance(periodo);
  // En línea el cobro lleva la hora del servidor: se mide con la hora actual (el periodo 2031-04 solo aparta el saldo).
  const fecha = new Date().toISOString();

  const medido = await api('/cobros', {
    method: 'POST', token: cobrador,
    body: { comerciante_id: merchant.id, monto: 1, metodo_pago: 'efectivo', periodo, fecha_cobro: fecha,
      inicio_atencion: new Date(Date.parse(fecha) - 90_000).toISOString() }
  });
  assert.equal(medido.status, 201, medido.body?.message);
  const invalido = await api('/cobros', {
    method: 'POST', token: cobrador,
    body: { comerciante_id: merchant.id, monto: 1, metodo_pago: 'efectivo', periodo, fecha_cobro: fecha,
      inicio_atencion: new Date(Date.parse(fecha) + 10 * 60_000).toISOString() }
  });
  assert.equal(invalido.status, 201, 'un inicio inválido no impide cobrar');
  const guardado = (await pool.query('SELECT inicio_atencion FROM transacciones WHERE id = $1', [invalido.body.data.id])).rows[0];
  assert.equal(guardado.inicio_atencion, null);

  assert.equal((await api('/cobros/tiempos', { token: cobrador })).status, 403);
  const hoy = todayInLima();
  const tiempos = await api(`/cobros/tiempos?desde=${hoy}&hasta=${hoy}`, { token: admin });
  assert.equal(tiempos.status, 200, tiempos.body?.message);
  assert.equal(tiempos.body.data.general.cobros, 1);
  assert.equal(tiempos.body.data.general.mediana_segundos, 90);
  assert.equal(tiempos.body.data.linea_base.segundos_por_cobro, 120);
});

test('la base no acepta un cobro anulado sin motivo', async () => {
  const fila = (await pool.query(`SELECT id FROM transacciones WHERE estado = 'confirmado' ORDER BY id LIMIT 1`)).rows[0];
  assert.ok(fila, 'las pruebas anteriores dejaron cobros confirmados');
  await assert.rejects(
    () => pool.query(`UPDATE transacciones SET estado = 'anulado' WHERE id = $1`, [fila.id]),
    /transacciones_anulacion_con_motivo/
  );
});
