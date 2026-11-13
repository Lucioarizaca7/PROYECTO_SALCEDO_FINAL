/**
 * Comerciante sin tarifa vigente (revisión del 11/11/2026, migración 0024). Una zona sin tipo de vía y un rubro sin
 * tarifa propia no tienen tarifa aplicable:
 * - sin señal el cobrador igual puede cobrarle (el paquete de jornada lo trae con saldo 0). Antes el cobro se
 *   rechazaba al sincronizar y el dinero ya recibido quedaba fuera; ahora queda observado, sin tarifa;
 * - el portal respondía 400 y el comerciante no veía ni sus recibos; ahora abre y avisa que no hay tarifa.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { closeDatabase, createUser, initializeDatabase, insertComerciante, insertZona, registrarCobro, syncOfflineBatch } from '../src/db.js';
import { emitirCarnets, ingresarAlPortal } from '../src/portalAcceso.js';
import { pool } from '../src/pg.js';

before(async () => { await initializeDatabase(); });
after(async () => { await closeDatabase(); });

let documento = 20444000000;
async function comercianteSinTarifa() {
  const zona = await insertZona(pool, { nombre: `Zona sin vía ${process.pid}-${documento}` });
  const rubro = (await pool.query('INSERT INTO rubros (nombre) VALUES ($1) RETURNING id', [`rubro sin tarifa ${process.pid}-${documento}`])).rows[0].id;
  return insertComerciante(pool, {
    dni_ruc: String(documento += 1), nombre: `Sin tarifa ${documento}`, rubro_id: rubro, zona_id: zona.id,
    tipo_comerciante: 'permanente', estado: 'activo', usuario_creador: 1
  });
}

test('sin señal, el cobro a un comerciante sin tarifa queda observado (antes se rechazaba)', async () => {
  const comerciante = await comercianteSinTarifa();
  const cobrador = await createUser({ nombre: `Cobrador sin tarifa ${process.pid}`, email: `sin-tarifa-${process.pid}@prueba.pe`, password: 'clave-de-prueba-1', rol: 'cobrador' });
  const cobro = { comerciante_id: comerciante.id, monto: 5, metodo_pago: 'efectivo', fecha_cobro: new Date().toISOString(), hash_transaccion: `sin-tarifa-${process.pid}` };

  const { resultados: [resultado] } = await syncOfflineBatch(pool, [cobro], { cobradorId: cobrador.id, deviceId: 'cel-sin-tarifa' });
  assert.equal(resultado.estado, 'observado', resultado.mensaje);

  const { rows: [fila] } = await pool.query(`
    SELECT t.tarifa_id, o.motivo FROM transacciones t JOIN cobros_observados o ON o.transaccion_id = t.id WHERE t.id = $1`, [resultado.id]);
  assert.equal(fila.tarifa_id, null);
  assert.match(fila.motivo, /sin tarifa vigente/);

  // En línea se sigue rechazando: con señal no hay por qué cobrar sin tarifa.
  await assert.rejects(registrarCobro(pool, { comerciante_id: comerciante.id, cobrador_id: cobrador.id, monto: 5, metodo_pago: 'efectivo' }),
    /No existe una tarifa vigente/);
});

test('el portal abre sin tarifa vigente y muestra los pagos (antes respondía 400)', async () => {
  const comerciante = await comercianteSinTarifa();
  const [carnet] = await emitirCarnets(pool, [comerciante.id], 1);
  const datos = await ingresarAlPortal(pool, { identifier: comerciante.dni_ruc, llave: carnet.llave });
  assert.equal(datos.deuda.sin_tarifa, true);
  assert.equal(datos.deuda.saldo, 0);
  assert.ok(Array.isArray(datos.pagos));
});

test('en el portal, un cobro observado sin revisar sale "en revisión", no válido', async () => {
  const comerciante = await comercianteSinTarifa();
  const cobrador = await createUser({ nombre: `Cobrador revisión ${process.pid}`, email: `revision-${process.pid}@prueba.pe`, password: 'clave-de-prueba-1', rol: 'cobrador' });
  await syncOfflineBatch(pool, [{ comerciante_id: comerciante.id, monto: 4, metodo_pago: 'efectivo', fecha_cobro: new Date().toISOString(), hash_transaccion: `revision-${process.pid}` }],
    { cobradorId: cobrador.id, deviceId: 'cel-revision' });
  const [carnet] = await emitirCarnets(pool, [comerciante.id], 1);
  const { pagos } = await ingresarAlPortal(pool, { llave: carnet.llave });
  assert.deepEqual(pagos.map((pago) => pago.estado), ['en_revision']);
});
