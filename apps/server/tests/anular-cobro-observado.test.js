/**
 * Anular un cobro que estaba en revisión cierra su revisión (revisión del 11/11/2026). Antes, si el administrador
 * anulaba desde la lista de cobros un cobro sin señal observado, la observación seguía "pendiente" para siempre:
 * anularla respondía 409 ("El cobro ya estaba anulado") y aceptarla dejaba como pago válido un cobro anulado.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  anularCobro, closeDatabase, createUser, getCobrosObservados, initializeDatabase, insertComerciante, insertPuesto,
  insertZona, resolveCobroObservado, syncOfflineBatch
} from '../src/db.js';
import { pool } from '../src/pg.js';
import { insertZonaConPrecio } from './_deuda.js';

before(async () => { await initializeDatabase(); });
after(async () => { await closeDatabase(); });

let correlativo = 0;
const unico = () => `${process.pid}-${correlativo += 1}-${Date.now()}`;
let documento = 20666000000;

// Permanente en zona asfaltada que debe S/ 3 hoy: un cobro sin señal de S/ 50 excede el saldo y queda observado.
async function cobroObservado() {
  const zona = await insertZonaConPrecio(pool, { nombre: `Zona revisión ${unico()}`, tipo_via: 'asfaltada' });
  const rubro = (await pool.query("SELECT id FROM rubros WHERE nombre = 'ropa'")).rows[0].id;
  const comerciante = await insertComerciante(pool, {
    dni_ruc: String(documento += 1), nombre: `Revisión ${documento}`, rubro_id: rubro, zona_id: zona.id,
    tipo_comerciante: 'permanente', estado: 'activo', usuario_creador: 1
  });
  await insertPuesto(pool, { zona_id: zona.id, metros_cuadrados: 4, direccion: `Revisión ${unico()}`, comerciante_id: comerciante.id });
  const cobrador = await createUser({ nombre: `Cobrador revisión ${unico()}`, email: `revision-${unico()}@prueba.pe`, password: 'clave-de-prueba-1', rol: 'cobrador' });
  const { resultados } = await syncOfflineBatch(pool, [{
    comerciante_id: comerciante.id, monto: 50, metodo_pago: 'efectivo', fecha_cobro: new Date().toISOString(), hash_transaccion: `hash-${unico()}`
  }], { cobradorId: cobrador.id, deviceId: 'cel-revision' });
  assert.equal(resultados[0].estado, 'observado');
  const observacion = (await getCobrosObservados(pool)).find((fila) => Number(fila.transaccion_id) === Number(resultados[0].id));
  return { comerciante, transaccionId: Number(resultados[0].id), observacionId: Number(observacion.id) };
}
const observacion = async (id) => (await pool.query('SELECT estado, resolucion, revisado_por FROM cobros_observados WHERE id = $1', [id])).rows[0];

test('anular desde la lista de cobros cierra la revisión pendiente', async () => {
  const { transaccionId, observacionId } = await cobroObservado();
  const anulado = await anularCobro(pool, transaccionId, { motivo: 'Cobro al comerciante equivocado', usuarioId: 1 });
  assert.equal(anulado.observacion_cerrada, observacionId);

  const fila = await observacion(observacionId);
  assert.equal(fila.estado, 'anulado', 'antes seguía pendiente');
  assert.equal(fila.resolucion, 'Cobro al comerciante equivocado');
  assert.equal(Number(fila.revisado_por), 1);
  assert.ok(!(await getCobrosObservados(pool)).some((item) => Number(item.id) === observacionId), 'ya no sale entre los pendientes');
});

test('una revisión cuyo cobro ya está anulado se puede cerrar, pero no aceptar', async () => {
  const { transaccionId, observacionId } = await cobroObservado();
  // Como quedaban los datos de antes: cobro anulado y revisión pendiente.
  await pool.query("UPDATE transacciones SET estado = 'anulado', anulado_en = now(), anulado_por = 1, motivo_anulacion = 'Anulado antes' WHERE id = $1", [transaccionId]);

  await assert.rejects(
    resolveCobroObservado(pool, observacionId, { decision: 'aceptado', resolucion: 'Era un adelanto', usuarioId: 1 }),
    (error) => error.status === 409 && /ya está anulado/.test(error.message));
  assert.equal((await observacion(observacionId)).estado, 'pendiente');

  const cerrada = await resolveCobroObservado(pool, observacionId, { decision: 'anulado', resolucion: 'Ya se había anulado', usuarioId: 1 });
  assert.equal(cerrada.estado, 'anulado', 'antes respondía 409 y la revisión no se cerraba nunca');
});

test('anular desde la revisión sigue funcionando igual', async () => {
  const { transaccionId, observacionId } = await cobroObservado();
  const resuelta = await resolveCobroObservado(pool, observacionId, { decision: 'anulado', resolucion: 'Se devolvió el dinero', usuarioId: 1 });
  assert.equal(resuelta.estado, 'anulado');
  const cobro = (await pool.query('SELECT estado, motivo_anulacion FROM transacciones WHERE id = $1', [transaccionId])).rows[0];
  assert.equal(cobro.estado, 'anulado');
  assert.equal(cobro.motivo_anulacion, 'Se devolvió el dinero');
  assert.equal((await observacion(observacionId)).resolucion, 'Se devolvió el dinero');
});
