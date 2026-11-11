/**
 * Un mes en que el comerciante estuvo de baja todo el mes no paga la cuota mensual (migración 0027, revisión del
 * 11/11/2026). Antes la cuota se cobraba todos los meses desde el alta: dado de baja en julio y reactivado en
 * noviembre, debía agosto, septiembre y octubre. El mes de la baja y el de la reactivación sí se cobran, como el
 * tipo de comerciante (0023): estuvo activo algunos días.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  calcularDeudaAcumulada, calcularLiquidacion, closeDatabase, currentPeriod, initializeDatabase, insertComerciante,
  insertPuesto, insertTarifa, insertZona, setInicioCobro, updateComerciante
} from '../src/db.js';
import { pool } from '../src/pg.js';

before(async () => {
  await initializeDatabase();
  await setInicioCobro(pool, '2026-01');
});
after(async () => { await closeDatabase(); });

let correlativo = 0;
const unico = () => `${process.pid}-${correlativo += 1}`;
let documento = 20444000000;

// Permanente con cuota mensual de S/ 30 de su rubro (zona sin tipo de vía), dado de alta en junio.
async function permanente() {
  const zona = await insertZona(pool, { nombre: `Zona baja ${unico()}` });
  const rubro = (await pool.query('INSERT INTO rubros (nombre) VALUES ($1) RETURNING id', [`rubro baja ${unico()}`])).rows[0].id;
  await insertTarifa(pool, {
    tipo_tarifa: 'fija', monto_fijo: 30, monto_variable: 0, unidad_medida: 'mensual', rubro_id: rubro, vigencia_inicio: '2026-01-01'
  }, { permitirInicioPasado: true });
  const merchant = await insertComerciante(pool, {
    dni_ruc: String(documento += 1), nombre: `Baja ${documento}`, rubro_id: rubro, zona_id: zona.id,
    tipo_comerciante: 'permanente', estado: 'activo', usuario_creador: 1
  });
  await insertPuesto(pool, { zona_id: zona.id, metros_cuadrados: 4, direccion: `Baja ${unico()}`, comerciante_id: merchant.id });
  await pool.query("UPDATE comerciantes SET creado_en = '2026-06-05T12:00:00-05:00' WHERE id = $1", [merchant.id]);
  return merchant;
}
// La baja se registra hoy (trigger); se mueve al día que se quiere simular.
async function darDeBaja(id, desde) {
  await updateComerciante(pool, id, { estado: 'inactivo' });
  await pool.query("UPDATE comerciantes_estado_cambios SET desde = $2 WHERE comerciante_id = $1 AND estado_nuevo = 'inactivo'", [id, desde]);
}
const saldos = (deuda) => Object.fromEntries(deuda.periodos.map((item) => [item.periodo, item.saldo]));

test('dado de baja en julio y reactivado hoy: no debe los meses de en medio', async () => {
  const merchant = await permanente();
  await darDeBaja(merchant.id, '2026-07-10');
  await updateComerciante(pool, merchant.id, { estado: 'activo' });

  const deuda = await calcularDeudaAcumulada(pool, merchant.id);
  const porMes = saldos(deuda);
  assert.equal(porMes['2026-06'], 30);
  assert.equal(porMes['2026-07'], 30, 'el mes de la baja se cobra');
  for (const mes of ['2026-08', '2026-09', '2026-10']) assert.equal(porMes[mes], undefined, `antes debía ${mes}`);
  assert.equal(porMes[currentPeriod()], 30, 'el mes de la reactivación se cobra');
  assert.equal(deuda.deuda_total, 90, 'antes eran S/ 180');

  const agosto = await calcularLiquidacion(pool, merchant.id, '2026-08');
  assert.equal(agosto.no_devengo, true);
  assert.equal(agosto.motivo, 'dado_de_baja');
});

test('de baja desde antes de este mes: la cuota del mes no se cobra', async () => {
  const merchant = await permanente();
  await darDeBaja(merchant.id, '2026-09-20');
  const mes = await calcularLiquidacion(pool, merchant.id, currentPeriod());
  assert.equal(mes.saldo, 0, 'antes mostraba S/ 30');
  assert.equal(mes.motivo, 'dado_de_baja');
  assert.equal((await calcularLiquidacion(pool, merchant.id, '2026-09')).saldo, 30, 'lo que debía antes de la baja se mantiene');
});

test('cada cambio de estado deja una fila; reenviar el mismo estado no', async () => {
  const merchant = await permanente();
  await updateComerciante(pool, merchant.id, { estado: 'inactivo' });
  await updateComerciante(pool, merchant.id, { estado: 'inactivo' });
  await updateComerciante(pool, merchant.id, { estado: 'activo' });
  const { rows } = await pool.query('SELECT estado_anterior, estado_nuevo FROM comerciantes_estado_cambios WHERE comerciante_id = $1 ORDER BY id', [merchant.id]);
  assert.deepEqual(rows.map((fila) => [fila.estado_anterior, fila.estado_nuevo]), [['activo', 'inactivo'], ['inactivo', 'activo']]);
});
