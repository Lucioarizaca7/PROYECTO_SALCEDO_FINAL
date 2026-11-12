/**
 * Un cobro sin señal con la fecha del celular fuera de rango (en el futuro o de más de DIAS_COBRO_SIN_SENAL días)
 * queda observado y no marca asistencia ese día (revisión del 12/11/2026). Antes la marca se ponía igual: un celular
 * con la hora mal creaba un día cobrado en otra fecha (S/ 3 de deuda en un mes que no era), saltándose la ventana
 * de 3 días que rige para las marcas desde la app (decisión del 22/10/2026).
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  closeDatabase, createUser, initializeDatabase, insertComerciante, insertPuesto, insertZona, resolveCobroObservado, syncOfflineCobro,
  todayInLima
} from '../src/db.js';
import { pool } from '../src/pg.js';

const MIGRACION = readFileSync(new URL('../migrations/0030_marca_de_cobro_con_fecha_dudosa.sql', import.meta.url), 'utf8');

before(async () => { await initializeDatabase(); });
after(async () => { await closeDatabase(); });

let correlativo = 0;
const unico = () => `${process.pid}-${correlativo += 1}-${Date.now()}`;
let documento = 20666000000;
const DIA_MS = 24 * 3600 * 1000;

// Ferial en zona asfaltada: S/ 3 por día asistido (tarifa general de la 0013).
async function ferial() {
  const zona = await insertZona(pool, { nombre: `Zona fecha ${unico()}`, tipo_via: 'asfaltada' });
  const rubro = (await pool.query("SELECT id FROM rubros WHERE nombre = 'ropa'")).rows[0].id;
  const comerciante = await insertComerciante(pool, {
    dni_ruc: String(documento += 1), nombre: `Fecha ${documento}`, rubro_id: rubro, zona_id: zona.id,
    tipo_comerciante: 'ferial', estado: 'activo', usuario_creador: 1
  });
  const puesto = await insertPuesto(pool, { zona_id: zona.id, metros_cuadrados: 4, direccion: `Fecha ${unico()}`, comerciante_id: comerciante.id });
  return { comerciante, puesto };
}
const nuevoCobrador = () => createUser({ nombre: `Cobrador fecha ${unico()}`, email: `fecha-${unico()}@prueba.pe`, password: 'clave-de-prueba-1', rol: 'cobrador' });
const marcasDelPuesto = async (puestoId) => (await pool.query(
  "SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha FROM asistencias_feriales WHERE puesto_id = $1 ORDER BY fecha", [puestoId])).rows.map((fila) => fila.fecha);
// El celular manda la fecha y el periodo de su propio reloj, aunque esté mal.
const cobroSinSenal = (cobradorId, comercianteId, fecha) => syncOfflineCobro(pool, {
  comerciante_id: comercianteId, cobrador_id: cobradorId, monto: 3, metodo_pago: 'efectivo',
  fecha_cobro: fecha.toISOString(), periodo: todayInLima(fecha).slice(0, 7), hash_transaccion: `fecha-${unico()}`
});

test('un celular con la fecha en el futuro: el cobro queda observado y no marca ese día', async () => {
  const { comerciante, puesto } = await ferial();
  const cobrador = await nuevoCobrador();
  const resultado = await cobroSinSenal(cobrador.id, comerciante.id, new Date(Date.now() + 40 * DIA_MS));
  assert.equal(resultado.status, 'OBSERVED');
  assert.match(resultado.data.observacion, /fecha/);
  assert.deepEqual(await marcasDelPuesto(puesto.id), [], 'antes marcaba un día que todavía no llega');
});

test('un celular con la fecha de hace 20 días: no crea un día cobrado fuera de la ventana', async () => {
  const { comerciante, puesto } = await ferial();
  const cobrador = await nuevoCobrador();
  const resultado = await cobroSinSenal(cobrador.id, comerciante.id, new Date(Date.now() - 20 * DIA_MS));
  assert.equal(resultado.status, 'OBSERVED');
  assert.deepEqual(await marcasDelPuesto(puesto.id), [], 'antes marcaba el día de hace 20 días');
});

test('dentro de la ventana el cobro sin señal sí marca su día, como antes', async () => {
  const { comerciante, puesto } = await ferial();
  const cobrador = await nuevoCobrador();
  const ayer = new Date(Date.now() - DIA_MS);
  const resultado = await cobroSinSenal(cobrador.id, comerciante.id, ayer);
  assert.equal(resultado.status, 'SUCCESS');
  assert.deepEqual(await marcasDelPuesto(puesto.id), [todayInLima(ayer)]);
});

// La marca que ponía el código anterior: la del día del cobro, fuente 'cobro'.
async function marcaComoAntes(puestoId, fecha) {
  await pool.query(`INSERT INTO asistencias_feriales (puesto_id, fecha, sesion, marca, fuente)
    VALUES ($1, $2::date, '', 'P', 'cobro')`, [puestoId, todayInLima(fecha)]);
}

test('la migración quita las marcas viejas de cobros con fecha dudosa aún en revisión', async () => {
  const pendiente = await ferial();
  const revisado = await ferial();
  const cobrador = await nuevoCobrador();
  const fecha = new Date(Date.now() - 20 * DIA_MS);
  await cobroSinSenal(cobrador.id, pendiente.comerciante.id, fecha);
  await marcaComoAntes(pendiente.puesto.id, fecha);
  const aceptado = await cobroSinSenal(cobrador.id, revisado.comerciante.id, fecha);
  await marcaComoAntes(revisado.puesto.id, fecha);
  const observacion = (await pool.query('SELECT id FROM cobros_observados WHERE transaccion_id = $1', [aceptado.data.id])).rows[0].id;
  await resolveCobroObservado(pool, observacion, { decision: 'aceptado', resolucion: 'Revisado con el cobrador', usuarioId: 1 });

  await pool.query(MIGRACION);
  assert.deepEqual(await marcasDelPuesto(pendiente.puesto.id), [], 'la marca del día equivocado se quita');
  assert.deepEqual(await marcasDelPuesto(revisado.puesto.id), [todayInLima(fecha)], 'lo que ya revisó el administrador no se toca');
});
