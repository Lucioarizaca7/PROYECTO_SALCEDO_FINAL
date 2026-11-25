/**
 * Reporte de cobros en Excel (24/11/2026): el CSV se abría en Excel en una sola columna y con las tildes rotas.
 * El .xlsx trae una tabla de Excel con encabezados en español, la fecha como fecha, el monto en soles y el
 * total de lo cobrado solo con los confirmados (un anulado no es recaudación).
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

import { anularCobro, closeDatabase, currentPeriod, initializeDatabase, registrarCobro } from '../src/db.js';
import { pool } from '../src/pg.js';
import { buildReportXlsx, textoPeriodoReporte } from '../src/reporteExcel.js';
import { comercianteConDeuda } from './_deuda.js';

before(async () => { await initializeDatabase(); });
after(async () => { await closeDatabase(); });

async function leer(buffer) {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(buffer);
  return libro.getWorksheet('Cobros');
}

test('el reporte sale como tabla de Excel y el total suma solo los cobros confirmados', async () => {
  const { merchant } = await comercianteConDeuda(pool, { precio: 30, dias: 3 });
  const pagado = await registrarCobro(pool, { comerciante_id: merchant.id, cobrador_id: 1, monto: 30, metodo_pago: 'efectivo', observaciones: 'Pagó con monedas' });
  const anulado = await registrarCobro(pool, { comerciante_id: merchant.id, cobrador_id: 1, monto: 30, metodo_pago: 'efectivo' });
  await anularCobro(pool, anulado.id, { motivo: 'Cobro duplicado de prueba', usuarioId: 1 });

  const hoja = await leer(await buildReportXlsx(pool, { periodo: currentPeriod(), comerciante_id: merchant.id }, { usuarioId: 1 }));
  const tabla = hoja.getTable('TablaCobros');
  assert.ok(tabla, 'hay una tabla de Excel, no texto suelto');
  const encabezados = hoja.getRow(7).values.slice(1);
  assert.deepEqual(encabezados.slice(0, 7), ['Fecha', 'Código', 'Comerciante', 'Rubro', 'Zona', 'Cobrador', 'Monto']);
  assert.ok(encabezados.includes('Nota del cobrador') && encabezados.includes('Motivo de anulación'));

  const filas = [hoja.getRow(8), hoja.getRow(9)];
  const estados = filas.map((fila) => fila.getCell(9).value).sort();
  assert.deepEqual(estados, ['anulado', 'confirmado']);
  assert.ok(filas[0].getCell(1).value instanceof Date, 'la fecha es fecha de Excel: se ordena y se filtra');
  assert.equal(filas[0].getCell(7).numFmt, '"S/" #,##0.00');
  assert.equal(typeof filas[0].getCell(7).value, 'number');

  // Total cobrado: solo los confirmados.
  assert.equal(hoja.getCell('B5').value, 30, 'el anulado no suma');
  assert.equal(hoja.getCell('B5').numFmt, '"S/" #,##0.00');
  assert.equal(hoja.getCell('D5').value, 1);
  assert.equal(hoja.getCell('F5').value, 1);
  assert.match(hoja.getCell('A2').value, /^Reporte de cobros de /);
  assert.ok(pagado.id);
});

test('sin cobros el Excel abre igual, con la tabla vacía', async () => {
  const hoja = await leer(await buildReportXlsx(pool, { periodo: '1999-01' }));
  assert.ok(hoja.getTable('TablaCobros'));
  assert.equal(hoja.getCell('B5').value, 0);
  assert.equal(hoja.getCell('A2').value, 'Reporte de cobros de enero de 1999');
});

test('el título dice el día, el mes o todo el registro, como la vista previa', () => {
  assert.equal(textoPeriodoReporte('2026-11-23'), 'del día 23/11/2026');
  assert.equal(textoPeriodoReporte('2026-11'), 'de noviembre de 2026');
  assert.equal(textoPeriodoReporte(''), 'de todo el registro');
});
