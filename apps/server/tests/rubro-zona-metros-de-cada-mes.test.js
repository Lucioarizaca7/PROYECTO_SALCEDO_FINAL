/**
 * Rubro y zona del comerciante y metros del puesto (migración 0025, revisión del 11/11/2026). Desde el 13/11/2026
 * el precio es el de la zona de cada día cobrado: ni el rubro ni los metros cambian lo que se debe, y un día ya
 * marcado conserva su zona aunque después el comerciante pase a otra. Los cambios siguen quedando en su historia.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  calcularLiquidacion, closeDatabase, currentPeriod, initializeDatabase, insertComerciante, insertPuesto,
  updateComerciante, updatePuesto
} from '../src/db.js';
import { pool } from '../src/pg.js';
import { marcarDias, zonaConPrecio } from './_deuda.js';

before(async () => { await initializeDatabase(); });
after(async () => { await closeDatabase(); });

const anterior = (periodo) => {
  const [anio, mes] = periodo.split('-').map(Number);
  return mes === 1 ? `${anio - 1}-12` : `${anio}-${String(mes - 1).padStart(2, '0')}`;
};
const mesPasado = anterior(currentPeriod());
let correlativo = 0;
const unico = () => `${process.pid}-${correlativo += 1}`;
let documento = 20333000000;

const rubro = async () => (await pool.query('INSERT INTO rubros (nombre) VALUES ($1) RETURNING id', [`rubro historia ${unico()}`])).rows[0].id;
// Permanente con un día cobrado el mes pasado y otro este mes.
async function permanente(zonaId, rubroId) {
  const merchant = await insertComerciante(pool, {
    dni_ruc: String(documento += 1), nombre: `Historia ${documento}`, rubro_id: rubroId, zona_id: zonaId,
    tipo_comerciante: 'permanente', estado: 'activo', usuario_creador: 1
  });
  const puesto = await insertPuesto(pool, { zona_id: zonaId, metros_cuadrados: 4, direccion: `Historia ${unico()}`, comerciante_id: merchant.id });
  await marcarDias(pool, puesto.id, mesPasado, 1);
  await marcarDias(pool, puesto.id, currentPeriod(), 1);
  return { merchant, puesto };
}
const total = async (id, periodo) => (await calcularLiquidacion(pool, id, periodo)).monto_total;

test('cambiar el rubro no cambia lo que se debe: el precio es de la zona', async () => {
  const z = await zonaConPrecio(pool, 30);
  const { merchant } = await permanente(z.id, await rubro());
  assert.equal(await total(merchant.id, mesPasado), 30);

  await updateComerciante(pool, merchant.id, { rubro_id: await rubro() });
  assert.equal(await total(merchant.id, mesPasado), 30);
  assert.equal(await total(merchant.id, currentPeriod()), 30);
});

test('cambiar la zona del comerciante no cambia los días ya marcados', async () => {
  const [z1, z2] = [await zonaConPrecio(pool, 20), await zonaConPrecio(pool, 45)];
  const { merchant } = await permanente(z1.id, await rubro());
  await updateComerciante(pool, merchant.id, { zona_id: z2.id });
  assert.equal(await total(merchant.id, mesPasado), 20, 'el día marcado conserva la zona donde vendió');
  assert.equal(await total(merchant.id, currentPeriod()), 20);
});

test('cambiar los metros del puesto no cambia lo que se debe; reenviar el mismo valor no deja rastro', async () => {
  const z = await zonaConPrecio(pool, 5);
  const { merchant, puesto } = await permanente(z.id, await rubro());
  assert.equal(await total(merchant.id, mesPasado), 5, 'un día × S/ 5, sin metros');

  await updatePuesto(pool, puesto.id, { metros_cuadrados: 6 });
  await updatePuesto(pool, puesto.id, { metros_cuadrados: 6 });
  assert.equal(await total(merchant.id, mesPasado), 5);
  assert.equal(await total(merchant.id, currentPeriod()), 5);

  const { rows } = await pool.query('SELECT metros_anterior::float AS antes, metros_nuevo::float AS despues FROM puestos_metros_cambios WHERE puesto_id = $1', [puesto.id]);
  assert.deepEqual(rows.map((fila) => [fila.antes, fila.despues]), [[4, 6]]);
});
