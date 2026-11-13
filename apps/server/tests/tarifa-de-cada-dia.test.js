/**
 * Tarifas en el tiempo (decisiones del usuario del 11/11/2026):
 * - cada día cobrado se cobra con la tarifa vigente ese día. Antes se tomaba la del día 1 del mes: una tarifa
 *   nueva "desde hoy" recién se aplicaba el mes siguiente, aunque la pantalla dijera "desde hoy";
 * - una tarifa nueva no empieza antes de hoy: con una fecha pasada cerraba la anterior hacia atrás y
 *   recalculaba meses ya cobrados.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  calcularLiquidacion, closeDatabase, currentPeriod, initializeDatabase, insertComerciante, insertPuesto, insertTarifa,
  insertZona, marcarAsistencias, todayInLima, updateTarifa
} from '../src/db.js';
import { pool } from '../src/pg.js';

before(async () => { await initializeDatabase(); });
after(async () => { await closeDatabase(); });

const hoy = todayInLima();
const primeroDelMes = `${currentPeriod()}-01`;
const rubroOtros = async () => (await pool.query("SELECT id FROM rubros WHERE nombre = 'otros'")).rows[0].id;

test('una tarifa nueva desde hoy cobra desde hoy; los días anteriores siguen con la anterior', { skip: hoy === primeroDelMes && 'hace falta un día anterior en el mes' }, async () => {
  const zona = await insertZona(pool, { nombre: `Zona tarifa del día ${process.pid}`, tipo_via: 'asfaltada' });
  const comerciante = await insertComerciante(pool, {
    dni_ruc: `4658${String(process.pid).slice(-4).padStart(4, '0')}`, nombre: 'Ferial tarifa del día', rubro_id: await rubroOtros(),
    zona_id: zona.id, tipo_comerciante: 'ferial', estado: 'activo', usuario_creador: 1
  });
  const puesto = await insertPuesto(pool, { zona_id: zona.id, metros_cuadrados: 4, direccion: 'Puesto tarifa del día', comerciante_id: comerciante.id });
  await pool.query(`INSERT INTO asistencias_feriales (puesto_id, fecha, sesion, marca, fuente) VALUES ($1, $2::date, '', 'P', 'app')`, [puesto.id, primeroDelMes]);
  await marcarAsistencias(pool, [{ puesto_id: puesto.id, fecha: hoy, asistio: true }], { usuarioId: 1 });
  assert.equal((await calcularLiquidacion(pool, comerciante.id)).monto_total, 6, 'dos días a S/ 3');

  // Ordenanza nueva: S/ 4 la vía asfaltada desde hoy. Cierra la general anterior ayer.
  await insertTarifa(pool, { rubro_id: '', tipo_via: 'asfaltada', tipo_tarifa: 'fija', monto_fijo: 4, unidad_medida: 'semanal', vigencia_inicio: hoy });

  const liquidacion = await calcularLiquidacion(pool, comerciante.id);
  assert.deepEqual(liquidacion.puestos_cobrados.map((item) => [item.dias, item.monto_dia]).sort(), [[1, 3], [1, 4]]);
  assert.equal(liquidacion.monto_total, 7, 'antes seguía en S/ 6 hasta el mes siguiente');
  assert.equal(Number(liquidacion.tarifa.monto_fijo), 4, 'la tarifa que se informa es la que rige hoy');
});

test('una tarifa nueva no empieza antes de hoy, ni una futura se mueve al pasado', async () => {
  const rubro = (await pool.query('INSERT INTO rubros (nombre) VALUES ($1) RETURNING id', [`rubro fechas ${process.pid}`])).rows[0].id;
  const base = { rubro_id: rubro, tipo_tarifa: 'fija', monto_fijo: 10, unidad_medida: 'mensual' };
  await assert.rejects(insertTarifa(pool, { ...base, vigencia_inicio: '2026-01-01' }), /no puede empezar antes de hoy/);

  const futura = await insertTarifa(pool, { ...base, vigencia_inicio: '2031-01-01' });
  await assert.rejects(updateTarifa(pool, futura.id, { vigencia_inicio: '2026-01-01', version: futura.version }), /no puede empezar antes de hoy/);
  const movida = await updateTarifa(pool, futura.id, { vigencia_inicio: '2031-02-01', version: futura.version });
  assert.equal(movida.vigencia_inicio, '2031-02-01', 'a otra fecha futura sí se mueve');
});
