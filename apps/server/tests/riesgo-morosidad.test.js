/**
 * Riesgo de morosidad (11/11/2026):
 * - antes solo se puntuaba a los primeros 300 comerciantes por id: con el padrón importado, el resto nunca
 *   salía en las alertas ni en los conteos;
 * - la deuda del puntaje era solo la del mes y, a quien paga por día, se le contaba 0;
 * - el recálculo del día corría dentro de la carga del panel. Ahora corre por detrás y mientras tanto se
 *   muestra el puntaje anterior con `actualizando` (decisión del usuario).
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  closeDatabase, esperarRecalculoRiesgo, getRiskDashboard, initializeDatabase, insertComerciante, insertPuesto, insertZona,
  marcarAsistencias, recalcularRiesgoMorosidad, scoreMorosidadComerciante, todayInLima
} from '../src/db.js';
import { pool } from '../src/pg.js';
import { insertZonaConPrecio } from './_deuda.js';

let documento = 48990000;
const rubroId = async (nombre) => (await pool.query('SELECT id FROM rubros WHERE nombre = $1', [nombre])).rows[0].id;

const filasDeHoy = async () => (await pool.query(`
  SELECT entidad_id, score, nivel, metricas FROM modelos_ia_metricas
  WHERE modelo = 'riesgo_morosidad' AND entidad_tipo = 'comerciante'
    AND (generado_en AT TIME ZONE 'America/Lima')::date = $1::date`, [todayInLima()])).rows;

let zonaAsfaltada;
let porDia;

before(async () => {
  await initializeDatabase();
  // Más de 300 comerciantes de una vez (el tope de antes), con documentos que no chocan con otras pruebas.
  await pool.query(`
    INSERT INTO comerciantes (dni_ruc, nombre, rubro_id, zona_id, tipo_comerciante, estado)
    SELECT '7700' || lpad(n::text, 4, '0'), 'Padrón grande ' || n, (SELECT id FROM rubros ORDER BY id LIMIT 1),
           (SELECT id FROM zonas ORDER BY id LIMIT 1), 'permanente', CASE WHEN n % 50 = 0 THEN 'inactivo' ELSE 'activo' END
    FROM generate_series(1, 320) AS n`);

  // Paga por día cobrado: S/ 3 por puesto y día marcado en vía asfaltada; hoy asistió y no pagó.
  zonaAsfaltada = await insertZonaConPrecio(pool, { nombre: `Riesgo asfaltada ${process.pid}`, tipo_via: 'asfaltada' });
  porDia = await insertComerciante(pool, {
    dni_ruc: String(documento += 1), nombre: 'Riesgo por día', rubro_id: await rubroId('otros'), zona_id: zonaAsfaltada.id,
    tipo_comerciante: 'ferial', estado: 'activo', usuario_creador: 1
  });
  const puesto = await insertPuesto(pool, { zona_id: zonaAsfaltada.id, metros_cuadrados: 4, direccion: 'Riesgo por día', comerciante_id: porDia.id });
  await marcarAsistencias(pool, [{ puesto_id: puesto.id, fecha: todayInLima(), asistio: true }], { usuarioId: 2 });

  // Sin puntaje previo, la primera carga espera el cálculo (la lista no sale vacía).
  const primero = await getRiskDashboard(pool, { limit: 20 });
  assert.equal(primero.actualizando, false);
  assert.ok(primero.calculado_el);
});

after(async () => {
  await esperarRecalculoRiesgo();
  await closeDatabase();
});

test('se puntúa a todo el padrón no dado de baja, no solo a los primeros 300', async () => {
  const { rows: [{ vigentes }] } = await pool.query(`SELECT COUNT(*)::int AS vigentes FROM comerciantes WHERE estado <> 'inactivo'`);
  assert.ok(vigentes > 300);
  const { summary } = await getRiskDashboard(pool, { limit: 5 });
  assert.equal(summary.total, vigentes);
  assert.equal(summary.bajo + summary.medio + summary.alto + summary.critico, vigentes);
});

test('quien paga por día y debe días cobrados tiene deuda en su puntaje', async () => {
  const fila = (await filasDeHoy()).find((item) => Number(item.entidad_id) === porDia.id);
  assert.ok(fila, 'el comerciante por día tiene puntaje de hoy');
  assert.ok(Number(fila.metricas.deuda_total) > 0, 'antes se le contaba deuda 0');
  assert.notEqual(fila.nivel, 'bajo');
});

test('el cálculo del padrón da lo mismo que el de un comerciante', async () => {
  const deHoy = new Map((await filasDeHoy()).map((item) => [Number(item.entidad_id), item]));
  const { rows: muestra } = await pool.query(`
    SELECT id FROM comerciantes WHERE estado <> 'inactivo' AND (id = $1 OR id IN (SELECT id FROM comerciantes ORDER BY id LIMIT 3))`, [porDia.id]);
  for (const { id } of muestra) {
    const individual = await scoreMorosidadComerciante(pool, id);
    const lote = deHoy.get(Number(id));
    assert.equal(Number(lote.score), individual.score, `score del comerciante ${id}`);
    assert.equal(lote.nivel, individual.nivel);
    assert.equal(Number(lote.metricas.deuda_total), individual.deuda_total);
  }
});

test('si el puntaje es de ayer, el panel responde con el anterior y recalcula por detrás', async () => {
  // Se lleva todo el puntaje a ayer: así queda "viejo" para hoy.
  await pool.query(`UPDATE modelos_ia_metricas SET generado_en = generado_en - interval '1 day' WHERE modelo = 'riesgo_morosidad'`);
  const respuesta = await getRiskDashboard(pool, { limit: 3 });
  assert.equal(respuesta.actualizando, true);
  assert.ok(respuesta.summary.total > 300, 'mientras tanto muestra el puntaje anterior');
  assert.notEqual(todayInLima(new Date(respuesta.calculado_el)), todayInLima());

  await esperarRecalculoRiesgo();
  const luego = await getRiskDashboard(pool, { limit: 3 });
  assert.equal(luego.actualizando, false);
  assert.equal(todayInLima(new Date(luego.calculado_el)), todayInLima());
});

test('dos recálculos a la vez dejan un solo puntaje por comerciante en el día', async () => {
  await esperarRecalculoRiesgo();
  await pool.query(`UPDATE modelos_ia_metricas SET generado_en = generado_en - interval '1 day' WHERE modelo = 'riesgo_morosidad'`);
  const resultados = await Promise.all([recalcularRiesgoMorosidad(pool), recalcularRiesgoMorosidad(pool)]);
  assert.equal(resultados.filter((item) => item.guardado).length, 1);

  const { rows: [{ duplicados }] } = await pool.query(`
    SELECT COUNT(*)::int AS duplicados FROM (
      SELECT entidad_id FROM modelos_ia_metricas
      WHERE modelo = 'riesgo_morosidad' AND (generado_en AT TIME ZONE 'America/Lima')::date = $1::date
      GROUP BY entidad_id HAVING COUNT(*) > 1) d`, [todayInLima()]);
  assert.equal(duplicados, 0);
});
