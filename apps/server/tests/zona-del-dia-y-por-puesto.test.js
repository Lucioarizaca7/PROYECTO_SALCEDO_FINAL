/**
 * Decisiones del usuario del 12/11/2026 (migración 0031):
 * - Zona del día: si faltan otros, un comerciante vende en otra zona y ese día se le cobra con la tarifa de esa
 *   zona (asfaltada S/ 3, sin asfaltar S/ 2). El cobrador la elige al marcar o al cobrar; el administrador la ve.
 * - Por puesto: cada puesto marcado paga su día (desde el 13/11/2026 ya no hay cuota mensual por rubro).
 * - Reenviar la baja o la liberación de un puesto (cola del mapa con señal débil) no es un error.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  calcularLiquidacion, closeDatabase, createUser, currentPeriod, deactivatePuesto, getObservacionesCobro,
  initializeDatabase, insertComerciante, insertPuesto, insertTarifa, insertZona, liberarPuesto, marcarAsistencias, registrarCobro,
  seriesDelComerciante, todayInLima, updatePuesto
} from '../src/db.js';
import { pool } from '../src/pg.js';
import { insertZonaConPrecio, zonaConPrecio } from './_deuda.js';

before(async () => { await initializeDatabase(); });
after(async () => { await closeDatabase(); });

let correlativo = 0;
const unico = () => `${process.pid}-${correlativo += 1}-${Date.now()}`;
let documento = 20888100000;
const rubroRopa = async () => (await pool.query("SELECT id FROM rubros WHERE nombre = 'ropa'")).rows[0].id;

// Ferial con su puesto en una zona asfaltada (S/ 3 por día, tarifa general de la 0013).
async function ferialAsfaltado() {
  const asfaltada = await insertZonaConPrecio(pool, { nombre: `Zona asfaltada ${unico()}`, tipo_via: 'asfaltada' });
  const comerciante = await insertComerciante(pool, {
    dni_ruc: String(documento += 1), nombre: `Zona del día ${documento}`, rubro_id: await rubroRopa(), zona_id: asfaltada.id,
    tipo_comerciante: 'ferial', estado: 'activo', usuario_creador: 1
  });
  const puesto = await insertPuesto(pool, { zona_id: asfaltada.id, metros_cuadrados: 4, direccion: `Zona del día ${unico()}`, comerciante_id: comerciante.id });
  return { asfaltada, comerciante, puesto };
}
const zonaSinAsfaltar = () => insertZonaConPrecio(pool, { nombre: `Zona sin asfaltar ${unico()}`, tipo_via: 'sin_asfaltar' });
const nuevoCobrador = () => createUser({ nombre: `Cobrador zona ${unico()}`, email: `zona-${unico()}@prueba.pe`, password: 'clave-de-prueba-1', rol: 'cobrador' });
const zonaDeLaMarca = async (puestoId) => Number((await pool.query(
  "SELECT zona_id FROM asistencias_feriales WHERE puesto_id = $1 AND fecha = $2::date AND sesion = ''", [puestoId, todayInLima()])).rows[0]?.zona_id);

test('zona del día: marcado en una zona sin asfaltar, ese día se cobra S/ 2 y se entrega un S2', async () => {
  const { comerciante, puesto } = await ferialAsfaltado();
  const tierra = await zonaSinAsfaltar();
  const cobrador = await nuevoCobrador();
  const [marca] = await marcarAsistencias(pool, [{ puesto_id: puesto.id, fecha: todayInLima(), asistio: true, zona_id: tierra.id }], { usuarioId: cobrador.id, rol: 'cobrador' });
  assert.equal(marca.en_otra_zona, true);

  const liquidacion = await calcularLiquidacion(pool, comerciante.id);
  assert.equal(liquidacion.monto_total, 2, 'antes se cobraba con la zona del puesto: S/ 3');
  const series = await seriesDelComerciante(pool, (await pool.query('SELECT * FROM comerciantes WHERE id = $1', [comerciante.id])).rows[0]);
  const s2 = series.find((item) => item.serie === 'S2');
  assert.equal(s2?.puestos_hoy, 1, 'el ticket de hoy es S2');
  assert.equal(series.find((item) => item.serie === 'S3')?.puestos_hoy ?? 0, 0, 'hoy no se entrega S3');

  // El administrador lo ve en observaciones.
  const { observaciones } = await getObservacionesCobro(pool, { comercianteId: comerciante.id });
  assert.ok(observaciones.some((item) => item.en_otra_zona && /Cobrado en otra zona/.test(item.observacion)));
});

test('zona del día al cobrar: la marca que pone el cobro va en esa zona', async () => {
  const { comerciante, puesto } = await ferialAsfaltado();
  const tierra = await zonaSinAsfaltar();
  const cobrador = await nuevoCobrador();
  await registrarCobro(pool, { comerciante_id: comerciante.id, cobrador_id: cobrador.id, monto: 2, metodo_pago: 'efectivo', zona_dia: tierra.id });
  assert.equal(await zonaDeLaMarca(puesto.id), Number(tierra.id));
  assert.equal((await calcularLiquidacion(pool, comerciante.id)).saldo, 0);
});

test('ya marcado en la zona del puesto: elegir la zona del día al cobrar la corrige', async () => {
  const { comerciante, puesto } = await ferialAsfaltado();
  const tierra = await zonaSinAsfaltar();
  const cobrador = await nuevoCobrador();
  await marcarAsistencias(pool, [{ puesto_id: puesto.id, fecha: todayInLima(), asistio: true }], { usuarioId: cobrador.id });
  await registrarCobro(pool, { comerciante_id: comerciante.id, cobrador_id: cobrador.id, monto: 2, metodo_pago: 'efectivo', zona_dia: tierra.id });
  assert.equal(await zonaDeLaMarca(puesto.id), Number(tierra.id));
  assert.equal((await calcularLiquidacion(pool, comerciante.id)).saldo, 0, 'el día quedó en S/ 2 y está pagado');
});

test('cambiar la zona del puesto no pisa la zona del día ya elegida', async () => {
  const { puesto } = await ferialAsfaltado();
  const tierra = await zonaSinAsfaltar();
  const otra = await insertZonaConPrecio(pool, { nombre: `Zona nueva del puesto ${unico()}`, tipo_via: 'asfaltada' });
  await marcarAsistencias(pool, [{ puesto_id: puesto.id, fecha: todayInLima(), asistio: true, zona_id: tierra.id }], { usuarioId: 1 });
  await updatePuesto(pool, puesto.id, { zona_id: otra.id });
  assert.equal(await zonaDeLaMarca(puesto.id), Number(tierra.id), 'antes el cambio de zona del puesto la borraba');
});

// Permanente con dos puestos en una zona de S/ 30 por día.
async function permanenteMensual() {
  const zona = await zonaConPrecio(pool, 30, { nombre: `Zona por puesto ${unico()}` });
  const comerciante = await insertComerciante(pool, {
    dni_ruc: String(documento += 1), nombre: `Por puesto ${documento}`, rubro_id: 1, zona_id: zona.id,
    tipo_comerciante: 'permanente', estado: 'activo', usuario_creador: 1
  });
  const puestos = [];
  for (let i = 0; i < 2; i += 1) {
    puestos.push(await insertPuesto(pool, { zona_id: zona.id, metros_cuadrados: 4, direccion: `Por puesto ${unico()}`, comerciante_id: comerciante.id }));
  }
  return { comerciante, puestos };
}
const marcarHoy = (puestos) => marcarAsistencias(pool, puestos.map((puesto) => ({ puesto_id: puesto.id, fecha: todayInLima(), asistio: true })), { usuarioId: 1 });

test('dos puestos: paga cada puesto marcado ese día, no una cuota del mes', async () => {
  const { comerciante, puestos } = await permanenteMensual();
  assert.equal((await calcularLiquidacion(pool, comerciante.id, currentPeriod())).saldo, 0, 'sin días cobrados no debe nada');
  await marcarHoy([puestos[0]]);
  assert.equal((await calcularLiquidacion(pool, comerciante.id, currentPeriod())).monto_total, 30);
  await marcarHoy(puestos);
  assert.equal((await calcularLiquidacion(pool, comerciante.id, currentPeriod())).monto_total, 60, 'los dos puestos marcados hoy');
});

test('ceder un puesto después no cambia lo que debe por los días que lo tuvo', async () => {
  const { comerciante, puestos } = await permanenteMensual();
  await marcarHoy(puestos);
  await liberarPuesto(pool, puestos[1].id);
  assert.equal((await calcularLiquidacion(pool, comerciante.id, currentPeriod())).monto_total, 60, 'el día marcado sigue siendo suyo');
});

test('reenviar la baja o la liberación de un puesto no es un error', async () => {
  const { puestos } = await permanenteMensual();
  await liberarPuesto(pool, puestos[0].id);
  assert.equal((await liberarPuesto(pool, puestos[0].id)).ya_libre, true, 'antes un reenvío fallaba');
  await deactivatePuesto(pool, puestos[1].id);
  assert.equal((await deactivatePuesto(pool, puestos[1].id)).ya_dado_de_baja, true);
});

// Ronda 17 (12/11/2026): los tickets de hoy son lo que se le cobra hoy.
const comercianteDe = async (id) => (await pool.query('SELECT * FROM comerciantes WHERE id = $1', [id])).rows[0];
const ticketsDeHoy = (series) => series.reduce((total, item) => total + Number(item.puestos_hoy || 0), 0);

test('tickets de hoy: el puesto marcado "faltó" no suma ticket', async () => {
  const { comerciante, puesto } = await ferialAsfaltado();
  await marcarAsistencias(pool, [{ puesto_id: puesto.id, fecha: todayInLima(), asistio: false, motivo: 'no_salio' }], { usuarioId: 1 });
  assert.equal(ticketsDeHoy(await seriesDelComerciante(pool, await comercianteDe(comerciante.id))), 0, 'antes sugería S/ 3 a quien no salió');
});

test('tickets de hoy: con dos puestos sin marcar, uno (el que marca el cobro)', async () => {
  const { asfaltada, comerciante } = await ferialAsfaltado();
  await insertPuesto(pool, { zona_id: asfaltada.id, metros_cuadrados: 4, direccion: `Segundo ${unico()}`, comerciante_id: comerciante.id });
  assert.equal(ticketsDeHoy(await seriesDelComerciante(pool, await comercianteDe(comerciante.id))), 1,
    'antes eran 2 y el cobro de S/ 6 se rechazaba: el cobro marca un solo puesto');
});

test('sin marca de hoy se puede cobrar: el cobro marca el día', async () => {
  const { comerciante, puesto } = await ferialAsfaltado();
  const cobrador = await nuevoCobrador();
  assert.equal((await calcularLiquidacion(pool, comerciante.id)).saldo, 0, 'antes de cobrar no debe nada');
  const cobro = await registrarCobro(pool, { comerciante_id: comerciante.id, cobrador_id: cobrador.id, monto: 3, metodo_pago: 'efectivo' });
  assert.equal(cobro.estado, 'confirmado');
  assert.equal(await zonaDeLaMarca(puesto.id), Number((await pool.query('SELECT zona_id FROM puestos WHERE id = $1', [puesto.id])).rows[0].zona_id));
});
