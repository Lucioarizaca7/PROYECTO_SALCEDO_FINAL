/**
 * Solo efectivo (RN-34, decisión del 17/11/2026) y código de operación de los cobros digitales que quedan.
 *
 * En línea ya no se cobra por Yape, Plin ni POS. El único cobro digital que entra es el que un celular guardó
 * sin señal: el dinero ya se recibió, así que se registra y queda observado. Para esos sigue valiendo la
 * revisión del 11/11/2026: solo el mismo hash es el mismo cobro reenviado; otro cobro con un número de
 * operación ya usado se rechaza a la vista (antes se daba por "duplicado" y el dinero no entraba), y el número
 * es único por método (un Plin y un POS con el mismo número no chocan).
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  closeDatabase, createUser, getCobrosObservados, getSyncErrors, initializeDatabase, insertComerciante, insertPuesto,
  registrarCobro, syncOfflineBatch
} from '../src/db.js';
import { pool } from '../src/pg.js';
import { insertZonaConPrecio } from './_deuda.js';

before(async () => { await initializeDatabase(); });
after(async () => { await closeDatabase(); });

let correlativo = 0;
const unico = () => `${process.pid}-${correlativo += 1}-${Date.now()}`;
let documento = 20777000000;

// Permanente en zona asfaltada: el cobro marca el día y deja S/ 3 por pagar (tarifa general de la 0013).
async function comerciante() {
  const zona = await insertZonaConPrecio(pool, { nombre: `Zona operación ${unico()}`, tipo_via: 'asfaltada' });
  const rubro = (await pool.query("SELECT id FROM rubros WHERE nombre = 'ropa'")).rows[0].id;
  const merchant = await insertComerciante(pool, {
    dni_ruc: String(documento += 1), nombre: `Operación ${documento}`, rubro_id: rubro, zona_id: zona.id,
    tipo_comerciante: 'permanente', estado: 'activo', usuario_creador: 1
  });
  await insertPuesto(pool, { zona_id: zona.id, metros_cuadrados: 4, direccion: `Operación ${unico()}`, comerciante_id: merchant.id });
  return merchant;
}
const nuevoCobrador = () => createUser({ nombre: `Cobrador operación ${unico()}`, email: `operacion-${unico()}@prueba.pe`, password: 'clave-de-prueba-1', rol: 'cobrador' });
const cobrosDe = async (comercianteId) => (await pool.query('SELECT metodo_pago FROM transacciones WHERE comerciante_id = $1', [comercianteId])).rows;

test('en línea solo se cobra en efectivo: Yape, Plin y POS se rechazan y no dejan nada escrito', async () => {
  const cobrador = await nuevoCobrador();
  const merchant = await comerciante();
  for (const metodo of ['yape', 'plin', 'pos']) {
    await assert.rejects(
      registrarCobro(pool, { comerciante_id: merchant.id, cobrador_id: cobrador.id, monto: 3, metodo_pago: metodo, codigo_operacion: `OP${unico()}` }),
      (error) => error.status === 400 && /Solo se cobra en efectivo/.test(error.message));
  }
  assert.equal((await cobrosDe(merchant.id)).length, 0);

  const efectivo = await registrarCobro(pool, { comerciante_id: merchant.id, cobrador_id: cobrador.id, monto: 3, metodo_pago: 'efectivo' });
  assert.equal(efectivo.estado, 'confirmado');
});

test('la base no deja un cobro digital que no esté observado', async () => {
  const cobrador = await nuevoCobrador();
  const merchant = await comerciante();
  const efectivo = await registrarCobro(pool, { comerciante_id: merchant.id, cobrador_id: cobrador.id, monto: 3, metodo_pago: 'efectivo' });
  await assert.rejects(
    pool.query("UPDATE transacciones SET metodo_pago = 'yape' WHERE id = $1", [efectivo.id]),
    (error) => error.code === '23514' && error.constraint === 'transacciones_solo_efectivo');
  assert.deepEqual(await cobrosDe(merchant.id), [{ metodo_pago: 'efectivo' }]);
});

test('sin señal: un cobro digital guardado antes del cambio entra observado; un número ya usado se rechaza a la vista', async () => {
  const cobrador = await nuevoCobrador();
  const numero = `OP${unico()}`;
  const primero = {
    comerciante_id: (await comerciante()).id, monto: 3, metodo_pago: 'plin', codigo_operacion: numero,
    fecha_cobro: new Date().toISOString(), hash_transaccion: `hash-${unico()}`
  };
  const segundo = { ...primero, comerciante_id: (await comerciante()).id, hash_transaccion: `hash-${unico()}` };
  // El mismo número con otro método no choca.
  const conPos = { ...primero, comerciante_id: (await comerciante()).id, metodo_pago: 'pos', hash_transaccion: `hash-${unico()}` };

  const { resultados } = await syncOfflineBatch(pool, [primero, segundo, conPos], { cobradorId: cobrador.id, deviceId: 'cel-operacion' });
  assert.equal(resultados[0].estado, 'observado', 'el dinero ya se recibió: entra y va a revisión');
  assert.equal(resultados[1].estado, 'rechazado', 'antes era "duplicado" y el celular lo borraba de la cola');
  assert.match(resultados[1].mensaje, new RegExp(`${numero} de PLIN ya se usó`));
  assert.equal(resultados[2].estado, 'observado');

  const observado = (await getCobrosObservados(pool)).find((item) => Number(item.comerciante_id) === primero.comerciante_id);
  assert.match(observado.motivo, new RegExp(`Pago por PLIN \\(operación ${numero}\\): ya solo se cobra en efectivo`));

  const errores = await getSyncErrors(pool);
  assert.ok(errores.some((item) => item.hash_transaccion === segundo.hash_transaccion), 'sale en los errores de sincronización');

  // Reenviar el primero (mismo hash) sí es un duplicado.
  const reenvio = await syncOfflineBatch(pool, [primero], { cobradorId: cobrador.id, deviceId: 'cel-operacion' });
  assert.equal(reenvio.resultados[0].estado, 'duplicado');
});
