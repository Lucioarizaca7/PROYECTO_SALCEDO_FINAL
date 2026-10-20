/**
 * Errores de lógica corregidos en auditoría y comerciantes:
 * - el filtro de auditoría por comerciante busca su id exacto (antes no encontraba nada y el 3 habría
 *   coincidido con el 13);
 * - dar de baja a un comerciante editando su estado también da de baja sus puestos.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { closeDatabase, getAuditTrail, getPuestos, initializeDatabase, insertComerciante, insertPuesto, recordAudit, registrarCobro, updateComerciante } from '../src/db.js';
import { pool } from '../src/pg.js';

let correlativo = 0;
const idDe = async (tabla, nombre) => (await pool.query(`SELECT id FROM ${tabla} WHERE nombre = $1`, [nombre])).rows[0].id;

async function nuevoComerciante(rubro = 'otros') {
  correlativo += 1;
  return insertComerciante(pool, {
    dni_ruc: `4800${String(correlativo).padStart(4, '0')}`,
    nombre: `Prueba pendientes ${correlativo}`,
    rubro_id: await idDe('rubros', rubro),
    zona_id: await idDe('zonas', 'Mercado Central')
  });
}

const auditar = (datos) => recordAudit(pool, { usuarioId: 1, usuarioRol: 'super_admin', metodoHttp: 'PUT', ipOrigen: '127.0.0.1', ...datos });

before(async () => { await initializeDatabase(); });
after(async () => { await closeDatabase(); });

test('el filtro de auditoría por comerciante trae solo lo suyo', async () => {
  const a = await nuevoComerciante();
  const b = await nuevoComerciante();

  await auditar({ entidad: 'comerciantes', accion: 'ACTUALIZAR_COMERCIANTE', recursoId: a.id, payloadNuevo: { id: a.id } });
  await auditar({ entidad: 'comerciantes', accion: 'ACTUALIZAR_COMERCIANTE', recursoId: b.id, payloadNuevo: { id: b.id } });
  await auditar({ entidad: 'comerciantes', accion: 'ACTUALIZAR_COMERCIANTE', recursoId: a.id * 10, payloadNuevo: { id: a.id * 10 } });
  await auditar({ entidad: 'puestos', accion: 'ASIGNAR_PUESTO', recursoId: 999, payloadNuevo: { id: 999, comerciante_id: a.id } });
  await registrarCobro(pool, { comerciante_id: a.id, cobrador_id: 1, monto: 10, metodo_pago: 'efectivo' }, {
    audit: { usuarioId: 1, usuarioRol: 'cobrador', accion: 'REGISTRAR_COBRO', metodoHttp: 'POST', ipOrigen: '127.0.0.1' }
  });

  const deA = await getAuditTrail(pool, { comerciante_id: a.id });
  assert.deepEqual(deA.map((item) => item.entidad).sort(), ['cobros', 'comerciantes', 'puestos']);

  const cobrosDeA = await getAuditTrail(pool, { comerciante_id: a.id, entidad: 'cobros' });
  assert.equal(cobrosDeA.length, 1);
  assert.equal(cobrosDeA[0].accion, 'REGISTRAR_COBRO');

  const deB = await getAuditTrail(pool, { comerciante_id: b.id });
  assert.equal(deB.length, 1);
});

test('dar de baja editando el estado también da de baja sus puestos', async () => {
  const merchant = await nuevoComerciante('ropa');
  const puesto = await insertPuesto(pool, { comerciante_id: merchant.id, zona_id: await idDe('zonas', 'Mercado Central'), direccion: 'Pasaje baja por edición 1', metros_cuadrados: 4 });
  assert.equal(puesto.estado, 'ocupado');

  await updateComerciante(pool, merchant.id, { estado: 'inactivo' });
  const fila = async () => (await pool.query(`SELECT c.estado, c.fecha_baja, p.estado AS puesto FROM comerciantes c JOIN puestos p ON p.comerciante_id = c.id WHERE c.id = $1`, [merchant.id])).rows[0];
  const baja = await fila();
  assert.equal(baja.estado, 'inactivo');
  assert.equal(baja.puesto, 'inactivo');
  assert.ok(baja.fecha_baja, 'se registra la fecha de baja');
  assert.equal((await getPuestos(pool)).some((item) => item.id === puesto.id), false, 'el puesto ya no aparece ni genera deuda');

  await updateComerciante(pool, merchant.id, { nombre: 'Prueba pendientes renombrado' });
  assert.equal(String((await fila()).fecha_baja), String(baja.fecha_baja), 'editar a un comerciante ya inactivo no cambia su baja');

  await updateComerciante(pool, merchant.id, { estado: 'activo' });
  const reactivado = await fila();
  assert.equal(reactivado.estado, 'activo');
  assert.equal(reactivado.fecha_baja, null);
  assert.equal(reactivado.puesto, 'inactivo', 'los puestos se vuelven a asignar');
});
