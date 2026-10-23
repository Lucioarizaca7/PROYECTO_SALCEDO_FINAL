import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addZoneTariff,
  calculateLiquidation,
  deleteZona,
  feriaDaysOfPeriod,
  getZoneTariffs,
  initializeDatabase,
  insertCobro,
  insertComerciante,
  insertPuesto,
  insertZona,
  setDefaultZoneTariff,
  setZoneTariff,
  updateComerciante,
  updatePuesto
} from '../src/db.js';

let sequence = 0;

// Zona con monto fijo desde enero para que los meses pasados también se liquiden.
async function zoneWithAmount(db, amount) {
  sequence += 1;
  const zona = await insertZona(db, { nombre: `Zona Prueba ${process.pid}-${sequence}`, monto_por_feria: amount });
  await db.query("UPDATE tarifas SET vigencia_inicio = '2026-01-01' WHERE zona_id = $1", [zona.id]);
  return zona;
}

async function merchantWithPost(db, zonaId, { metros = 4, frecuencia = 'semanal', tipo = 'ferial', desde = '2026-01-01', categoriaId } = {}) {
  sequence += 1;
  const merchant = await insertComerciante(db, {
    dni_ruc: `9${String(process.pid % 1000).padStart(3, '0')}${String(sequence).padStart(4, '0')}`,
    nombre: `Comerciante Zona ${sequence}`,
    rubro_id: 1,
    zona_id: zonaId,
    tipo_comerciante: tipo,
    frecuencia_pago: frecuencia
  });
  const puesto = await insertPuesto(db, {
    comerciante_id: merchant.id, zona_id: zonaId, direccion: `Puesto zona ${sequence}`, metros_cuadrados: metros, codigo_puesto: `PZ-${process.pid}-${sequence}`,
    asignado_desde: desde, categoria_cobro_id: categoriaId
  });
  return { merchant, puesto };
}

const nextMonth = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
};

test('las ferias son martes y miércoles', () => {
  const days = feriaDaysOfPeriod('2026-09');
  assert.equal(days.length, 10);
  assert.ok(days.every((day) => [2, 3].includes(new Date(`${day}T00:00:00Z`).getUTCDay())));
  assert.deepEqual(days.slice(0, 2), ['2026-09-01', '2026-09-02']);
});

test('el monto depende de la zona y del número de ferias, no del metraje ni del rubro', async () => {
  const db = await initializeDatabase();
  const zonaA = await zoneWithAmount(db, 5);
  const zonaB = await zoneWithAmount(db, 8);
  const small = await merchantWithPost(db, zonaA.id, { metros: 2 });
  const large = await merchantWithPost(db, zonaA.id, { metros: 12 });
  const other = await merchantWithPost(db, zonaB.id, { metros: 2 });
  await updateComerciante(db, large.merchant.id, { rubro_id: 2 });

  const a = await calculateLiquidation(db, small.merchant.id, '2026-09');
  const b = await calculateLiquidation(db, large.merchant.id, '2026-09');
  const c = await calculateLiquidation(db, other.merchant.id, '2026-09');
  assert.equal(a.monto_total, 50);
  assert.equal(b.monto_total, 50);
  assert.equal(c.monto_total, 80);
  assert.equal(a.dias_feria, 10);
  assert.equal(a.monto_por_feria, 5);
});

test('la cuota sugerida sigue la frecuencia elegida por el comerciante', async () => {
  const db = await initializeDatabase();
  const zona = await zoneWithAmount(db, 5);
  const porFeria = await merchantWithPost(db, zona.id, { frecuencia: 'por_feria' });
  const semanal = await merchantWithPost(db, zona.id, { frecuencia: 'semanal' });
  const mensual = await merchantWithPost(db, zona.id, { frecuencia: 'mensual' });

  assert.equal((await calculateLiquidation(db, porFeria.merchant.id, '2026-09')).cuota_sugerida, 5);
  assert.equal((await calculateLiquidation(db, semanal.merchant.id, '2026-09')).cuota_sugerida, 10);
  assert.equal((await calculateLiquidation(db, mensual.merchant.id, '2026-09')).cuota_sugerida, 50);
  await assert.rejects(() => updateComerciante(db, semanal.merchant.id, { frecuencia_pago: 'quincenal' }), /Frecuencia de pago no válida/);
});

