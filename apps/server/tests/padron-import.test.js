import test from 'node:test';
import assert from 'node:assert/strict';

import ExcelJS from 'exceljs';

import { calculateLiquidation, deactivateComerciante, getComerciantes, getPuestos, initializeDatabase, insertComerciante, updateComerciante } from '../src/db.js';
import { importPadronPreview, previewPadronSheets, readPadronWorkbook, temporaryDocument } from '../src/padronImport.js';
import { buildPadronTemplate } from '../src/padronTemplate.js';

const workbook = [{
  name: 'BLOQUE A',
  rows: [
    ['DNI', 'Titular', 'Código Puesto', 'Metraje m2', 'Estado', 'Rubro'],
    ['20123456781', 'Titular Ausente', 'ZAP-TEST-01', 4.5, 'Ausente', 'zapatillas'],
    ['20123456782', 'Titular Presente', 'ZAP-TEST-02', 3, 'Presente', 'zapatillas']
  ]
}];

test('previsualiza e importa por bloque: el ausente registra una falta de esa feria y conserva su puesto', async () => {
  const db = await initializeDatabase();
  const options = { filename: 'FERIA ZAPATILLAS 2026.xlsx', db, fechaFeria: '2026-09-08' };
  const preview = await previewPadronSheets(workbook, options);

  assert.equal(preview.rows, 2);
  assert.equal(preview.validRows, 2);
  assert.equal(preview.absentRows, 1);
  assert.equal(preview.newMerchants, 2);
  assert.deepEqual(preview.feriaDates, ['2026-09-08']);

  const result = await importPadronPreview(db, preview, 1);
  assert.deepEqual(result, {
    createdMerchants: 2,
    updatedMerchants: 0,
    pendingMerchants: 0,
    reactivatedMerchants: 0,
    regularizedMerchants: 0,
    createdPosts: 2,
    updatedPosts: 0,
    absentPosts: 1,
    attendanceMarks: 2,
    skippedRows: 0
  });

  const absentMerchant = (await getComerciantes(db, { search: '20123456781', includeInactive: true, limit: 100 })).find((item) => item.dni_ruc === '20123456781');
  const absentPost = (await getPuestos(db)).find((item) => item.codigo === 'ZAP-TEST-01');
  assert.equal(absentMerchant.tipo_comerciante, 'ferial');
  assert.equal(absentPost.metros_cuadrados, 4.5);
  assert.equal(absentPost.estado, 'ocupado');
  const marks = (await db.query("SELECT marca FROM asistencias_feriales WHERE puesto_id = $1 AND fecha = '2026-09-08'", [absentPost.id])).rows;
  assert.deepEqual(marks.map((row) => row.marca), ['F']);

  // Septiembre tiene 10 ferias; la del martes 8 no se cobra.
  const liquidation = await calculateLiquidation(db, absentMerchant.id, '2026-09');
  assert.equal(liquidation.no_devengo, false);
  assert.equal(liquidation.dias_ausente, 1);
  assert.equal(liquidation.monto_total, 45);

  const secondPreview = await previewPadronSheets(workbook, options);
  assert.equal(secondPreview.validRows, 2);
  assert.equal(secondPreview.newMerchants, 0);
  const secondResult = await importPadronPreview(db, secondPreview, 1);
  assert.equal(secondResult.createdMerchants, 0);
  assert.equal(secondResult.createdPosts, 0);
  assert.equal(secondResult.updatedMerchants, 2);
  assert.equal(secondResult.updatedPosts, 2);
  assert.equal(Number((await db.query("SELECT COUNT(*) FROM comerciantes WHERE dni_ruc IN ('20123456781', '20123456782')")).rows[0].count), 2);
  assert.equal(Number((await db.query('SELECT COUNT(*) FROM asistencias_feriales WHERE puesto_id = $1', [absentPost.id])).rows[0].count), 1);
});

