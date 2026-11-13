/**
 * Marcas de asistencia (revisión del 11/11/2026):
 * - el cobrador podía marcar un día de hace un año y crear deuda sin revisión: ahora solo hasta
 *   DIAS_COBRO_SIN_SENAL días atrás, como el cobro sin señal; más atrás, el super_admin;
 * - se aceptaban marcas de comerciantes dados de baja (les creaba deuda): ahora se rechazan;
 * - una sola marca inválida rechazaba todo el lote subido desde el celular: ahora responde marca por marca.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  closeDatabase, DIAS_COBRO_SIN_SENAL, initializeDatabase, insertComerciante, insertPuesto, insertZona, marcarAsistencias, todayInLima
} from '../src/db.js';
import { pool } from '../src/pg.js';
import { insertZonaConPrecio } from './_deuda.js';

let documento = 47110000;
let correlativo = 0;
const COBRADOR = 2;
const diasAtras = (n) => todayInLima(new Date(Date.now() - n * 24 * 60 * 60 * 1000));

async function ferialConPuesto() {
  correlativo += 1;
  const zona = await insertZonaConPrecio(pool, { nombre: `Asistencia lote ${process.pid}-${correlativo}`, tipo_via: 'asfaltada' });
  const rubro = (await pool.query("SELECT id FROM rubros WHERE nombre = 'otros'")).rows[0].id;
  const comerciante = await insertComerciante(pool, {
    dni_ruc: String(documento += 1), nombre: `Ferial lote ${correlativo}`, rubro_id: rubro, zona_id: zona.id,
    tipo_comerciante: 'ferial', estado: 'activo', usuario_creador: 1
  });
  const puesto = await insertPuesto(pool, { zona_id: zona.id, metros_cuadrados: 4, direccion: `Lote ${correlativo}`, comerciante_id: comerciante.id });
  return { comerciante, puesto };
}

before(async () => { await initializeDatabase(); });
after(async () => { await closeDatabase(); });

test('el cobrador marca hasta 3 días atrás; más atrás solo el administrador', async () => {
  const { puesto } = await ferialConPuesto();
  const limite = diasAtras(DIAS_COBRO_SIN_SENAL);
  const guardadas = await marcarAsistencias(pool, [{ puesto_id: puesto.id, fecha: limite, asistio: true }], { usuarioId: COBRADOR, rol: 'cobrador' });
  assert.equal(guardadas[0].fecha, limite);

  const viejo = diasAtras(DIAS_COBRO_SIN_SENAL + 1);
  await assert.rejects(
    () => marcarAsistencias(pool, [{ puesto_id: puesto.id, fecha: viejo, asistio: true }], { usuarioId: COBRADOR, rol: 'cobrador' }),
    /más de 3 días: la registra el administrador/
  );
  const delAdmin = await marcarAsistencias(pool, [{ puesto_id: puesto.id, fecha: viejo, asistio: true }], { usuarioId: 1, rol: 'super_admin' });
  assert.equal(delAdmin[0].fecha, viejo);
});

test('no se registra asistencia de un comerciante dado de baja', async () => {
  const { comerciante, puesto } = await ferialConPuesto();
  await pool.query("UPDATE comerciantes SET estado = 'inactivo' WHERE id = $1", [comerciante.id]);
  await assert.rejects(
    () => marcarAsistencias(pool, [{ puesto_id: puesto.id, asistio: true }], { usuarioId: COBRADOR, rol: 'cobrador' }),
    /está dado de baja/
  );
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM asistencias_feriales WHERE puesto_id = $1', [puesto.id]);
  assert.equal(rows[0].n, 0, 'no le queda deuda');
});

test('un lote guarda las marcas buenas y devuelve las rechazadas una por una', async () => {
  const bueno = await ferialConPuesto();
  const deBaja = await ferialConPuesto();
  await pool.query("UPDATE comerciantes SET estado = 'inactivo' WHERE id = $1", [deBaja.comerciante.id]);
  const hoy = todayInLima();

  const { guardadas, rechazadas } = await marcarAsistencias(pool, [
    { puesto_id: bueno.puesto.id, fecha: hoy, asistio: true },
    { puesto_id: deBaja.puesto.id, fecha: hoy, asistio: true },
    { puesto_id: bueno.puesto.id, fecha: diasAtras(30), asistio: true },
    { puesto_id: 99999999, fecha: hoy, asistio: true }
  ], { usuarioId: COBRADOR, rol: 'cobrador', parcial: true });

  assert.deepEqual(guardadas.map((item) => [item.puesto_id, item.fecha]), [[bueno.puesto.id, hoy]]);
  assert.equal(rechazadas.length, 3);
  assert.match(rechazadas[0].error, /dado de baja/);
  assert.equal(rechazadas[1].fecha, diasAtras(30));
  assert.match(rechazadas[2].error, /no existe/);
});
