/**
 * Tarifa por tipo de vía (migrations/0009_tipo_via.sql): zona > tipo de vía > general del rubro,
 * también con tarifa por m².
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { initializeDatabase, insertComerciante, insertPuesto, insertTarifa, insertZona, updateZona, calcularLiquidacion } from '../src/db.js';

let documento = 20888000000;
let correlativoZona = 0;

// Cada prueba usa un rubro propio para no chocar con las tarifas de la semilla.
async function rubroNuevo(db) {
  const nombre = `rubro vía ${process.pid} ${Date.now()} ${Math.random().toString(16).slice(2, 6)}`;
  return (await db.query('INSERT INTO rubros (nombre) VALUES ($1) RETURNING id', [nombre])).rows[0].id;
}

const zonaNueva = (db, tipo_via) => insertZona(db, { nombre: `Zona vía ${process.pid}-${correlativoZona += 1}-${Date.now()}`, tipo_via });

async function permanente(db, rubroId, zonaId, metros = 1) {
  const comerciante = await insertComerciante(db, {
    dni_ruc: String(documento += 1), nombre: `Comerciante Vía ${documento}`, rubro_id: rubroId, zona_id: zonaId,
    tipo_comerciante: 'permanente', estado: 'activo', usuario_creador: 1
  });
  await insertPuesto(db, { zona_id: zonaId, metros_cuadrados: metros, direccion: `Vía ${documento}`, comerciante_id: comerciante.id });
  return comerciante;
}

const tarifa = (db, rubroId, extra) => insertTarifa(db, {
  rubro_id: rubroId, tipo_tarifa: 'fija', unidad_medida: 'mensual', vigencia_inicio: '2026-01-01', ...extra
});

test('la tarifa del tipo de vía gana a la general y la de la zona gana a ambas', async () => {
  const db = await initializeDatabase();
  const rubroId = await rubroNuevo(db);
  const asfaltada = await zonaNueva(db, 'asfaltada');
  const tierra = await zonaNueva(db, 'sin_asfaltar');
  const sinDato = await zonaNueva(db);
  assert.equal(asfaltada.tipo_via, 'asfaltada');

  await tarifa(db, rubroId, { monto_fijo: 50 });
  await tarifa(db, rubroId, { monto_fijo: 90, tipo_via: 'asfaltada' });
  await tarifa(db, rubroId, { monto_fijo: 60, tipo_via: 'sin_asfaltar' });

  const enAsfalto = await permanente(db, rubroId, asfaltada.id);
  const enTierra = await permanente(db, rubroId, tierra.id);
  const sinTipo = await permanente(db, rubroId, sinDato.id);
  assert.equal((await calcularLiquidacion(db, enAsfalto.id, '2026-11')).monto_total, 90);
  assert.equal((await calcularLiquidacion(db, enTierra.id, '2026-11')).monto_total, 60);
  assert.equal((await calcularLiquidacion(db, sinTipo.id, '2026-11')).monto_total, 50, 'zona sin tipo de vía: tarifa general');

  await tarifa(db, rubroId, { monto_fijo: 120, zona_id: asfaltada.id });
  assert.equal((await calcularLiquidacion(db, enAsfalto.id, '2026-11')).monto_total, 120, 'la tarifa de la zona es la más específica');

  // Si la zona pasa a sin asfaltar, se aplica la tarifa de ese tipo de vía.
  await updateZona(db, sinDato.id, { tipo_via: 'sin_asfaltar' });
  assert.equal((await calcularLiquidacion(db, sinTipo.id, '2026-11')).monto_total, 60);
});

test('tipo de vía con tarifa por m² y validaciones', async () => {
  const db = await initializeDatabase();
  const rubroId = await rubroNuevo(db);
  const zona = await zonaNueva(db, 'asfaltada');
  await tarifa(db, rubroId, { tipo_tarifa: 'variable', monto_variable: 3, unidad_medida: 'metro_cuadrado', tipo_via: 'asfaltada' });
  const comerciante = await permanente(db, rubroId, zona.id, 4);
  const liquidacion = await calcularLiquidacion(db, comerciante.id, '2026-11');
  assert.equal(liquidacion.tarifa.tipo_via, 'asfaltada');
  assert.equal(liquidacion.monto_total, 12, 'S/ 3 × 4 m²');

  await assert.rejects(() => tarifa(db, rubroId, { monto_fijo: 5, zona_id: zona.id, tipo_via: 'asfaltada' }), /zona o para un tipo de vía/);
  await assert.rejects(() => zonaNueva(db, 'empedrada'), /tipo de vía/);
  await assert.rejects(
    () => db.query(`INSERT INTO tarifas (rubro_id, zona_id, tipo_via, tipo_tarifa, monto_fijo, unidad_medida, vigencia_inicio)
                    VALUES ($1, $2, 'asfaltada', 'fija', 1, 'mensual', '2026-01-01')`, [rubroId, zona.id]),
    /tarifas_zona_o_tipo_via/
  );
});
