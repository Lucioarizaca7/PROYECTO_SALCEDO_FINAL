/**
 * Auditoría con fechas, páginas y búsqueda (revisión del 11/11/2026): antes la pantalla mostraba siempre los
 * últimos 200 registros y el auditor no podía ver nada más antiguo.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { closeDatabase, contarAuditoria, getAuditTrail, initializeDatabase, recordAudit, todayInLima } from '../src/db.js';
import { pool } from '../src/pg.js';

const MARCA = `auditoria-filtros-${process.pid}`;
const ayer = todayInLima(new Date(Date.now() - 24 * 60 * 60 * 1000));

before(async () => {
  await initializeDatabase();
  for (let i = 1; i <= 5; i += 1) {
    await recordAudit(pool, { usuarioId: 1, usuarioRol: 'super_admin', entidad: 'pruebas_auditoria', accion: 'PROBAR', detalle: `${MARCA} registro ${i} 100%_ok` });
  }
});
after(async () => { await closeDatabase(); });

test('se pagina con el total de lo filtrado', async () => {
  const filtros = { entidad: 'pruebas_auditoria' };
  assert.equal(await contarAuditoria(pool, filtros), 5);
  const pagina1 = await getAuditTrail(pool, { ...filtros, page: 1, limit: 2 });
  const pagina3 = await getAuditTrail(pool, { ...filtros, page: 3, limit: 2 });
  assert.deepEqual(pagina1.map((item) => item.detalle.split(' ')[2]), ['5', '4'], 'lo más reciente primero');
  assert.deepEqual(pagina3.map((item) => item.detalle.split(' ')[2]), ['1']);
});

test('se filtra por días de Lima y por texto', async () => {
  const hoy = todayInLima();
  assert.equal(await contarAuditoria(pool, { entidad: 'pruebas_auditoria', desde: hoy, hasta: hoy }), 5);
  assert.equal(await contarAuditoria(pool, { entidad: 'pruebas_auditoria', hasta: ayer }), 0);
  assert.equal(await contarAuditoria(pool, { buscar: `${MARCA} registro 3` }), 1);
  // Un % o un _ del texto se busca tal cual, no como comodín.
  assert.equal(await contarAuditoria(pool, { buscar: '100%_ok' }), 5);
  assert.equal(await contarAuditoria(pool, { buscar: '100%%ok' }), 0);
});

test('sin límite pedido trae hasta 200, como antes', async () => {
  const todo = await getAuditTrail(pool, {});
  assert.ok(todo.length <= 200);
  const muchos = await getAuditTrail(pool, { limit: 5000 });
  assert.ok(muchos.length <= 200, 'el límite no se puede saltar');
});
