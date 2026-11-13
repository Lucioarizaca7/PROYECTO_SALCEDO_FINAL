/**
 * Dos tarifas activas del mismo rubro, zona y tipo de vía no cruzan sus fechas
 * (migrations/0020_tarifas_sin_cruces.sql): crear una cierra la anterior o se rechaza.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { initializeDatabase, insertTarifa, updateTarifa, insertComerciante, calcularLiquidacion } from '../src/db.js';
import { ConflictError } from '../src/errors.js';

let correlativo = 0;
let documento = 20777000000;

async function preparar() {
  const db = await initializeDatabase();
  const rubro = await db.query('INSERT INTO rubros (nombre, descripcion) VALUES ($1, $2) RETURNING id', [`Rubro tarifas ${process.pid}-${correlativo += 1}-${Date.now()}`, 'Prueba']);
  return { db, rubroId: rubro.rows[0].id };
}

const tarifa = (db, rubroId, extra) => insertTarifa(db, { rubro_id: rubroId, tipo_tarifa: 'fija', monto_fijo: 10, unidad_medida: 'mensual', vigencia_inicio: '2026-01-01', ...extra }, { permitirInicioPasado: true });

test('una tarifa que empieza después cierra la anterior y los meses pasados no cambian', async () => {
  const { db, rubroId } = await preparar();
  const anterior = await tarifa(db, rubroId, { monto_fijo: 10 });
  const comerciante = await insertComerciante(db, {
    dni_ruc: String(documento += 1), nombre: `Titular ${documento}`, rubro_id: rubroId, zona_id: 1,
    tipo_comerciante: 'permanente', estado: 'activo', usuario_creador: 1
  });

  const nueva = await tarifa(db, rubroId, { monto_fijo: 15, vigencia_inicio: '2026-03-01' });

  assert.deepEqual(nueva.tarifas_cerradas, [{ id: anterior.id, vigencia_fin: '2026-02-28' }]);
  assert.equal((await calcularLiquidacion(db, comerciante.id, '2026-02')).monto_total, 10, 'febrero sigue con la anterior');
  assert.equal((await calcularLiquidacion(db, comerciante.id, '2026-03')).monto_total, 15, 'marzo ya va con la nueva');
  const cerrada = await db.query('SELECT version FROM tarifas WHERE id = $1', [anterior.id]);
  assert.equal(cerrada.rows[0].version, anterior.version + 1, 'editar con la versión vieja avisa del cambio');
});

test('se rechaza una tarifa que empieza el mismo día o antes, y no se cierra nada', async () => {
  const { db, rubroId } = await preparar();
  const anterior = await tarifa(db, rubroId, { vigencia_inicio: '2026-03-01' });

  await assert.rejects(() => tarifa(db, rubroId, { vigencia_inicio: '2026-03-01' }), ConflictError);
  await assert.rejects(() => tarifa(db, rubroId, { vigencia_inicio: '2026-01-01' }), /desde el 2026-03-01 en adelante/);

  const fila = await db.query('SELECT vigencia_fin FROM tarifas WHERE id = $1', [anterior.id]);
  assert.equal(fila.rows[0].vigencia_fin, null);
});

test('se rechaza una tarifa que termina antes que la anterior: quedaría un tramo sin tarifa', async () => {
  const { db, rubroId } = await preparar();
  await tarifa(db, rubroId, {});
  await assert.rejects(() => tarifa(db, rubroId, { vigencia_inicio: '2026-03-01', vigencia_fin: '2026-04-30' }), ConflictError);
});

test('fechas que no se cruzan conviven, y otra zona o tipo de vía no cuenta como cruce', async () => {
  const { db, rubroId } = await preparar();
  await tarifa(db, rubroId, { vigencia_fin: '2026-02-28' });
  const siguiente = await tarifa(db, rubroId, { vigencia_inicio: '2026-03-01' });
  assert.deepEqual(siguiente.tarifas_cerradas, []);

  const deZona = await tarifa(db, rubroId, { zona_id: 1 });
  assert.deepEqual(deZona.tarifas_cerradas, []);
  const deVia = await tarifa(db, rubroId, { tipo_via: 'asfaltada' });
  assert.deepEqual(deVia.tarifas_cerradas, []);
});

test('editar no cierra otra tarifa: si las fechas se cruzan, se rechaza', async () => {
  // Tarifas que todavía no empiezan: una que ya rigió no cambia su inicio (tarifas-vigentes.test.js).
  const { db, rubroId } = await preparar();
  await tarifa(db, rubroId, { vigencia_inicio: '2030-01-01', vigencia_fin: '2030-02-28' });
  const segunda = await tarifa(db, rubroId, { vigencia_inicio: '2030-03-01' });

  await assert.rejects(() => updateTarifa(db, segunda.id, { vigencia_inicio: '2030-02-01', version: segunda.version }), /del 2030-01-01 al 2030-02-28/);
  const movida = await updateTarifa(db, segunda.id, { vigencia_inicio: '2030-04-01', version: segunda.version });
  assert.equal(movida.vigencia_inicio, '2030-04-01');
});

test('la base rechaza un cruce aunque entre por otro camino', async () => {
  const { db, rubroId } = await preparar();
  await tarifa(db, rubroId, {});
  await assert.rejects(
    () => db.query(`INSERT INTO tarifas (rubro_id, tipo_tarifa, monto_fijo, unidad_medida, vigencia_inicio) VALUES ($1, 'fija', 5, 'mensual', '2026-06-01')`, [rubroId]),
    (error) => error.code === '23P01'
  );
  // Una inactiva no compite con nadie.
  await db.query(`INSERT INTO tarifas (rubro_id, tipo_tarifa, monto_fijo, unidad_medida, vigencia_inicio, activo) VALUES ($1, 'fija', 5, 'mensual', '2026-06-01', FALSE)`, [rubroId]);
});

test('dos altas a la vez: una cierra la anterior y la otra recibe un conflicto', async () => {
  const { db, rubroId } = await preparar();
  await tarifa(db, rubroId, {});
  const resultados = await Promise.allSettled([
    tarifa(db, rubroId, { vigencia_inicio: '2026-03-01' }),
    tarifa(db, rubroId, { vigencia_inicio: '2026-03-01' })
  ]);
  assert.equal(resultados.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(resultados.filter((item) => item.status === 'rejected').length, 1);
  const activas = await db.query(`SELECT count(*)::int AS total FROM tarifas WHERE rubro_id = $1 AND activo AND vigencia_inicio = '2026-03-01'`, [rubroId]);
  assert.equal(activas.rows[0].total, 1);
});
