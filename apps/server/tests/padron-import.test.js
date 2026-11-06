import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calcularLiquidacion, getComerciantes, getPuestos, getZonas, initializeDatabase, insertZona, deactivateComerciante, marcarAsistencias,
  todayInLima, updatePuesto
} from '../src/db.js';
import {
  importPadronPreview, previewPadronSheets, readPadronWorkbook, guardarVistaPrevia, tomarVistaPrevia, descartarVistaPrevia
} from '../src/padronImport.js';
import { buildPadronTemplate } from '../src/padronPlantilla.js';

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
    reactivatedMerchants: 0,
    regularizedMerchants: 0,
    createdPosts: 2,
    updatedPosts: 0,
    absentPosts: 1,
    skippedRows: 0,
    rowErrors: []
  });

  const absentMerchant = (await getComerciantes(db, { search: '20123456781', includeInactive: true, limit: 100 })).find((item) => item.dni_ruc === '20123456781');
  const absentPost = (await getPuestos(db)).find((item) => item.codigo === 'ZAP-TEST-01');
  assert.equal(absentMerchant.tipo_comerciante, 'ferial');
  assert.equal(absentPost.metros_cuadrados, 4.5);
  assert.equal(absentPost.estado, 'disponible');
  assert.equal((await calcularLiquidacion(db, absentMerchant.id, '2026-09')).no_devengo, true);

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
  assert.match(preview.errors[0].message, /ya aparece con otro titular/, 'el mismo DNI con otro nombre es un error');
});

// Zona con tipo de vía (cobro por día, metraje opcional) o sin él; una por prueba para no chocar.
let correlativoZona = 0;
const zonaNueva = (db, tipo_via) => insertZona(db, { nombre: `Zona padrón ${process.pid}-${correlativoZona += 1}-${Date.now()}`, tipo_via });
const ENCABEZADOS = ['DNI/RUC', 'Titular', 'Código Puesto', 'Sector', 'Zona', 'Tipo Comerciante', 'Rubro', 'Metraje m2', 'Estado'];
const libro = (filas, name = 'PADRON') => [{ name, rows: [ENCABEZADOS, ...filas] }];
const importar = async (db, filas) => {
  const preview = await previewPadronSheets(libro(filas), { filename: 'padron.xlsx', db });
  return { preview, result: await importPadronPreview(db, preview, 1) };
};
const porDocumento = async (db, documento) => (await db.query('SELECT * FROM comerciantes WHERE dni_ruc = $1', [documento])).rows[0];
const puestosDe = async (db, comercianteId) => (await db.query('SELECT * FROM puestos WHERE comerciante_id = $1 ORDER BY id', [comercianteId])).rows;

test('un titular sin DNI entra como pendiente, no se duplica al reimportar y se regulariza con su DNI', async () => {
  const db = await initializeDatabase();
  const zona = await zonaNueva(db, 'asfaltada');
  const filas = [[null, 'Rosa Sin Documento', 'SD-01', 'BLOQUE S', zona.nombre, 'ferial', 'zapatillas', null, 'Presente']];

  const { preview, result } = await importar(db, filas);
  assert.equal(preview.validRows, 1);
  assert.equal(preview.pendingMerchants, 1);
  assert.equal(result.createdMerchants, 1);
  const pendiente = (await db.query(`SELECT * FROM comerciantes WHERE nombre = 'Rosa Sin Documento'`)).rows[0];
  assert.match(pendiente.dni_ruc, /^TEMP_DNI_[A-F0-9]{12}$/);
  assert.equal(pendiente.estado, 'pendiente');
  assert.equal(pendiente.estado_empadronamiento, 'PENDIENTE_REGULARIZACION');
  assert.equal((await puestosDe(db, pendiente.id))[0].metros_cuadrados, null, 'sin metraje en zona con tipo de vía');

  const segunda = await importar(db, filas);
  assert.equal(segunda.result.createdMerchants, 0);
  assert.equal(segunda.result.updatedMerchants, 1);
  assert.equal(Number((await db.query(`SELECT COUNT(*) FROM comerciantes WHERE nombre = 'Rosa Sin Documento'`)).rows[0].count), 1);

  // Un padrón posterior trae su DNI para el mismo puesto y el mismo nombre: se regulariza ese comerciante.
  const conDni = await importar(db, [['41234567', 'Rosa Sin Documento', 'SD-01', 'BLOQUE S', zona.nombre, 'ferial', 'zapatillas', null, 'Presente']]);
  assert.equal(conDni.preview.regularizedMerchants.length, 1);
  assert.equal(conDni.result.regularizedMerchants, 1);
  const regularizado = await porDocumento(db, '41234567');
  assert.equal(Number(regularizado.id), Number(pendiente.id));
  assert.equal(regularizado.estado_empadronamiento, 'REGULARIZADO');
  assert.equal(regularizado.estado, 'activo');
});

