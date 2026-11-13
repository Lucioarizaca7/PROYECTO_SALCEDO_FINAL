/**
 * La baja con el cobro por día cobrado (13/11/2026): ya no hay cuota mensual, así que un comerciante de baja no
 * debe nada mientras no se le cobren días, y no se le pueden marcar (11/11/2026). Lo que debía de los días
 * cobrados antes de la baja se mantiene. Antes (0027) se cuidaba que la cuota no se cobrara los meses de baja.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  calcularDeudaAcumulada, calcularLiquidacion, closeDatabase, currentPeriod, initializeDatabase, insertComerciante,
  insertPuesto, marcarAsistencias, setInicioCobro, todayInLima, updateComerciante
} from '../src/db.js';
import { pool } from '../src/pg.js';
import { marcarDias, zonaConPrecio } from './_deuda.js';

before(async () => {
  await initializeDatabase();
  await setInicioCobro(pool, '2026-01');
});
after(async () => { await closeDatabase(); });

let correlativo = 0;
const unico = () => `${process.pid}-${correlativo += 1}`;
let documento = 20444000000;

// Permanente en una zona de S/ 30 por día, dado de alta en junio.
async function permanente() {
  const zona = await zonaConPrecio(pool, 30);
  const merchant = await insertComerciante(pool, {
    dni_ruc: String(documento += 1), nombre: `Baja ${documento}`, rubro_id: 1, zona_id: zona.id,
    tipo_comerciante: 'permanente', estado: 'activo', usuario_creador: 1
  });
  const puesto = await insertPuesto(pool, { zona_id: zona.id, metros_cuadrados: 4, direccion: `Baja ${unico()}`, comerciante_id: merchant.id });
  await pool.query("UPDATE comerciantes SET creado_en = '2026-06-05T12:00:00-05:00' WHERE id = $1", [merchant.id]);
  return { ...merchant, puesto };
}
// La baja se registra hoy (trigger); se mueve al día que se quiere simular.
async function darDeBaja(id, desde) {
  await updateComerciante(pool, id, { estado: 'inactivo' });
  await pool.query("UPDATE comerciantes_estado_cambios SET desde = $2 WHERE comerciante_id = $1 AND estado_nuevo = 'inactivo'", [id, desde]);
}
const saldos = (deuda) => Object.fromEntries(deuda.periodos.map((item) => [item.periodo, item.saldo]));

test('dado de baja en julio y reactivado hoy: solo debe los días que se le cobraron', async () => {
  const merchant = await permanente();
  await marcarDias(pool, merchant.puesto.id, '2026-06', 1, { desde: 10 });
  await marcarDias(pool, merchant.puesto.id, '2026-07', 1, { desde: 5 });
  await darDeBaja(merchant.id, '2026-07-10');
  await updateComerciante(pool, merchant.id, { estado: 'activo' });

  const deuda = await calcularDeudaAcumulada(pool, merchant.id);
  const porMes = saldos(deuda);
  assert.equal(porMes['2026-06'], 30);
  assert.equal(porMes['2026-07'], 30, 'el día cobrado antes de la baja se debe');
  for (const mes of ['2026-08', '2026-09', '2026-10']) assert.equal(porMes[mes], undefined, `sin días cobrados en ${mes}`);
  assert.equal(deuda.deuda_total, 60);

  const agosto = await calcularLiquidacion(pool, merchant.id, '2026-08');
  assert.equal(agosto.no_devengo, true);
  assert.equal(agosto.motivo, 'sin_dias_cobrados');
});

test('de baja: no se le marcan días, el mes no se cobra y lo de antes de la baja se mantiene', async () => {
  const merchant = await permanente();
  await marcarDias(pool, merchant.puesto.id, '2026-09', 1, { desde: 6 });
  await darDeBaja(merchant.id, '2026-09-20');
  await assert.rejects(() => marcarAsistencias(pool, { puesto_id: merchant.puesto.id, fecha: todayInLima(), asistio: true }, { usuarioId: 1 }), /dado de baja/);
  const mes = await calcularLiquidacion(pool, merchant.id, currentPeriod());
  assert.equal(mes.saldo, 0);
  assert.equal(mes.motivo, 'sin_dias_cobrados');
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
