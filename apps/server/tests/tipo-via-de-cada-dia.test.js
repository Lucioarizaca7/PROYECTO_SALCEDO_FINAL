/**
 * Tipo de vía de cada día (migración 0021, decisión del usuario del 11/11/2026): si la calle de una zona se
 * asfalta, los días ya marcados siguen pagando S/ 2 y los nuevos S/ 3. Antes se recalculaba todo el mes (y los
 * meses pasados) con el tipo de vía actual, aunque ya estuviera pagado.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  calcularLiquidacion, closeDatabase, currentPeriod, initializeDatabase, insertComerciante, insertPuesto, insertZona,
  marcarAsistencias, registrarCobro, todayInLima, updateZona
} from '../src/db.js';
import { pool } from '../src/pg.js';

before(async () => { await initializeDatabase(); });
after(async () => { await closeDatabase(); });

const hoy = todayInLima();
const primeroDelMes = `${currentPeriod()}-01`;

test('asfaltar la calle no cambia lo que deben (ni lo que pagaron) los días anteriores', { skip: hoy === primeroDelMes && 'hace falta un día anterior en el mes' }, async () => {
  const zona = await insertZona(pool, { nombre: `Vía por asfaltar ${process.pid}`, tipo_via: 'sin_asfaltar' });
  const rubro = (await pool.query("SELECT id FROM rubros WHERE nombre = 'otros'")).rows[0].id;
  const comerciante = await insertComerciante(pool, {
    dni_ruc: `4655${String(process.pid).slice(-4).padStart(4, '0')}`, nombre: 'Ferial calle nueva', rubro_id: rubro, zona_id: zona.id,
    tipo_comerciante: 'ferial', estado: 'activo', usuario_creador: 1
  });
  const puesto = await insertPuesto(pool, { zona_id: zona.id, metros_cuadrados: 4, direccion: 'Calle por asfaltar', comerciante_id: comerciante.id });

  // Sin asfaltar: S/ 2 el primer día del mes, y se paga.
  await marcarAsistencias(pool, [{ puesto_id: puesto.id, fecha: primeroDelMes, asistio: true }], { usuarioId: 1 });
  assert.equal((await calcularLiquidacion(pool, comerciante.id)).monto_total, 2);
  await registrarCobro(pool, { comerciante_id: comerciante.id, cobrador_id: 1, monto: 2, metodo_pago: 'efectivo', periodo: currentPeriod() });

  // Se asfalta la calle y el comerciante viene hoy.
  await updateZona(pool, zona.id, { tipo_via: 'asfaltada' });
  await marcarAsistencias(pool, [{ puesto_id: puesto.id, fecha: hoy, asistio: true }], { usuarioId: 1 });

  const liquidacion = await calcularLiquidacion(pool, comerciante.id);
  assert.deepEqual(liquidacion.puestos_cobrados.map((item) => [item.dias, item.monto_dia]).sort(), [[1, 2], [1, 3]]);
  assert.equal(liquidacion.monto_total, 5, 'antes eran S/ 6: el primer día se recalculaba a S/ 3');
  assert.equal(liquidacion.saldo, 3, 'lo pagado por el primer día sigue cubriéndolo');

  const { rows: cambios } = await pool.query('SELECT via_anterior, via_nueva, desde FROM zonas_via_cambios WHERE zona_id = $1', [zona.id]);
  assert.deepEqual(cambios.map((item) => [item.via_anterior, item.via_nueva]), [['sin_asfaltar', 'asfaltada']]);

  // Una marca de un día anterior que llega después del cambio (sin señal) toma el tipo de vía de su fecha.
  const { rows: [marca] } = await pool.query(
    'SELECT tipo_via FROM asistencias_feriales WHERE puesto_id = $1 AND fecha = $2::date', [puesto.id, primeroDelMes]);
  assert.equal(marca.tipo_via, 'sin_asfaltar');
});