test('una falta no se cobra y lo pagado de más queda a cuenta para el mes siguiente', async () => {
  const db = await initializeDatabase();
  const zona = await zoneWithAmount(db, 5);
  const { merchant, puesto } = await merchantWithPost(db, zona.id);

  await insertCobro(db, { comerciante_id: merchant.id, cobrador_id: 2, monto: 50, metodo_pago: 'efectivo', periodo: '2026-09' });
  // Faltó el martes 8: esa feria ya estaba pagada.
  await db.query(`INSERT INTO asistencias_feriales (puesto_id, fecha, sesion, marca, fuente) VALUES ($1, '2026-09-08', '', 'F', 'prueba')`, [puesto.id]);

  const septiembre = await calculateLiquidation(db, merchant.id, '2026-09');
  assert.equal(septiembre.dias_ausente, 1);
  assert.equal(septiembre.monto_total, 45);
  assert.equal(septiembre.saldo, 0);
  assert.equal(septiembre.saldo_a_favor, 5);

  const octubre = await calculateLiquidation(db, merchant.id, '2026-10');
  assert.equal(octubre.credito_anterior, 5);
  assert.equal(octubre.monto_total, 40);
  assert.equal(octubre.saldo, 35);
});

test('un día con presencia no se descuenta aunque tenga otra marca', async () => {
  const db = await initializeDatabase();
  const zona = await zoneWithAmount(db, 5);
  const { merchant, puesto } = await merchantWithPost(db, zona.id);
  await db.query(`INSERT INTO asistencias_feriales (puesto_id, fecha, sesion, marca, fuente)
    VALUES ($1, '2026-09-09', 'mañana', 'P', 'prueba'), ($1, '2026-09-09', 'tarde', 'F', 'prueba')`, [puesto.id]);
  assert.equal((await calculateLiquidation(db, merchant.id, '2026-09')).monto_total, 50);
});

test('cambiar el monto de una zona rige desde su fecha y no altera lo ya liquidado ni lo pagado', async () => {
  const db = await initializeDatabase();
  const zona = await zoneWithAmount(db, 5);
  const { merchant } = await merchantWithPost(db, zona.id);
  await insertCobro(db, { comerciante_id: merchant.id, cobrador_id: 2, monto: 20, metodo_pago: 'efectivo', periodo: '2026-09' });

  const desde = nextMonth();
  const updated = await setZoneTariff(db, zona.categorias[0].id, { monto_por_feria: 7, vigencia_inicio: desde });
  assert.equal(updated.monto_por_feria, 5);
  assert.deepEqual(updated.proximo_cambio, { monto_por_feria: 7, vigente_desde: desde });

  const septiembre = await calculateLiquidation(db, merchant.id, '2026-09');
  assert.equal(septiembre.monto_total, 50);
  assert.equal(septiembre.monto_pagado, 20);
  assert.equal(septiembre.saldo, 30);

  const siguiente = await calculateLiquidation(db, merchant.id, desde.slice(0, 7));
  assert.equal(siguiente.monto_por_feria, 7);
  assert.equal(siguiente.monto_total, Number((7 * feriaDaysOfPeriod(desde.slice(0, 7)).length).toFixed(2)));

  await assert.rejects(() => setZoneTariff(db, zona.categorias[0].id, { monto_por_feria: 9, vigencia_inicio: '2026-01-01' }), /desde hoy o una fecha futura/);
  await assert.rejects(() => setZoneTariff(db, zona.categorias[0].id, { monto_por_feria: 0 }), /mayor que cero/);
});

test('cada zona nueva nace con pista asfaltada (S/ 3) y sin asfaltar (S/ 2), y una zona sin uso se puede eliminar', async () => {
  const db = await initializeDatabase();
  sequence += 1;
  const zona = await insertZona(db, { nombre: `Zona Nueva ${process.pid}-${sequence}` });
  const listed = (await getZoneTariffs(db)).find((item) => item.zona_id === Number(zona.id));
  assert.deepEqual(listed.tarifas.map((item) => [item.nombre, item.monto_por_feria, item.predeterminada]),
    [['Pista asfaltada', 3, true], ['Pista sin asfaltar', 2, false]]);
  assert.deepEqual(await deleteZona(db, zona.id), { id: Number(zona.id), eliminado: true });
});

