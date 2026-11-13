/**
 * Reactivaciones de la importación del padrón anteriores a la 0027 (migración 0029, revisión del 12/11/2026).
 * La importación reactivaba sin un registro propio en la auditoría, la 0027 no pudo reconstruirlas y la historia
 * de estados quedaba en "inactivo": se cobraban los meses de baja del comerciante ya reactivado.
 *
 * Se simula el estado de antes de la 0027 (la fila de la reactivación no existe, la importación solo dejó su fila
 * IMPORTAR_PADRON_EXCEL) y se corre el SQL de la migración. Decisión del usuario: la reactivación rige desde la
 * primera importación con reactivados posterior a la baja; si no hubo, desde el día en que con seguridad ya estaba
 * activo. Las pruebas van en orden: las importaciones de la auditoría valen para todos los comerciantes.
 * Desde el 13/11/2026 no hay cuota mensual (ningún mes de baja se cobra): se comprueba solo la historia de estados.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  closeDatabase, initializeDatabase, insertComerciante, insertPuesto, setInicioCobro, updateComerciante
} from '../src/db.js';
import { pool } from '../src/pg.js';
import { zonaConPrecio } from './_deuda.js';

const MIGRACION = readFileSync(new URL('../migrations/0029_reactivacion_del_padron.sql', import.meta.url), 'utf8');
const migrar = () => pool.query(MIGRACION);

before(async () => {
  await initializeDatabase();
  await setInicioCobro(pool, '2026-01');
});
after(async () => { await closeDatabase(); });

let correlativo = 0;
const unico = () => `${process.pid}-${correlativo += 1}`;
let documento = 20555000000;
const enLima = (dia) => `${dia}T12:00:00-05:00`;

// Permanente dado de alta en enero, en una zona con precio por día.
async function permanente() {
  const zona = await zonaConPrecio(pool, 30);
  const merchant = await insertComerciante(pool, {
    dni_ruc: String(documento += 1), nombre: `Padrón ${documento}`, rubro_id: 1, zona_id: zona.id,
    tipo_comerciante: 'permanente', estado: 'activo', usuario_creador: 1
  });
  await insertPuesto(pool, { zona_id: zona.id, metros_cuadrados: 4, direccion: `Padrón ${unico()}`, comerciante_id: merchant.id });
  await pool.query("UPDATE comerciantes SET creado_en = '2026-01-05T12:00:00-05:00' WHERE id = $1", [merchant.id]);
  return merchant;
}
// Cambio de estado registrado por el trigger y movido al día que se quiere simular.
async function cambiarEstado(id, estado, dia) {
  await updateComerciante(pool, id, { estado });
  await pool.query(`
    UPDATE comerciantes_estado_cambios SET desde = $2::date, registrado_en = $3::timestamptz
    WHERE id = (SELECT MAX(id) FROM comerciantes_estado_cambios WHERE comerciante_id = $1)`, [id, dia, enLima(dia)]);
}
// Reactivación como la hacía la importación antes de la 0027: sin fila en la historia.
async function reactivarSinRegistro(id) {
  await updateComerciante(pool, id, { estado: 'activo' });
  await pool.query('DELETE FROM comerciantes_estado_cambios WHERE id = (SELECT MAX(id) FROM comerciantes_estado_cambios WHERE comerciante_id = $1)', [id]);
}
// Fila de auditoría de una importación del padrón de ese día (la auditoría solo prohíbe UPDATE y DELETE).
async function importacion(dia, reactivados) {
  await pool.query(`
    INSERT INTO auditoria_logs (rol, entidad, accion, payload_nuevo, hash_actual, fecha)
    VALUES ('super_admin', 'padron', 'IMPORTAR_PADRON_EXCEL', $1::jsonb, 'prueba', $2::timestamptz)`,
  [JSON.stringify({ reactivatedMerchants: reactivados, createdMerchants: 0 }), enLima(dia)]);
}
const filas = async (id) => (await pool.query(
  'SELECT estado_anterior, estado_nuevo, desde::text AS desde FROM comerciantes_estado_cambios WHERE comerciante_id = $1 ORDER BY desde, registrado_en, id', [id])).rows;

test('reactivado por una importación: rige desde la primera importación con reactivados tras la baja', async () => {
  const merchant = await permanente();
  await importacion('2026-01-20', 1); // antes de la baja: no es la suya
  await cambiarEstado(merchant.id, 'inactivo', '2026-02-10');
  await importacion('2026-03-05', 0); // no reactivó a nadie
  await importacion('2026-04-15', 1);
  await reactivarSinRegistro(merchant.id);

  await migrar();
  assert.deepEqual((await filas(merchant.id)).at(-1), { estado_anterior: 'inactivo', estado_nuevo: 'activo', desde: '2026-04-15' });
});

test('reactivación perdida entre dos bajas, sin importación: rige el día de la segunda baja', async () => {
  const merchant = await permanente();
  await cambiarEstado(merchant.id, 'inactivo', '2026-05-10');
  await reactivarSinRegistro(merchant.id);
  await cambiarEstado(merchant.id, 'inactivo', '2026-08-20');

  await migrar();
  assert.deepEqual(await filas(merchant.id), [
    { estado_anterior: 'activo', estado_nuevo: 'inactivo', desde: '2026-05-10' },
    { estado_anterior: 'inactivo', estado_nuevo: 'activo', desde: '2026-08-20' },
    { estado_anterior: 'activo', estado_nuevo: 'inactivo', desde: '2026-08-20' }
  ]);
});

test('reactivado sin importación posterior: rige el día en que se aplicó la 0027', async () => {
  const merchant = await permanente();
  await cambiarEstado(merchant.id, 'inactivo', '2026-09-20');
  await reactivarSinRegistro(merchant.id);

  await migrar();
  const aplicada = (await pool.query(
    "SELECT (aplicada_en AT TIME ZONE 'America/Lima')::date::text AS dia FROM schema_migrations WHERE name = '0027_baja_de_cada_mes.sql'")).rows[0].dia;
  assert.deepEqual((await filas(merchant.id)).at(-1), { estado_anterior: 'inactivo', estado_nuevo: 'activo', desde: aplicada });
});

test('una historia completa no se toca y la migración se puede repetir', async () => {
  const merchant = await permanente();
  await cambiarEstado(merchant.id, 'inactivo', '2026-06-10');
  await cambiarEstado(merchant.id, 'activo', '2026-07-10');
  const antes = await filas(merchant.id);
  const total = async () => Number((await pool.query('SELECT COUNT(*) FROM comerciantes_estado_cambios')).rows[0].count);
  const totalAntes = await total();

  await migrar();
  await migrar();
  assert.deepEqual(await filas(merchant.id), antes);
  assert.equal(await total(), totalAntes, 'las reparaciones de las pruebas anteriores no se duplican');
});
