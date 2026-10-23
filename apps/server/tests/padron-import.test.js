import test from 'node:test';
import assert from 'node:assert/strict';

import ExcelJS from 'exceljs';

import { calculateLiquidation, deactivateComerciante, getComerciantes, getPuestos, initializeDatabase, insertComerciante } from '../src/db.js';
import { importPadronPreview, previewPadronSheets, readPadronWorkbook } from '../src/padronImport.js';
import { buildPadronTemplate } from '../src/padronTemplate.js';

const workbook = [{
  name: 'BLOQUE A',
  rows: [
    ['DNI', 'Titular', 'Código Puesto', 'Metraje m2', 'Estado', 'Rubro'],
    ['20123456781', 'Titular Ausente', 'ZAP-TEST-01', 4.5, 'Ausente', 'zapatillas'],
    ['20123456782', 'Titular Presente', 'ZAP-TEST-02', 3, 'Presente', 'zapatillas']
  ]
}];

test('previsualiza e importa hojas por bloque, reimporta sin duplicar y no devenga para ausente ferial', async () => {
  const db = await initializeDatabase();
  const preview = await previewPadronSheets(workbook, { filename: 'FERIA ZAPATILLAS 2026.xlsx', db });

  assert.equal(preview.rows, 2);
  assert.equal(preview.validRows, 2);
  assert.equal(preview.absentRows, 1);
  assert.equal(preview.newMerchants, 2);

  const result = await importPadronPreview(db, preview, 1);
  assert.deepEqual(result, {
    createdMerchants: 2,
    updatedMerchants: 0,
    createdPosts: 2,
    updatedPosts: 0,
    absentPosts: 1,
    skippedRows: 0
  });

  const absentMerchant = (await getComerciantes(db, { search: '20123456781', includeInactive: true, limit: 100 })).find((item) => item.dni_ruc === '20123456781');
  const absentPost = (await getPuestos(db)).find((item) => item.codigo === 'ZAP-TEST-01');
  assert.equal(absentMerchant.tipo_comerciante, 'ferial');
  assert.equal(absentPost.metros_cuadrados, 4.5);
  assert.equal(absentPost.estado, 'disponible');
  assert.equal((await calculateLiquidation(db, absentMerchant.id, '2026-09')).no_devengo, true);

  const secondPreview = await previewPadronSheets(workbook, { filename: 'FERIA ZAPATILLAS 2026.xlsx', db });
  assert.equal(secondPreview.validRows, 2);
  assert.equal(secondPreview.newMerchants, 0);
  const secondResult = await importPadronPreview(db, secondPreview, 1);
  assert.equal(secondResult.createdMerchants, 0);
  assert.equal(secondResult.createdPosts, 0);
  assert.equal(secondResult.updatedMerchants, 2);
  assert.equal(secondResult.updatedPosts, 2);
  assert.equal(Number((await db.query("SELECT COUNT(*) FROM comerciantes WHERE dni_ruc IN ('20123456781', '20123456782')")).rows[0].count), 2);
});

test('marca documentos y códigos de puesto duplicados dentro del mismo libro', async () => {
  const db = await initializeDatabase();
  const duplicateRows = [{
    name: 'BLOQUE A',
    rows: [
      ['DNI', 'Titular', 'Código Puesto', 'm2'],
      ['20123456781', 'Titular Uno', 'ZAP-DUP-01', 2],
      ['20123456781', 'Titular Dos', 'ZAP-DUP-01', 2]
    ]
  }];
  const preview = await previewPadronSheets(duplicateRows, { filename: 'FERIA ZAPATILLAS 2026.xlsx', db });

  assert.equal(preview.validRows, 1);
  assert.equal(preview.invalidRows, 1);
  assert.match(preview.errors[0].message, /duplicado dentro del libro/);
});

test('reconoce hojas de control de asistencia por bloque sin inventar DNI ni metraje', async () => {
  const db = await initializeDatabase();
  const attendanceWorkbook = [{
    name: 'BLOQUE A-I',
    rows: [
      [null, 'BLOQUE A-I', null, new Date('2026-09-08T00:00:00Z'), new Date('2026-09-09T00:00:00Z')],
      [1, 'Yorica Choque Cutipa', 'P', null],
      [2, 'Nidia Layme Atencio', 'N/S', 'F'],
      [3, 'Ghina Ordoño Duran', null, 'P/1 Mañana']
    ]
  }];

  const preview = await previewPadronSheets(attendanceWorkbook, { filename: 'FERIA ZAPATILLAS 2026.xlsx', db });
  assert.equal(preview.workbookType, 'attendance');
  assert.equal(preview.attendanceRecords, 3);
  assert.equal(preview.attendanceMarks, 4);
  assert.equal(preview.sheets[0].dates.length, 2);
  assert.equal(preview.validRows, 0);
  assert.match(preview.sheets[0].reason, /faltan DNI\/RUC y metraje/);
});

