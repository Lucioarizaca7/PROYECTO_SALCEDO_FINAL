/**
 * Cobro por día cobrado (migrations/0013_cobro_por_dia.sql): S/ 3 en vía asfaltada y S/ 2 sin asfaltar,
 * para todos los rubros, por cada día que el cobrador marcó asistencia. Sin día cobrado no hay deuda.
 * El cobrador puede dejar una observación: "no salió" es una falta; "no vendió" no libera la deuda del día.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  initializeDatabase, insertComerciante, insertPuesto, insertTarifa, insertZona, calcularLiquidacion, calcularDeudaAcumulada,
  marcarAsistencias, getAsistencias, getObservacionesCobro, getJornadaPackage, getTarifas, todayInLima, currentPeriod,
  registrarCobro, syncOfflineCobro
} from '../src/db.js';

let documento = 20999000000;
let correlativoZona = 0;
const PERIODO = '2026-09';

const rubroId = async (db, nombre) => (await db.query('SELECT id FROM rubros WHERE nombre = $1', [nombre])).rows[0].id;
const zonaNueva = (db, tipo_via) => insertZona(db, { nombre: `Zona por día ${process.pid}-${correlativoZona += 1}-${Date.now()}`, tipo_via });

async function comercianteConPuesto(db, { rubro, zonaId, tipo = 'permanente', metros = 4 }) {
  const comerciante = await insertComerciante(db, {
    dni_ruc: String(documento += 1), nombre: `Por día ${documento}`, rubro_id: await rubroId(db, rubro), zona_id: zonaId,
    tipo_comerciante: tipo, estado: 'activo', usuario_creador: 1
  });
  const puesto = await insertPuesto(db, { zona_id: zonaId, metros_cuadrados: metros, direccion: `Por día ${documento}`, comerciante_id: comerciante.id });
  return { comerciante, puesto };
}

// Las tarifas generales de la migración rigen desde el mes actual. Estas pruebas liquidan septiembre de
// 2026: cada una agrega (una sola vez) las mismas tarifas generales vigentes desde ese mes. Las pruebas del
// archivo corren a la vez, así que ninguna modifica las de la migración.
async function preparar() {
  const db = await initializeDatabase();
  await db.query(`
    INSERT INTO tarifas (rubro_id, tipo_via, tipo_tarifa, monto_fijo, monto_variable, unidad_medida, vigencia_inicio)
    SELECT NULL, via.tipo_via, 'fija', via.monto, 0, 'semanal', DATE '2026-09-01'
    FROM (VALUES ('asfaltada', 3), ('sin_asfaltar', 2)) AS via (tipo_via, monto)
    WHERE NOT EXISTS (SELECT 1 FROM tarifas t WHERE t.rubro_id IS NULL AND t.tipo_via = via.tipo_via AND t.vigencia_inicio = DATE '2026-09-01')`);
  return db;
}

const marcar = (db, puesto, fechas, extra = {}) => marcarAsistencias(db, fechas.map((fecha) => ({ puesto_id: puesto.id, fecha, asistio: true, ...extra })), { usuarioId: 2 });

test('las tarifas generales por tipo de vía existen y valen para todos los rubros', async () => {
  const db = await initializeDatabase();
  const generales = (await getTarifas(db)).filter((item) => item.rubro_id === null && item.unidad_medida === 'semanal' && item.vigencia_inicio === `${currentPeriod()}-01`);
  assert.deepEqual(generales.map((item) => [item.tipo_via, Number(item.monto_fijo)]).sort(), [['asfaltada', 3], ['sin_asfaltar', 2]]);
  assert.equal(generales[0].rubro, 'Todos los rubros');

  const creada = await insertTarifa(db, { rubro_id: '', tipo_tarifa: 'fija', monto_fijo: 1, unidad_medida: 'diaria', vigencia_inicio: '2030-01-01' });
  assert.equal(creada.rubro_id, null, 'una tarifa sin rubro se puede registrar');

  // Rigen desde el mes de la migración: los meses anteriores siguen con la tarifa del rubro, así cargar el
  // tipo de vía de una zona no reescribe la deuda ni lo pagado de esos meses.
  const asfaltada = await zonaNueva(db, 'asfaltada');
  const { comerciante } = await comercianteConPuesto(db, { rubro: 'otros', zonaId: asfaltada.id });
  const mesPasado = await calcularLiquidacion(db, comerciante.id, '2026-08');
  assert.equal(mesPasado.tarifa.unidad_medida, 'mensual');
  assert.equal(mesPasado.monto_total, 90);
});

test('el permanente paga S/ 3 o S/ 2 por día cobrado, sin importar rubro ni metros', async () => {
  const db = await preparar();
  const asfaltada = await zonaNueva(db, 'asfaltada');
  const tierra = await zonaNueva(db, 'sin_asfaltar');
  const comida = await comercianteConPuesto(db, { rubro: 'comida', zonaId: asfaltada.id, metros: 2 });
  const ropa = await comercianteConPuesto(db, { rubro: 'ropa', zonaId: asfaltada.id, metros: 9 });
  const enTierra = await comercianteConPuesto(db, { rubro: 'otros', zonaId: tierra.id });

  const sinMarcas = await calcularLiquidacion(db, comida.comerciante.id, PERIODO);
  assert.equal(sinMarcas.no_devengo, true);
  assert.equal(sinMarcas.motivo, 'sin_asistencia');
  assert.equal(sinMarcas.saldo, 0);
  assert.equal((await calcularDeudaAcumulada(db, comida.comerciante.id)).deuda_total, 0, 'sin día cobrado no hay deuda');

  for (const { puesto } of [comida, ropa, enTierra]) await marcar(db, puesto, ['2026-09-06', '2026-09-13']);
  const deComida = await calcularLiquidacion(db, comida.comerciante.id, PERIODO);
  assert.equal(deComida.dias_asistidos, 2);
  assert.equal(deComida.monto_dia, 3);
  assert.equal(deComida.monto_total, 6);
  assert.equal((await calcularLiquidacion(db, ropa.comerciante.id, PERIODO)).monto_total, 6, 'otro rubro y otro tamaño, el mismo monto');
  assert.equal((await calcularLiquidacion(db, enTierra.comerciante.id, PERIODO)).monto_total, 4, 'vía sin asfaltar: S/ 2 por día');
});

test('el ferial y el eventual también cobran S/ 3 en vía asfaltada', async () => {
  const db = await preparar();
  const asfaltada = await zonaNueva(db, 'asfaltada');
  const ferial = await comercianteConPuesto(db, { rubro: 'zapatillas', zonaId: asfaltada.id, tipo: 'ferial' });
  await marcar(db, ferial.puesto, ['2026-09-06', '2026-09-07', '2026-09-13']);
  assert.equal((await calcularLiquidacion(db, ferial.comerciante.id, PERIODO)).monto_total, 9);

  const eventual = await comercianteConPuesto(db, { rubro: 'comida', zonaId: asfaltada.id, tipo: 'eventual' });
  const hoy = await calcularLiquidacion(db, eventual.comerciante.id);
  assert.equal(hoy.cobro_diario, true);
  assert.equal(hoy.monto_total, 3);
  await assert.rejects(() => marcar(db, eventual.puesto, [todayInLima()]), /no es de un comerciante ferial/, 'al eventual se le cobra sin marca');
});

test('una zona sin tipo de vía sigue con la tarifa de su rubro', async () => {
  const db = await preparar();
  const sinDato = await zonaNueva(db);
  const { comerciante, puesto } = await comercianteConPuesto(db, { rubro: 'otros', zonaId: sinDato.id });
  const liquidacion = await calcularLiquidacion(db, comerciante.id, PERIODO);
  assert.equal(liquidacion.tarifa.unidad_medida, 'mensual');
  assert.equal(liquidacion.monto_total, 90);
  await assert.rejects(() => marcar(db, puesto, ['2026-09-06']), /tarifa por día cobrado/);
});

test('el permanente que cobra por día aparece en la lista del día y en el paquete de jornada', async () => {
  const db = await preparar();
  const asfaltada = await zonaNueva(db, 'asfaltada');
  const { comerciante, puesto } = await comercianteConPuesto(db, { rubro: 'ropa', zonaId: asfaltada.id });
  const lista = await getAsistencias(db);
  assert.ok(lista.puestos.some((item) => item.puesto_id === Number(puesto.id)));

  const paquete = await getJornadaPackage(db);
  assert.equal(paquete.comerciantes.find((item) => item.id === Number(comerciante.id)).puesto_ferial_id, Number(puesto.id));
});

test('la observación del cobrador: no salió no se debe; no vendió sí', async () => {
  const db = await preparar();
  const asfaltada = await zonaNueva(db, 'asfaltada');
  const { comerciante, puesto } = await comercianteConPuesto(db, { rubro: 'comida', zonaId: asfaltada.id });

  const [noSalio] = await marcarAsistencias(db, { puesto_id: puesto.id, fecha: '2026-09-06', motivo: 'no_salio', observacion: 'Puesto cerrado' }, { usuarioId: 2 });
  assert.equal(noSalio.asistio, false, 'el motivo define la marca');
  await marcarAsistencias(db, { puesto_id: puesto.id, fecha: '2026-09-13', motivo: 'no_vendio', observacion: 'Dice que no vendió nada' }, { usuarioId: 2 });
  // Reenviar la misma marca (cola sin señal) no duplica.
  await marcarAsistencias(db, { puesto_id: puesto.id, fecha: '2026-09-13', motivo: 'no_vendio', observacion: 'Dice que no vendió nada' }, { usuarioId: 2 });

  const liquidacion = await calcularLiquidacion(db, comerciante.id, PERIODO);
  assert.equal(liquidacion.dias_asistidos, 1, 'no vendió: estuvo, el día se debe');
  assert.equal(liquidacion.saldo, 3);

  await assert.rejects(() => marcarAsistencias(db, { puesto_id: puesto.id, fecha: '2026-09-20', motivo: 'no_salio', asistio: true }), /corresponde a una falta/);
  await assert.rejects(() => marcarAsistencias(db, { puesto_id: puesto.id, fecha: '2026-09-20', motivo: 'llovio', asistio: false }), /motivo/);
  await assert.rejects(() => marcarAsistencias(db, { puesto_id: puesto.id, fecha: '2026-09-20', motivo: 'otro', observacion: 'x'.repeat(301), asistio: false }), /300/);

  const reporte = await getObservacionesCobro(db, { desde: '2026-09-01', hasta: '2026-09-30', comercianteId: comerciante.id });
  assert.deepEqual(reporte.observaciones.map((item) => [item.fecha, item.motivo, item.asistio]), [['2026-09-13', 'no_vendio', true], ['2026-09-06', 'no_salio', false]]);
  assert.equal(reporte.observaciones[0].observacion, 'Dice que no vendió nada');
  assert.equal((await getObservacionesCobro(db, { desde: '2026-09-10', hasta: '2026-09-30', comercianteId: comerciante.id })).observaciones.length, 1);
  assert.equal((await getObservacionesCobro(db, { desde: '2026-09-01', hasta: '2026-09-30', comercianteId: comerciante.id, cobradorId: 1 })).observaciones.length, 0);
  await assert.rejects(() => getObservacionesCobro(db, { desde: '2026-09-30', hasta: '2026-09-01' }), /posterior/);
});

test('el cobro marca el día: no hace falta marcar antes de cobrar, ni con señal ni sin ella', async () => {
  const db = await preparar();
  const asfaltada = await zonaNueva(db, 'asfaltada');
  const marcasDe = async (puesto) => (await db.query('SELECT fecha, marca, fuente FROM asistencias_feriales WHERE puesto_id = $1', [puesto.id])).rows;

  const enLinea = await comercianteConPuesto(db, { rubro: 'comida', zonaId: asfaltada.id });
  const cobro = await registrarCobro(db, { comerciante_id: enLinea.comerciante.id, cobrador_id: 2, monto: 3, metodo_pago: 'efectivo' });
  assert.equal(cobro.saldo_restante, 0);
  assert.deepEqual((await marcasDe(enLinea.puesto)).map((item) => [item.marca, item.fuente]), [['P', 'cobro']]);
  // La marca de la app del mismo día no se duplica: la de la app ya existe y el cobro no la toca.
  await marcarAsistencias(db, { puesto_id: enLinea.puesto.id, asistio: true, motivo: 'no_vendio' }, { usuarioId: 2 });
  assert.equal((await marcasDe(enLinea.puesto)).length, 1);

  // Sin señal: el cobro llega al servidor antes que la marca del día y no va a revisión.
  const sinSenal = await comercianteConPuesto(db, { rubro: 'ropa', zonaId: asfaltada.id });
  const sync = await syncOfflineCobro(db, { comerciante_id: sinSenal.comerciante.id, cobrador_id: 2, monto: 3, metodo_pago: 'efectivo', fecha_cobro: new Date().toISOString(), hash_transaccion: `por-dia-${Date.now()}`, device_id: 'prueba' });
  assert.equal(sync.status, 'SUCCESS');
  await marcarAsistencias(db, { puesto_id: sinSenal.puesto.id, asistio: true }, { usuarioId: 2 });
  assert.equal((await calcularLiquidacion(db, sinSenal.comerciante.id)).dias_asistidos, 1, 'la marca que llega después no suma otro día');

  // Si el cobrador marcó "no salió", el cobro no la pisa.
  const ausente = await comercianteConPuesto(db, { rubro: 'otros', zonaId: asfaltada.id });
  await marcarAsistencias(db, { puesto_id: ausente.puesto.id, motivo: 'no_salio' }, { usuarioId: 2 });
  await assert.rejects(() => registrarCobro(db, { comerciante_id: ausente.comerciante.id, cobrador_id: 2, monto: 3, metodo_pago: 'efectivo' }), /excede el saldo/);

  // Pagar un mes anterior no marca el día de hoy; un cobro rechazado tampoco deja marca.
  const deuda = await comercianteConPuesto(db, { rubro: 'otros', zonaId: asfaltada.id });
  await marcar(db, deuda.puesto, ['2026-09-06']);
  await registrarCobro(db, { comerciante_id: deuda.comerciante.id, cobrador_id: 2, monto: 3, metodo_pago: 'efectivo', periodo: PERIODO });
  await assert.rejects(() => registrarCobro(db, { comerciante_id: deuda.comerciante.id, cobrador_id: 2, monto: 50, metodo_pago: 'efectivo' }), /excede el saldo/);
  assert.deepEqual((await marcasDe(deuda.puesto)).map((item) => item.fuente), ['app']);
});

test('lo pagado se ve aunque el mes no tenga días cobrados', async () => {
  const db = await preparar();
  const asfaltada = await zonaNueva(db, 'asfaltada');
  const { comerciante } = await comercianteConPuesto(db, { rubro: 'comida', zonaId: asfaltada.id });
  await registrarCobro(db, { comerciante_id: comerciante.id, cobrador_id: 2, monto: 3, metodo_pago: 'efectivo', periodo: PERIODO }, { allowExcess: true });
  const liquidacion = await calcularLiquidacion(db, comerciante.id, PERIODO);
  assert.equal(liquidacion.no_devengo, true);
  assert.equal(liquidacion.monto_pagado, 3);
  assert.equal(liquidacion.saldo, 0);
});

test('"no salió" en la app manda sobre la P importada del Excel ese día', async () => {
  const db = await preparar();
  const asfaltada = await zonaNueva(db, 'asfaltada');
  const { comerciante, puesto } = await comercianteConPuesto(db, { rubro: 'comida', zonaId: asfaltada.id });
  await db.query(`INSERT INTO asistencias_feriales (puesto_id, fecha, sesion, marca, fuente) VALUES ($1, '2026-09-06', '4', 'P', 'excel'), ($1, '2026-09-13', '4', 'P', 'excel')`, [puesto.id]);
  assert.equal((await calcularLiquidacion(db, comerciante.id, PERIODO)).dias_asistidos, 2);
  await marcarAsistencias(db, { puesto_id: puesto.id, fecha: '2026-09-06', motivo: 'no_salio' }, { usuarioId: 2 });
  assert.equal((await calcularLiquidacion(db, comerciante.id, PERIODO)).dias_asistidos, 1);
});

test('con dos puestos marcados el mismo día paga por cada puesto, con la tarifa de la zona de cada uno', async () => {
  const db = await preparar();
  const asfaltada = await zonaNueva(db, 'asfaltada');
  const tierra = await zonaNueva(db, 'sin_asfaltar');
  const { comerciante, puesto } = await comercianteConPuesto(db, { rubro: 'comida', zonaId: asfaltada.id });
  const segundo = await insertPuesto(db, { zona_id: asfaltada.id, metros_cuadrados: 9, direccion: `Por día segundo ${documento}`, comerciante_id: comerciante.id });
  await marcar(db, puesto, ['2026-09-06']);
  await marcar(db, segundo, ['2026-09-06', '2026-09-13']);
  const mismaVia = await calcularLiquidacion(db, comerciante.id, PERIODO);
  assert.equal(mismaVia.dias_asistidos, 3, 'dos puestos el 6 y uno el 13');
  assert.equal(mismaVia.monto_dia, 3);
  assert.equal(mismaVia.monto_total, 9);
  assert.deepEqual(mismaVia.puestos_cobrados.map((item) => [item.puesto_id, item.dias]), [[Number(puesto.id), 1], [Number(segundo.id), 2]]);

  // Un tercer puesto en vía sin asfaltar paga S/ 2 por día.
  const enTierra = await insertPuesto(db, { zona_id: tierra.id, metros_cuadrados: 4, direccion: `Por día tierra ${documento}`, comerciante_id: comerciante.id });
  await marcar(db, enTierra, ['2026-09-06']);
  const mixto = await calcularLiquidacion(db, comerciante.id, PERIODO);
  assert.equal(mixto.monto_total, 11);
  assert.equal(mixto.monto_dia, null, 'montos distintos por puesto: el detalle va en puestos_cobrados');
});
