/**
 * Los reportes por zona cuentan cada cobro en la zona donde se vendió ese día (migración 0033, decisión del
 * usuario del 14/11/2026). Antes contaban en la zona del comerciante: quien vendía un día en otra zona pagaba
 * el precio de esa zona, pero el panel y los reportes sumaban el cobro a su zona habitual.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  closeDatabase, createUser, currentPeriod, getOperationalDashboard, getReportRows, initializeDatabase,
  insertComerciante, insertPuesto, registrarCobro
} from '../src/db.js';
import { pool } from '../src/pg.js';
import { zonaConPrecio } from './_deuda.js';

before(async () => { await initializeDatabase(); });
after(async () => { await closeDatabase(); });

let correlativo = 0;
const unico = () => `${process.pid}-${correlativo += 1}`;
let documento = 20777000000;
const zona = (nombre, precio) => zonaConPrecio(pool, precio, { nombre: `${nombre} ${unico()}` });
const recaudado = (panel, nombre) => Number(panel.porZona.find((fila) => fila.zona === nombre)?.recaudado || 0);

async function preparar() {
  const [habitual, otra] = [await zona('Zona habitual', 3), await zona('Zona del día', 2)];
  const rubro = (await pool.query('INSERT INTO rubros (nombre) VALUES ($1) RETURNING id', [`rubro zona día ${unico()}`])).rows[0].id;
  const cobrador = await createUser({ nombre: `Cobrador zona día ${unico()}`, email: `zona-dia-${unico()}@prueba.pe`, password: 'clave-de-prueba-1', rol: 'cobrador' });
  const merchant = await insertComerciante(pool, {
    dni_ruc: String(documento += 1), nombre: `Zona día ${documento}`, rubro_id: rubro, zona_id: habitual.id,
    tipo_comerciante: 'ferial', estado: 'activo', usuario_creador: 1
  });
  await insertPuesto(pool, { zona_id: habitual.id, direccion: `Zona día ${unico()}`, comerciante_id: merchant.id });
  return { habitual, otra, cobrador, merchant };
}

test('un cobro en la zona del día cuenta en esa zona en el panel y en el reporte', async () => {
  const { habitual, otra, cobrador, merchant } = await preparar();
  // Hoy vende en la otra zona (S/ 2): el cobrador la elige al cobrar.
  const cobro = await registrarCobro(pool, { comerciante_id: merchant.id, cobrador_id: cobrador.id, monto: 2, metodo_pago: 'efectivo', zona_dia: otra.id });

  const foto = (await pool.query('SELECT zona_cobro_id FROM transacciones WHERE id = $1', [cobro.id])).rows[0];
  assert.equal(Number(foto.zona_cobro_id), Number(otra.id), 'antes guardaba la zona habitual del comerciante');

  const panel = await getOperationalDashboard(pool, { periodo: currentPeriod() });
  assert.equal(recaudado(panel, otra.nombre), 2);
  assert.equal(recaudado(panel, habitual.nombre), 0, 'antes los S/ 2 se sumaban a la zona habitual');

  const deLaOtra = await getReportRows(pool, { periodo: currentPeriod(), zona_id: otra.id });
  assert.ok(deLaOtra.some((fila) => Number(fila.id) === Number(cobro.id)), 'el filtro por zona trae el cobro');
  const deLaHabitual = await getReportRows(pool, { periodo: currentPeriod(), zona_id: habitual.id });
  assert.ok(!deLaHabitual.some((fila) => Number(fila.id) === Number(cobro.id)));
});

test('sin elegir zona del día, el cobro cuenta en la zona de su puesto', async () => {
  const { habitual, cobrador, merchant } = await preparar();
  const cobro = await registrarCobro(pool, { comerciante_id: merchant.id, cobrador_id: cobrador.id, monto: 3, metodo_pago: 'efectivo' });
  const foto = (await pool.query('SELECT zona_cobro_id FROM transacciones WHERE id = $1', [cobro.id])).rows[0];
  assert.equal(Number(foto.zona_cobro_id), Number(habitual.id));
});

test('elegir otra zona del día en un segundo cobro mueve también el primero de ese día', async () => {
  const { habitual, otra, cobrador, merchant } = await preparar();
  // Segundo puesto, para que haya dos cobros el mismo día.
  const primero = await registrarCobro(pool, { comerciante_id: merchant.id, cobrador_id: cobrador.id, monto: 1, metodo_pago: 'efectivo' });
  await registrarCobro(pool, { comerciante_id: merchant.id, cobrador_id: cobrador.id, monto: 1, metodo_pago: 'efectivo', zona_dia: otra.id });
  const foto = (await pool.query('SELECT zona_cobro_id FROM transacciones WHERE id = $1', [primero.id])).rows[0];
  assert.equal(Number(foto.zona_cobro_id), Number(otra.id), `el día entero pasó a la otra zona (habitual ${habitual.id})`);
});
