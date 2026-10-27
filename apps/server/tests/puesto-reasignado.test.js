/**
 * La marca de asistencia es del titular que tenía el puesto ese día (migrations/0015_asistencia_titular.sql):
 * si el puesto pasa a otro comerciante o se libera, lo marcado antes lo sigue debiendo quien lo tenía.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  initializeDatabase, insertComerciante, insertPuesto, insertZona, updatePuesto, liberarPuesto, calcularLiquidacion,
  marcarAsistencias, getAsistencias, getObservacionesCobro, recordAudit, todayInLima
} from '../src/db.js';

let documento = 20888000000;
let correlativoZona = 0;
const PERIODO = '2026-09';

const rubroId = async (db, nombre) => (await db.query('SELECT id FROM rubros WHERE nombre = $1', [nombre])).rows[0].id;

// Mismas tarifas por día cobrado que cobro-por-dia.test.js, vigentes desde septiembre de 2026.
async function preparar() {
  const db = await initializeDatabase();
  await db.query(`
    INSERT INTO tarifas (rubro_id, tipo_via, tipo_tarifa, monto_fijo, monto_variable, unidad_medida, vigencia_inicio)
    SELECT NULL, via.tipo_via, 'fija', via.monto, 0, 'semanal', DATE '2026-09-01'
    FROM (VALUES ('asfaltada', 3), ('sin_asfaltar', 2)) AS via (tipo_via, monto)
    WHERE NOT EXISTS (SELECT 1 FROM tarifas t WHERE t.rubro_id IS NULL AND t.tipo_via = via.tipo_via AND t.vigencia_inicio = DATE '2026-09-01')`);
  const zona = await insertZona(db, { nombre: `Zona reasignada ${process.pid}-${correlativoZona += 1}-${Date.now()}`, tipo_via: 'asfaltada' });
  return { db, zona };
}

const comerciante = async (db, zonaId) => insertComerciante(db, {
  dni_ruc: String(documento += 1), nombre: `Titular ${documento}`, rubro_id: await rubroId(db, 'otros'), zona_id: zonaId,
  tipo_comerciante: 'permanente', estado: 'activo', usuario_creador: 1
});

const marcar = (db, puesto, fechas, extra = {}) => marcarAsistencias(db, fechas.map((fecha) => ({ puesto_id: puesto.id, fecha, asistio: true, ...extra })), { usuarioId: 2 });

test('al reasignar el puesto, cada titular debe solo los días que marcó', async () => {
  const { db, zona } = await preparar();
  const antes = await comerciante(db, zona.id);
  const despues = await comerciante(db, zona.id);
  const puesto = await insertPuesto(db, { zona_id: zona.id, metros_cuadrados: 4, direccion: `Reasignado ${documento}`, comerciante_id: antes.id });

  await marcar(db, puesto, ['2026-09-06', '2026-09-13'], { motivo: 'no_vendio' });
  await updatePuesto(db, puesto.id, { comerciante_id: despues.id });
  await marcar(db, puesto, ['2026-09-20']);

  const deAntes = await calcularLiquidacion(db, antes.id, PERIODO);
  assert.equal(deAntes.dias_asistidos, 2, 'lo marcado antes del cambio sigue siendo de quien tenía el puesto');
  assert.equal(deAntes.monto_total, 6);
  const deDespues = await calcularLiquidacion(db, despues.id, PERIODO);
  assert.equal(deDespues.dias_asistidos, 1, 'el titular nuevo no hereda los días del anterior');
  assert.equal(deDespues.monto_total, 3);

  const observaciones = await getObservacionesCobro(db, { desde: '2026-09-01', hasta: '2026-09-30', comercianteId: antes.id });
  assert.equal(observaciones.observaciones.length, 2, 'la observación queda con el comerciante de la marca');
  assert.ok(observaciones.observaciones.every((fila) => fila.comerciante_id === Number(antes.id)));
});

test('al liberar el puesto, el titular conserva la deuda de los días marcados', async () => {
  const { db, zona } = await preparar();
  const titular = await comerciante(db, zona.id);
  const puesto = await insertPuesto(db, { zona_id: zona.id, metros_cuadrados: 4, direccion: `Liberado ${documento}`, comerciante_id: titular.id });
  await marcar(db, puesto, ['2026-09-06', '2026-09-13', '2026-09-20']);

  await liberarPuesto(db, puesto.id);
  const liquidacion = await calcularLiquidacion(db, titular.id, PERIODO);
  assert.equal(liquidacion.no_devengo, false);
  assert.equal(liquidacion.monto_total, 9, 'soltar el puesto no borra lo que ya debía');
});

test('la marca de hoy de otro titular no aparece como marcada para el titular nuevo', async () => {
  const { db, zona } = await preparar();
  const antes = await comerciante(db, zona.id);
  const despues = await comerciante(db, zona.id);
  const puesto = await insertPuesto(db, { zona_id: zona.id, metros_cuadrados: 4, direccion: `Hoy ${documento}`, comerciante_id: antes.id });
  await marcar(db, puesto, [todayInLima()]);
  await updatePuesto(db, puesto.id, { comerciante_id: despues.id });

  const fila = (await getAsistencias(db, { fecha: todayInLima() })).puestos.find((item) => item.puesto_id === Number(puesto.id));
  assert.equal(fila.comerciante_id, Number(despues.id));
  assert.equal(fila.marca, null, 'la marca del día era del titular anterior');
});

test('titular_de_asistencia reconstruye el titular de las marcas viejas con la auditoría', async () => {
  const { db, zona } = await preparar();
  const antes = await comerciante(db, zona.id);
  const despues = await comerciante(db, zona.id);
  const puesto = await insertPuesto(db, { zona_id: zona.id, metros_cuadrados: 4, direccion: `Auditado ${documento}`, comerciante_id: antes.id });
  const sinRastro = await insertPuesto(db, { zona_id: zona.id, metros_cuadrados: 4, direccion: `Sin rastro ${documento}`, comerciante_id: antes.id });

  // Lo que deja la ruta POST /puestos/:id/liberar: el estado previo del puesto, con su titular.
  const previo = (await db.query('SELECT * FROM puestos WHERE id = $1', [puesto.id])).rows[0];
  await liberarPuesto(db, puesto.id);
  await recordAudit(db, { entidad: 'puestos', accion: 'LIBERAR_PUESTO', recursoId: String(puesto.id), payloadPrevio: previo });
  await updatePuesto(db, puesto.id, { comerciante_id: despues.id });

  const titular = async (puestoId, fecha) => (await db.query('SELECT titular_de_asistencia($1, $2::date) AS id', [puestoId, fecha])).rows[0].id;
  assert.equal(Number(await titular(puesto.id, '2026-09-06')), Number(antes.id), 'antes del cambio auditado, el titular previo');
  assert.equal(Number(await titular(puesto.id, todayInLima())), Number(despues.id), 'sin cambios posteriores, el titular actual');
  assert.equal(Number(await titular(sinRastro.id, '2026-09-06')), Number(antes.id), 'sin auditoría, el titular actual');

  // El trigger llena el titular de las marcas que entran por otros caminos (Excel, semilla).
  await db.query(`INSERT INTO asistencias_feriales (puesto_id, fecha, sesion, marca, fuente) VALUES ($1, '2026-09-27', 'excel', 'P', 'excel')`, [puesto.id]);
  const insertada = (await db.query(`SELECT comerciante_id FROM asistencias_feriales WHERE puesto_id = $1 AND sesion = 'excel'`, [puesto.id])).rows[0];
  assert.equal(Number(insertada.comerciante_id), Number(despues.id));
});
