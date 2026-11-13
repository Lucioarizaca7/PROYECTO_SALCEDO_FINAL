/**
 * Anular un cobro quita la asistencia que puso ese cobro (decisión del usuario, 11/11/2026). Cobrar a quien paga
 * por día marca el día si nadie lo había marcado (marcarDiaCobrado, fuente 'cobro'). Antes la marca quedaba al
 * anular: si el cobro era del comerciante equivocado, ese comerciante seguía debiendo el día.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  anularCobro, calcularLiquidacion, closeDatabase, createUser, initializeDatabase, insertComerciante, insertPuesto,
  insertZona, marcarAsistencias, registrarCobro, todayInLima
} from '../src/db.js';
import { pool } from '../src/pg.js';
import { insertZonaConPrecio } from './_deuda.js';

before(async () => { await initializeDatabase(); });
after(async () => { await closeDatabase(); });

let correlativo = 0;
const unico = () => `${process.pid}-${correlativo += 1}-${Date.now()}`;
let documento = 20555000000;

// Ferial en zona asfaltada: S/ 3 por día asistido (tarifa general de la 0013).
async function ferial() {
  const zona = await insertZonaConPrecio(pool, { nombre: `Zona anulación ${unico()}`, tipo_via: 'asfaltada' });
  const rubro = (await pool.query("SELECT id FROM rubros WHERE nombre = 'ropa'")).rows[0].id;
  const comerciante = await insertComerciante(pool, {
    dni_ruc: String(documento += 1), nombre: `Anulación ${documento}`, rubro_id: rubro, zona_id: zona.id,
    tipo_comerciante: 'ferial', estado: 'activo', usuario_creador: 1
  });
  const puesto = await insertPuesto(pool, { zona_id: zona.id, metros_cuadrados: 4, direccion: `Anulación ${unico()}`, comerciante_id: comerciante.id });
  return { comerciante, puesto };
}
const nuevoCobrador = () => createUser({ nombre: `Cobrador anulación ${unico()}`, email: `anulacion-${unico()}@prueba.pe`, password: 'clave-de-prueba-1', rol: 'cobrador' });
const marcas = async (puestoId) => (await pool.query(
  'SELECT fuente FROM asistencias_feriales WHERE puesto_id = $1 AND fecha = $2::date', [puestoId, todayInLima()])).rows.map((fila) => fila.fuente);
const cobrar = (cobradorId, comercianteId, monto) =>
  registrarCobro(pool, { comerciante_id: comercianteId, cobrador_id: cobradorId, monto, metodo_pago: 'efectivo' });

test('anular el cobro quita el día que marcó y ese día ya no se debe', async () => {
  const { comerciante, puesto } = await ferial();
  const cobrador = await nuevoCobrador();
  const cobro = await cobrar(cobrador.id, comerciante.id, 3);
  assert.deepEqual(await marcas(puesto.id), ['cobro']);

  const anulado = await anularCobro(pool, cobro.id, { motivo: 'Comerciante equivocado', usuarioId: 1 });
  assert.deepEqual(anulado.asistencias_quitadas, [todayInLima()]);
  assert.deepEqual(await marcas(puesto.id), [], 'antes la marca quedaba');
  const liquidacion = await calcularLiquidacion(pool, comerciante.id);
  assert.equal(liquidacion.saldo, 0, 'antes seguía debiendo S/ 3 por un día en que quizá no estuvo');
});

test('una marca hecha en la app no se quita al anular', async () => {
  const { comerciante, puesto } = await ferial();
  const cobrador = await nuevoCobrador();
  await marcarAsistencias(pool, [{ puesto_id: puesto.id, fecha: todayInLima(), asistio: true }], { usuarioId: cobrador.id });
  const cobro = await cobrar(cobrador.id, comerciante.id, 3);
  const anulado = await anularCobro(pool, cobro.id, { motivo: 'Monto mal digitado', usuarioId: 1 });
  assert.deepEqual(anulado.asistencias_quitadas, []);
  assert.deepEqual(await marcas(puesto.id), ['app']);
  assert.equal((await calcularLiquidacion(pool, comerciante.id)).saldo, 3);
});

test('si queda otro cobro confirmado ese día, la marca queda', async () => {
  const { comerciante, puesto } = await ferial();
  const cobrador = await nuevoCobrador();
  const primero = await cobrar(cobrador.id, comerciante.id, 1.5);
  await cobrar(cobrador.id, comerciante.id, 1.5);
  const anulado = await anularCobro(pool, primero.id, { motivo: 'Cobro repetido', usuarioId: 1 });
  assert.deepEqual(anulado.asistencias_quitadas, []);
  assert.deepEqual(await marcas(puesto.id), ['cobro']);
});