test('el ausente necesita una fecha de feria válida (martes o miércoles)', async () => {
  const db = await initializeDatabase();
  const rows = [
    ['DNI', 'Titular', 'Código Puesto', 'Zona', 'Rubro', 'Estado', 'Fecha Feria'],
    ['62345671', 'Ausente Sin Fecha', 'FEC-01', 'Zona Norte', 'ropa', 'Ausente', null],
    ['62345672', 'Fecha Jueves', 'FEC-02', 'Zona Norte', 'ropa', 'Presente', '2026-09-10'],
    ['62345673', 'Fecha Propia', 'FEC-03', 'Zona Norte', 'ropa', 'Ausente', new Date('2026-09-09T00:00:00Z')],
    ['62345674', 'Presente Sin Fecha', 'FEC-04', 'Zona Norte', 'ropa', 'Presente', '']
  ];
  const preview = await previewPadronSheets([{ name: 'BLOQUE F', rows }], { filename: 'padron.xlsx', db });

  assert.equal(preview.validRows, 2);
  assert.match(preview.errors.find((error) => error.row === 2).message, /Ausente sin fecha de feria/);
  assert.match(preview.errors.find((error) => error.row === 3).message, /no es día de feria/);
  assert.equal(preview.candidates.find((row) => row.code === 'FEC-03').feriaDate, '2026-09-09');
  assert.equal(preview.candidates.find((row) => row.code === 'FEC-04').feriaDate, null);

  // La fecha de la columna manda sobre la elegida al subir el archivo.
  const withDefault = await previewPadronSheets([{ name: 'BLOQUE F', rows }], { filename: 'padron.xlsx', db, fechaFeria: '2026-09-15' });
  assert.equal(withDefault.candidates.find((row) => row.code === 'FEC-01').feriaDate, '2026-09-15');
  assert.equal(withDefault.candidates.find((row) => row.code === 'FEC-03').feriaDate, '2026-09-09');
  await assert.rejects(() => previewPadronSheets([{ name: 'BLOQUE F', rows }], { filename: 'padron.xlsx', db, fechaFeria: '2026-09-11' }), /martes o miércoles/);
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

  const preview = await previewPadronSheets(workbook, { filename: 'padron.xlsx', db: countingDb, fechaFeria: '2026-09-08' });
  assert.equal(preview.validRows, 60);
  assert.ok(queries <= 5, `la previsualización hizo ${queries} consultas`);

  const result = await importPadronPreview(db, preview, 1);
  assert.equal(result.createdMerchants, 60);
  assert.equal(result.createdPosts, 60);
  assert.equal(result.absentPosts, 6);
  const posts = (await getPuestos(db)).filter((post) => post.codigo.startsWith('LOTE-'));
  assert.equal(posts.length, 60);
  assert.ok(posts.every((post) => post.estado === 'ocupado'));
  assert.equal(result.attendanceMarks, 60);
  const faltas = (await db.query("SELECT COUNT(*) FROM asistencias_feriales a JOIN puestos p ON p.id = a.puesto_id WHERE p.codigo_puesto LIKE 'LOTE-%' AND a.marca = 'F'")).rows[0].count;
  assert.equal(Number(faltas), 6);
  assert.equal(posts.find((post) => post.codigo === 'LOTE-001').direccion, 'Bloque L - LOTE-001');
});

test('un dado de baja que reaparece en el padrón se reactiva y la previsualización lo avisa', async () => {
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

  assert.equal(preview.validRows, 2);
  assert.deepEqual(preview.reactivatedMerchants, [{ nombre: 'Titular de Baja', dni_ruc: '61234567' }]);
  const result = await importPadronPreview(db, preview, 1);
  assert.equal(result.createdMerchants, 1);
  assert.equal(result.reactivatedMerchants, 1);
  const reactivated = (await db.query('SELECT estado, fecha_baja FROM comerciantes WHERE id = $1', [merchant.id])).rows[0];
  assert.equal(reactivated.estado, 'activo');
  assert.equal(reactivated.fecha_baja, null);
  assert.equal((await getPuestos(db)).find((post) => post.codigo === 'BAJA-01').estado, 'ocupado');
});

