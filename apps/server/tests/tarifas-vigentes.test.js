/**
 * Un precio que ya empezó a regir no cambia lo que cobra (decisión del usuario, 11/11/2026): editar su monto
 * recalculaba los días pasados y un mes pagado aparecía con deuda o saldo a favor. Para otro monto se crea un
 * precio nuevo, que cierra el anterior. Desde la 0032 cada tarifa es el precio por día de una zona.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { calcularLiquidacion, initializeDatabase, insertComerciante, insertPuesto, insertTarifa, insertZona, todayInLima, updateTarifa } from '../src/db.js';
import { marcarDias } from './_deuda.js';

let correlativo = 0;
let documento = 20888000000;

async function preparar() {
  const db = await initializeDatabase();
  const zona = await insertZona(db, { nombre: `Zona vigente ${process.pid}-${correlativo += 1}-${Date.now()}` });
  return { db, zonaId: zona.id };
}
const tarifa = (db, zonaId, extra) => insertTarifa(db, { zona_id: zonaId, monto_fijo: 10, vigencia_inicio: '2026-01-01', ...extra }, { permitirInicioPasado: true });
const ayer = todayInLima(new Date(Date.now() - 24 * 60 * 60 * 1000));

test('el monto de un precio que ya rige no se edita; reenviar los mismos datos sí pasa', async () => {
  const { db, zonaId } = await preparar();
  const vigente = await tarifa(db, zonaId, {});

  await assert.rejects(() => updateTarifa(db, vigente.id, { monto_fijo: 25, version: vigente.version }), /rige desde el 2026-01-01: para cambiar el monto registre un precio nuevo/);
  await assert.rejects(() => updateTarifa(db, vigente.id, { unidad_medida: 'mensual', version: vigente.version }), /Solo se cobra por día cobrado/);
  await assert.rejects(() => updateTarifa(db, vigente.id, { vigencia_inicio: '2026-02-01', version: vigente.version }), /registre un precio nuevo/);

  // La pantalla reenvía el formulario completo: con los mismos valores (como texto) no es un cambio.
  const igual = await updateTarifa(db, vigente.id, {
    zona_id: String(zonaId), monto_fijo: '10', vigencia_inicio: '2026-01-01', vigencia_fin: '', version: vigente.version
  });
  assert.equal(Number(igual.monto_fijo), 10);
});

test('un precio que ya rige se cierra, pero no antes de hoy', async () => {
  const { db, zonaId } = await preparar();
  const vigente = await tarifa(db, zonaId, {});
  await assert.rejects(() => updateTarifa(db, vigente.id, { vigencia_fin: ayer, version: vigente.version }), /no se puede cerrar antes de hoy/);
  const cerrada = await updateTarifa(db, vigente.id, { vigencia_fin: '2099-12-31', version: vigente.version });
  assert.equal(cerrada.vigencia_fin, '2099-12-31');
});

test('un precio que todavía no empieza se edita libremente', async () => {
  const { db, zonaId } = await preparar();
  const futura = await tarifa(db, zonaId, { vigencia_inicio: '2099-01-01' });
  const editada = await updateTarifa(db, futura.id, { monto_fijo: 30, version: futura.version });
  assert.equal(Number(editada.monto_fijo), 30);
});

test('para cambiar el monto se crea otro: cierra el anterior y lo pasado no cambia', async () => {
  const { db, zonaId } = await preparar();
  await tarifa(db, zonaId, { monto_fijo: 10 });
  const comerciante = await insertComerciante(db, {
    dni_ruc: String(documento += 1), nombre: `Titular vigente ${documento}`, rubro_id: 1, zona_id: zonaId,
    tipo_comerciante: 'permanente', estado: 'activo', usuario_creador: 1
  });
  const puesto = await insertPuesto(db, { comerciante_id: comerciante.id, zona_id: zonaId, direccion: `Vigente ${documento}` });
  await marcarDias(db, puesto.id, '2026-02', 1);
  const nueva = await tarifa(db, zonaId, { monto_fijo: 15, vigencia_inicio: '2099-01-01' });
  assert.equal(nueva.tarifas_cerradas.length, 1);
  const febrero = await calcularLiquidacion(db, comerciante.id, '2026-02');
  assert.equal(Number(febrero.tarifa.monto_fijo), 10);
  assert.equal(febrero.monto_total, 10);
});

test('una tarifa del cobro anterior (por rubro o mensual) se rechaza al crear y no se edita', async () => {
  const { db, zonaId } = await preparar();
  await assert.rejects(() => insertTarifa(db, { rubro_id: 1, monto_fijo: 90, unidad_medida: 'mensual', vigencia_inicio: '2099-01-01' }), /Elija la zona/);
  await assert.rejects(() => tarifa(db, zonaId, { rubro_id: 1 }), /no del rubro/);
  await assert.rejects(() => tarifa(db, zonaId, { unidad_medida: 'semanal' }), /Solo se cobra por día cobrado/);
  await assert.rejects(() => tarifa(db, zonaId, { monto_variable: 2 }), /sin metros/);
  await assert.rejects(() => tarifa(db, zonaId, { tipo_via: 'asfaltada' }), /El tipo de vía es de la zona/);
  const vieja = (await db.query(`INSERT INTO tarifas (rubro_id, tipo_tarifa, monto_fijo, unidad_medida, vigencia_inicio, activo)
    VALUES (1, 'fija', 90, 'mensual', '2026-01-01', FALSE) RETURNING id, version`)).rows[0];
  await assert.rejects(() => updateTarifa(db, vieja.id, { vigencia_fin: '2099-12-31', version: vieja.version }), /cobro anterior/);
});