test('un titular sin DNI con el mismo nombre que otro con DNI sale como advertencia', async () => {
  const db = await initializeDatabase();
  const zona = await zonaNueva(db, 'asfaltada');
  const { preview } = await importar(db, [
    ['42234567', 'Pedro Homónimo', 'HOM-01', 'BLOQUE H', zona.nombre, 'ferial', 'zapatillas', 2, 'Presente'],
    [null, 'Pedro Homónimo', 'HOM-02', 'BLOQUE H', zona.nombre, 'ferial', 'zapatillas', 2, 'Presente']
  ]);
  assert.equal(preview.validRows, 2);
  assert.equal(preview.warnings.length, 1);
  assert.match(preview.warnings[0].message, /mismo nombre/);
});

test('varias filas del mismo titular son un comerciante con varios puestos', async () => {
  const db = await initializeDatabase();
  const zona = await zonaNueva(db, 'asfaltada');
  const { preview, result } = await importar(db, [
    ['43234567', 'Ana Dos Puestos', 'DOS-01', 'BLOQUE D', zona.nombre, 'ferial', 'zapatillas', 3, 'Presente'],
    ['43234567', 'ANA DOS PUESTOS', 'DOS-02', 'BLOQUE D', zona.nombre, 'ferial', 'zapatillas', 3, 'Presente']
  ]);
  assert.equal(preview.validRows, 2);
  assert.equal(preview.newMerchants, 1);
  assert.equal(preview.merchantsWithSeveralPosts, 1);
  assert.equal(result.createdMerchants, 1);
  assert.equal(result.createdPosts, 2);
  assert.equal((await puestosDe(db, (await porDocumento(db, '43234567')).id)).length, 2);
});

test('un puesto físico ocupado es error de su fila y las demás se importan', async () => {
  const db = await initializeDatabase();
  const zona = await zonaNueva(db, 'asfaltada');
  await importar(db, [['44234567', 'Dueño Actual', 'OCU-00', 'BLOQUE O', zona.nombre, 'ferial', 'zapatillas', 2, 'Presente']]);
  const dueno = await porDocumento(db, '44234567');
  // Otro puesto del dueño en la misma ubicación que trae la fila siguiente (BLOQUE O - OCU-01).
  await db.query(`UPDATE puestos SET direccion = 'BLOQUE O - OCU-01' WHERE comerciante_id = $1`, [dueno.id]);

  const { preview, result } = await importar(db, [
    ['45234567', 'Otro Titular', 'OCU-01', 'BLOQUE O', zona.nombre, 'ferial', 'zapatillas', 2, 'Presente'],
    ['46234567', 'Titular Libre', 'OCU-02', 'BLOQUE O', zona.nombre, 'ferial', 'zapatillas', 2, 'Presente']
  ]);
  assert.equal(preview.invalidRows, 1);
  assert.match(preview.errors[0].message, /puesto físico/);
  assert.equal(result.createdMerchants, 1);
  assert.ok(await porDocumento(db, '46234567'));
  assert.equal(await porDocumento(db, '45234567'), undefined);
});

