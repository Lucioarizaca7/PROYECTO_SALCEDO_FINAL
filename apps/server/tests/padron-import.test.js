import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateLiquidation, getComerciantes, getPuestos, initializeDatabase } from '../src/db.js';
import { importPadronPreview, previewPadronSheets } from '../src/padronImport.js';

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
  const preview = previewPadronSheets(workbook, { filename: 'FERIA ZAPATILLAS 2026.xlsx', db });

  assert.equal(preview.rows, 2);
  assert.equal(preview.validRows, 2);
  assert.equal(preview.absentRows, 1);
  assert.equal(preview.newMerchants, 2);

  const result = importPadronPreview(db, preview, 1);
  assert.deepEqual(result, {
    createdMerchants: 2,
    updatedMerchants: 0,
    createdPosts: 2,
    updatedPosts: 0,
    absentPosts: 1,
    skippedRows: 0
  });

  const absentMerchant = getComerciantes(db, { search: '20123456781', includeInactive: true, limit: 100 }).find((item) => item.dni_ruc === '20123456781');
  const absentPost = getPuestos(db).find((item) => item.codigo === 'ZAP-TEST-01');
  assert.equal(absentMerchant.tipo_comerciante, 'ferial');
  assert.equal(absentPost.metros_cuadrados, 4.5);
  assert.equal(absentPost.estado, 'disponible');
  assert.equal(calculateLiquidation(db, absentMerchant.id, '2026-09').no_devengo, true);

  const secondPreview = previewPadronSheets(workbook, { filename: 'FERIA ZAPATILLAS 2026.xlsx', db });
  assert.equal(secondPreview.validRows, 2);
  assert.equal(secondPreview.newMerchants, 0);
  const secondResult = importPadronPreview(db, secondPreview, 1);
  assert.equal(secondResult.createdMerchants, 0);
  assert.equal(secondResult.createdPosts, 0);
  assert.equal(secondResult.updatedMerchants, 2);
  assert.equal(secondResult.updatedPosts, 2);
  assert.equal(db.exec("SELECT COUNT(*) FROM comerciantes WHERE dni_ruc IN ('20123456781', '20123456782')")[0].values[0][0], 2);
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
  const preview = previewPadronSheets(duplicateRows, { filename: 'FERIA ZAPATILLAS 2026.xlsx', db });

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

  const preview = previewPadronSheets(attendanceWorkbook, { filename: 'FERIA ZAPATILLAS 2026.xlsx', db });
  assert.equal(preview.workbookType, 'attendance');
  assert.equal(preview.attendanceRecords, 3);
  assert.equal(preview.attendanceMarks, 4);
  assert.equal(preview.sheets[0].dates.length, 2);
  assert.equal(preview.validRows, 0);
  assert.match(preview.sheets[0].reason, /faltan DNI\/RUC y metraje/);
});
