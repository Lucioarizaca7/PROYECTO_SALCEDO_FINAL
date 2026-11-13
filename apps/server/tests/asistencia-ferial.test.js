/**
 * Asistencia por fecha (migrations/0010_asistencia_ferial.sql): el ferial (y desde el 13/11/2026 también el
 * permanente) paga los días que asistió × el precio por día de su zona; sin asistencias en el mes no devenga.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  initializeDatabase, insertComerciante, insertPuesto, insertTarifa, calcularLiquidacion,
  marcarAsistencias, getAsistencias, getJornadaPackage, getPendingDebt, todayInLima
} from '../src/db.js';

let documento = 20777000000;

// Zona propia con su precio por día (lo fija el super_admin; 0032).
async function zonaConPrecioDiario(db, monto) {
  const nombre = `zona feria ${process.pid} ${Date.now()} ${Math.random().toString(16).slice(2, 6)}`;
  const zonaId = (await db.query('INSERT INTO zonas (nombre) VALUES ($1) RETURNING id', [nombre])).rows[0].id;
  await insertTarifa(db, { zona_id: zonaId, monto_fijo: monto, vigencia_inicio: '2026-01-01' }, { permitirInicioPasado: true });
  return zonaId;
}

async function ferialConPuesto(db, zonaId, estadoPuesto = 'ocupado') {
  const comerciante = await insertComerciante(db, {
    dni_ruc: String(documento += 1), nombre: `Ferial ${documento}`, rubro_id: 1, zona_id: zonaId,
    tipo_comerciante: 'ferial', estado: 'activo', usuario_creador: 1
  });
  const puesto = await insertPuesto(db, { zona_id: zonaId, metros_cuadrados: 2, direccion: `Feria ${documento}`, codigo_puesto: `FER-${documento}`, comerciante_id: comerciante.id, estado: estadoPuesto });
  return { comerciante, puesto };
}

test('el ferial paga solo los días que asistió; sin asistencias no devenga', async () => {
  const db = await initializeDatabase();
  const rubroId = await zonaConPrecioDiario(db, 2); // id de la zona
  const { comerciante, puesto } = await ferialConPuesto(db, rubroId);

  const sinMarcas = await calcularLiquidacion(db, comerciante.id, '2026-09');
  assert.equal(sinMarcas.no_devengo, true);
  assert.equal(sinMarcas.motivo, 'sin_dias_cobrados');

  await marcarAsistencias(db, [
    { puesto_id: puesto.id, fecha: '2026-09-06', asistio: true },
    { puesto_id: puesto.id, fecha: '2026-09-13', asistio: true },
    { puesto_id: puesto.id, fecha: '2026-09-20', asistio: false },
    { puesto_id: puesto.id, fecha: '2026-09-27', asistio: true }
  ], { usuarioId: 2 });
  // Reenviar una marca (p. ej. la cola sin señal) no la duplica; cambiarla sí la corrige.
  await marcarAsistencias(db, [{ puesto_id: puesto.id, fecha: '2026-09-06', asistio: true }], { usuarioId: 2 });
  await marcarAsistencias(db, [{ puesto_id: puesto.id, fecha: '2026-09-27', asistio: false }], { usuarioId: 2 });

  const liquidacion = await calcularLiquidacion(db, comerciante.id, '2026-09');
  assert.equal(liquidacion.no_devengo, false);
  assert.equal(liquidacion.dias_asistidos, 2);
  assert.equal(liquidacion.monto_total, 4, '2 días × S/ 2');
  assert.equal((await calcularLiquidacion(db, comerciante.id, '2026-10')).no_devengo, true, 'otro mes sin asistencias');

  // Una marca importada del Excel ('P/1 MÑN') también cuenta, y el mismo día solo una vez.
  await db.query(`INSERT INTO asistencias_feriales (puesto_id, fecha, sesion, marca, fuente) VALUES ($1, '2026-09-13', '4', 'P/1 MÑN', 'excel'), ($1, '2026-09-14', '4', 'P', 'excel')`, [puesto.id]);
  assert.equal((await calcularLiquidacion(db, comerciante.id, '2026-09')).dias_asistidos, 3);
});

test('el ferial ausente que conserva su puesto también paga si asistió', async () => {
  const db = await initializeDatabase();
  const rubroId = await zonaConPrecioDiario(db, 3); // id de la zona
  const { comerciante, puesto } = await ferialConPuesto(db, rubroId, 'disponible');
  await marcarAsistencias(db, { puesto_id: puesto.id, fecha: '2026-08-02', asistio: true }, { usuarioId: 1 });
  const liquidacion = await calcularLiquidacion(db, comerciante.id, '2026-08');
  assert.equal(liquidacion.monto_total, 3);
});

test('las marcas se validan y la lista del día muestra a quienes pagan por día; el eventual no se marca', async () => {
  const db = await initializeDatabase();
  const rubroId = await zonaConPrecioDiario(db, 2); // id de la zona
  const { comerciante, puesto } = await ferialConPuesto(db, rubroId);

  await assert.rejects(() => marcarAsistencias(db, { puesto_id: puesto.id, fecha: '2999-01-01', asistio: true }), /todavía no llega/);
  await assert.rejects(() => marcarAsistencias(db, { puesto_id: puesto.id, asistio: 'si' }), /asistió/);
  await assert.rejects(() => marcarAsistencias(db, { puesto_id: 99999999, asistio: true }), /no existe/);

  const eventual = await insertComerciante(db, {
    dni_ruc: String(documento += 1), nombre: `Eventual ${documento}`, rubro_id: 1, zona_id: rubroId,
    tipo_comerciante: 'eventual', estado: 'activo', usuario_creador: 1
  });
  const puestoEventual = await insertPuesto(db, { zona_id: rubroId, metros_cuadrados: 2, direccion: `Eventual ${documento}`, comerciante_id: eventual.id });
  await assert.rejects(() => marcarAsistencias(db, { puesto_id: puestoEventual.id, asistio: true }), /eventual/);

  await marcarAsistencias(db, { puesto_id: puesto.id, asistio: true }, { usuarioId: 2 });
  const hoy = await getAsistencias(db);
  assert.equal(hoy.fecha, todayInLima());
  const fila = hoy.puestos.find((item) => item.puesto_id === Number(puesto.id));
  assert.equal(fila.asistio, true);
  assert.equal(fila.comerciante_id, Number(comerciante.id));
  assert.ok(!hoy.puestos.some((item) => item.puesto_id === Number(puestoEventual.id)), 'el eventual no está en la lista');

  const paquete = await getJornadaPackage(db);
  const enPaquete = paquete.comerciantes.find((item) => item.id === Number(comerciante.id));
  assert.equal(enPaquete.puesto_ferial_id, Number(puesto.id));
  assert.equal(enPaquete.dias_asistidos, 1);
});

test('el pendiente de regularización entra al padrón de la jornada y a la deuda del panel', async () => {
  const db = await initializeDatabase();
  const rubroId = await zonaConPrecioDiario(db, 2); // id de la zona
  const { comerciante, puesto } = await ferialConPuesto(db, rubroId);
  await db.query(`UPDATE comerciantes SET estado = 'pendiente' WHERE id = $1`, [comerciante.id]);
  await marcarAsistencias(db, { puesto_id: puesto.id, asistio: true }, { usuarioId: 2 });

  const enPaquete = (await getJornadaPackage(db)).comerciantes.find((item) => item.id === Number(comerciante.id));
  assert.ok(enPaquete, 'el cobrador lo tiene sin señal');
  assert.equal(enPaquete.puesto_ferial_id, Number(puesto.id));
  assert.equal(enPaquete.saldo, 2);
  assert.ok(await getPendingDebt(db) >= 2, 'su deuda suma en el panel');
});