test('un choque que la vista previa no vio se informa en su fila y no deshace las demás', async () => {
  const db = await initializeDatabase();
  const zona = await zonaNueva(db, 'asfaltada');
  await importar(db, [['47234567', 'Ya Tiene Código', 'CHO-01', 'BLOQUE C', zona.nombre, 'ferial', 'zapatillas', 2, 'Presente']]);
  const preview = await previewPadronSheets(libro([
    ['48234567', 'Nuevo Choque', 'CHO-02', 'BLOQUE C', zona.nombre, 'ferial', 'zapatillas', 2, 'Presente'],
    ['49234567', 'Nuevo Sano', 'CHO-03', 'BLOQUE C', zona.nombre, 'ferial', 'zapatillas', 2, 'Presente']
  ]), { filename: 'padron.xlsx', db });
  // Otro usuario toma el código CHO-02 entre la vista previa y la confirmación.
  await db.query(`UPDATE puestos SET codigo_puesto = 'CHO-02' WHERE codigo_puesto = 'CHO-01'`);

  const result = await importPadronPreview(db, preview, 1);
  assert.equal(result.rowErrors.length, 1);
  assert.match(result.rowErrors[0].message, /CHO-02/);
  assert.equal(result.skippedRows, 1);
  assert.equal(await porDocumento(db, '48234567'), undefined, 'la fila con choque no deja el comerciante a medias');
  assert.ok(await porDocumento(db, '49234567'));
});

test('un comerciante dado de baja que reaparece en el padrón se reactiva', async () => {
  const db = await initializeDatabase();
  const zona = await zonaNueva(db, 'asfaltada');
  const filas = [['50234567', 'Vuelve Al Padrón', 'BAJ-01', 'BLOQUE B', zona.nombre, 'ferial', 'zapatillas', 2, 'Presente']];
  await importar(db, filas);
  const comerciante = await porDocumento(db, '50234567');
  await deactivateComerciante(db, comerciante.id);

  const { preview, result } = await importar(db, filas);
  assert.equal(preview.reactivatedMerchants.length, 1);
  assert.equal(result.reactivatedMerchants, 1);
  const reactivado = await porDocumento(db, '50234567');
  assert.equal(reactivado.estado, 'activo');
  assert.equal(reactivado.fecha_baja, null);
  assert.equal((await puestosDe(db, comerciante.id))[0].estado, 'ocupado');
});

test('el metraje es opcional en una zona con tipo de vía y obligatorio sin ella', async () => {
  const db = await initializeDatabase();
  const conVia = await zonaNueva(db, 'sin_asfaltar');
  const sinVia = await zonaNueva(db);
  const preview = await previewPadronSheets(libro([
    ['51234567', 'Sin Metros Con Vía', 'MET-01', 'BLOQUE M', conVia.nombre, 'ferial', 'zapatillas', null, 'Presente'],
    ['52234567', 'Sin Metros Sin Vía', 'MET-02', 'BLOQUE M', sinVia.nombre, 'ferial', 'zapatillas', null, 'Presente']
  ]), { filename: 'padron.xlsx', db });
  assert.equal(preview.validRows, 1);
  assert.equal(preview.errors[0].row, 3);
  assert.match(preview.errors[0].message, /metraje/);
});

