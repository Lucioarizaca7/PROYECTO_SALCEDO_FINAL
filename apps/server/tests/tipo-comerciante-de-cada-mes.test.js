/**
 * El tipo de comerciante rige desde el día del cambio (migración 0023, decisión del usuario del 11/11/2026).
 * Antes cada mes se liquidaba con el tipo actual: pasar a un ferial a eventual borraba su deuda atrasada (el
 * eventual no acumula), y pasar un eventual a permanente le creaba deuda de meses en que era eventual.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  calcularDeudaAcumulada, calcularLiquidacion, closeDatabase, currentPeriod, initializeDatabase, insertComerciante,
  insertPuesto, insertZona, setInicioCobro, tipoEnPeriodo, updateComerciante
} from '../src/db.js';
import { pool } from '../src/pg.js';

before(async () => { await initializeDatabase(); });
after(async () => { await closeDatabase(); });

const anterior = (periodo) => {
  const [anio, mes] = periodo.split('-').map(Number);
  return mes === 1 ? `${anio - 1}-12` : `${anio}-${String(mes - 1).padStart(2, '0')}`;
};

test('tipoEnPeriodo: cada mes con el tipo que tenía; un mes con días de ferial no cuenta como eventual', () => {
  const cambios = [{ tipo_anterior: 'ferial', tipo_nuevo: 'eventual', desde: '2026-10-15' }];
  assert.equal(tipoEnPeriodo('eventual', cambios, '2026-09', '2026-11'), 'ferial', 'mes entero como ferial');
  assert.equal(tipoEnPeriodo('eventual', cambios, '2026-10', '2026-11'), 'ferial', 'el mes del cambio tuvo días de ferial');
  assert.equal(tipoEnPeriodo('eventual', cambios, '2026-11', '2026-11'), 'eventual', 'el mes en curso usa el tipo actual');

  const alReves = [{ tipo_anterior: 'eventual', tipo_nuevo: 'permanente', desde: '2026-10-15' }];
  assert.equal(tipoEnPeriodo('permanente', alReves, '2026-09', '2026-11'), 'eventual', 'antes del cambio no acumulaba');
  assert.equal(tipoEnPeriodo('permanente', alReves, '2026-10', '2026-11'), 'permanente');
  // Un cambio el día 1 ya rige todo ese mes.
  assert.equal(tipoEnPeriodo('permanente', [{ tipo_anterior: 'eventual', tipo_nuevo: 'permanente', desde: '2026-10-01' }], '2026-10', '2026-11'), 'permanente');
  assert.equal(tipoEnPeriodo('ferial', [], '2026-01', '2026-11'), 'ferial', 'sin cambios, el actual');
});

test('pasar a un ferial a eventual no borra los días que debe del mes pasado', async () => {
  const mesPasado = anterior(currentPeriod());
  await setInicioCobro(pool, mesPasado);
  const zona = await insertZona(pool, { nombre: `Zona tipo ${process.pid}`, tipo_via: 'asfaltada' });
  const rubro = (await pool.query("SELECT id FROM rubros WHERE nombre = 'ropa'")).rows[0].id;
  const comerciante = await insertComerciante(pool, {
    dni_ruc: `4657${String(process.pid).slice(-4).padStart(4, '0')}`, nombre: 'Ferial que pasa a eventual', rubro_id: rubro,
    zona_id: zona.id, tipo_comerciante: 'ferial', estado: 'activo', usuario_creador: 1
  });
  await pool.query(`UPDATE comerciantes SET creado_en = $2::date WHERE id = $1`, [comerciante.id, `${mesPasado}-01`]);
  const puesto = await insertPuesto(pool, { zona_id: zona.id, metros_cuadrados: 4, direccion: 'Puesto que cambia de tipo', comerciante_id: comerciante.id });
  // Dos días marcados el mes pasado, sin pagar (con la tarifa que regía ese mes).
  for (const dia of ['10', '17']) {
    await pool.query(`INSERT INTO asistencias_feriales (puesto_id, fecha, sesion, marca, fuente) VALUES ($1, $2::date, '', 'P', 'app')`,
      [puesto.id, `${mesPasado}-${dia}`]);
  }
  const debia = (await calcularLiquidacion(pool, comerciante.id, mesPasado)).saldo;
  assert.ok(debia > 0);

  await updateComerciante(pool, comerciante.id, { tipo_comerciante: 'eventual' });
  const { rows: cambios } = await pool.query('SELECT tipo_anterior, tipo_nuevo FROM comerciantes_tipo_cambios WHERE comerciante_id = $1', [comerciante.id]);
  assert.deepEqual(cambios.map((item) => [item.tipo_anterior, item.tipo_nuevo]), [['ferial', 'eventual']]);

  assert.equal((await calcularLiquidacion(pool, comerciante.id, mesPasado)).saldo, debia, 'antes daba 0: el mes se recalculaba como eventual');
  const deuda = await calcularDeudaAcumulada(pool, comerciante.id);
  assert.deepEqual(deuda.meses_impagos, [mesPasado], 'antes la deuda atrasada desaparecía');
  assert.equal(deuda.deuda_vencida, debia);
});
