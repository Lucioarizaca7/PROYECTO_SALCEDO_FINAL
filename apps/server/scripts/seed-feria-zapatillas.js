import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import readExcelFile from 'read-excel-file/node';

import { initializeDatabase, closeDatabase } from '../src/db.js';
import { buildFeriaZapatillasSeedPlan, seedFeriaZapatillas } from '../src/feriaZapatillasSeed.js';

const args = process.argv.slice(2);
const applyChanges = args.includes('--apply');
const sourceArgument = args.find((argument) => !argument.startsWith('--'));
const sourceFile = resolve(sourceArgument || process.env.FERIA_XLSX_PATH || 'C:/Users/LUCIO/Downloads/FERIA ZAPATILLAS 2026.xlsx');

if (!existsSync(sourceFile)) {
  console.error(`No se encontró el archivo Excel: ${sourceFile}`);
  console.error('Uso: npm run seed:feria-zapatillas -- [ruta.xlsx] [--apply]');
  process.exitCode = 1;
} else {
  let db;
  try {
    const workbook = await readExcelFile(sourceFile);
    db = await initializeDatabase();
    const plan = await buildFeriaZapatillasSeedPlan(workbook, db);

    console.log(`Archivo: ${sourceFile}`);
    console.log(`Modo: ${applyChanges ? 'APLICAR' : 'DRY-RUN (sin importar cambios)'}`);
    console.log(`Hojas/bloques procesados: ${plan.totals.blocksProcessed}`);
    console.log(`Comerciantes únicos: ${plan.totals.uniqueMerchants} (${plan.totals.newMerchants} nuevos, ${plan.totals.existingMerchants} existentes)`);
    console.log(`Puestos asignados: ${plan.totals.validPosts} (${plan.totals.newPosts} nuevos, ${plan.totals.existingPosts} existentes)`);
    console.log(`Marcas de asistencia por fecha detectadas: ${plan.totals.attendanceCells}`);
    console.log(`Marcas sin fecha identificable (no se importan): ${plan.totals.attendanceWithoutDate}`);
    console.log(`Correlativos de puesto duplicados (se omite la fila ambigua): ${plan.totals.duplicatePostCodes}`);
    console.log(`Filas vacías o sin correlativo/nombre omitidas: ${plan.totals.skippedRows}`);
    console.log('Metraje: no viene en el Excel; se deja NULL y el registro queda PENDIENTE_REGULARIZACION. No se devenga tasa hasta capturar el área real.');
    console.log('Cobro: monto fijo por zona y por día de feria (configurable por el super admin).');

    if (applyChanges) {
      const result = await seedFeriaZapatillas(db, plan, sourceFile, 1);
      console.log('RESULTADO:');
      console.log(`Total de comerciantes creados: ${result.createdMerchants}`);
      console.log(`Total de comerciantes actualizados: ${result.updatedMerchants}`);
      console.log(`Total de puestos asignados: ${result.assignedPosts}`);
      console.log(`Total de puestos nuevos: ${result.createdPosts}`);
      console.log(`Total de marcas de asistencia importadas/actualizadas: ${result.savedAttendanceMarks}`);
      console.log(`Bloques procesados: ${result.blocksProcessed}`);
      console.log(`Filas omitidas: ${result.skippedRows}`);
      console.log(`Puestos pendientes de metraje: ${result.areaMissingPosts}`);
    } else {
      console.log('Para confirmar la carga, vuelve a ejecutar el mismo comando añadiendo --apply.');
    }
  } catch (error) {
    console.error(`Falló la carga; no se confirmó la transacción: ${error.stack || error.message}`);
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}
