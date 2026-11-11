/**
 * Fallos reportados el 10/11/2026:
 * - la nota (observaciones) del cobrador no le llegaba al administrador: se guardaba y ninguna vista la mostraba;
 * - un cobro en efectivo después de uno por Yape arrastraba el código de operación: en línea se rechazaba y
 *   sin señal se descartaba como "duplicado" (el dinero ya se había recibido).
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildReportCsv, closeDatabase, currentPeriod, getAuditTrail, getCobrosObservados, getObservacionesCobro,
  getReportRows, initializeDatabase, insertComerciante, registrarCobro, syncOfflineCobro, todayInLima
} from '../src/db.js';
import { pool } from '../src/pg.js';

let correlativo = 0;
const idDe = async (tabla, nombre) => (await pool.query(`SELECT id FROM ${tabla} WHERE nombre = $1`, [nombre])).rows[0].id;

async function nuevoComerciante() {
  correlativo += 1;
  return insertComerciante(pool, {
    dni_ruc: `4811${String(correlativo).padStart(4, '0')}`,
    nombre: `Fallos noviembre ${correlativo}`,
    rubro_id: await idDe('rubros', 'otros'), // tarifa mensual de S/ 90
    zona_id: await idDe('zonas', 'Mercado Central')
  });
}

before(async () => { await initializeDatabase(); });
after(async () => { await closeDatabase(); });

test('la nota del cobro llega al administrador: reporte, CSV, observaciones y auditoría', async () => {
  const merchant = await nuevoComerciante();
  const nota = 'Pagó con monedas; pide recibo impreso';
  const cobro = await registrarCobro(pool, { comerciante_id: merchant.id, cobrador_id: 1, monto: 10, metodo_pago: 'efectivo', observaciones: nota },
    { audit: { usuarioId: 1, accion: 'crear' } });

  const fila = (await getReportRows(pool, { periodo: currentPeriod(), comerciante_id: merchant.id }))[0];
  assert.equal(fila.observaciones, nota);
  assert.equal(fila.comerciante_id, merchant.id);
  assert.match(await buildReportCsv(pool, { comerciante_id: merchant.id }), /observaciones/);
  assert.match(await buildReportCsv(pool, { comerciante_id: merchant.id }), /Pagó con monedas/);

  const hoy = todayInLima();
  const { observaciones } = await getObservacionesCobro(pool, { desde: hoy, hasta: hoy, comercianteId: merchant.id });
  const deCobro = observaciones.filter((item) => item.origen === 'cobro');
  assert.equal(deCobro.length, 1);
  assert.equal(deCobro[0].observacion, nota);
  assert.equal(deCobro[0].comprobante, cobro.comprobante);
  // El cobrador ve solo las suyas: otro cobrador no la ve.
  const otro = await getObservacionesCobro(pool, { desde: hoy, hasta: hoy, comercianteId: merchant.id, cobradorId: 999 });
  assert.equal(otro.observaciones.length, 0);

  const auditoria = await getAuditTrail(pool, { limit: 20 });
  assert.ok(auditoria.some((item) => String(item.detalle || '').includes(`Nota del cobrador: ${nota}`)));
});

test('la nota de un cobro observado se ve en la revisión', async () => {
  const merchant = await nuevoComerciante();
  // Sin señal y por encima del saldo: se registra observado (el dinero ya se recibió).
  const res = await syncOfflineCobro(pool, {
    comerciante_id: merchant.id, cobrador_id: 1, monto: 150, metodo_pago: 'efectivo', observaciones: 'Adelantó dos meses',
    hash_transaccion: `nota-observado-${Date.now()}`
  });
  assert.equal(res.status, 'OBSERVED');
  const fila = (await getCobrosObservados(pool)).find((item) => Number(item.comerciante_id) === merchant.id);
  assert.equal(fila.observaciones, 'Adelantó dos meses');
});

test('un cobro en efectivo ignora el código de operación que arrastró del cobro por Yape', async () => {
  const merchant = await nuevoComerciante();
  const codigo = `YP-${Date.now()}`;
  await registrarCobro(pool, { comerciante_id: merchant.id, cobrador_id: 1, monto: 10, metodo_pago: 'yape', codigo_operacion: codigo });

  // En línea: antes respondía "Ya existe un cobro registrado con ese código de operación".
  const efectivo = await registrarCobro(pool, { comerciante_id: merchant.id, cobrador_id: 1, monto: 5, metodo_pago: 'efectivo', codigo_operacion: codigo });
  assert.notEqual(efectivo.codigo_operacion, codigo);

  // Sin señal: antes volvía "IGNORED" y el cobro se perdía.
  const offline = await syncOfflineCobro(pool, {
    comerciante_id: merchant.id, cobrador_id: 1, monto: 5, metodo_pago: 'efectivo', codigo_operacion: codigo,
    hash_transaccion: `efectivo-tras-yape-${Date.now()}`
  });
  assert.equal(offline.status, 'SUCCESS');

  const filas = await getReportRows(pool, { comerciante_id: merchant.id });
  assert.equal(filas.length, 3);
  assert.equal(filas.reduce((suma, item) => suma + Number(item.monto), 0), 20);

  // El mismo código digital sigue sin poder usarse dos veces.
  await assert.rejects(() => registrarCobro(pool, { comerciante_id: merchant.id, cobrador_id: 1, monto: 5, metodo_pago: 'plin', codigo_operacion: codigo }), /código de operación/);
});