test('sin zona o con una zona no registrada, el puesto queda en la primera zona marcado por regularizar', async () => {
  const db = await initializeDatabase();
  const primera = (await getZonas(db))[0];
  // La hoja no se llama como ninguna zona: la fila sin zona no puede tomarla del nombre de la hoja.
  const preview = await previewPadronSheets(libro([
    ['61234567', 'Zona Inventada', 'ZPR-01', 'BLOQUE Z', 'Barrio Inexistente QX', 'ferial', 'zapatillas', 3, 'Presente'],
    ['62234567', 'Zona Vacía', 'ZPR-02', 'BLOQUE Z', null, 'ferial', 'zapatillas', 3, 'Presente']
  ], 'HOJA QX SIN ZONA'), { filename: 'padron.xlsx', db });
  assert.equal(preview.validRows, 2, 'no es error de fila: se importa y se regulariza después');
  assert.equal(preview.zonePendingPosts, 2);
  assert.match(preview.warnings[0].message, /"Barrio Inexistente QX" no está registrada.*zona por regularizar/);
  assert.match(preview.warnings[1].message, /^Sin zona:.*zona por regularizar/);
  await importPadronPreview(db, preview, 1);

  const [inventada] = await puestosDe(db, (await porDocumento(db, '61234567')).id);
  const [vacia] = await puestosDe(db, (await porDocumento(db, '62234567')).id);
  assert.equal(Number(inventada.zona_id), Number(primera.id), 'paga con la tarifa de la primera zona');
  assert.equal(inventada.zona_por_regularizar, 'Barrio Inexistente QX', 'guarda la zona que traía el padrón');
  assert.equal(vacia.zona_por_regularizar, '');
  assert.equal((await getPuestos(db, { conPagos: false })).find((p) => Number(p.id) === Number(vacia.id)).zona_por_regularizar, '', 'Sitios recibe la marca');

  // Mover el puesto en el mapa no la toca; asignarle una zona la confirma.
  const zona = await zonaNueva(db, 'asfaltada');
  await updatePuesto(db, vacia.id, { latitud: -15.9, longitud: -70.0 });
  assert.equal((await puestosDe(db, vacia.comerciante_id))[0].zona_por_regularizar, '');
  await updatePuesto(db, vacia.id, { zona_id: zona.id });
  const regularizado = (await puestosDe(db, vacia.comerciante_id))[0];
  assert.equal(regularizado.zona_por_regularizar, null);
  assert.equal(Number(regularizado.zona_id), Number(zona.id));

  // Reimportar con una zona registrada también borra la marca.
  await importar(db, [['61234567', 'Zona Inventada', 'ZPR-01', 'BLOQUE Z', zona.nombre, 'ferial', 'zapatillas', 3, 'Presente']]);
  assert.equal((await puestosDe(db, inventada.comerciante_id))[0].zona_por_regularizar, null);
});

test('el pendiente de regularización sin metraje paga sus días cobrados', async () => {
  const db = await initializeDatabase();
  const zona = await zonaNueva(db, 'asfaltada');
  await importar(db, [[null, 'Pendiente Que Paga', 'PAG-01', 'BLOQUE P', zona.nombre, 'ferial', 'zapatillas', null, 'Presente']]);
  const comerciante = (await db.query(`SELECT * FROM comerciantes WHERE nombre = 'Pendiente Que Paga'`)).rows[0];
  const [puesto] = await puestosDe(db, comerciante.id);
  await marcarAsistencias(db, [{ puesto_id: puesto.id, fecha: todayInLima(), asistio: true }], { usuarioId: 2 });

  const liquidacion = await calcularLiquidacion(db, comerciante.id);
  assert.equal(liquidacion.no_devengo, false);
  assert.equal(liquidacion.monto_total, 3, 'S/ 3 por el día cobrado en vía asfaltada, como cualquier otro');
});

test('la vista previa guardada solo la usa quien la hizo y vence a los 15 minutos', () => {
  const ahora = Date.now();
  const token = guardarVistaPrevia(7, { filename: 'padron.xlsx', sheets: [] }, ahora);
  assert.equal(tomarVistaPrevia(token, 7, ahora).filename, 'padron.xlsx');
  assert.equal(tomarVistaPrevia(token, 8, ahora), null, 'otro usuario no la puede confirmar');
  assert.equal(tomarVistaPrevia(token, 7, ahora + 16 * 60 * 1000), null, 'vencida');
  descartarVistaPrevia(token);
  assert.equal(tomarVistaPrevia(token, 7, ahora), null, 'después de importar ya no sirve');
});

test('la plantilla oficial trae los encabezados que reconoce la importación', async () => {
  const db = await initializeDatabase();
  const sheets = await readPadronWorkbook(await buildPadronTemplate(db));
  assert.deepEqual(sheets.map((sheet) => sheet.name).sort(), ['LISTAS_SISREC', 'PADRON']);
  const padron = sheets.find((sheet) => sheet.name === 'PADRON');
  const zona = (await db.query('SELECT nombre FROM zonas ORDER BY id LIMIT 1')).rows[0].nombre;
  padron.rows.push(['53234567', 'Desde Plantilla', 'PLA-01', 'BLOQUE T', zona, 'ferial', 'zapatillas', 2, 'Presente']);

  const preview = await previewPadronSheets(sheets, { filename: 'plantilla.xlsx', db });
  assert.equal(preview.workbookType, 'merchant-padron');
  assert.equal(preview.sheets.length, 1, 'la hoja de listas no se lee como padrón');
  assert.equal(preview.validRows, 1, JSON.stringify(preview.errors));
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
