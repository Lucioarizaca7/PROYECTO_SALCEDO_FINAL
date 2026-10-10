import test from 'node:test';
import assert from 'node:assert/strict';

import { loginUser, hasRoleAccess, requireAuth, requireRoles } from '../src/auth.js';
import { initializeDatabase, recordAudit, getAuditTrail, syncOfflineCobro, createNotification, getNotifications, getMerchantPortal, generateForecastProjection, scoreMorosidadComerciante } from '../src/db.js';

test('loginUser acepta credenciales válidas y devuelve usuario', () => {
  const result = loginUser({ email: 'admin@salcedo.gob.pe', password: 'admin123' });

  assert.equal(result.user.rol, 'super_admin');
  assert.ok(result.token.length > 10);
});

test('loginUser rechaza credenciales inválidas', () => {
  assert.throws(() => loginUser({ email: 'admin@salcedo.gob.pe', password: 'badpass' }), /credenciales/i);
});

test('hasRoleAccess permite acceso según rol', () => {
  assert.equal(hasRoleAccess('super_admin', 'cobrador'), true);
  assert.equal(hasRoleAccess('cobrador', 'auditor'), false);
  assert.equal(hasRoleAccess('comerciante', 'comerciante'), true);
});

test('requireAuth valida JWT real y rechaza sin token', () => {
  const validToken = loginUser({ email: 'cobrador@salcedo.gob.pe', password: 'cobro123' }).token;
  const req = { headers: { authorization: `Bearer ${validToken}` } };
  const res = { status(code) { this.code = code; return this; }, json(payload) { this.payload = payload; return this; } };
  let nextCalled = false;

  requireAuth(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(res.code, undefined);

  const missingTokenReq = { headers: {} };
  const missingTokenRes = { status(code) { this.code = code; return this; }, json(payload) { this.payload = payload; return this; } };

  requireAuth(missingTokenReq, missingTokenRes, () => {});
  assert.equal(missingTokenRes.code, 401);
});

test('requireRoles bloquea acceso si el rol no está permitido', () => {
  const validToken = loginUser({ email: 'super_admin@salcedo.gob.pe', password: 'admin123' }).token;
  const req = { headers: { authorization: `Bearer ${validToken}` } };
  const res = { status(code) { this.code = code; return this; }, json(payload) { this.payload = payload; return this; } };
  let nextCalled = false;

  requireAuth(req, res, () => {
    requireRoles(['super_admin'])(req, res, () => { nextCalled = true; });
  });

  assert.equal(nextCalled, true);

  const cobradorToken = loginUser({ email: 'cobrador@salcedo.gob.pe', password: 'cobro123' }).token;
  const blockedReq = { headers: { authorization: `Bearer ${cobradorToken}` } };
  const blockedRes = { status(code) { this.code = code; return this; }, json(payload) { this.payload = payload; return this; } };

  requireAuth(blockedReq, blockedRes, () => {
    requireRoles(['super_admin'])(blockedReq, blockedRes, () => {});
  });

  assert.equal(blockedRes.code, 403);
});

test('recordAudit persiste trazabilidad inmutable del cambio y bloquea ediciones', async () => {
  const db = await initializeDatabase();

  recordAudit(db, {
    usuarioId: 1,
    entidad: 'tarifas',
    accion: 'MODIFICAR_TARIFA',
    detalle: 'Se actualizó tarifa de comercio',
    usuarioRol: 'super_admin',
    rolUsuario: 'super_admin',
    metodoHttp: 'PUT',
    ipOrigen: '127.0.0.1',
    rutaEndpoint: '/api/tarifas/1',
    recursoId: 1,
    payloadPrevio: JSON.stringify({ monto_fijo: 120 }),
    payloadNuevo: JSON.stringify({ monto_fijo: 140 })
  });

  const trail = getAuditTrail(db, { entidad: 'tarifas' });
  assert.ok(trail.length >= 1);
  const last = trail[0];
  assert.equal(last.accion, 'MODIFICAR_TARIFA');
  assert.match(last.detalle, /tarifa/i);
  assert.equal(last.usuario, 'Administrador');
  assert.equal(last.ruta_endpoint || last.rutaEndpoint, '/api/tarifas/1');

  assert.throws(() => {
    db.run('UPDATE auditoria SET detalle = ? WHERE id = ?', ['modificado', last.id]);
  }, /No se permite modificar/i);

  assert.throws(() => {
    db.run('DELETE FROM auditoria WHERE id = ?', [last.id]);
  }, /No se permite eliminar/i);
});

test('syncOfflineCobro detecta duplicados por hash idempotente y evita reinsertar cobros', async () => {
  const db = await initializeDatabase();
  const payload = {
    comerciante_id: 1,
    cobrador_id: 2,
    monto: 25,
    concepto: 'Cobro offline',
    metodo_pago: 'efectivo',
    codigo_operacion: 'OFFLINE-001',
    hash_transaccion: 'hash-offline-001',
    periodo: '2026-09',
    fecha_cobro: '2026-09-16T10:00:00.000Z'
  };

  const first = syncOfflineCobro(db, payload);
  assert.equal(first.status, 'SUCCESS');

  const second = syncOfflineCobro(db, payload);
  assert.equal(second.status, 'IGNORED');

  const totalCobros = db.exec('SELECT COUNT(*) AS total FROM cobros WHERE hash_transaccion = ?', [payload.hash_transaccion])[0].values[0][0];
  assert.equal(Number(totalCobros), 1);
});

test('getMerchantPortal y createNotification exponen el portal del comerciante y su historial de avisos', async () => {
  const db = await initializeDatabase();
  const portal = getMerchantPortal(db, '20123456780');

  assert.equal(portal.comerciante.nombre, 'Comerciante Demo');
  assert.ok(Array.isArray(portal.pagos));
  assert.equal(typeof portal.deuda.saldo, 'number');

  const notification = createNotification(db, {
    comerciante_id: portal.comerciante.id,
    tipo: 'cobro_confirmado',
    canal: 'whatsapp',
    mensaje: 'Cobro confirmado por SISREC Salcedo.'
  });

  assert.equal(notification.canal, 'whatsapp');
  assert.equal(getNotifications(db, portal.comerciante.id).length >= 1, true);
});

test('generateForecastProjection y scoreMorosidadComerciante entregan métricas predictivas razonables', async () => {
  const db = await initializeDatabase();

  const forecast = generateForecastProjection(db, { period: '2026-09', horizonteDias: 90 });
  assert.ok(Number(forecast.totalProyectado) > 0);
  assert.ok(Array.isArray(forecast.porZona));
  assert.ok(forecast.porZona.length >= 1);

  const score = scoreMorosidadComerciante(db, 1);
  assert.ok(score.score >= 0 && score.score <= 1);
  assert.match(score.nivel, /bajo|medio|alto|critico/i);
  assert.ok(score.motivo_principal.length > 0);
});