test('el cobro guarda el periodo al que se imputa', async () => {
  const db = await initializeDatabase();
  const zona = await zoneWithAmount(db, 5);
  const { merchant } = await merchantWithPost(db, zona.id);
  const cobro = await insertCobro(db, { comerciante_id: merchant.id, cobrador_id: 2, monto: 10, metodo_pago: 'efectivo', periodo: '2026-09' });
  const stored = (await db.query('SELECT periodo FROM transacciones WHERE id = $1', [cobro.id])).rows[0];
  assert.equal(stored.periodo, '2026-09');
});

test('una zona puede tener varias tarifas y cada puesto paga la suya', async () => {
  const db = await initializeDatabase();
  sequence += 1;
  const zona = await insertZona(db, { nombre: `Zona Vías ${process.pid}-${sequence}` });
  await db.query("UPDATE tarifas SET vigencia_inicio = '2026-01-01' WHERE zona_id = $1", [zona.id]);
  const [asfaltada, sinAsfaltar] = zona.categorias;
  const a = await merchantWithPost(db, zona.id, { categoriaId: asfaltada.id });
  const b = await merchantWithPost(db, zona.id, { categoriaId: sinAsfaltar.id });
  const c = await merchantWithPost(db, zona.id);
  assert.equal((await calculateLiquidation(db, a.merchant.id, '2026-09')).monto_total, 30);
  assert.equal((await calculateLiquidation(db, b.merchant.id, '2026-09')).monto_total, 20);
  // Sin tarifa indicada toma la predeterminada de la zona.
  assert.equal((await calculateLiquidation(db, c.merchant.id, '2026-09')).puestos[0].tarifa, 'Pista asfaltada');

  const extra = await addZoneTariff(db, zona.id, { nombre: 'Pista de tierra', monto_por_feria: 1.5 });
  assert.equal(extra.predeterminada, false);
  await setDefaultZoneTariff(db, extra.categoria_id);
  const listed = (await getZoneTariffs(db)).find((item) => item.zona_id === Number(zona.id));
  assert.deepEqual(listed.tarifas.filter((item) => item.predeterminada).map((item) => item.nombre), ['Pista de tierra']);
  await assert.rejects(() => addZoneTariff(db, zona.id, { nombre: 'pista de tierra', monto_por_feria: 2 }), /ya tiene una tarifa con ese nombre/);
});

test('un puesto solo se cobra desde que está asignado', async () => {
  const db = await initializeDatabase();
  const zona = await zoneWithAmount(db, 5);
  const { merchant } = await merchantWithPost(db, zona.id, { desde: '2026-09-15' });
  // Septiembre desde el martes 15: 15, 16, 22, 23, 29 y 30.
  const septiembre = await calculateLiquidation(db, merchant.id, '2026-09');
  assert.equal(septiembre.dias_cobrables, 6);
  assert.equal(septiembre.monto_total, 30);
  assert.equal((await calculateLiquidation(db, merchant.id, '2026-08')).monto_total, 0);
  assert.equal(septiembre.puestos[0].asignado_desde, '2026-09-15');
});

test('cambiar el puesto de zona rige desde su fecha y no recalcula los días anteriores', async () => {
  const db = await initializeDatabase();
  const barata = await zoneWithAmount(db, 5);
  const cara = await zoneWithAmount(db, 8);
  const { merchant, puesto } = await merchantWithPost(db, barata.id);
  await updatePuesto(db, puesto.id, { zona_id: cara.id, vigente_desde: '2026-09-15' });

  // 4 ferias a S/ 5 (1, 2, 8, 9) y 6 a S/ 8 (desde el 15).
  const septiembre = await calculateLiquidation(db, merchant.id, '2026-09');
  assert.equal(septiembre.monto_total, 4 * 5 + 6 * 8);
  assert.equal((await calculateLiquidation(db, merchant.id, '2026-08')).monto_total, 8 * 5);
  const history = (await db.query("SELECT zona_id, to_char(desde, 'YYYY-MM-DD') AS desde, to_char(hasta, 'YYYY-MM-DD') AS hasta FROM puestos_historial WHERE puesto_id = $1 ORDER BY desde", [puesto.id])).rows;
  assert.deepEqual(history, [
    { zona_id: Number(barata.id), desde: '2026-01-01', hasta: '2026-09-14' },
    { zona_id: Number(cara.id), desde: '2026-09-15', hasta: null }
  ]);
});
