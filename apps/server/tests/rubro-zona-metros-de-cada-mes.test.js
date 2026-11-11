/**
 * Rubro y zona del comerciante y metros del puesto rigen desde el cambio (migración 0025, revisión del
 * 11/11/2026). Antes un mes pasado se liquidaba con los de hoy: corregir un rubro, mover al comerciante de zona o
 * cambiar el metraje recalculaba meses ya pagados. Un mes pasado usa los del día 1 de ese mes.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  calcularLiquidacion, closeDatabase, currentPeriod, initializeDatabase, insertComerciante, insertPuesto, insertTarifa,
  insertZona, updateComerciante, updatePuesto
} from '../src/db.js';
import { pool } from '../src/pg.js';

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

// Zona sin tipo de vía: gana la tarifa del rubro o de la zona (no la general por día).
const zona = () => insertZona(pool, { nombre: `Zona historia ${unico()}` });
const rubro = async () => (await pool.query('INSERT INTO rubros (nombre) VALUES ($1) RETURNING id', [`rubro historia ${unico()}`])).rows[0].id;
const tarifaMensual = (extra) => insertTarifa(pool, {
  tipo_tarifa: 'fija', monto_fijo: 0, monto_variable: 0, unidad_medida: 'mensual', vigencia_inicio: `${mesPasado}-01`, ...extra
}, { permitirInicioPasado: true });
async function permanente(zonaId, rubroId) {
  const merchant = await insertComerciante(pool, {
    dni_ruc: String(documento += 1), nombre: `Historia ${documento}`, rubro_id: rubroId, zona_id: zonaId,
    tipo_comerciante: 'permanente', estado: 'activo', usuario_creador: 1
  });
  const puesto = await insertPuesto(pool, { zona_id: zonaId, metros_cuadrados: 4, direccion: `Historia ${unico()}`, comerciante_id: merchant.id });
  return { merchant, puesto };
}
const total = async (id, periodo) => (await calcularLiquidacion(pool, id, periodo)).monto_total;

test('cambiar el rubro no cambia lo que se debía en los meses pasados', async () => {
  const z = await zona();
  const [a, b] = [await rubro(), await rubro()];
  await tarifaMensual({ rubro_id: a, monto_fijo: 30 });
  await tarifaMensual({ rubro_id: b, monto_fijo: 50 });
  const { merchant } = await permanente(z.id, a);
  assert.equal(await total(merchant.id, mesPasado), 30);

  await updateComerciante(pool, merchant.id, { rubro_id: b });
  assert.equal(await total(merchant.id, mesPasado), 30, 'antes pasaba a S/ 50');
  assert.equal(await total(merchant.id, currentPeriod()), 50, 'desde el cambio, el rubro nuevo');
});

test('cambiar la zona del comerciante no cambia los meses pasados', async () => {
  const [z1, z2] = [await zona(), await zona()];
  const r = await rubro();
  await tarifaMensual({ rubro_id: r, zona_id: z1.id, monto_fijo: 20 });
  await tarifaMensual({ rubro_id: r, zona_id: z2.id, monto_fijo: 45 });
  const { merchant } = await permanente(z1.id, r);
  await updateComerciante(pool, merchant.id, { zona_id: z2.id });
  assert.equal(await total(merchant.id, mesPasado), 20, 'antes pasaba a S/ 45');
  assert.equal(await total(merchant.id, currentPeriod()), 45);
});

test('cambiar los metros del puesto no cambia los meses pasados; reenviar el mismo valor no deja rastro', async () => {
  const z = await zona();
  const r = await rubro();
  await tarifaMensual({ rubro_id: r, monto_variable: 5, unidad_medida: 'metro_cuadrado' });
  const { merchant, puesto } = await permanente(z.id, r);
  assert.equal(await total(merchant.id, mesPasado), 20, '4 m² × S/ 5');

  await updatePuesto(pool, puesto.id, { metros_cuadrados: 6 });
  await updatePuesto(pool, puesto.id, { metros_cuadrados: 6 });
  assert.equal(await total(merchant.id, mesPasado), 20, 'antes pasaba a S/ 30');
  assert.equal(await total(merchant.id, currentPeriod()), 30);

  const { rows } = await pool.query('SELECT metros_anterior::float AS antes, metros_nuevo::float AS despues FROM puestos_metros_cambios WHERE puesto_id = $1', [puesto.id]);
  assert.deepEqual(rows.map((fila) => [fila.antes, fila.despues]), [[4, 6]]);
});
