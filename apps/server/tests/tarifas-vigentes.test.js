/**
 * Una tarifa que ya empezó a regir no cambia lo que cobra (decisión del usuario, 11/11/2026): editar su monto
 * recalculaba los meses pasados y un mes pagado aparecía con deuda o saldo a favor. Para otro monto se crea una
 * tarifa nueva, que cierra la anterior.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { calcularLiquidacion, initializeDatabase, insertComerciante, insertTarifa, todayInLima, updateTarifa } from '../src/db.js';

let correlativo = 0;
let documento = 20888000000;

async function preparar() {
  const db = await initializeDatabase();
  const rubro = await db.query('INSERT INTO rubros (nombre, descripcion) VALUES ($1, $2) RETURNING id', [`Rubro vigente ${process.pid}-${correlativo += 1}-${Date.now()}`, 'Prueba']);
  return { db, rubroId: rubro.rows[0].id };
}
const tarifa = (db, rubroId, extra) => insertTarifa(db, { rubro_id: rubroId, tipo_tarifa: 'fija', monto_fijo: 10, monto_variable: 0, unidad_medida: 'mensual', vigencia_inicio: '2026-01-01', ...extra }, { permitirInicioPasado: true });
const ayer = todayInLima(new Date(Date.now() - 24 * 60 * 60 * 1000));

test('el monto de una tarifa que ya rige no se edita; reenviar los mismos datos sí pasa', async () => {
  const { db, rubroId } = await preparar();
  const vigente = await tarifa(db, rubroId, {});

  await assert.rejects(() => updateTarifa(db, vigente.id, { monto_fijo: 25, version: vigente.version }), /rige desde el 2026-01-01: para cambiar el monto registre una tarifa nueva/);
  await assert.rejects(() => updateTarifa(db, vigente.id, { unidad_medida: 'diaria', version: vigente.version }), /registre una tarifa nueva/);
  await assert.rejects(() => updateTarifa(db, vigente.id, { vigencia_inicio: '2026-02-01', version: vigente.version }), /registre una tarifa nueva/);

  // La pantalla reenvía el formulario completo: con los mismos valores (como texto) no es un cambio.
  const igual = await updateTarifa(db, vigente.id, {
    rubro_id: String(rubroId), zona_id: null, tipo_via: null, tipo_tarifa: 'fija', monto_fijo: '10', monto_variable: '0',
    unidad_medida: 'mensual', vigencia_inicio: '2026-01-01', vigencia_fin: '', version: vigente.version
  });
  assert.equal(Number(igual.monto_fijo), 10);
});

test('una tarifa que ya rige se cierra, pero no antes de hoy', async () => {
  const { db, rubroId } = await preparar();
  const vigente = await tarifa(db, rubroId, {});
  await assert.rejects(() => updateTarifa(db, vigente.id, { vigencia_fin: ayer, version: vigente.version }), /no se puede cerrar antes de hoy/);
  const cerrada = await updateTarifa(db, vigente.id, { vigencia_fin: '2099-12-31', version: vigente.version });
  assert.equal(cerrada.vigencia_fin, '2099-12-31');
});

test('una tarifa que todavía no empieza se edita libremente', async () => {
  const { db, rubroId } = await preparar();
  const futura = await tarifa(db, rubroId, { vigencia_inicio: '2099-01-01' });
  const editada = await updateTarifa(db, futura.id, { monto_fijo: 30, version: futura.version });
  assert.equal(Number(editada.monto_fijo), 30);
});

test('para cambiar el monto se crea otra: cierra la anterior y lo pasado no cambia', async () => {
  const { db, rubroId } = await preparar();
  await tarifa(db, rubroId, { monto_fijo: 10 });
  const comerciante = await insertComerciante(db, {
    dni_ruc: String(documento += 1), nombre: `Titular vigente ${documento}`, rubro_id: rubroId, zona_id: 1,
    tipo_comerciante: 'permanente', estado: 'activo', usuario_creador: 1
  });
  const nueva = await tarifa(db, rubroId, { monto_fijo: 15, vigencia_inicio: '2099-01-01' });
  assert.equal(nueva.tarifas_cerradas.length, 1);
  assert.equal(Number((await calcularLiquidacion(db, comerciante.id, '2026-02')).tarifa.monto_fijo), 10);
});
