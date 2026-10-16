/**
 * Código de negocio del comerciante: COM-{correlativo}-{iniciales}-{rubro}-{documento}-{zona}-{estado}-{AAAAMMDD}
 * (migrations/0004_codigo_comerciante.sql).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  initializeDatabase,
  insertComerciante,
  updateComerciante,
  deactivateComerciante,
  buscarComerciantePorCodigo,
  getComerciantes,
  obtenerPortalComerciante,
  todayInLima
} from '../src/db.js';

const hoy = () => todayInLima().replaceAll('-', '');

async function catalogo(db, tabla, nombre) {
  return (await db.query(`SELECT id, codigo FROM ${tabla} WHERE nombre = $1`, [nombre])).rows[0];
}

test('rubros y zonas reciben un código corto y único', async () => {
  const db = await initializeDatabase();
  assert.equal((await catalogo(db, 'rubros', 'comida')).codigo, 'COMI');
  assert.equal((await catalogo(db, 'zonas', 'Mercado Central')).codigo, 'MCEN');
  assert.equal((await catalogo(db, 'zonas', 'Zona Norte')).codigo, 'ZNOR');

  const zona = (await db.query(`INSERT INTO zonas (nombre) VALUES ('Mercado Centenario') RETURNING codigo`)).rows[0];
  assert.equal(zona.codigo, 'MCEN2', 'si la abreviatura ya existe se numera');
});

test('un comerciante nuevo recibe su código con toda su información', async () => {
  const db = await initializeDatabase();
  const comida = await catalogo(db, 'rubros', 'comida');
  const mercado = await catalogo(db, 'zonas', 'Mercado Central');

  const creado = await insertComerciante(db, {
    dni_ruc: '75163744', nombre: 'Lucio Arizaca Carrión', rubro_id: comida.id, zona_id: mercado.id,
    tipo_comerciante: 'eventual', estado: 'activo', usuario_creador: 1
  });
  const correlativo = String(creado.correlativo).padStart(4, '0');
  assert.equal(creado.codigo, `COM-${correlativo}-LAC-COMI-***744-MCEN-ACT-${hoy()}`);
  assert.ok(!creado.codigo.includes('75163744'), 'el código no expone el DNI completo');

  const [fila] = await getComerciantes(db, { search: creado.codigo });
  assert.equal(fila.codigo, creado.codigo);
  assert.equal(fila.qr_code, `SISREC://comerciante/${creado.codigo}`);
});

test('al cambiar zona o estado el código se rearma, el correlativo no cambia y el viejo sigue sirviendo', async () => {
  const db = await initializeDatabase();
  const ropa = await catalogo(db, 'rubros', 'ropa');
  const mercado = await catalogo(db, 'zonas', 'Mercado Central');
  const norte = await catalogo(db, 'zonas', 'Zona Norte');

  const creado = await insertComerciante(db, {
    dni_ruc: '41234567', nombre: 'Rosa Ñahui', rubro_id: ropa.id, zona_id: mercado.id,
    tipo_comerciante: 'permanente', estado: 'activo', usuario_creador: 1
  });
  const original = creado.codigo;

  const movido = await updateComerciante(db, creado.id, { zona_id: norte.id });
  assert.match(movido.codigo, /-RN-ROPA-\*\*\*567-ZNOR-ACT-/);
  assert.equal(movido.correlativo, creado.correlativo);

  assert.equal(await buscarComerciantePorCodigo(db, original), Number(creado.id), 'el código anterior sigue encontrándolo');
  assert.equal(await buscarComerciantePorCodigo(db, `SISREC://comerciante/${original}`), Number(creado.id), 'también desde el QR viejo');
  assert.equal(await buscarComerciantePorCodigo(db, String(creado.correlativo).padStart(4, '0')), Number(creado.id));
  assert.equal((await obtenerPortalComerciante(db, original)).comerciante.codigo, movido.codigo);

  const historial = (await db.query('SELECT codigo, motivo FROM comerciante_codigos_historicos WHERE comerciante_id = $1', [creado.id])).rows;
  assert.deepEqual(historial.map((h) => [h.codigo, h.motivo]), [[original, 'Cambio de zona']]);

  await deactivateComerciante(db, creado.id);
  const baja = (await db.query('SELECT codigo, correlativo FROM comerciantes WHERE id = $1', [creado.id])).rows[0];
  assert.match(baja.codigo, /-ZNOR-INA-/);
  assert.equal(baja.correlativo, creado.correlativo);
});

test('el código antiguo CM-00N del comerciante demo sigue llevando a él', async () => {
  const db = await initializeDatabase();
  const demo = (await db.query(`SELECT id, codigo FROM comerciantes WHERE dni_ruc = '20123456780'`)).rows[0];
  assert.match(demo.codigo, /^COM-\d{4}-CD-COMI-\*\*\*780-MCEN-ACT-\d{8}$/);
  // Los comerciantes creados antes de la migración guardan su CM-00N; uno nuevo se encuentra por correlativo.
  assert.equal(await buscarComerciantePorCodigo(db, `CM-${String(demo.id).padStart(3, '0')}`), Number(demo.id));
});
