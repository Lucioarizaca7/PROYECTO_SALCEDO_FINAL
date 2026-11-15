/**
 * Código de operación de Yape/Plin/POS (revisión del 11/11/2026). Solo el mismo hash es el mismo cobro
 * reenviado. Antes, sin señal, otro cobro con un número de operación ya usado se daba por "duplicado": el
 * celular lo borraba de la cola y el dinero no entraba a ninguna parte. Y el número se comparaba sin el
 * método, aunque la base lo pide único por método (un Yape y un POS con el mismo número no chocan).
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  closeDatabase, createUser, getSyncErrors, initializeDatabase, insertComerciante, insertPuesto, insertZona,
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

test('en línea: el número de operación es único por método y el aviso dice en qué recibo se usó', async () => {
  const cobrador = await nuevoCobrador();
  const numero = `OP${unico()}`;
  const yape = await registrarCobro(pool, { comerciante_id: (await comerciante()).id, cobrador_id: cobrador.id, monto: 3, metodo_pago: 'yape', codigo_operacion: numero });

  const pos = await registrarCobro(pool, { comerciante_id: (await comerciante()).id, cobrador_id: cobrador.id, monto: 3, metodo_pago: 'pos', codigo_operacion: numero });
  assert.equal(pos.codigo_operacion, numero, 'antes chocaba con el Yape del mismo número');

  await assert.rejects(
    registrarCobro(pool, { comerciante_id: (await comerciante()).id, cobrador_id: cobrador.id, monto: 3, metodo_pago: 'yape', codigo_operacion: numero }),
    (error) => error.status === 409 && error.message.includes(`ya se usó en el cobro ${yape.comprobante}`));
});

test('sin señal: otro cobro con un número ya usado queda rechazado a la vista, no "duplicado"', async () => {
  const cobrador = await nuevoCobrador();
  const numero = `OP${unico()}`;
  const primero = {
    comerciante_id: (await comerciante()).id, monto: 3, metodo_pago: 'plin', codigo_operacion: numero,
    fecha_cobro: new Date().toISOString(), hash_transaccion: `hash-${unico()}`
  };
  const segundo = { ...primero, comerciante_id: (await comerciante()).id, hash_transaccion: `hash-${unico()}` };

  const { resultados } = await syncOfflineBatch(pool, [primero, segundo], { cobradorId: cobrador.id, deviceId: 'cel-operacion' });
  assert.equal(resultados[0].estado, 'sincronizado');
  assert.equal(resultados[1].estado, 'rechazado', 'antes era "duplicado" y el celular lo borraba de la cola');
  assert.match(resultados[1].mensaje, new RegExp(`${numero} de PLIN ya se usó`));

  const errores = await getSyncErrors(pool);
  assert.ok(errores.some((item) => item.hash_transaccion === segundo.hash_transaccion), 'sale en los errores de sincronización');

  // Reenviar el primero (mismo hash) sí es un duplicado.
  const reenvio = await syncOfflineBatch(pool, [primero], { cobradorId: cobrador.id, deviceId: 'cel-operacion' });
  assert.equal(reenvio.resultados[0].estado, 'duplicado');
});
