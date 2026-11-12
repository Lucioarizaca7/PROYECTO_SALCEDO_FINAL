/**
 * El monto de un cobro se lleva a céntimos antes de validarlo (revisión del 12/11/2026). La base guarda
 * NUMERIC(12,2) y la API recibía el número tal cual:
 * - S/ 0.004 pasaba la validación (> 0), la base lo redondeaba a 0.00 y su CHECK respondía con un error interno;
 * - S/ 3.004 se rechazaba por exceder un saldo de S/ 3.00, aunque se guardaría S/ 3.00;
 * - una suma del celular como 0.1 + 0.2 volvía en la respuesta como 0.30000000000000004.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  closeDatabase, createUser, initializeDatabase, insertComerciante, insertPuesto, insertZona, registrarCobro, syncOfflineCobro
} from '../src/db.js';
import { ValidationError } from '../src/errors.js';
import { pool } from '../src/pg.js';

before(async () => { await initializeDatabase(); });
after(async () => { await closeDatabase(); });

let correlativo = 0;
const unico = () => `${process.pid}-${correlativo += 1}-${Date.now()}`;
let documento = 20777300000;

// Ferial en zona asfaltada: S/ 3 por día cobrado (tarifa general de la 0013).
async function ferial() {
  const zona = await insertZona(pool, { nombre: `Zona céntimos ${unico()}`, tipo_via: 'asfaltada' });
  const rubro = (await pool.query("SELECT id FROM rubros WHERE nombre = 'ropa'")).rows[0].id;
  const comerciante = await insertComerciante(pool, {
    dni_ruc: String(documento += 1), nombre: `Céntimos ${documento}`, rubro_id: rubro, zona_id: zona.id,
    tipo_comerciante: 'ferial', estado: 'activo', usuario_creador: 1
  });
  await insertPuesto(pool, { zona_id: zona.id, metros_cuadrados: 4, direccion: `Céntimos ${unico()}`, comerciante_id: comerciante.id });
  return comerciante;
}
const nuevoCobrador = () => createUser({ nombre: `Cobrador céntimos ${unico()}`, email: `centimos-${unico()}@prueba.pe`, password: 'clave-de-prueba-1', rol: 'cobrador' });
const cobrar = async (monto) => registrarCobro(pool, {
  comerciante_id: (await ferial()).id, cobrador_id: (await nuevoCobrador()).id, monto, metodo_pago: 'efectivo'
});

test('un monto que en céntimos es cero se rechaza con un mensaje, no con un error de la base', async () => {
  await assert.rejects(cobrar(0.004), (error) => error instanceof ValidationError && /monto positivo/.test(error.message),
    'antes respondía con la violación del CHECK de transacciones');
});

test('un monto con más de dos decimales se cobra por lo que se guarda', async () => {
  const cobro = await cobrar(3.004);
  assert.equal(cobro.estado, 'confirmado', 'antes se rechazaba por exceder el saldo de S/ 3.00');
  assert.equal(cobro.monto, 3);
  assert.equal(cobro.saldo_restante, 0);
});

test('una suma con error de coma flotante vuelve en céntimos', async () => {
  const cobro = await cobrar(0.1 + 0.2);
  assert.equal(cobro.monto, 0.3, 'antes volvía 0.30000000000000004');
  assert.equal(cobro.saldo_restante, 2.7);
});

test('sin señal, un monto que en céntimos es cero queda como cobro incompleto', async () => {
  const comerciante = await ferial();
  const cobrador = await nuevoCobrador();
  await assert.rejects(syncOfflineCobro(pool, {
    comerciante_id: comerciante.id, cobrador_id: cobrador.id, monto: 0.004, metodo_pago: 'efectivo',
    fecha_cobro: new Date().toISOString(), hash_transaccion: `centimos-${unico()}`
  }), (error) => error.permanent === true && /incompleto/.test(error.message));
});
