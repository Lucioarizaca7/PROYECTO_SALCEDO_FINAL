/**
 * Errores de lógica corregidos en cobros, liquidación y puestos:
 * - cobros simultáneos del mismo comerciante no pueden pasar del saldo;
 * - una tarifa nueva vigente desde el día 1 no borra lo ya pagado en el mes;
 * - editar un puesto sin coordenadas no lo manda a (0, 0).
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { calcularLiquidacion, closeDatabase, currentPeriod, initializeDatabase, insertComerciante, insertPuesto, insertTarifa, registrarCobro, updatePuesto } from '../src/db.js';
import { pool } from '../src/pg.js';
import { comercianteConDeuda } from './_deuda.js';

let correlativo = 0;
const idDe = async (tabla, nombre) => (await pool.query(`SELECT id FROM ${tabla} WHERE nombre = $1`, [nombre])).rows[0].id;

// Debe precio × días este mes (por omisión 3 días × S/ 30 = S/ 90, antes la cuota mensual de "otros").
async function nuevoComerciante(opciones = {}) {
  correlativo += 1;
  return comercianteConDeuda(pool, { nombre: `Prueba lógica ${correlativo}`, ...opciones });
}

const cobrar = (comercianteId, monto) => registrarCobro(pool, { comerciante_id: comercianteId, cobrador_id: 1, monto, metodo_pago: 'efectivo' });

before(async () => { await initializeDatabase(); });
after(async () => { await closeDatabase(); });

test('cobros simultáneos del mismo comerciante no pasan del saldo', async () => {
  const { merchant } = await nuevoComerciante();
  const { saldo } = await calcularLiquidacion(pool, merchant.id);
  assert.equal(saldo, 90);

  const resultados = await Promise.allSettled(Array.from({ length: 8 }, () => cobrar(merchant.id, 30)));
  const aceptados = resultados.filter((item) => item.status === 'fulfilled');
  const rechazados = resultados.filter((item) => item.status === 'rejected');

  assert.equal(aceptados.length, 3, 'solo caben tres cobros de S/ 30 en S/ 90');
  for (const item of rechazados) assert.match(item.reason.message, /excede el saldo pendiente/);
  const final = await calcularLiquidacion(pool, merchant.id);
  assert.equal(final.monto_pagado, 90);
  assert.equal(final.saldo, 0);
});

test('un precio nuevo de la zona desde el día 1 del mes no borra lo ya pagado', async () => {
  const { merchant, zona } = await nuevoComerciante({ dias: 5 }); // 5 × S/ 30 = S/ 150
  await cobrar(merchant.id, 100);
  assert.equal((await calcularLiquidacion(pool, merchant.id)).monto_pagado, 100);

  await insertTarifa(pool, { zona_id: zona.id, monto_fijo: 20, vigencia_inicio: `${currentPeriod()}-01` }, { permitirInicioPasado: true });

  const despues = await calcularLiquidacion(pool, merchant.id);
  assert.equal(Number(despues.tarifa.monto_fijo), 20, 'se aplica el precio nuevo');
  assert.equal(despues.monto_total, 100, '5 días × S/ 20');
  assert.equal(despues.monto_pagado, 100, 'lo cobrado con el precio anterior sigue contando');
  assert.equal(despues.saldo, 0);
});

test('editar un puesto sin coordenadas no lo manda a (0, 0)', async () => {
  const { merchant } = await nuevoComerciante();
  const zonaId = await idDe('zonas', 'Mercado Central');

  const sinUbicar = await insertPuesto(pool, { comerciante_id: merchant.id, zona_id: zonaId, direccion: 'Pasaje sin GPS 1', metros_cuadrados: 4, latitud: null, longitud: '' });
  assert.deepEqual([sinUbicar.latitud, sinUbicar.longitud], [null, null]);

  const editado = await updatePuesto(pool, sinUbicar.id, { direccion: 'Pasaje sin GPS 1-A' });
  assert.deepEqual([editado.latitud, editado.longitud], [null, null], 'sin coordenadas en el pedido se conservan vacías');

  const ubicado = await updatePuesto(pool, sinUbicar.id, { latitud: -15.8997, longitud: '-70.5881' });
  assert.deepEqual([ubicado.latitud, ubicado.longitud], [-15.8997, -70.5881]);

  const otraEdicion = await updatePuesto(pool, sinUbicar.id, { metros_cuadrados: 6 });
  assert.deepEqual([otraEdicion.latitud, otraEdicion.longitud], [-15.8997, -70.5881], 'se conservan las coordenadas actuales');

  const borrado = await updatePuesto(pool, sinUbicar.id, { latitud: null, longitud: null });
  assert.deepEqual([borrado.latitud, borrado.longitud], [null, null], 'null explícito las borra');
});
