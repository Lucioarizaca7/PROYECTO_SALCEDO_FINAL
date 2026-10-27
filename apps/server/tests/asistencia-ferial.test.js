/**
 * Asistencia ferial por fecha (migrations/0010_asistencia_ferial.sql): el ferial paga los días que
 * asistió × la tarifa diaria; sin asistencias en el mes no devenga.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  initializeDatabase, insertComerciante, insertPuesto, insertTarifa, calcularLiquidacion,
  marcarAsistencias, getAsistencias, getJornadaPackage, getPendingDebt, todayInLima
} from '../src/db.js';

let documento = 20777000000;

async function rubroConTarifaDiaria(db, monto) {
  const nombre = `rubro feria ${process.pid} ${Date.now()} ${Math.random().toString(16).slice(2, 6)}`;
  const rubroId = (await db.query('INSERT INTO rubros (nombre) VALUES ($1) RETURNING id', [nombre])).rows[0].id;
  await insertTarifa(db, { rubro_id: rubroId, tipo_tarifa: 'fija', monto_fijo: monto, unidad_medida: 'diaria', vigencia_inicio: '2026-01-01' });
  return rubroId;
}

async function ferialConPuesto(db, rubroId, estadoPuesto = 'ocupado') {
  const comerciante = await insertComerciante(db, {
    dni_ruc: String(documento += 1), nombre: `Ferial ${documento}`, rubro_id: rubroId, zona_id: 1,
    tipo_comerciante: 'ferial', estado: 'activo', usuario_creador: 1
  });
  const puesto = await insertPuesto(db, { zona_id: 1, metros_cuadrados: 2, direccion: `Feria ${documento}`, codigo_puesto: `FER-${documento}`, comerciante_id: comerciante.id, estado: estadoPuesto });
  return { comerciante, puesto };
}

test('el ferial paga solo los días que asistió; sin asistencias no devenga', async () => {
  const db = await initializeDatabase();
  const rubroId = await rubroConTarifaDiaria(db, 2);
  const { comerciante, puesto } = await ferialConPuesto(db, rubroId);

  const sinMarcas = await calcularLiquidacion(db, comerciante.id, '2026-09');
  assert.equal(sinMarcas.no_devengo, true);
  assert.equal(sinMarcas.motivo, 'ferial_sin_asistencia');

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
  const rubroId = await rubroConTarifaDiaria(db, 3);
  const { comerciante, puesto } = await ferialConPuesto(db, rubroId, 'disponible');
  await marcarAsistencias(db, { puesto_id: puesto.id, fecha: '2026-08-02', asistio: true }, { usuarioId: 1 });
  const liquidacion = await calcularLiquidacion(db, comerciante.id, '2026-08');
  assert.equal(liquidacion.monto_total, 3);
});

test('las marcas se validan y la lista del día muestra a los feriales', async () => {
  const db = await initializeDatabase();
  const rubroId = await rubroConTarifaDiaria(db, 2);
  const { comerciante, puesto } = await ferialConPuesto(db, rubroId);

  await assert.rejects(() => marcarAsistencias(db, { puesto_id: puesto.id, fecha: '2999-01-01', asistio: true }), /todavía no llega/);
  await assert.rejects(() => marcarAsistencias(db, { puesto_id: puesto.id, asistio: 'si' }), /asistió/);
  await assert.rejects(() => marcarAsistencias(db, { puesto_id: 99999999, asistio: true }), /no existe/);

  const permanente = await insertComerciante(db, {
    dni_ruc: String(documento += 1), nombre: `Permanente ${documento}`, rubro_id: rubroId, zona_id: 1,
    tipo_comerciante: 'permanente', estado: 'activo', usuario_creador: 1
  });
  const puestoPermanente = await insertPuesto(db, { zona_id: 1, metros_cuadrados: 2, direccion: `Fijo ${documento}`, comerciante_id: permanente.id });
  await assert.rejects(() => marcarAsistencias(db, { puesto_id: puestoPermanente.id, asistio: true }), /no es de un comerciante ferial/);

  await marcarAsistencias(db, { puesto_id: puesto.id, asistio: true }, { usuarioId: 2 });
  const hoy = await getAsistencias(db);
  assert.equal(hoy.fecha, todayInLima());
  const fila = hoy.puestos.find((item) => item.puesto_id === Number(puesto.id));
  assert.equal(fila.asistio, true);
  assert.equal(fila.comerciante_id, Number(comerciante.id));
  assert.ok(!hoy.puestos.some((item) => item.puesto_id === Number(puestoPermanente.id)), 'solo feriales');

  const paquete = await getJornadaPackage(db);
  const enPaquete = paquete.comerciantes.find((item) => item.id === Number(comerciante.id));
  assert.equal(enPaquete.puesto_ferial_id, Number(puesto.id));
  assert.equal(enPaquete.dias_asistidos, 1);
});

test('el pendiente de regularización entra al padrón de la jornada y a la deuda del panel', async () => {
  const db = await initializeDatabase();
  const rubroId = await rubroConTarifaDiaria(db, 2);
  const { comerciante, puesto } = await ferialConPuesto(db, rubroId);
  await db.query(`UPDATE comerciantes SET estado = 'pendiente' WHERE id = $1`, [comerciante.id]);
  await marcarAsistencias(db, { puesto_id: puesto.id, asistio: true }, { usuarioId: 2 });

  const enPaquete = (await getJornadaPackage(db)).comerciantes.find((item) => item.id === Number(comerciante.id));
  assert.ok(enPaquete, 'el cobrador lo tiene sin señal');
  assert.equal(enPaquete.puesto_ferial_id, Number(puesto.id));
  assert.equal(enPaquete.saldo, 2);
  assert.ok(await getPendingDebt(db) >= 2, 'su deuda suma en el panel');
});