test('sin DNI se importa como pendiente de regularización y se regulariza cuando llega el DNI real', async () => {
  const db = await initializeDatabase();
  const header = ['DNI', 'Titular', 'Código Puesto', 'Zona', 'Rubro', 'm2'];
  const preview = await previewPadronSheets([{
    name: 'BLOQUE T',
    rows: [header, [null, 'Rosa Pari Ccama', 'TMP-01', 'Zona Norte', 'ropa', null], [null, null, 'TMP-02', 'Zona Norte', 'ropa', 3]]
  }], { filename: 'padron.xlsx', db });

  assert.equal(preview.validRows, 1);
  assert.equal(preview.pendingMerchants, 1);
  assert.match(preview.errors[0].message, /Faltan el DNI\/RUC y el nombre/);
  const result = await importPadronPreview(db, preview, 1);
  assert.equal(result.pendingMerchants, 1);

  const document = temporaryDocument('Rosa Pari Ccama');
  const pending = (await db.query('SELECT id, estado, estado_empadronamiento FROM comerciantes WHERE dni_ruc = $1', [document])).rows[0];
  assert.equal(pending.estado, 'pendiente');
  assert.equal(pending.estado_empadronamiento, 'PENDIENTE_REGULARIZACION');
  // Pendiente y sin metraje: no se cobra hasta regularizarlo.
  assert.equal((await calculateLiquidation(db, pending.id, '2026-09')).motivo, 'pendiente_regularizacion_sin_metraje');

  // Reimportar sin DNI no duplica: el documento temporal es estable.
  const again = await previewPadronSheets([{ name: 'BLOQUE T', rows: [header, [null, 'ROSA PARI CCAMA', 'TMP-01', 'Zona Norte', 'ropa', null]] }], { filename: 'padron.xlsx', db });
  assert.equal(again.existingMerchants, 1);

  // Un padrón posterior trae el DNI real para el mismo puesto y titular: se regulariza el mismo comerciante.
  const withDocument = await previewPadronSheets([{
    name: 'BLOQUE T', rows: [header, ['63456789', 'Rosa Pari Ccama', 'TMP-01', 'Zona Norte', 'ropa', 2]]
  }], { filename: 'padron.xlsx', db });
  assert.equal(withDocument.validRows, 1);
  assert.deepEqual(withDocument.regularizedMerchants, [{ nombre: 'Rosa Pari Ccama', dni_ruc: '63456789' }]);
  const regularized = await importPadronPreview(db, withDocument, 1);
  assert.equal(regularized.regularizedMerchants, 1);
  assert.equal(regularized.createdMerchants, 0);
  const after = (await db.query('SELECT dni_ruc, estado, estado_empadronamiento FROM comerciantes WHERE id = $1', [pending.id])).rows[0];
  assert.deepEqual(after, { dni_ruc: '63456789', estado: 'activo', estado_empadronamiento: 'REGULARIZADO' });
});

test('al editar a un titular temporal con su DNI real queda regularizado', async () => {
  const db = await initializeDatabase();
  const preview = await previewPadronSheets([{
    name: 'BLOQUE R', rows: [['DNI', 'Titular', 'Código Puesto', 'Zona', 'Rubro'], [null, 'Hugo Turpo Vilca', 'TMP-R1', 'Zona Norte', 'ropa']]
  }], { filename: 'padron.xlsx', db });
  await importPadronPreview(db, preview, 1);
  const pending = (await db.query('SELECT id, dni_ruc FROM comerciantes WHERE dni_ruc = $1', [temporaryDocument('Hugo Turpo Vilca')])).rows[0];

  // Guardar otros cambios sin tocar el documento temporal no falla la validación de DNI.
  await updateComerciante(db, pending.id, { dni_ruc: pending.dni_ruc, frecuencia_pago: 'mensual' });
  const updated = await updateComerciante(db, pending.id, { dni_ruc: '64567890', estado: 'pendiente' });
  assert.equal(updated.estado, 'activo');
  assert.equal(updated.estado_empadronamiento, 'REGULARIZADO');
});

