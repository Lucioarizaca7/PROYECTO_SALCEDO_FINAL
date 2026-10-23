import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateLiquidation, getComerciantes, getPuestos, initializeDatabase } from '../src/db.js';
import { buildFeriaZapatillasSeedPlan, seedFeriaZapatillas } from '../src/feriaZapatillasSeed.js';

const workbook = [
  {
    sheet: 'BLOQUE A-I',
    data: [
      [null, 'BLOQUE A-I', new Date('2026-09-08T00:00:00Z'), new Date('2026-09-08T00:00:00Z')],
      [1, 'Yorica Choque Cutipa', 'P', 'F'],
      [2, 'Nidia Layme Atencio', 'N/S', null]
    ]
  },
  {
    sheet: 'BLOQUE ROPA',
    data: [
      ['N°', 'BLOQUE ROPA', new Date('2026-09-15T00:00:00Z'), new Date('2026-09-16T00:00:00Z')],
      [1, 'Yorica Choque Cutipa', 'P', 'P'],
      [2, '', null, null]
    ]
  }
];

test('seeder crea comerciantes temporales, puestos por bloque y conserva marcas sin duplicar al reejecutar', async () => {
  const db = await initializeDatabase();
  const plan = await buildFeriaZapatillasSeedPlan(workbook, db);

  assert.equal(plan.totals.blocksProcessed, 2);
  assert.equal(plan.totals.uniqueMerchants, 2);
  assert.equal(plan.totals.validPosts, 3);
  assert.equal(plan.totals.attendanceCells, 5);
  assert.equal(plan.totals.skippedRows, 1);

  const first = await seedFeriaZapatillas(db, plan, 'FERIA ZAPATILLAS 2026.xlsx');
  assert.equal(first.createdMerchants, 2);
  assert.equal(first.assignedPosts, 3);
  assert.equal(first.createdPosts, 3);
  assert.equal(first.savedAttendanceMarks, 5);

  const importedMerchant = (await getComerciantes(db, { search: 'Yorica Choque', includeInactive: true, limit: 20 }))[0];
  const importedPosts = (await getPuestos(db)).filter((post) => post.comerciante_id === importedMerchant.id);
  assert.match(importedMerchant.dni_ruc, /^TEMP_DNIZAP_[A-F0-9]{12}$/);
  assert.equal(importedMerchant.estado, 'pendiente');
  assert.equal(importedMerchant.estado_empadronamiento, 'PENDIENTE_REGULARIZACION');
  assert.equal(importedPosts.length, 2);
  assert.ok(importedPosts.every((post) => post.metros_cuadrados === null));
  assert.ok(importedPosts.some((post) => post.codigo === 'ZAP-A-I-01'));
  assert.ok(importedPosts.some((post) => post.codigo === 'ZAP-ROPA-01'));
  assert.equal((await calculateLiquidation(db, importedMerchant.id, '2026-09')).no_devengo, true);
  assert.equal((await calculateLiquidation(db, importedMerchant.id, '2026-09')).motivo, 'pendiente_regularizacion_sin_metraje');

  const scalar = async (text, params = []) => Number((await db.query(text, params)).rows[0].count);
  // Ya no se cobra por metro cuadrado: cada bloque importado nace con su monto fijo por día de feria.
  assert.equal(await scalar("SELECT COUNT(*) FROM tarifas WHERE unidad_medida = 'metro_cuadrado' AND activo"), 0);
  assert.equal(await scalar("SELECT COUNT(*) FROM tarifas t JOIN zonas z ON z.id = t.zona_id WHERE z.nombre = 'BLOQUE A-I' AND t.rubro_id IS NULL AND t.unidad_medida = 'dia_feria'"), 1);
  assert.equal(await scalar('SELECT COUNT(*) FROM asistencias_feriales'), 5);
  const blockPost = importedPosts.find((post) => post.codigo === 'ZAP-A-I-01');
  assert.equal(await scalar('SELECT COUNT(*) FROM asistencias_feriales WHERE puesto_id = $1 AND fecha = $2', [blockPost.id, '2026-09-08']), 2);

  const secondPlan = await buildFeriaZapatillasSeedPlan(workbook, db);
  const second = await seedFeriaZapatillas(db, secondPlan, 'FERIA ZAPATILLAS 2026.xlsx');
  assert.equal(second.createdMerchants, 0);
  assert.equal(second.createdPosts, 0);
  assert.equal(await scalar("SELECT COUNT(*) FROM comerciantes WHERE dni_ruc LIKE 'TEMP_DNIZAP_%'"), 2);
  assert.equal(await scalar("SELECT COUNT(*) FROM puestos WHERE codigo_puesto LIKE 'ZAP-%'"), 3);
  assert.equal(await scalar('SELECT COUNT(*) FROM asistencias_feriales'), 5);
  assert.equal(await scalar("SELECT COUNT(*) FROM auditoria_logs WHERE accion = 'SEED_FERIA_ZAPATILLAS'"), 2);
});

test('seeder omite y reporta correlativos repetidos en el mismo bloque', async () => {
  const db = await initializeDatabase();
  const repeatedWorkbook = [{
    sheet: 'BLOQUE A-I',
    data: [
      [null, 'BLOQUE A-I'],
      [1, 'Titular Uno'],
      [1, 'Titular Dos']
    ]
  }];
  const plan = await buildFeriaZapatillasSeedPlan(repeatedWorkbook, db);

  assert.equal(plan.totals.validPosts, 1);
  assert.equal(plan.totals.uniqueMerchants, 1);
  assert.equal(plan.totals.duplicatePostCodes, 1);
  assert.equal(plan.duplicatePostCodes[0].code, 'ZAP-A-I-01');
});
