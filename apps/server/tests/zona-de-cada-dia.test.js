/**
 * Cada día marcado se cobra con la zona que tenía el puesto ese día (migrations/0019_zona_de_cada_dia.sql):
 * cambiar la zona no recalcula lo pasado, salvo al asignar una "zona por regularizar".
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  initializeDatabase, insertComerciante, insertPuesto, insertZona, updatePuesto, calcularLiquidacion,
  marcarAsistencias, seriesDelComerciante, todayInLima
} from '../src/db.js';

let documento = 20999000000;
let correlativoZona = 0;
const PERIODO = '2026-09';

const rubroId = async (db, nombre) => (await db.query('SELECT id FROM rubros WHERE nombre = $1', [nombre])).rows[0].id;

// Tarifas por día cobrado desde septiembre de 2026, hasta el mes anterior al de las que trae la migración 0013.
async function preparar() {
  const db = await initializeDatabase();
  await db.query(`
    INSERT INTO tarifas (rubro_id, tipo_via, tipo_tarifa, monto_fijo, monto_variable, unidad_medida, vigencia_inicio, vigencia_fin)
    SELECT NULL, via.tipo_via, 'fija', via.monto, 0, 'semanal', DATE '2026-09-01', date_trunc('month', now() AT TIME ZONE 'America/Lima')::date - 1
    FROM (VALUES ('asfaltada', 3), ('sin_asfaltar', 2)) AS via (tipo_via, monto)
    WHERE NOT EXISTS (SELECT 1 FROM tarifas t WHERE t.rubro_id IS NULL AND t.tipo_via = via.tipo_via AND t.vigencia_inicio = DATE '2026-09-01')`);
  const nuevaZona = (tipoVia) => insertZona(db, { nombre: `Zona de cada día ${process.pid}-${correlativoZona += 1}-${Date.now()}`, tipo_via: tipoVia });
  return { db, asfaltada: await nuevaZona('asfaltada'), sinAsfaltar: await nuevaZona('sin_asfaltar') };
}

async function puestoConTitular(db, zona) {
  const titular = await insertComerciante(db, {
    dni_ruc: String(documento += 1), nombre: `Titular ${documento}`, rubro_id: await rubroId(db, 'otros'), zona_id: zona.id,
    tipo_comerciante: 'permanente', estado: 'activo', usuario_creador: 1
  });
  const puesto = await insertPuesto(db, { zona_id: zona.id, metros_cuadrados: 4, direccion: `Puesto ${documento}`, comerciante_id: titular.id });
  return { titular, puesto };
}

const marcar = (db, puesto, fechas) => marcarAsistencias(db, fechas.map((fecha) => ({ puesto_id: puesto.id, fecha, asistio: true })), { usuarioId: 2 });

test('cambiar la zona no recalcula los días ya marcados', async () => {
  const { db, asfaltada, sinAsfaltar } = await preparar();
  const { titular, puesto } = await puestoConTitular(db, asfaltada);
  await marcar(db, puesto, ['2026-09-06', '2026-09-13']);
  assert.equal((await calcularLiquidacion(db, titular.id, PERIODO)).monto_total, 6);

  await updatePuesto(db, puesto.id, { zona_id: sinAsfaltar.id });

  const liquidacion = await calcularLiquidacion(db, titular.id, PERIODO);
  assert.equal(liquidacion.monto_total, 6, 'los dos días siguen valiendo S/ 3');
  assert.equal(liquidacion.dias_asistidos, 2);
  const cambios = await db.query('SELECT zona_anterior_id, zona_nueva_id, corrige_pasado FROM puestos_zona_cambios WHERE puesto_id = $1', [puesto.id]);
  assert.deepEqual(cambios.rows, [{ zona_anterior_id: asfaltada.id, zona_nueva_id: sinAsfaltar.id, corrige_pasado: false }]);
});

test('la zona nueva rige desde el día del cambio, también para una marca de hoy', async () => {
  const { db, asfaltada, sinAsfaltar } = await preparar();
  const { puesto } = await puestoConTitular(db, asfaltada);
  const hoy = todayInLima();
  await marcar(db, puesto, ['2026-09-06', hoy]);

  await updatePuesto(db, puesto.id, { zona_id: sinAsfaltar.id });

  const zonas = await db.query(`SELECT fecha::text AS fecha, zona_id FROM asistencias_feriales WHERE puesto_id = $1 ORDER BY fecha`, [puesto.id]);
  assert.deepEqual(zonas.rows, [{ fecha: '2026-09-06', zona_id: asfaltada.id }, { fecha: hoy, zona_id: sinAsfaltar.id }]);
});

test('un mes con cambio de zona cobra cada tramo con su tarifa y una marca atrasada toma la zona de su fecha', async () => {
  const { db, asfaltada, sinAsfaltar } = await preparar();
  const { titular, puesto } = await puestoConTitular(db, asfaltada);
  await marcar(db, puesto, ['2026-09-06']);
  // Simula un cambio con fecha del 10/09: el trigger siempre registra hoy.
  await db.query(`UPDATE puestos SET zona_id = $1 WHERE id = $2`, [sinAsfaltar.id, puesto.id]);
  await db.query(`UPDATE puestos_zona_cambios SET desde = DATE '2026-09-10' WHERE puesto_id = $1`, [puesto.id]);

  // Llega sin señal después del cambio, pero es de antes: va con la zona anterior.
  await marcar(db, puesto, ['2026-09-08', '2026-09-20']);
  await db.query(`UPDATE asistencias_feriales SET zona_id = $1 WHERE puesto_id = $2 AND fecha = DATE '2026-09-20'`, [sinAsfaltar.id, puesto.id]);

  const liquidacion = await calcularLiquidacion(db, titular.id, PERIODO);
  assert.equal(liquidacion.monto_total, 8, 'S/ 3 × 2 días + S/ 2 × 1 día');
  assert.equal(liquidacion.monto_dia, null, 'hay dos montos por día');
  assert.deepEqual(liquidacion.puestos_cobrados.map((item) => [item.puesto_id, item.dias, item.monto_dia]), [[Number(puesto.id), 2, 3], [Number(puesto.id), 1, 2]]);
});

test('una zona por regularizar es provisional: asignarla corrige también lo pasado', async () => {
  const { db, asfaltada, sinAsfaltar } = await preparar();
  const { titular, puesto } = await puestoConTitular(db, asfaltada);
  await db.query(`UPDATE puestos SET zona_por_regularizar = '' WHERE id = $1`, [puesto.id]);
  await marcar(db, puesto, ['2026-09-06', '2026-09-13']);
  assert.equal((await calcularLiquidacion(db, titular.id, PERIODO)).monto_total, 6);

  await updatePuesto(db, puesto.id, { zona_id: sinAsfaltar.id });

  assert.equal((await calcularLiquidacion(db, titular.id, PERIODO)).monto_total, 4, 'los dos días pasan a S/ 2');
  const cambios = await db.query('SELECT corrige_pasado FROM puestos_zona_cambios WHERE puesto_id = $1', [puesto.id]);
  assert.deepEqual(cambios.rows, [{ corrige_pasado: true }]);
});

test('guardar el puesto sin cambiar la zona no registra un cambio', async () => {
  const { db, asfaltada } = await preparar();
  const { puesto } = await puestoConTitular(db, asfaltada);
  await updatePuesto(db, puesto.id, { zona_id: asfaltada.id, direccion: `Otra dirección ${documento}` });
  const cambios = await db.query('SELECT 1 FROM puestos_zona_cambios WHERE puesto_id = $1', [puesto.id]);
  assert.equal(cambios.rowCount, 0);
});

test('los días de la zona anterior se pueden pagar con la serie de esa zona', async () => {
  const { db, asfaltada, sinAsfaltar } = await preparar();
  const { titular, puesto } = await puestoConTitular(db, asfaltada);
  await marcar(db, puesto, ['2026-09-06']);
  await updatePuesto(db, puesto.id, { zona_id: sinAsfaltar.id });

  const series = await seriesDelComerciante(db, titular, PERIODO);
  assert.deepEqual(series.map((item) => item.serie).sort(), ['S2', 'S3']);
});