test('un titular sin DNI con el mismo nombre que otro con DNI genera una advertencia', async () => {
  const db = await initializeDatabase();
  const preview = await previewPadronSheets([{
    name: 'BLOQUE W',
    rows: [['DNI', 'Titular', 'Código Puesto', 'Zona', 'Rubro'], ['65678901', 'Néstor Apaza Larico', 'W-01', 'Zona Norte', 'ropa'], [null, 'NESTOR APAZA LARICO', 'W-02', 'Zona Norte', 'ropa']]
  }], { filename: 'padron.xlsx', db });
  assert.equal(preview.validRows, 2);
  assert.equal(preview.warnings.length, 1);
  assert.match(preview.warnings[0].message, /misma persona/);
});

test('un titular puede tener varios puestos y paga el monto de la zona de cada uno', async () => {
  const db = await initializeDatabase();
  const zonaNorte = (await db.query(`SELECT id FROM zonas WHERE nombre = 'Zona Norte'`)).rows[0].id;
  await db.query("UPDATE tarifas SET monto_fijo = 8 WHERE zona_id = $1 AND rubro_id IS NULL", [zonaNorte]);
  const preview = await previewPadronSheets([{
    name: 'BLOQUE M',
    rows: [
      ['DNI', 'Titular', 'Código Puesto', 'Zona', 'Rubro'],
      ['66789012', 'Juan Mamani Quispe', 'MULTI-01', 'Mercado Central', 'comida'],
      ['66789012', 'Juan Mamani Quispe', 'MULTI-02', 'Zona Norte', 'comida'],
      ['66789012', 'Otro Nombre', 'MULTI-03', 'Zona Norte', 'comida']
    ]
  }], { filename: 'padron.xlsx', db });

  assert.equal(preview.validRows, 2);
  assert.equal(preview.newMerchants, 1);
  assert.equal(preview.multiPostMerchants, 1);
  assert.match(preview.errors[0].message, /con otro titular/);
  const result = await importPadronPreview(db, preview, 1);
  assert.equal(result.createdMerchants, 1);
  assert.equal(result.createdPosts, 2);

  const merchantId = (await db.query(`SELECT id FROM comerciantes WHERE dni_ruc = '66789012'`)).rows[0].id;
  const liquidation = await calculateLiquidation(db, merchantId, '2026-09');
  // Septiembre: 10 ferias × (S/ 5 Mercado Central + S/ 8 Zona Norte).
  assert.equal(liquidation.puestos.length, 2);
  assert.equal(liquidation.monto_por_feria, 13);
  assert.equal(liquidation.monto_total, 130);
  assert.equal(liquidation.cuota_sugerida, 26);
  assert.deepEqual(liquidation.puestos.map((post) => [post.codigo, post.monto_total]), [['MULTI-01', 50], ['MULTI-02', 80]]);
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

  sheet.addRow(['04512345', 'Titular Plantilla', 'PLT-001', 'Bloque P', 'Mercado Central', 'permanente', 'comida', null, 'Ausente', new Date('2026-09-15T00:00:00Z')]);
  const sheets = await readPadronWorkbook(Buffer.from(await template.xlsx.writeBuffer()));
  const preview = await previewPadronSheets(sheets, { filename: 'plantilla-padron-sisrec.xlsx', db });

  assert.equal(preview.validRows, 1);
  assert.equal(preview.candidates[0].document, '04512345');
  assert.equal(preview.candidates[0].feriaDate, '2026-09-15');
  assert.equal(preview.candidates[0].area, null);
  assert.deepEqual(preview.sheets.map((item) => item.sheet), ['PADRON']);
});
