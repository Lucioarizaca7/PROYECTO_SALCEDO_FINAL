/**
 * Etapa 3 del plan de reglas (migrations/0035_anulaciones_avisos_bajas_y_reclamos.sql), contra la API levantada:
 * anulación con segunda aprobación (RN-38), avisos de deuda (RN-53), baja de deuda con resolución (RN-54) y
 * reclamo de un día marcado (RN-27).
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../src/index.ts';
import {
  closeDatabase, calcularDeudaAcumulada, calcularLiquidacion, createUser, currentPeriod, primerDiaImpago, registrarCobro,
  setInicioCobro, todayInLima
} from '../src/db.js';
import { pool } from '../src/pg.js';
import { comercianteConDeuda } from './_deuda.js';

let server;
let baseUrl;
let admin;
let suplente;
let auditor;
let cobradorDemo;

const DIA_MS = 24 * 60 * 60 * 1000;
const diaHace = (dias) => todayInLima(new Date(Date.now() - dias * DIA_MS));
// El mes de hace `n` meses, contado desde el mes en curso de Lima.
function periodoHace(n) {
  const [anio, mes] = currentPeriod().split('-').map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1 - n, 1));
  return `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth() + 1).padStart(2, '0')}`;
}
let secuencia = 0;
const unico = () => `${process.pid}-${++secuencia}`;

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
  const { status, body } = await api('/auth/login', { method: 'POST', body: { email, password, device_id: `etapa3-${email}` } });
  assert.equal(status, 200, body?.message);
  return { token: body.token, id: Number(body.user?.id) };
}

// Comerciante con deuda en un mes pasado: se le pone el alta en ese mes para que la deuda acumulada lo cuente.
async function conDeudaAntigua({ meses = 2, precio = 10, dias = 3 } = {}) {
  const periodo = periodoHace(meses);
  const creado = await comercianteConDeuda(pool, { periodo, precio, dias });
  await pool.query(`UPDATE comerciantes SET creado_en = ($2 || '-01 12:00')::timestamp AT TIME ZONE 'America/Lima' WHERE id = $1`, [creado.merchant.id, periodo]);
  return { ...creado, periodo };
}

const estadoDelCobro = async (id) => (await pool.query('SELECT estado, anulado_por FROM transacciones WHERE id = $1', [id])).rows[0];

before(async () => {
  server = await startServer(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  await setInicioCobro(pool, periodoHace(4), { usuarioId: 1 });
  admin = await login('admin@salcedo.gob.pe', 'admin123');
  suplente = await login('admin@sisrec.demo', 'sisrec2026');
  auditor = await login('auditor@salcedo.gob.pe', 'audit123');
  cobradorDemo = await login('cobrador@salcedo.gob.pe', 'cobro123');
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closeDatabase();
});

test('las consultas de la Etapa 3 son del administrador y del auditor; el cobrador recibe 403 y el auditor no escribe', async () => {
  for (const path of ['/cobros/anulaciones', '/deuda/avisos', '/deuda/bajas', '/reclamos']) {
    assert.equal((await api(path, { token: cobradorDemo.token })).status, 403, path);
    assert.equal((await api(path, { token: auditor.token })).status, 200, path);
    assert.equal((await api(path)).status, 401, path);
  }
  for (const path of ['/deuda/avisos', '/deuda/bajas', '/reclamos', '/reclamos/1/resolver', '/cobros/anulaciones/1/resolver']) {
    assert.equal((await api(path, { method: 'POST', token: auditor.token, body: {} })).status, 403, path);
  }
});

test('un cobro de otro día no lo anula una sola persona: uno la pide y el otro super administrador la aprueba', async () => {
  const dia = `${periodoHace(1)}-10`;
  const { merchant } = await comercianteConDeuda(pool, { periodo: dia.slice(0, 7) });
  const cobro = await registrarCobro(pool, {
    comerciante_id: merchant.id, cobrador_id: cobradorDemo.id, monto: 30, metodo_pago: 'efectivo', periodo: dia.slice(0, 7), fecha_cobro: `${dia}T15:00:00Z`
  });

  const pedida = await api(`/cobros/${cobro.id}/anular`, { method: 'POST', token: admin.token, body: { motivo: 'Cobro al comerciante equivocado' } });
  assert.equal(pedida.status, 202, pedida.body?.message);
  assert.equal(pedida.body.data.pendiente_aprobacion, true);
  assert.match(pedida.body.message, /otro super administrador/);
  assert.equal((await estadoDelCobro(cobro.id)).estado, 'confirmado', 'mientras no se apruebe, el cobro sigue válido');
  const solicitudId = pedida.body.data.solicitud.id;

  const otraVez = await api(`/cobros/${cobro.id}/anular`, { method: 'POST', token: suplente.token, body: { motivo: 'Otra vez el mismo cobro' } });
  assert.equal(otraVez.status, 409, 'una sola anulación pendiente por cobro');

  const pendientes = await api('/cobros/anulaciones', { token: auditor.token });
  assert.ok(pendientes.body.data.some((item) => item.id === solicitudId && item.transaccion_id === Number(cobro.id)));

  const elMismo = await api(`/cobros/anulaciones/${solicitudId}/resolver`, { method: 'POST', token: admin.token, body: { decision: 'aprobar' } });
  assert.equal(elMismo.status, 409, 'nadie aprueba lo que él mismo pidió');
  assert.match(elMismo.body.message, /otro super administrador/);

  const aprobada = await api(`/cobros/anulaciones/${solicitudId}/resolver`, { method: 'POST', token: suplente.token, body: { decision: 'aprobar' } });
  assert.equal(aprobada.status, 200, aprobada.body?.message);
  assert.equal(aprobada.body.data.estado, 'aprobada');
  const fila = await estadoDelCobro(cobro.id);
  assert.equal(fila.estado, 'anulado');
  assert.equal(Number(fila.anulado_por), admin.id, 'lo anula quien lo pidió; quien aprobó queda en la solicitud');

  const repetida = await api(`/cobros/anulaciones/${solicitudId}/resolver`, { method: 'POST', token: suplente.token, body: { decision: 'aprobar' } });
  assert.equal(repetida.status, 409);
  const auditoria = await pool.query(`SELECT accion FROM auditoria_logs WHERE entidad = 'cobros' AND recurso_id = $1 ORDER BY id`, [String(cobro.id)]);
  assert.deepEqual(auditoria.rows.map((item) => item.accion), ['SOLICITAR_ANULACION', 'RESOLVER_ANULACION']);
});

test('una anulación rechazada deja el cobro válido y pide explicar el rechazo', async () => {
  const dia = `${periodoHace(1)}-12`;
  const { merchant } = await comercianteConDeuda(pool, { periodo: dia.slice(0, 7) });
  const cobro = await registrarCobro(pool, {
    comerciante_id: merchant.id, cobrador_id: cobradorDemo.id, monto: 30, metodo_pago: 'efectivo', periodo: dia.slice(0, 7), fecha_cobro: `${dia}T15:00:00Z`
  });
  const pedida = await api(`/cobros/${cobro.id}/anular`, { method: 'POST', token: suplente.token, body: { motivo: 'Dice que pagó dos veces' } });
  assert.equal(pedida.status, 202);
  const id = pedida.body.data.solicitud.id;

  const sinNota = await api(`/cobros/anulaciones/${id}/resolver`, { method: 'POST', token: admin.token, body: { decision: 'rechazar' } });
  assert.equal(sinNota.status, 400);
  const rechazada = await api(`/cobros/anulaciones/${id}/resolver`, { method: 'POST', token: admin.token, body: { decision: 'rechazar', resolucion: 'El recibo es correcto' } });
  assert.equal(rechazada.status, 200, rechazada.body?.message);
  assert.equal(rechazada.body.data.estado, 'rechazada');
  assert.equal((await estadoDelCobro(cobro.id)).estado, 'confirmado');

  const nueva = await api(`/cobros/${cobro.id}/anular`, { method: 'POST', token: admin.token, body: { motivo: 'Nuevo pedido con más datos' } });
  assert.equal(nueva.status, 202, 'se puede volver a pedir');
});

test('un cobro de hoy se anula directo con la caja abierta y pide aprobación con la caja cerrada', async () => {
  const email = `cobrador-etapa3-${unico()}@prueba.pe`;
  await createUser({ nombre: `Cobrador etapa 3 ${unico()}`, email, password: 'clave-de-prueba-1', rol: 'cobrador' });
  const cobrador = await login(email, 'clave-de-prueba-1');
  const { merchant } = await comercianteConDeuda(pool, { precio: 10, dias: 3 });
  const cobrar = () => registrarCobro(pool, { comerciante_id: merchant.id, cobrador_id: cobrador.id, monto: 10, metodo_pago: 'efectivo' });

  const primero = await cobrar();
  const directa = await api(`/cobros/${primero.id}/anular`, { method: 'POST', token: admin.token, body: { motivo: 'Monto mal digitado' } });
  assert.equal(directa.status, 200, directa.body?.message);
  assert.equal(directa.body.data.estado, 'anulado');

  const segundo = await cobrar();
  const cierre = await api('/caja/cierre', { method: 'POST', token: cobrador.token, body: { declarado: { efectivo: 10 } } });
  assert.equal(cierre.status, 201, cierre.body?.message);
  const conCajaCerrada = await api(`/cobros/${segundo.id}/anular`, { method: 'POST', token: admin.token, body: { motivo: 'Monto mal digitado' } });
  assert.equal(conCajaCerrada.status, 202, conCajaCerrada.body?.message);
  assert.match(conCajaCerrada.body.message, /caja de ese día ya está cerrada/);
});

test('primerDiaImpago: los pagos cubren primero los días más antiguos', () => {
  const dias = [{ fecha: '2026-03-01', monto: 3 }, { fecha: '2026-03-02', monto: 3 }, { fecha: '2026-03-05', monto: 2 }];
  assert.equal(primerDiaImpago(dias, 0), '2026-03-01');
  assert.equal(primerDiaImpago(dias, 3), '2026-03-02');
  assert.equal(primerDiaImpago(dias, 5), '2026-03-02', 'un día pagado a medias sigue impago');
  assert.equal(primerDiaImpago(dias, 6), '2026-03-05');
  assert.equal(primerDiaImpago(dias, 8), null);
});

test('aviso de deuda: entra quien debe un día cobrado desde hace 30 días o más, y se emite una sola vez', async () => {
  const { merchant, periodo } = await conDeudaAntigua();
  const reciente = await comercianteConDeuda(pool, { precio: 10, dias: 1 });

  const deuda = await calcularDeudaAcumulada(pool, merchant.id);
  assert.equal(deuda.dia_impago_mas_antiguo, `${periodo}-01`);
  assert.equal(deuda.deuda_total, 30);

  const lista = await api('/deuda/avisos', { token: admin.token });
  assert.equal(lista.status, 200);
  const fila = lista.body.data.por_emitir.find((item) => item.comerciante_id === Number(merchant.id));
  assert.ok(fila, 'el comerciante con deuda antigua está por avisar');
  assert.equal(fila.dia_impago, `${periodo}-01`);
  assert.ok(fila.dias_de_atraso >= 30);
  assert.ok(!lista.body.data.por_emitir.some((item) => item.comerciante_id === Number(reciente.merchant.id)), 'una deuda de este mes no llega a los 30 días');

  const sinDerecho = await api('/deuda/avisos', { method: 'POST', token: admin.token, body: { comerciante_id: reciente.merchant.id } });
  assert.equal(sinDerecho.status, 409);

  const emitido = await api('/deuda/avisos', { method: 'POST', token: admin.token, body: { comerciante_id: merchant.id, observaciones: 'Entregado en su puesto' } });
  assert.equal(emitido.status, 201, emitido.body?.message);
  assert.equal(emitido.body.data.deuda, 30);
  assert.equal(emitido.body.data.dia_impago, `${periodo}-01`);
  const repetido = await api('/deuda/avisos', { method: 'POST', token: suplente.token, body: { comerciante_id: merchant.id } });
  assert.equal(repetido.status, 409, 'un aviso por comerciante y por día impago');

  const despues = await api('/deuda/avisos', { token: auditor.token });
  assert.ok(!despues.body.data.por_emitir.some((item) => item.comerciante_id === Number(merchant.id)));
  assert.ok(despues.body.data.emitidos.some((item) => item.id === emitido.body.data.id));

  // Paga el primer día: el impago más antiguo pasa al día 2 y, si sigue con 30 días, vuelve a la lista.
  await registrarCobro(pool, { comerciante_id: merchant.id, cobrador_id: cobradorDemo.id, monto: 10, metodo_pago: 'efectivo', periodo, fecha_cobro: `${periodo}-20T15:00:00Z` });
  assert.equal((await calcularDeudaAcumulada(pool, merchant.id)).dia_impago_mas_antiguo, `${periodo}-02`);
  const otraLista = await api('/deuda/avisos', { token: admin.token });
  assert.equal(otraLista.body.data.por_emitir.find((item) => item.comerciante_id === Number(merchant.id))?.dia_impago, `${periodo}-02`);
});

test('baja de deuda: solo meses pasados, con resolución; la liquidación la resta y los días cobrados se conservan', async () => {
  const { merchant, periodo } = await conDeudaAntigua();
  const cuerpo = { comerciante_id: merchant.id, hasta_periodo: periodo, resolucion: 'RA 045-2026-MDS', motivo: 'Deuda incobrable según informe de Rentas' };

  assert.equal((await api('/deuda/bajas', { method: 'POST', token: admin.token, body: { ...cuerpo, resolucion: '' } })).status, 400);
  assert.equal((await api('/deuda/bajas', { method: 'POST', token: admin.token, body: { ...cuerpo, motivo: 'no' } })).status, 400);
  const mesEnCurso = await api('/deuda/bajas', { method: 'POST', token: admin.token, body: { ...cuerpo, hasta_periodo: currentPeriod() } });
  assert.equal(mesEnCurso.status, 400, 'la deuda del mes en curso no se da de baja');

  const baja = await api('/deuda/bajas', { method: 'POST', token: admin.token, body: cuerpo });
  assert.equal(baja.status, 201, baja.body?.message);
  assert.equal(baja.body.data.total, 30);
  assert.deepEqual(baja.body.data.periodos, [{ periodo, monto: 30 }]);

  const liquidacion = await calcularLiquidacion(pool, merchant.id, periodo);
  assert.equal(liquidacion.monto_total, 30, 'los días cobrados siguen ahí');
  assert.equal(liquidacion.monto_baja, 30);
  assert.equal(liquidacion.monto_pagado, 0, 'una baja no es dinero recaudado');
  assert.equal(liquidacion.saldo, 0);
  assert.equal((await calcularDeudaAcumulada(pool, merchant.id)).deuda_total, 0);

  const otraVez = await api('/deuda/bajas', { method: 'POST', token: admin.token, body: cuerpo });
  assert.equal(otraVez.status, 409, 'ya no queda deuda hasta ese mes');
  const lista = await api('/deuda/bajas', { token: auditor.token });
  assert.ok(lista.body.data.some((item) => item.comerciante_id === Number(merchant.id) && item.resolucion === 'RA 045-2026-MDS' && item.monto === 30));
});

test('reclamo de un día marcado: plazo de 7 días, uno pendiente por día, y si procede el día deja de deberse', async () => {
  const hoy = todayInLima();
  const { merchant } = await comercianteConDeuda(pool, { precio: 10, dias: 3 });
  const sinMarcas = await comercianteConDeuda(pool, { precio: 10, dias: 0 });
  const cuerpo = { comerciante_id: merchant.id, fecha: hoy, tipo: 'no_asistio', detalle: 'Dice que ese día estuvo de viaje' };

  assert.equal((await api('/reclamos', { method: 'POST', token: admin.token, body: { ...cuerpo, fecha: diaHace(8) } })).status, 400, 'fuera de plazo');
  assert.equal((await api('/reclamos', { method: 'POST', token: admin.token, body: { ...cuerpo, tipo: 'otro' } })).status, 400);
  assert.equal((await api('/reclamos', { method: 'POST', token: admin.token, body: { ...cuerpo, comerciante_id: sinMarcas.merchant.id } })).status, 409, 'sin día cobrado no hay reclamo');

  const creado = await api('/reclamos', { method: 'POST', token: admin.token, body: cuerpo });
  assert.equal(creado.status, 201, creado.body?.message);
  assert.equal(creado.body.data.estado, 'pendiente');
  assert.equal((await api('/reclamos', { method: 'POST', token: admin.token, body: cuerpo })).status, 409, 'un reclamo pendiente por día');

  const antes = (await calcularLiquidacion(pool, merchant.id)).saldo;
  const sinNota = await api(`/reclamos/${creado.body.data.id}/resolver`, { method: 'POST', token: admin.token, body: { decision: 'procedente' } });
  assert.equal(sinNota.status, 400);
  const resuelto = await api(`/reclamos/${creado.body.data.id}/resolver`, { method: 'POST', token: admin.token, body: { decision: 'procedente', resolucion: 'El cobrador confirma que no estuvo' } });
  assert.equal(resuelto.status, 200, resuelto.body?.message);
  assert.equal(resuelto.body.data.estado, 'procedente');
  assert.equal(resuelto.body.data.marcas_corregidas, 1);
  assert.equal((await calcularLiquidacion(pool, merchant.id)).saldo, antes - 10, 'el día reclamado ya no se debe');

  const repetido = await api(`/reclamos/${creado.body.data.id}/resolver`, { method: 'POST', token: admin.token, body: { decision: 'no_procedente', resolucion: 'Segunda respuesta' } });
  assert.equal(repetido.status, 409);
  assert.ok((await api('/reclamos?estado=procedente', { token: auditor.token })).body.data.some((item) => item.id === creado.body.data.id));
});

test('un reclamo no devuelve dinero: con un cobro confirmado ese día primero se anula el cobro', async () => {
  const hoy = todayInLima();
  const { merchant } = await comercianteConDeuda(pool, { precio: 10, dias: 3 });
  await registrarCobro(pool, { comerciante_id: merchant.id, cobrador_id: cobradorDemo.id, monto: 10, metodo_pago: 'efectivo' });
  const creado = await api('/reclamos', { method: 'POST', token: suplente.token, body: { comerciante_id: merchant.id, fecha: hoy, tipo: 'no_asistio', detalle: 'Dice que no vino y que no pagó' } });
  assert.equal(creado.status, 201, creado.body?.message);

  const conCobro = await api(`/reclamos/${creado.body.data.id}/resolver`, { method: 'POST', token: suplente.token, body: { decision: 'procedente', resolucion: 'Se acepta el reclamo' } });
  assert.equal(conCobro.status, 409);
  assert.match(conCobro.body.message, /anule primero el cobro/);

  const noProcede = await api(`/reclamos/${creado.body.data.id}/resolver`, { method: 'POST', token: suplente.token, body: { decision: 'no_procedente', resolucion: 'Hay recibo firmado de ese día' } });
  assert.equal(noProcede.status, 200, noProcede.body?.message);
  assert.equal(noProcede.body.data.marcas_corregidas, 0);

  const yaPago = await api('/reclamos', { method: 'POST', token: admin.token, body: { comerciante_id: merchant.id, fecha: hoy, tipo: 'ya_pago', detalle: 'Muestra su ticket de ese día' } });
  assert.equal(yaPago.status, 201, 'resuelto el anterior, se puede reclamar otra vez');
  const procede = await api(`/reclamos/${yaPago.body.data.id}/resolver`, { method: 'POST', token: admin.token, body: { decision: 'procedente', resolucion: 'Se registró el cobro que faltaba' } });
  assert.equal(procede.status, 200);
  assert.equal(procede.body.data.marcas_corregidas, 0, 'en «ya pagó» el sistema no inventa un pago');
});
