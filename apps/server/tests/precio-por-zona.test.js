/**
 * Precio por zona y calles (decisión del usuario, 13/11/2026; migración 0032). Reemplaza a tarifa-tipo-via.test.js:
 * - el precio de un día lo fija el super_admin para cada zona; no depende del rubro, de los metros ni del tipo de
 *   vía (que queda como dato del sector);
 * - zona = sector: la calle de un puesto es una calle de su zona.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calcularLiquidacion, getZonas, initializeDatabase, insertCalle, insertComerciante, insertPuesto, insertTarifa, insertZona,
  updateCalle, updatePuesto, updateZona
} from '../src/db.js';
import { marcarDias } from './_deuda.js';

let documento = 20888500000;
let correlativo = 0;
const unico = () => `${process.pid}-${correlativo += 1}-${Date.now()}`;

async function permanenteConPuesto(db, { zonaId, rubro = 'comida', metros = 1 }) {
  const rubroId = (await db.query('SELECT id FROM rubros WHERE nombre = $1', [rubro])).rows[0].id;
  const comerciante = await insertComerciante(db, {
    dni_ruc: String(documento += 1), nombre: `Precio zona ${documento}`, rubro_id: rubroId, zona_id: zonaId,
    tipo_comerciante: 'permanente', estado: 'activo', usuario_creador: 1
  });
  const puesto = await insertPuesto(db, { zona_id: zonaId, metros_cuadrados: metros, direccion: `Precio zona ${documento}`, comerciante_id: comerciante.id });
  return { comerciante, puesto };
}

test('el precio es de la zona: igual para todo rubro y tamaño, y el tipo de vía no lo cambia', async () => {
  const db = await initializeDatabase();
  const zona = await insertZona(db, { nombre: `Zona precio ${unico()}`, tipo_via: 'sin_asfaltar' });
  await insertTarifa(db, { zona_id: zona.id, monto_fijo: 4, vigencia_inicio: '2026-01-01' }, { permitirInicioPasado: true });

  const comida = await permanenteConPuesto(db, { zonaId: zona.id, rubro: 'comida', metros: 2 });
  const ropa = await permanenteConPuesto(db, { zonaId: zona.id, rubro: 'ropa', metros: 12 });
  for (const { puesto } of [comida, ropa]) await marcarDias(db, puesto.id, '2026-10', 2);
  assert.equal((await calcularLiquidacion(db, comida.comerciante.id, '2026-10')).monto_total, 8);
  assert.equal((await calcularLiquidacion(db, ropa.comerciante.id, '2026-10')).monto_total, 8, 'otro rubro y 12 m²: el mismo precio');

  await updateZona(db, zona.id, { tipo_via: 'asfaltada' });
  assert.equal((await calcularLiquidacion(db, comida.comerciante.id, '2026-10')).monto_total, 8, 'asfaltar el sector no cambia el precio: lo cambia el super_admin');

  const [enLista] = (await getZonas(db)).filter((item) => item.id === zona.id);
  assert.equal(Number(enLista.precio_dia), 4);
  assert.equal(enLista.precio_desde, '2026-01-01');
  assert.ok(enLista.precio_tarifa_id);

  await assert.rejects(() => insertZona(db, { nombre: `Zona ${unico()}`, tipo_via: 'empedrada' }), /tipo de vía/);
});

test('una zona sin precio aparece así en la lista', async () => {
  const db = await initializeDatabase();
  const zona = await insertZona(db, { nombre: `Zona sin precio ${unico()}` });
  const [enLista] = (await getZonas(db)).filter((item) => item.id === zona.id);
  assert.equal(enLista.precio_dia, null);
});

test('la calle del puesto es de su zona; mover el puesto o la calle a otra zona le quita la calle', async () => {
  const db = await initializeDatabase();
  const norte = await insertZona(db, { nombre: `Norte ${unico()}` });
  const sur = await insertZona(db, { nombre: `Sur ${unico()}` });
  const calleNorte = await insertCalle(db, { nombre: 'Jr. Lima', zona_id: norte.id });
  const calleSur = await insertCalle(db, { nombre: 'Jr. Puno', zona_id: sur.id });

  await assert.rejects(() => insertPuesto(db, { zona_id: norte.id, direccion: `Calle ${unico()}`, calle_id: calleSur.id }), /no pertenece a la zona/);
  const puesto = await insertPuesto(db, { zona_id: norte.id, direccion: `Calle ${unico()}`, calle_id: calleNorte.id });
  assert.equal(puesto.calle_id, calleNorte.id);
  assert.equal(puesto.calle, 'Jr. Lima');
  assert.equal(puesto.metros_cuadrados, null, 'el metraje es opcional');

  // Sin calle en el pedido se conserva; pasar a otra zona la quita, salvo que se elija una de la zona nueva.
  assert.equal((await updatePuesto(db, puesto.id, { direccion: 'Otra dirección' })).calle_id, calleNorte.id);
  assert.equal((await updatePuesto(db, puesto.id, { zona_id: sur.id })).calle_id, null);
  assert.equal((await updatePuesto(db, puesto.id, { calle_id: calleSur.id })).calle, 'Jr. Puno');
  await assert.rejects(() => updatePuesto(db, puesto.id, { calle_id: calleNorte.id }), /no pertenece a la zona/);

  // La base lo vuelve a exigir aunque se entre por otro camino.
  await assert.rejects(() => db.query('UPDATE puestos SET calle_id = $1 WHERE id = $2', [calleNorte.id, puesto.id]), /no pertenece a la zona/);

  // La calle pasa a otra zona: el puesto de la zona anterior se queda sin calle.
  await updateCalle(db, calleSur.id, { zona_id: norte.id });
  assert.equal((await db.query('SELECT calle_id FROM puestos WHERE id = $1', [puesto.id])).rows[0].calle_id, null);
});
