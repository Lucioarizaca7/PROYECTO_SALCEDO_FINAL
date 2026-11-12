/**
 * Cada cobro cuenta en la zona y el rubro que tenía el comerciante el día del cobro (migración 0028, revisión
 * del 11/11/2026). Antes el panel, los reportes y la proyección usaban los de hoy: mover a un comerciante de
 * zona cambiaba la recaudación ya cerrada de los meses pasados y el filtro del reporte dejaba de traer sus
 * cobros. También: el conteo de comerciantes por zona del panel incluía a los dados de baja.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  closeDatabase, createUser, currentPeriod, generateForecastProjection, getOperationalDashboard, getReportRows,
  initializeDatabase, insertComerciante, insertPuesto, insertTarifa, insertZona, registrarCobro, updateComerciante
} from '../src/db.js';
import { pool } from '../src/pg.js';

before(async () => { await initializeDatabase(); });
after(async () => { await closeDatabase(); });

const anterior = (periodo) => {
  const [anio, mes] = periodo.split('-').map(Number);
  return mes === 1 ? `${anio - 1}-12` : `${anio}-${String(mes - 1).padStart(2, '0')}`;
};
const mesPasado = anterior(currentPeriod());
let correlativo = 0;
const unico = () => `${process.pid}-${correlativo += 1}`;
let documento = 20888000000;

// Zonas sin tipo de vía y tarifa mensual de S/ 30 por rubro, vigente desde el mes pasado.
const zona = (nombre) => insertZona(pool, { nombre: `${nombre} ${unico()}` });
async function rubroConTarifa(nombre) {
  const id = (await pool.query('INSERT INTO rubros (nombre) VALUES ($1) RETURNING id', [`${nombre} ${unico()}`])).rows[0].id;
  await insertTarifa(pool, {
    tipo_tarifa: 'fija', monto_fijo: 30, monto_variable: 0, unidad_medida: 'mensual', rubro_id: id, vigencia_inicio: `${mesPasado}-01`
  }, { permitirInicioPasado: true });
  return id;
}
async function comerciante(zonaId, rubroId) {
  const merchant = await insertComerciante(pool, {
    dni_ruc: String(documento += 1), nombre: `Informe ${documento}`, rubro_id: rubroId, zona_id: zonaId,
    tipo_comerciante: 'permanente', estado: 'activo', usuario_creador: 1
  });
  await insertPuesto(pool, { zona_id: zonaId, metros_cuadrados: 4, direccion: `Informe ${unico()}`, comerciante_id: merchant.id });
  return merchant;
}
// Cobro de S/ 30 fechado el 15 del mes pasado (los informes agrupan por fecha_cobro_cliente).
async function cobroDelMesPasado(comercianteId, cobradorId) {
  const cobro = await registrarCobro(pool, { comerciante_id: comercianteId, cobrador_id: cobradorId, monto: 30, metodo_pago: 'efectivo' });
  await pool.query(`UPDATE transacciones SET fecha_cobro_cliente = ($2 || '-15T12:00:00-05:00')::timestamptz, periodo_aplicado = $2 WHERE id = $1`, [cobro.id, mesPasado]);
  return cobro;
}
const porNombre = (lista, campo, nombre) => lista.find((fila) => fila[campo] === nombre);

test('mover de zona y rubro no mueve la recaudación de los meses pasados', async () => {
  const [zonaA, zonaB] = [await zona('Zona informe A'), await zona('Zona informe B')];
  const [rubro1, rubro2] = [await rubroConTarifa('rubro informe 1'), await rubroConTarifa('rubro informe 2')];
  const cobrador = await createUser({ nombre: `Cobrador informe ${unico()}`, email: `informe-${unico()}@prueba.pe`, password: 'clave-de-prueba-1', rol: 'cobrador' });
  const merchant = await comerciante(zonaA.id, rubro1);
  const pasado = await cobroDelMesPasado(merchant.id, cobrador.id);

  await updateComerciante(pool, merchant.id, { zona_id: zonaB.id, rubro_id: rubro2 });
  const hoy = await registrarCobro(pool, { comerciante_id: merchant.id, cobrador_id: cobrador.id, monto: 30, metodo_pago: 'efectivo' });

  // Panel del mes pasado: el cobro sigue en la zona y el rubro de entonces.
  const panel = await getOperationalDashboard(pool, { periodo: mesPasado });
  assert.equal(Number(porNombre(panel.porZona, 'zona', zonaA.nombre).recaudado), 30, 'antes pasaba a S/ 0');
  assert.equal(Number(porNombre(panel.porZona, 'zona', zonaB.nombre).recaudado), 0, 'antes se llevaba los S/ 30');
  const rubro1Nombre = (await pool.query('SELECT nombre FROM rubros WHERE id = $1', [rubro1])).rows[0].nombre;
  assert.equal(Number(porNombre(panel.porRubro, 'rubro', rubro1Nombre).recaudado), 30);

  // El cobro de hoy sí cuenta en la zona nueva.
  const panelHoy = await getOperationalDashboard(pool, { periodo: currentPeriod() });
  assert.equal(Number(porNombre(panelHoy.porZona, 'zona', zonaB.nombre).recaudado), 30);

  // Reporte: el filtro por zona y las columnas son los del día del cobro.
  const enZonaA = await getReportRows(pool, { zona_id: zonaA.id, comerciante_id: merchant.id });
  assert.deepEqual(enZonaA.map((fila) => Number(fila.id)), [pasado.id], 'antes el filtro por la zona vieja no lo traía');
  assert.equal(enZonaA[0].zona, zonaA.nombre);
  assert.equal(enZonaA[0].rubro, rubro1Nombre);
  const enZonaB = await getReportRows(pool, { zona_id: zonaB.id, comerciante_id: merchant.id });
  assert.deepEqual(enZonaB.map((fila) => Number(fila.id)), [hoy.id]);

  // Proyección: la serie histórica del mes pasado queda en la zona y el rubro de entonces.
  const proyeccion = await generateForecastProjection(pool, {});
  const zonaProyectada = proyeccion.porZona.find((fila) => Number(fila.zona_id) === Number(zonaA.id));
  assert.equal(zonaProyectada?.recaudado, 30, 'antes la historia se movía a la zona nueva');
  assert.ok(!proyeccion.porZona.some((fila) => Number(fila.zona_id) === Number(zonaB.id) && fila.recaudado > 0));

  // Un cobro sin señal fechado antes del cambio de zona se sincroniza después: su foto es la zona de ese día.
  const haceDosDias = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
  const atrasado = await registrarCobro(pool, {
    comerciante_id: merchant.id, cobrador_id: cobrador.id, monto: 5, metodo_pago: 'efectivo', fecha_cobro: haceDosDias
  }, { allowExcess: true });
  const foto = (await pool.query('SELECT zona_cobro_id, rubro_cobro_id FROM transacciones WHERE id = $1', [atrasado.id])).rows[0];
  assert.equal(Number(foto.zona_cobro_id), Number(zonaA.id), 'el cambio fue después del día del cobro');
  assert.equal(Number(foto.rubro_cobro_id), Number(rubro1));
});

test('el conteo de comerciantes por zona no incluye a los dados de baja', async () => {
  const zonaC = await zona('Zona informe C');
  const rubro = await rubroConTarifa('rubro informe baja');
  const activo = await comerciante(zonaC.id, rubro);
  const dadoDeBaja = await comerciante(zonaC.id, rubro);
  await updateComerciante(pool, dadoDeBaja.id, { estado: 'inactivo' });

  const panel = await getOperationalDashboard(pool, { periodo: currentPeriod() });
  assert.equal(porNombre(panel.porZona, 'zona', zonaC.nombre).comerciantes, 1, `antes contaba también al dado de baja (${activo.id})`);
});
