/**
 * Registrar en un comerciante el DNI/RUC de otro dado de baja (revisión del 12/11/2026). La base lo impide (dni_ruc
 * es único), pero la pantalla decía solo "El registro ya existe". Ahora dice de qué comerciante es el documento,
 * para reactivarlo en vez de dejar a la misma persona en dos registros.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { closeDatabase, deactivateComerciante, findComerciante, initializeDatabase, insertComerciante, insertZona, updateComerciante } from '../src/db.js';
import { ConflictError } from '../src/errors.js';
import { pool } from '../src/pg.js';

before(async () => { await initializeDatabase(); });
after(async () => { await closeDatabase(); });

let documento = 20777000000;
async function comerciante(zonaId, rubroId) {
  return insertComerciante(pool, {
    dni_ruc: String(documento += 1), nombre: `Documento ${documento}`, rubro_id: rubroId, zona_id: zonaId,
    tipo_comerciante: 'permanente', estado: 'activo', usuario_creador: 1
  });
}

test('el DNI de un dado de baja: el mensaje dice de quién es', async () => {
  const zona = await insertZona(pool, { nombre: `Zona documento ${process.pid}` });
  const rubro = (await pool.query("SELECT id FROM rubros WHERE nombre = 'ropa'")).rows[0].id;
  const antiguo = await comerciante(zona.id, rubro);
  await deactivateComerciante(pool, antiguo.id);
  const codigoDeBaja = (await findComerciante(pool, antiguo.id)).codigo; // el código cambia con el estado
  const otro = await comerciante(zona.id, rubro);

  await assert.rejects(updateComerciante(pool, otro.id, { dni_ruc: antiguo.dni_ruc }), (error) => {
    assert.ok(error instanceof ConflictError, 'antes era el error crudo de PostgreSQL (23505)');
    assert.ok(error.message.includes(`dado de baja ${codigoDeBaja}`), error.message);
    return true;
  });
  // Conservar el propio documento sigue funcionando.
  assert.equal((await updateComerciante(pool, otro.id, { dni_ruc: otro.dni_ruc, nombre: 'Documento renombrado' })).nombre, 'Documento renombrado');
});
