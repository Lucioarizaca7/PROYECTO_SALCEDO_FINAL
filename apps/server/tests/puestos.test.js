import test from 'node:test';
import assert from 'node:assert/strict';

import {
  initializeDatabase,
  insertComerciante,
  insertPuesto,
  updatePuesto,
  liberarPuesto,
  deactivatePuesto,
  getPuestos,
  calcularLiquidacion,
  registrarCobro
} from '../src/db.js';

let documento = 20999000000;
const nuevoComerciante = (db, extra = {}) => insertComerciante(db, {
  dni_ruc: String(documento += 1),
  nombre: `Comerciante Puesto ${documento}`,
  rubro_id: 1,
  zona_id: 1,
  tipo_comerciante: 'permanente',
  estado: 'activo',
  usuario_creador: 1,
  ...extra
});

const puestoBase = (extra = {}) => ({ zona_id: 1, metros_cuadrados: 4, ...extra });

test('un puesto sin comerciante queda libre y se puede asignar y volver a liberar', async () => {
  const db = await initializeDatabase();

  const libre = await insertPuesto(db, puestoBase({ direccion: 'Libre L-01', codigo_puesto: 'L-01' }));
  assert.equal(libre.comerciante_id, null);
  assert.equal(libre.estado, 'disponible');
  assert.equal(libre.estado_pago, 'libre');

  const comerciante = await nuevoComerciante(db);
  const asignado = await updatePuesto(db, libre.id, { comerciante_id: comerciante.id });
  assert.equal(asignado.estado, 'ocupado');
  assert.equal(asignado.comerciante, comerciante.nombre);

  const liberado = await liberarPuesto(db, libre.id);
  assert.equal(liberado.comerciante_id, null);
  assert.equal(liberado.estado, 'disponible');
  assert.equal(liberado.estado_pago, 'libre');
});

test('un puesto ocupado necesita titular (servidor y base de datos)', async () => {
  const db = await initializeDatabase();

  await assert.rejects(() => insertPuesto(db, puestoBase({ direccion: 'Sin titular', estado: 'ocupado' })), /titular/);
  const libre = await insertPuesto(db, puestoBase({ direccion: 'Sin titular 2' }));
  await assert.rejects(() => db.query(`UPDATE puestos SET estado = 'ocupado' WHERE id = $1`, [libre.id]), /puestos_ocupado_con_titular/);
});

test('el saldo del puesto es la liquidación del mes de su titular y baja con el cobro', async () => {
  const db = await initializeDatabase();
  const comerciante = await nuevoComerciante(db);
  const puesto = await insertPuesto(db, puestoBase({ direccion: 'Deuda D-01', comerciante_id: comerciante.id }));

  const liquidacion = await calcularLiquidacion(db, comerciante.id);
  assert.ok(liquidacion.saldo > 0);
  let fila = (await getPuestos(db)).find((item) => item.id === puesto.id);
  assert.equal(fila.estado_pago, 'pendiente');
  assert.equal(fila.saldo_pendiente, liquidacion.saldo);
  assert.equal(fila.monto_total, liquidacion.monto_total);

  await registrarCobro(db, { comerciante_id: comerciante.id, cobrador_id: 2, monto: liquidacion.saldo, metodo_pago: 'efectivo', concepto: 'Cuota del mes' });
  fila = (await getPuestos(db)).find((item) => item.id === puesto.id);
  assert.equal(fila.saldo_pendiente, 0);
  assert.equal(fila.monto_pagado, liquidacion.saldo);
  assert.equal(fila.estado_pago, 'pagado');
});

test('con dos puestos la deuda va solo en el principal; el otro sale incluido', async () => {
  const db = await initializeDatabase();
  const comerciante = await nuevoComerciante(db);
  const principal = await insertPuesto(db, puestoBase({ direccion: 'Doble A', codigo_puesto: 'DOB-A', comerciante_id: comerciante.id }));
  const segundo = await insertPuesto(db, puestoBase({ direccion: 'Doble B', codigo_puesto: 'DOB-B', comerciante_id: comerciante.id }));

  const filas = await getPuestos(db);
  const a = filas.find((item) => item.id === principal.id);
  const b = filas.find((item) => item.id === segundo.id);
  assert.equal(a.estado_pago, 'pendiente');
  assert.ok(a.saldo_pendiente > 0);
  assert.equal(b.estado_pago, 'incluido');
  assert.equal(b.saldo_pendiente, 0);
  assert.equal(b.puesto_principal, 'DOB-A');
});

test('los puestos dados de baja solo se listan si se piden', async () => {
  const db = await initializeDatabase();
  const puesto = await insertPuesto(db, puestoBase({ direccion: 'Baja X-01', codigo_puesto: 'BAJA-01' }));
  await deactivatePuesto(db, puesto.id);

  assert.ok(!(await getPuestos(db)).some((item) => item.id === puesto.id));
  const conBajas = await getPuestos(db, { incluirInactivos: true });
  assert.equal(conBajas.find((item) => item.id === puesto.id).estado_pago, 'inactivo');
  await assert.rejects(() => liberarPuesto(db, puesto.id), /baja/);
});

test('una zona inexistente o un mismo lugar ocupado por otro titular dan mensajes claros', async () => {
  const db = await initializeDatabase();
  await assert.rejects(() => insertPuesto(db, puestoBase({ direccion: 'Zona fantasma', zona_id: 9999 })), /zona elegida no existe/);

  const titular = await nuevoComerciante(db);
  await insertPuesto(db, puestoBase({ direccion: 'Lugar Único', comerciante_id: titular.id }));
  await assert.rejects(() => insertPuesto(db, puestoBase({ direccion: 'lugar único ' })), /ya está asignado/);
});
