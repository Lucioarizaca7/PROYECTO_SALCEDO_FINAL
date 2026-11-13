/**
 * Dos precios activos de la misma zona no cruzan sus fechas (migrations/0020_tarifas_sin_cruces.sql, y desde la
 * 0032 cada tarifa es el precio por día de una zona): crear uno cierra el anterior o se rechaza.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { initializeDatabase, insertTarifa, updateTarifa, insertComerciante, insertPuesto, insertZona, calcularLiquidacion } from '../src/db.js';
import { ConflictError } from '../src/errors.js';
import { marcarDias } from './_deuda.js';

let correlativo = 0;
let documento = 20777000000;

async function preparar() {
  const db = await initializeDatabase();
  const zona = await insertZona(db, { nombre: `Zona tarifas ${process.pid}-${correlativo += 1}-${Date.now()}` });
  return { db, zonaId: zona.id };
}

const tarifa = (db, zonaId, extra) => insertTarifa(db, { zona_id: zonaId, monto_fijo: 10, vigencia_inicio: '2026-01-01', ...extra }, { permitirInicioPasado: true });

test('un precio que empieza después cierra el anterior y los meses pasados no cambian', async () => {
  const { db, zonaId } = await preparar();
  const anterior = await tarifa(db, zonaId, { monto_fijo: 10 });
  const comerciante = await insertComerciante(db, {
    dni_ruc: String(documento += 1), nombre: `Titular ${documento}`, rubro_id: 1, zona_id: zonaId,
    tipo_comerciante: 'permanente', estado: 'activo', usuario_creador: 1
  });
  const puesto = await insertPuesto(db, { comerciante_id: comerciante.id, zona_id: zonaId, direccion: `Cruces ${documento}` });
  await marcarDias(db, puesto.id, '2026-02', 2);
  await marcarDias(db, puesto.id, '2026-03', 2);

  const nueva = await tarifa(db, zonaId, { monto_fijo: 15, vigencia_inicio: '2026-03-01' });

  assert.deepEqual(nueva.tarifas_cerradas, [{ id: anterior.id, vigencia_fin: '2026-02-28' }]);
  assert.equal((await calcularLiquidacion(db, comerciante.id, '2026-02')).monto_total, 20, 'febrero sigue con el anterior: 2 días × 10');
  assert.equal((await calcularLiquidacion(db, comerciante.id, '2026-03')).monto_total, 30, 'marzo ya va con el nuevo: 2 días × 15');
  const cerrada = await db.query('SELECT version FROM tarifas WHERE id = $1', [anterior.id]);
  assert.equal(cerrada.rows[0].version, anterior.version + 1, 'editar con la versión vieja avisa del cambio');
});

test('se rechaza un precio que empieza el mismo día o antes, y no se cierra nada', async () => {
  const { db, zonaId } = await preparar();
  const anterior = await tarifa(db, zonaId, { vigencia_inicio: '2026-03-01' });

  await assert.rejects(() => tarifa(db, zonaId, { vigencia_inicio: '2026-03-01' }), ConflictError);
  await assert.rejects(() => tarifa(db, zonaId, { vigencia_inicio: '2026-01-01' }), /desde el 2026-03-01 en adelante/);

  const fila = await db.query('SELECT vigencia_fin FROM tarifas WHERE id = $1', [anterior.id]);
  assert.equal(fila.rows[0].vigencia_fin, null);
});

test('se rechaza un precio que termina antes que el anterior: quedaría un tramo sin precio', async () => {
  const { db, zonaId } = await preparar();
  await tarifa(db, zonaId, {});
  await assert.rejects(() => tarifa(db, zonaId, { vigencia_inicio: '2026-03-01', vigencia_fin: '2026-04-30' }), ConflictError);
});

test('fechas que no se cruzan conviven, y otra zona no cuenta como cruce', async () => {
  const { db, zonaId } = await preparar();
  await tarifa(db, zonaId, { vigencia_fin: '2026-02-28' });
  const siguiente = await tarifa(db, zonaId, { vigencia_inicio: '2026-03-01' });
  assert.deepEqual(siguiente.tarifas_cerradas, []);

  const otra = await preparar();
  const deOtraZona = await tarifa(db, otra.zonaId, {});
  assert.deepEqual(deOtraZona.tarifas_cerradas, []);
});

test('editar no cierra otro precio: si las fechas se cruzan, se rechaza', async () => {
  // Precios que todavía no empiezan: uno que ya rigió no cambia su inicio (tarifas-vigentes.test.js).
  const { db, zonaId } = await preparar();
  await tarifa(db, zonaId, { vigencia_inicio: '2030-01-01', vigencia_fin: '2030-02-28' });
  const segunda = await tarifa(db, zonaId, { vigencia_inicio: '2030-03-01' });

  await assert.rejects(() => updateTarifa(db, segunda.id, { vigencia_inicio: '2030-02-01', version: segunda.version }), /del 2030-01-01 al 2030-02-28/);
  const movida = await updateTarifa(db, segunda.id, { vigencia_inicio: '2030-04-01', version: segunda.version });
  assert.equal(movida.vigencia_inicio, '2030-04-01');
});

test('la base rechaza un cruce aunque entre por otro camino, y una tarifa activa que no sea precio de zona', async () => {
  const { db, zonaId } = await preparar();
  await tarifa(db, zonaId, {});
  await assert.rejects(
    () => db.query(`INSERT INTO tarifas (zona_id, tipo_tarifa, monto_fijo, unidad_medida, vigencia_inicio) VALUES ($1, 'fija', 5, 'dia', '2026-06-01')`, [zonaId]),
    (error) => error.code === '23P01'
  );
  // Una inactiva no compite con nadie.
  await db.query(`INSERT INTO tarifas (zona_id, tipo_tarifa, monto_fijo, unidad_medida, vigencia_inicio, activo) VALUES ($1, 'fija', 5, 'dia', '2026-06-01', FALSE)`, [zonaId]);
  // Una cuota mensual por rubro ya no entra activa (0032).
  await assert.rejects(
    () => db.query(`INSERT INTO tarifas (rubro_id, tipo_tarifa, monto_fijo, unidad_medida, vigencia_inicio) VALUES (1, 'fija', 90, 'mensual', '2031-01-01')`),
    (error) => error.code === '23514' && error.constraint === 'tarifas_precio_de_zona'
  );
});

test('dos altas a la vez: una cierra el anterior y la otra recibe un conflicto', async () => {
  const { db, zonaId } = await preparar();
  await tarifa(db, zonaId, {});
  const resultados = await Promise.allSettled([
    tarifa(db, zonaId, { vigencia_inicio: '2026-03-01' }),
    tarifa(db, zonaId, { vigencia_inicio: '2026-03-01' })
  ]);
  assert.equal(resultados.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(resultados.filter((item) => item.status === 'rejected').length, 1);
  const activas = await db.query(`SELECT count(*)::int AS total FROM tarifas WHERE zona_id = $1 AND activo AND vigencia_inicio = '2026-03-01'`, [zonaId]);
  assert.equal(activas.rows[0].total, 1);
});