test('previsualiza e importa en lote: el número de consultas no crece con las filas', async () => {
  const db = await initializeDatabase();
  const rows = Array.from({ length: 60 }, (_, index) => [
    `7${String(index).padStart(7, '0')}`, `Titular Lote ${index}`, `LOTE-${String(index).padStart(3, '0')}`, 'Bloque L', 'Zona Norte', 'ferial', 'ropa', 3, index % 10 === 0 ? 'Ausente' : 'Presente'
  ]);
  const workbook = [{ name: 'BLOQUE L', rows: [['DNI/RUC', 'Titular', 'Código Puesto', 'Sector', 'Zona', 'Tipo Comerciante', 'Rubro', 'Metraje m2', 'Estado'], ...rows] }];
  let queries = 0;
  const countingDb = { query: (...args) => { queries += 1; return db.query(...args); } };

  const preview = await previewPadronSheets(workbook, { filename: 'padron.xlsx', db: countingDb });
  assert.equal(preview.validRows, 60);
  assert.ok(queries <= 5, `la previsualización hizo ${queries} consultas`);

  const result = await importPadronPreview(db, preview, 1);
  assert.equal(result.createdMerchants, 60);
  assert.equal(result.createdPosts, 60);
  assert.equal(result.absentPosts, 6);
  const posts = (await getPuestos(db)).filter((post) => post.codigo.startsWith('LOTE-'));
  assert.equal(posts.length, 60);
  assert.equal(posts.filter((post) => post.estado === 'disponible').length, 6);
  assert.equal(posts.find((post) => post.codigo === 'LOTE-001').direccion, 'Bloque L - LOTE-001');
});

test('un comerciante dado de baja no recibe un puesto nuevo: se marca la fila en vez de abortar el libro', async () => {
  const db = await initializeDatabase();
  const rubroId = (await db.query(`SELECT id FROM rubros WHERE nombre = 'ropa'`)).rows[0].id;
  const zonaId = (await db.query(`SELECT id FROM zonas WHERE nombre = 'Zona Norte'`)).rows[0].id;
  const merchant = await insertComerciante(db, { dni_ruc: '61234567', nombre: 'Titular de Baja', rubro_id: rubroId, zona_id: zonaId, tipo_comerciante: 'ferial' });
  await deactivateComerciante(db, merchant.id);

  const preview = await previewPadronSheets([{
    name: 'BLOQUE D',
    rows: [
      ['DNI', 'Titular', 'Código Puesto', 'Zona', 'Rubro', 'm2'],
      ['61234567', 'Titular de Baja', 'BAJA-01', 'Zona Norte', 'ropa', 2],
      ['61234568', 'Titular Nuevo', 'BAJA-02', 'Zona Norte', 'ropa', 2]
    ]
  }], { filename: 'padron.xlsx', db });

  assert.equal(preview.validRows, 1);
  assert.match(preview.errors[0].message, /dado de baja/);
  const result = await importPadronPreview(db, preview, 1);
  assert.equal(result.createdMerchants, 1);
  assert.equal(result.skippedRows, 1);
});

test('la plantilla oficial trae las listas del catálogo y se importa sin ajustes', async () => {
  const db = await initializeDatabase();
  const template = new ExcelJS.Workbook();
  await template.xlsx.load(await buildPadronTemplate(db));

  const lists = template.getWorksheet('LISTAS');
  assert.equal(lists.state, 'veryHidden');
  const zonas = lists.getColumn(1).values.filter(Boolean);
  assert.ok(zonas.includes('Mercado Central'));
  const sheet = template.getWorksheet('PADRON');
  assert.equal(sheet.getCell('G2').dataValidation.type, 'list');

  sheet.addRow(['04512345', 'Titular Plantilla', 'PLT-001', 'Bloque P', 'Mercado Central', 'permanente', 'comida', 4, 'Presente']);
  const sheets = await readPadronWorkbook(Buffer.from(await template.xlsx.writeBuffer()));
  const preview = await previewPadronSheets(sheets, { filename: 'plantilla-padron-sisrec.xlsx', db });

  assert.equal(preview.validRows, 1);
  assert.equal(preview.candidates[0].document, '04512345');
  assert.deepEqual(preview.sheets.map((item) => item.sheet), ['PADRON']);
});
