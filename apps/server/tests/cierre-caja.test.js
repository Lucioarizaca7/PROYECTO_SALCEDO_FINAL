/**
 * Cierre de caja diario por cobrador (migrations/0012_cierre_caja.sql), contra la API levantada.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../src/index.ts';
import { closeDatabase, calcularLiquidacion, getComerciantes, registrarCobro, todayInLima } from '../src/db.js';
import { pool } from '../src/pg.js';
import { comercianteConDeuda } from './_deuda.js';

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
  const { status, body } = await api('/auth/login', { method: 'POST', body: { email, password, device_id: `caja-${email}` } });
  assert.equal(status, 200, body?.message);
  return { token: body.token, id: Number(body.user?.id) };
}

// Comerciante con deuda armada para la prueba (cobro por día cobrado, 13/11/2026): S/ 90 en el periodo.
async function merchantWithBalance(periodo) {
  return (await comercianteConDeuda(pool, { periodo })).merchant;
}

test('el cobrador cierra su caja: lo esperado lo calcula el servidor y se ve la diferencia', async () => {
  const cobrador = await login('cobrador@salcedo.gob.pe', 'cobro123');
  const admin = await login('admin@salcedo.gob.pe', 'admin123');
  const dia = '2026-01-15';
  const periodo = dia.slice(0, 7);
  const merchant = await merchantWithBalance(periodo, 8);
  // Los cobros de ese día se graban con registrarCobro: por la API, un cobro en línea lleva la hora del
  // servidor (fechaCobroEnLinea) y no podría caer en un día pasado.
  const cobrar = (monto, metodo_pago, extra = {}) => registrarCobro(pool, {
    comerciante_id: merchant.id, cobrador_id: cobrador.id, monto, metodo_pago, periodo, fecha_cobro: `${dia}T15:00:00Z`, ...extra
  });
  await cobrar(3, 'efectivo');
  await cobrar(2, 'efectivo');
  await cobrar(1.5, 'yape', { codigo_operacion: `YP-CAJA-${process.pid}` });

  const resumen = await api(`/caja/resumen?fecha=${dia}`, { token: cobrador.token });
  assert.equal(resumen.status, 200, resumen.body?.message);
  assert.deepEqual(resumen.body.data.esperado, { efectivo: 5, yape: 1.5, plin: 0, pos: 0 });
  assert.equal(resumen.body.data.cobros, 3);
  assert.equal(resumen.body.data.cierre, null);

  // Faltan S/ 1 en efectivo: un faltante no se cierra sin justificación (RN-42).
  const sinJustificar = await api('/caja/cierre', { method: 'POST', token: cobrador.token, body: { fecha: dia, declarado: { efectivo: 4, yape: 1.5 } } });
  assert.equal(sinJustificar.status, 400);
  assert.match(sinJustificar.body.message, /Faltan S\/ 1\.00: escriba la justificación/);
  const cierre = await api('/caja/cierre', {
    method: 'POST', token: cobrador.token,
    body: { fecha: dia, declarado: { efectivo: 4, yape: 1.5 }, esperado: { efectivo: 999 }, justificacion: 'Di mal un vuelto de S/ 1' }
  });
  assert.equal(cierre.status, 201, cierre.body?.message);
  assert.equal(cierre.body.data.esperado_efectivo, 5, 'lo esperado no lo decide el celular');
  assert.equal(cierre.body.data.diferencia, -1);
  assert.match(cierre.body.message, /faltan S\/ 1\.00/);

  const otraVez = await api('/caja/cierre', { method: 'POST', token: cobrador.token, body: { fecha: dia, declarado: { efectivo: 5 } } });
  assert.equal(otraVez.status, 409);

  // Un cobro sincronizado después del cierre aparece aparte.
  await cobrar(1, 'efectivo');
  const despues = await api(`/caja/resumen?fecha=${dia}`, { token: cobrador.token });
  assert.deepEqual(despues.body.data.posteriores_al_cierre, { cobros: 1, monto: 1 });

  assert.equal((await api(`/caja/resumen?fecha=${dia}&cobrador_id=${admin.id}`, { token: cobrador.token })).status, 403, 'no ve la caja de otro');
  assert.equal((await api('/caja/cierres', { token: cobrador.token })).status, 403);
  const delAdmin = await api(`/caja/resumen?fecha=${dia}&cobrador_id=${cobrador.id}`, { token: admin.token });
  assert.equal(delAdmin.body.data.cierre.diferencia, -1);
  const cierres = await api(`/caja/cierres?desde=${dia}&hasta=${dia}`, { token: admin.token });
  assert.equal(cierres.body.data.length, 1);
  assert.equal(cierres.body.data[0].cobrador_id, cobrador.id);
  assert.equal(cierres.body.data[0].justificacion, 'Di mal un vuelto de S/ 1');
  assert.equal(cierres.body.data[0].entregado, false);

  // Entrega del dinero (RN-41): la registra el super_admin que lo recibe.
  const id = cierre.body.data.id;
  const entregar = (token, body) => api(`/caja/cierres/${id}/entrega`, { method: 'POST', token, body });
  assert.equal((await entregar(cobrador.token, { monto: 4 })).status, 403, 'el cobrador no registra su propia entrega');
  const otroMonto = await entregar(admin.token, { monto: 3 });
  assert.equal(otroMonto.status, 400);
  assert.match(otroMonto.body.message, /declaró S\/ 4\.00 en efectivo/);
  const entrega = await entregar(admin.token, { monto: 4 });
  assert.equal(entrega.status, 201, entrega.body?.message);
  assert.equal(entrega.body.data.entregado, true);
  assert.deepEqual([entrega.body.data.entregas[0].tipo, entrega.body.data.entregas[0].monto, entrega.body.data.entregas[0].recibido_por], ['cierre', 4, 'Administrador']);
  assert.equal((await entregar(admin.token, { monto: 4 })).status, 409, 'el efectivo de un cierre se entrega una vez');
  // El cobro que entró después del cierre se entrega aparte (RN-44).
  const complementaria = await entregar(admin.token, { tipo: 'complementaria', monto: 1 });
  assert.equal(complementaria.status, 201, complementaria.body?.message);
  assert.equal(complementaria.body.data.entregas.length, 2);

  // Rectificación (RN-43): el cierre original no cambia; vale lo rectificado.
  const rectificar = (token, body) => api(`/caja/cierres/${id}/rectificacion`, { method: 'POST', token, body });
  const corregido = { efectivo: 5, yape: 1.5, plin: 0, pos: 0 };
  assert.equal((await rectificar(cobrador.token, { declarado: corregido, motivo: 'Contó mal' })).status, 403);
  assert.equal((await rectificar(admin.token, { declarado: corregido })).status, 400, 'sin motivo no se rectifica');
  const rectificado = await rectificar(admin.token, { declarado: corregido, motivo: 'El billete de S/ 1 estaba en otro bolsillo' });
  assert.equal(rectificado.status, 201, rectificado.body?.message);
  assert.equal(rectificado.body.data.diferencia, -1, 'el cierre original se conserva');
  assert.equal(rectificado.body.data.declarado_efectivo, 4);
  assert.equal(rectificado.body.data.vigente.diferencia, 0);
  assert.equal(rectificado.body.data.vigente.declarado_efectivo, 5);
  assert.equal(rectificado.body.data.rectificacion.rectificado_por, 'Administrador');
  assert.equal((await rectificar(admin.token, { declarado: corregido, motivo: 'Otra vez lo mismo' })).status, 409);
  assert.equal((await rectificar(admin.token, { declarado: corregido, motivo: 'No existe' }).then(() => api('/caja/cierres/999999999/rectificacion', { method: 'POST', token: admin.token, body: { declarado: corregido, motivo: 'No existe' } }))).status, 404);

  const { rows: auditoria } = await pool.query("SELECT accion FROM auditoria_logs WHERE entidad IN ('entregas_caja', 'cierres_caja') AND recurso_id = $1 ORDER BY id", [String(id)]);
  assert.deepEqual(auditoria.map((fila) => fila.accion), ['CERRAR_CAJA', 'ENTREGA_CAJA', 'ENTREGA_CAJA', 'RECTIFICAR_CAJA']);
});

test('un sobrante se justifica desde S/ 5; nadie registra la entrega de su propia caja', async () => {
  const cobrador = await login('cobrador@salcedo.gob.pe', 'cobro123');
  const admin = await login('admin@salcedo.gob.pe', 'admin123');
  const cerrar = (token, body) => api('/caja/cierre', { method: 'POST', token, body });
  // Días sin cobros: lo declarado es todo sobrante.
  const menor = await cerrar(cobrador.token, { fecha: '2026-01-17', declarado: { efectivo: 4.99 } });
  assert.equal(menor.status, 201, menor.body?.message);
  const mayor = await cerrar(cobrador.token, { fecha: '2026-01-18', declarado: { efectivo: 5 } });
  assert.equal(mayor.status, 400);
  assert.match(mayor.body.message, /Sobran S\/ 5\.00/);
  assert.equal((await cerrar(cobrador.token, { fecha: '2026-01-18', declarado: { efectivo: 5 }, justificacion: 'Un comerciante no quiso su vuelto' })).status, 201);
  // La base repite la regla aunque el dato entre por otro camino.
  await assert.rejects(() => pool.query("INSERT INTO cierres_caja (cobrador_id, fecha, declarado_efectivo) VALUES ($1, '2026-01-19', 9)", [cobrador.id]), /cierres_caja_diferencia_justificada/);

  // Sin cobros posteriores no hay entrega complementaria.
  const sinPosteriores = await api(`/caja/cierres/${menor.body.data.id}/entrega`, { method: 'POST', token: admin.token, body: { tipo: 'complementaria', monto: 1 } });
  assert.equal(sinPosteriores.status, 409);

  const propio = await cerrar(admin.token, { fecha: '2026-01-17', declarado: {} });
  assert.equal(propio.status, 201, propio.body?.message);
  const aSiMismo = await api(`/caja/cierres/${propio.body.data.id}/entrega`, { method: 'POST', token: admin.token, body: { monto: 0 } });
  assert.equal(aSiMismo.status, 409);
  assert.match(aSiMismo.body.message, /su propia caja/);
});

test('un cobro en línea cuenta en la caja de hoy aunque el celular mande otra fecha', async () => {
  const cobrador = await login('cobrador@salcedo.gob.pe', 'cobro123');
  const periodo = '2026-02';
  const merchant = await merchantWithBalance(periodo, 2);
  const hoy = todayInLima();
  const antes = (await api(`/caja/resumen?fecha=${hoy}`, { token: cobrador.token })).body.data.esperado.efectivo;

  const cobro = await api('/cobros', {
    method: 'POST', token: cobrador.token,
    body: { comerciante_id: merchant.id, monto: 1, metodo_pago: 'efectivo', periodo, fecha_cobro: '2026-02-10T15:00:00Z' }
  });
  assert.equal(cobro.status, 201, cobro.body?.message);
  const { rows: [guardado] } = await pool.query('SELECT fecha_cobro_cliente FROM transacciones WHERE id = $1', [cobro.body.data.id]);
  assert.ok(Math.abs(Date.now() - new Date(guardado.fecha_cobro_cliente).getTime()) < 60_000, 'manda la hora del servidor');

  const despues = (await api(`/caja/resumen?fecha=${hoy}`, { token: cobrador.token })).body.data.esperado.efectivo;
  assert.equal(despues, Number((antes + 1).toFixed(2)), 'el cobro está en la caja de hoy');
});

test('el cierre valida montos y fechas', async () => {
  const cobrador = await login('cobrador@salcedo.gob.pe', 'cobro123');
  assert.equal((await api('/caja/cierre', { method: 'POST', token: cobrador.token, body: { fecha: '2999-01-01' } })).status, 400);
  assert.equal((await api('/caja/cierre', { method: 'POST', token: cobrador.token, body: { fecha: '2026-01-16', declarado: { efectivo: -5 } } })).status, 400);
});
