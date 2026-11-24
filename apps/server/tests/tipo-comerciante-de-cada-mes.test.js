/**
 * El tipo de comerciante rige desde el día del cambio (migración 0023, decisión del usuario del 11/11/2026).
 * Antes cada mes se liquidaba con el tipo actual: pasar a un ferial a eventual borraba su deuda atrasada (el
 * eventual no acumula), y pasar un eventual a permanente le creaba deuda de meses en que era eventual.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  calcularDeudaAcumulada, calcularLiquidacion, closeDatabase, currentPeriod, initializeDatabase, insertComerciante,
  insertPuesto, insertZona, setInicioCobro, tipoEnDia, tipoEnPeriodo, todayInLima, updateComerciante
} from '../src/db.js';
import { pool } from '../src/pg.js';
import { insertZonaConPrecio } from './_deuda.js';

before(async () => { await initializeDatabase(); });
after(async () => { await closeDatabase(); });

const anterior = (periodo) => {
  const [anio, mes] = periodo.split('-').map(Number);
  return mes === 1 ? `${anio - 1}-12` : `${anio}-${String(mes - 1).padStart(2, '0')}`;
};

test('tipoEnPeriodo: cada mes con el tipo que tenía; un mes con días de ferial no cuenta como eventual', () => {
  const cambios = [{ tipo_anterior: 'ferial', tipo_nuevo: 'eventual', desde: '2026-10-15' }];
  assert.equal(tipoEnPeriodo('eventual', cambios, '2026-09', '2026-11'), 'ferial', 'mes entero como ferial');
  assert.equal(tipoEnPeriodo('eventual', cambios, '2026-10', '2026-11'), 'ferial', 'el mes del cambio tuvo días de ferial');
  assert.equal(tipoEnPeriodo('eventual', cambios, '2026-11', '2026-11'), 'eventual', 'el mes en curso usa el tipo actual');

  const alReves = [{ tipo_anterior: 'eventual', tipo_nuevo: 'permanente', desde: '2026-10-15' }];
  assert.equal(tipoEnPeriodo('permanente', alReves, '2026-09', '2026-11'), 'eventual', 'antes del cambio no acumulaba');
  assert.equal(tipoEnPeriodo('permanente', alReves, '2026-10', '2026-11'), 'permanente');
  // Un cambio el día 1 ya rige todo ese mes.
  assert.equal(tipoEnPeriodo('permanente', [{ tipo_anterior: 'eventual', tipo_nuevo: 'permanente', desde: '2026-10-01' }], '2026-10', '2026-11'), 'permanente');
  assert.equal(tipoEnPeriodo('ferial', [], '2026-01', '2026-11'), 'ferial', 'sin cambios, el actual');
});

test('tipoEnDia: el tipo de cada día según sus cambios', () => {
  const cambios = [{ tipo_anterior: 'eventual', tipo_nuevo: 'ferial', desde: '2026-11-23' }];
  assert.equal(tipoEnDia(cambios, '2026-11-22'), 'eventual');
  assert.equal(tipoEnDia(cambios, '2026-11-23'), 'ferial', 'el día del cambio ya rige el tipo nuevo');
  assert.equal(tipoEnDia([...cambios, { tipo_anterior: 'ferial', tipo_nuevo: 'permanente', desde: '2026-12-01' }], '2026-12-05'), 'permanente');
});

// Un solo tipo (decisión del usuario, 23/11/2026; 0039): la base ya no acepta 'eventual'. La migración pasó a cada
// eventual a 'ferial' y el trigger de la 0023 dejó el cambio con su fecha; aquí se arma igual, a mano.
test('el ex eventual: sus meses de eventual no se deben; desde el cambio, un día presente sin pagar sí', async () => {
  const mesPasado = anterior(currentPeriod());
  await setInicioCobro(pool, mesPasado);
  const zona = await insertZonaConPrecio(pool, { nombre: `Zona tipo ${process.pid}`, tipo_via: 'asfaltada' });
  const rubro = (await pool.query("SELECT id FROM rubros WHERE nombre = 'ropa'")).rows[0].id;
  const comerciante = await insertComerciante(pool, {
    dni_ruc: `4657${String(process.pid).slice(-4).padStart(4, '0')}`, nombre: 'Ex eventual', rubro_id: rubro,
    zona_id: zona.id, tipo_comerciante: 'eventual', estado: 'activo', usuario_creador: 1
  });
  assert.equal(comerciante.tipo_comerciante, 'ferial', 'el tipo pedido se ignora');
  await assert.rejects(pool.query("UPDATE comerciantes SET tipo_comerciante = 'eventual' WHERE id = $1", [comerciante.id]), /comerciantes_un_solo_tipo/);

  const hoy = todayInLima();
  await pool.query('UPDATE comerciantes SET creado_en = $2::date WHERE id = $1', [comerciante.id, `${mesPasado}-01`]);
  await pool.query("INSERT INTO comerciantes_tipo_cambios (comerciante_id, tipo_anterior, tipo_nuevo, desde) VALUES ($1, 'eventual', 'ferial', $2::date)",
    [comerciante.id, hoy]);
  const puesto = await insertPuesto(pool, { zona_id: zona.id, direccion: 'Puesto del ex eventual', comerciante_id: comerciante.id });
  const marcar = (dia) => pool.query("INSERT INTO asistencias_feriales (puesto_id, fecha, sesion, marca, fuente) VALUES ($1, $2::date, '', 'P', 'app')", [puesto.id, dia]);

  // El mes pasado era eventual: un día marcado ese mes no se debe (RN-52 seguía vigente).
  await marcar(`${mesPasado}-10`);
  // Este mes, ya con el tipo único: hoy estuvo presente y no pagó.
  await marcar(hoy);
  // Lo que pagó como eventual antes del cambio (sin periodo_aplicado) pagó ese día y no cubre el de hoy.
  if (hoy.slice(8) !== '01') {
    await pool.query(`INSERT INTO transacciones (comerciante_id, cobrador_id, monto, concepto, metodo_pago, hash_transaccion, fecha_cobro_cliente)
      VALUES ($1, 2, 3, 'Día como eventual', 'efectivo', $2, ($3::date + time '12:00') AT TIME ZONE 'America/Lima')`,
    [comerciante.id, `prueba-ex-eventual-${comerciante.id}`, `${hoy.slice(0, 8)}01`]);
  }

  const esteMes = await calcularLiquidacion(pool, comerciante.id);
  assert.equal(esteMes.saldo, 3, 'el día presente sin pagar se debe');
  assert.equal(esteMes.monto_pagado, 0, 'lo pagado como eventual no lo cubre');
  const deuda = await calcularDeudaAcumulada(pool, comerciante.id);
  assert.ok(!deuda.meses_impagos.includes(mesPasado), 'el mes en que era eventual no entra en la deuda');
});
