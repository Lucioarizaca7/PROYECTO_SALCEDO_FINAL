/**
 * Fase 2 — trabajo en campo y offline, contra la API levantada de verdad (esquema de prueba propio):
 * token de renovación por dispositivo, lote de cobros offline que no se detiene ante un error,
 * cobro observado cuando excede el saldo, revisión manual y paquete de jornada.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

import { startServer } from '../src/index.ts';
import { closeDatabase, calcularLiquidacion, findUserByEmail, getComerciantes, getAuditTrail, DIAS_COBRO_SIN_SENAL, fechaCobroEnLinea, fechaCobroFueraDeRango } from '../src/db.js';
import { pool } from '../src/pg.js';

let server;
let baseUrl;

before(async () => {
  server = await startServer(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closeDatabase();
});

async function api(path, { method = 'GET', token, body, headers = {}, refreshCookie } = {}) {
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(refreshCookie ? { Cookie: `sisrec_refresh=${encodeURIComponent(refreshCookie)}` } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, setCookie: response.headers.getSetCookie() };
}

// El token de renovación llega solo en la cookie HttpOnly sisrec_refresh; aquí se lee para reenviarlo.
const refreshCookieOf = (setCookie) => {
  const cookie = setCookie.find((item) => item.startsWith('sisrec_refresh='));
  return cookie ? decodeURIComponent(cookie.split(';')[0].slice('sisrec_refresh='.length)) : '';
};
const refresh = (refreshToken) => api('/auth/refresh', { method: 'POST', refreshCookie: refreshToken });

async function login(email, password, device = {}) {
  const { status, body, setCookie } = await api('/auth/login', { method: 'POST', body: { email, password, ...device } });
  assert.equal(status, 200, body?.message);
  return { ...body, refreshToken: refreshCookieOf(setCookie), setCookie };
}

const cobradorLogin = (device) => login('cobrador@salcedo.gob.pe', 'cobro123', device);
const adminLogin = () => login('admin@salcedo.gob.pe', 'admin123', { device_id: 'pc-oficina' });

let hashCounter = 0;
const offlineHash = () => `test-offline-${process.pid}-${Date.now()}-${hashCounter += 1}`;

// La semilla trae pocos comerciantes con deuda: cada prueba cobra en su propio periodo (futuro), que el
// cobro aplica con periodo_aplicado, para no consumir el saldo de las demás.
async function merchantWithBalance(periodo) {
  const merchants = await getComerciantes(pool, { limit: 100 });
  for (const merchant of merchants) {
    const liquidation = await calcularLiquidacion(pool, merchant.id, periodo).catch(() => null);
    if (liquidation && !liquidation.no_devengo && liquidation.saldo >= 5) return { merchant, liquidation };
  }
  throw new Error(`La semilla no tiene un comerciante con saldo en ${periodo}`);
}

// Hora del celular de hace una hora (más los minutos indicados): dentro del rango que se acepta sin señal.
const horaDeCobro = (minute = 0) => new Date(Date.now() - 60 * 60_000 + minute * 60_000).toISOString();

// ---------------------------------------------------------------------------
// Token de renovación por dispositivo
// ---------------------------------------------------------------------------

test('el login entrega el token de renovación de 12 h solo en una cookie HttpOnly', async () => {
  const result = await cobradorLogin({ device_id: 'android-cobrador-1', device_nombre: 'Moto G (Cobrador 1)' });
  assert.ok(result.refreshToken.length >= 40);
  const cookie = result.setCookie.find((item) => item.startsWith('sisrec_refresh='));
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.match(cookie, /Path=\/api\/v1\/auth/i);
  const { body } = await api('/auth/login', { method: 'POST', body: { email: 'cobrador@salcedo.gob.pe', password: 'cobro123', device_id: 'android-cobrador-1b' } });
  assert.equal(body.refreshToken, undefined, 'el JavaScript de la página no recibe el token de renovación');
  assert.equal(result.deviceId, 'android-cobrador-1');

  const hours = (Date.parse(result.refreshExpiresAt) - Date.now()) / 3_600_000;
  assert.ok(hours > 11.9 && hours <= 12, `vence en ${hours} h`);

  const decoded = jwt.decode(result.token);
  assert.ok(decoded.sid, 'el token de acceso apunta a la sesión del dispositivo');
  const minutes = (decoded.exp - decoded.iat) / 60;
  assert.ok(minutes <= 15, `el token de acceso debe ser corto (JWT_EXPIRES_IN), dura ${minutes} min`);

  const stored = await pool.query('SELECT token_hash FROM sesiones_dispositivo WHERE id = $1', [decoded.sid]);
  assert.notEqual(stored.rows[0].token_hash, result.refreshToken, 'el token no se guarda en claro');
});

test('POST /auth/refresh renueva el token de acceso sin pedir la clave', async () => {
  const { refreshToken, user } = await cobradorLogin({ device_id: 'android-refresh' });
  const { status, body } = await refresh(refreshToken);
  assert.equal(status, 200, body?.message);
  assert.equal(body.user.id, user.id);

  const cobros = await api('/cobros', { token: body.token });
  assert.equal(cobros.status, 200, 'el token renovado sirve para la API');

  const invalid = await refresh('no-existe');
  assert.equal(invalid.status, 401);
  assert.equal(invalid.body.sessionExpired, true);
  assert.ok(invalid.setCookie.some((item) => item.startsWith('sisrec_refresh=;')), 'una cookie que ya no sirve se borra');

  // El token en el cuerpo (como antes) ya no se acepta: solo la cookie.
  assert.equal((await api('/auth/refresh', { method: 'POST', body: { refreshToken } })).status, 401);
});

test('un token de renovación vencido ya no sirve', async () => {
  const { refreshToken, token } = await cobradorLogin({ device_id: 'android-vencido' });
  await pool.query(`UPDATE sesiones_dispositivo SET expira_en = now() - interval '1 minute' WHERE id = $1`, [jwt.decode(token).sid]);
  const { status } = await refresh(refreshToken);
  assert.equal(status, 401);
});

test('volver a ingresar en el mismo dispositivo cierra la sesión anterior de ese dispositivo', async () => {
  const first = await cobradorLogin({ device_id: 'android-reingreso' });
  const second = await cobradorLogin({ device_id: 'android-reingreso' });
  assert.equal((await refresh(first.refreshToken)).status, 401);
  assert.equal((await refresh(second.refreshToken)).status, 200);
});

test('el administrador revoca la sesión de un celular desde el panel y queda auditado', async () => {
  const cobrador = await cobradorLogin({ device_id: 'android-perdido', device_nombre: 'Celular extraviado' });
  const admin = await adminLogin();
  const sid = jwt.decode(cobrador.token).sid;

  const listed = await api('/auth/sesiones', { token: admin.token });
  assert.equal(listed.status, 200);
  assert.ok(listed.body.data.some((item) => Number(item.id) === sid && item.device_nombre === 'Celular extraviado'));

  // El cobrador solo ve sus propias sesiones.
  const own = await api('/auth/sesiones', { token: cobrador.token });
  assert.ok(own.body.data.every((item) => item.email === 'cobrador@salcedo.gob.pe'));

  const revoked = await api(`/auth/sesiones/${sid}`, { method: 'DELETE', token: admin.token });
  assert.equal(revoked.status, 200, revoked.body?.message);

  assert.equal((await refresh(cobrador.refreshToken)).status, 401);
  assert.equal((await api('/cobros', { token: cobrador.token })).status, 401, 'el token de acceso de la sesión revocada deja de valer al instante');

  const audit = await getAuditTrail(pool, { entidad: 'sesiones_dispositivo' });
  assert.ok(audit.some((item) => item.accion === 'REVOCAR_SESION_DISPOSITIVO' && item.detalle.startsWith(`Sesión ${sid} `)));
});

test('un cobrador no puede revocar la sesión de otro usuario', async () => {
  const admin = await adminLogin();
  const cobrador = await cobradorLogin({ device_id: 'android-intruso' });
  const { status } = await api(`/auth/sesiones/${jwt.decode(admin.token).sid}`, { method: 'DELETE', token: cobrador.token });
  assert.equal(status, 404);
  assert.equal((await refresh(admin.refreshToken)).status, 200);
});

test('POST /auth/logout revoca el token de renovación del dispositivo', async () => {
  const { refreshToken } = await cobradorLogin({ device_id: 'android-logout' });
  const logout = await api('/auth/logout', { method: 'POST', refreshCookie: refreshToken });
  assert.equal(logout.status, 200);
  assert.ok(logout.setCookie.some((item) => item.startsWith('sisrec_refresh=;')), 'el cierre borra la cookie');
  assert.equal((await refresh(refreshToken)).status, 401);
});

// ---------------------------------------------------------------------------
// Lote de cobros offline
// ---------------------------------------------------------------------------

test('el lote sigue con el resto cuando un cobro falla, acepta el que excede como observado y no duplica', async () => {
  const { token } = await cobradorLogin({ device_id: 'android-lote' });
  const cobrador = await findUserByEmail(pool, 'cobrador@salcedo.gob.pe');
  const admin = await findUserByEmail(pool, 'admin@salcedo.gob.pe');
  const periodo = '2027-01';
  const { merchant, liquidation } = await merchantWithBalance(periodo);
  const cobro = (minute, extra) => ({ hash_transaccion: offlineHash(), comerciante_id: merchant.id, monto: 1, metodo_pago: 'efectivo', periodo, fecha_cobro: horaDeCobro(minute), ...extra });

  const valid = cobro(1, { cobrador_id: admin.id });
  const unknownMerchant = cobro(2, { comerciante_id: 99999999 });
  // Monto 1 ya cobrado arriba: este se pasa del saldo restante.
  const excess = cobro(3, { monto: liquidation.saldo + 50 });
  const yapeWithoutCode = cobro(4, { metodo_pago: 'yape' });

  const { status, body } = await api('/cobros/sincronizar-lote', {
    method: 'POST', token, body: { device_id: 'android-lote', cobros: [valid, unknownMerchant, excess, yapeWithoutCode] }
  });
  assert.equal(status, 200, body?.message);
  const [r1, r2, r3, r4] = body.data.resultados;
  assert.equal(r1.estado, 'sincronizado');
  assert.match(r1.comprobante, /^R-\d{6}$/);
  assert.equal(r2.estado, 'rechazado');
  assert.match(r2.mensaje, /comerciante no encontrado/i);
  assert.equal(r3.estado, 'observado', 'el cobro que excede el saldo entra igual, en revisión');
  assert.equal(r4.estado, 'rechazado');
  assert.deepEqual(
    { sincronizado: body.data.resumen.sincronizado, observado: body.data.resumen.observado, rechazado: body.data.resumen.rechazado },
    { sincronizado: 1, observado: 1, rechazado: 2 }
  );

  // El cobrador es el del token aunque el celular diga otro.
  const saved = await pool.query('SELECT cobrador_id FROM transacciones WHERE hash_transaccion = $1', [valid.hash_transaccion]);
  assert.equal(Number(saved.rows[0].cobrador_id), Number(cobrador.id));

  // Reenviar el mismo lote (p. ej. se cortó la señal antes de la respuesta) no duplica nada.
  const again = await api('/cobros/sincronizar-lote', { method: 'POST', token, body: { cobros: [valid, excess] } });
  assert.deepEqual(again.body.data.resultados.map((item) => item.estado), ['duplicado', 'duplicado']);
  const count = await pool.query('SELECT COUNT(*) AS n FROM transacciones WHERE hash_transaccion = ANY($1)', [[valid.hash_transaccion, excess.hash_transaccion]]);
  assert.equal(Number(count.rows[0].n), 2);

  // El rechazado queda a la vista del panel de revisión.
  const adminToken = (await adminLogin()).token;
  const errors = await api('/cobros/sincronizacion/errores', { token: adminToken });
  assert.ok(errors.body.data.some((item) => item.hash_transaccion === unknownMerchant.hash_transaccion));
});

test('el lote procesa en orden de cobro: el segundo cobro que agota el saldo es el observado', async () => {
  const { token } = await cobradorLogin({ device_id: 'android-orden' });
  const periodo = '2027-02';
  const { merchant, liquidation } = await merchantWithBalance(periodo);
  const early = { hash_transaccion: offlineHash(), comerciante_id: merchant.id, monto: liquidation.saldo, metodo_pago: 'efectivo', periodo, fecha_cobro: horaDeCobro(1) };
  const late = { hash_transaccion: offlineHash(), comerciante_id: merchant.id, monto: 1, metodo_pago: 'efectivo', periodo, fecha_cobro: horaDeCobro(2) };

  // Llegan desordenados; el servidor respeta la hora en que se cobraron.
  const { body } = await api('/cobros/sincronizar-lote', { method: 'POST', token, body: { cobros: [late, early] } });
  assert.deepEqual(body.data.resultados.map((item) => item.estado), ['observado', 'sincronizado']);
});

test('rango de fechas del cobro: sin señal hasta 3 días atrás; en línea manda el reloj del servidor', () => {
  const ahora = new Date('2026-10-22T15:00:00Z');
  const menos = (ms) => new Date(ahora.getTime() - ms);
  assert.equal(DIAS_COBRO_SIN_SENAL, 3);
  assert.equal(fechaCobroFueraDeRango(menos(72 * 60 * 60_000), ahora), null, 'justo 3 días');
  assert.match(fechaCobroFueraDeRango(menos(72 * 60 * 60_000 + 60_000), ahora), /más de 3 días/);
  assert.equal(fechaCobroFueraDeRango(menos(-4 * 60_000), ahora), null, 'reloj 4 min adelantado');
  assert.match(fechaCobroFueraDeRango(menos(-6 * 60_000), ahora), /en el futuro/);

  assert.equal(fechaCobroEnLinea('2026-10-22T14:58:00Z', ahora), '2026-10-22T14:58:00.000Z', 'el celular con 2 min de diferencia');
  assert.equal(fechaCobroEnLinea('2026-01-15T15:00:00Z', ahora), ahora.toISOString(), 'una fecha vieja no se acepta');
  assert.equal(fechaCobroEnLinea('2031-03-15T15:00:00Z', ahora), ahora.toISOString(), 'ni una futura');
  assert.equal(fechaCobroEnLinea(undefined, ahora), ahora.toISOString());
});

test('sin señal, una fecha de más de 3 días o en el futuro no se descarta: queda observada', async () => {
  const { token } = await cobradorLogin({ device_id: 'android-fechas' });
  const periodo = '2027-04';
  const { merchant } = await merchantWithBalance(periodo);
  const cobro = (fecha_cobro) => ({ hash_transaccion: offlineHash(), comerciante_id: merchant.id, monto: 1, metodo_pago: 'efectivo', periodo, fecha_cobro });
  const hace = (dias) => new Date(Date.now() - dias * 24 * 60 * 60_000).toISOString();

  const enRango = cobro(hace(2.5));
  const viejo = cobro(hace(5));
  const futuro = cobro(new Date(Date.now() + 2 * 60 * 60_000).toISOString());
  const { status, body } = await api('/cobros/sincronizar-lote', { method: 'POST', token, body: { cobros: [enRango, viejo, futuro] } });
  assert.equal(status, 200, body?.message);
  assert.deepEqual(body.data.resultados.map((item) => item.estado), ['sincronizado', 'observado', 'observado']);

  const motivos = await pool.query(`
    SELECT t.hash_transaccion, o.motivo FROM transacciones t JOIN cobros_observados o ON o.transaccion_id = t.id
    WHERE t.hash_transaccion = ANY($1)`, [[viejo.hash_transaccion, futuro.hash_transaccion]]);
  const porHash = Object.fromEntries(motivos.rows.map((row) => [row.hash_transaccion, row.motivo]));
  assert.match(porHash[viejo.hash_transaccion], /más de 3 días/);
  assert.match(porHash[futuro.hash_transaccion], /en el futuro/);
});

test('el lote valida su tamaño y exige rol de cobro', async () => {
  const { token } = await cobradorLogin({ device_id: 'android-limites' });
  assert.equal((await api('/cobros/sincronizar-lote', { method: 'POST', token, body: { cobros: [] } })).status, 400);
  const tooMany = Array.from({ length: 101 }, () => ({ comerciante_id: 1, monto: 1 }));
  assert.equal((await api('/cobros/sincronizar-lote', { method: 'POST', token, body: { cobros: tooMany } })).status, 400);
  assert.equal((await api('/cobros/sincronizar-lote', { method: 'POST', body: { cobros: [{}] } })).status, 401);

  const auditor = await login('auditor@salcedo.gob.pe', 'audit123').catch(() => null);
  if (auditor) {
    assert.equal((await api('/cobros/sincronizar-lote', { method: 'POST', token: auditor.token, body: { cobros: [{}] } })).status, 403);
  }
});

// ---------------------------------------------------------------------------
// Revisión manual de cobros observados
// ---------------------------------------------------------------------------

test('el administrador acepta o anula un cobro observado; el anulado sale de la recaudación', async () => {
  const cobradorToken = (await cobradorLogin({ device_id: 'android-revision' })).token;
  const admin = await adminLogin();
  const periodo = '2027-03';
  const { merchant, liquidation } = await merchantWithBalance(periodo);
  const over = (extra) => ({ hash_transaccion: offlineHash(), comerciante_id: merchant.id, monto: liquidation.saldo + extra, metodo_pago: 'efectivo', periodo, fecha_cobro: horaDeCobro(extra) });
  const toAccept = over(10);
  const toVoid = over(20);
  const sync = await api('/cobros/sincronizar-lote', { method: 'POST', token: cobradorToken, body: { cobros: [toAccept, toVoid] } });
  assert.deepEqual(sync.body.data.resultados.map((item) => item.estado), ['observado', 'observado']);

  const pending = await api('/cobros/observados', { token: admin.token });
  assert.equal(pending.status, 200);
  const findFor = async (hash) => {
    const tx = await pool.query('SELECT id FROM transacciones WHERE hash_transaccion = $1', [hash]);
    return pending.body.data.find((item) => Number(item.transaccion_id) === Number(tx.rows[0].id));
  };
  const obsAccept = await findFor(toAccept.hash_transaccion);
  const obsVoid = await findFor(toVoid.hash_transaccion);
  assert.ok(obsAccept && obsVoid, 'ambos cobros aparecen en el panel');
  assert.match(obsAccept.motivo, /excede el saldo/);
  assert.equal(obsAccept.cobrador, (await findUserByEmail(pool, 'cobrador@salcedo.gob.pe')).nombre);

  // El listado de cobros los marca como observados.
  const cobros = await api('/cobros', { token: admin.token });
  assert.equal(cobros.body.data.find((item) => item.id === Number(obsAccept.transaccion_id)).estado, 'observado');

  // Solo el administrador decide, y debe explicar por qué.
  assert.equal((await api(`/cobros/observados/${obsAccept.id}/resolver`, { method: 'POST', token: cobradorToken, body: { decision: 'aceptado', resolucion: 'Adelanto' } })).status, 403);
  assert.equal((await api(`/cobros/observados/${obsAccept.id}/resolver`, { method: 'POST', token: admin.token, body: { decision: 'aceptado', resolucion: '' } })).status, 400);

  const accepted = await api(`/cobros/observados/${obsAccept.id}/resolver`, { method: 'POST', token: admin.token, body: { decision: 'aceptado', resolucion: 'Adelanto del mes siguiente' } });
  assert.equal(accepted.status, 200, accepted.body?.message);
  const voided = await api(`/cobros/observados/${obsVoid.id}/resolver`, { method: 'POST', token: admin.token, body: { decision: 'anulado', resolucion: 'Cobro repetido por error, se devuelve' } });
  assert.equal(voided.status, 200, voided.body?.message);

  const twice = await api(`/cobros/observados/${obsVoid.id}/resolver`, { method: 'POST', token: admin.token, body: { decision: 'aceptado', resolucion: 'Otra vez' } });
  assert.equal(twice.status, 409, 'una revisión no se puede repetir (conflicto)');

  const states = await pool.query('SELECT hash_transaccion, estado FROM transacciones WHERE hash_transaccion = ANY($1)', [[toAccept.hash_transaccion, toVoid.hash_transaccion]]);
  const byHash = Object.fromEntries(states.rows.map((row) => [row.hash_transaccion, row.estado]));
  assert.equal(byHash[toAccept.hash_transaccion], 'confirmado');
  assert.equal(byHash[toVoid.hash_transaccion], 'anulado');

  const audit = await getAuditTrail(pool, { entidad: 'cobros_observados' });
  const reviewed = audit.filter((item) => item.accion === 'REVISAR_COBRO_OBSERVADO');
  assert.ok(reviewed.some((item) => item.detalle.startsWith(`Cobro observado ${obsAccept.id} `) && item.detalle.includes('aceptado')));
  assert.ok(reviewed.some((item) => item.detalle.startsWith(`Cobro observado ${obsVoid.id} `) && item.detalle.includes('anulado')));
});

// ---------------------------------------------------------------------------
// Paquete de jornada
// ---------------------------------------------------------------------------

test('el paquete de jornada trae padrón con saldos y tarifas para buscar sin señal', async () => {
  const { token } = await cobradorLogin({ device_id: 'android-jornada' });
  const { status, body } = await api('/jornada/paquete', { token });
  assert.equal(status, 200, body?.message);
  const { data } = body;
  assert.match(data.periodo, /^\d{4}-\d{2}$/);
  assert.ok(data.comerciantes.length > 0);
  assert.ok(data.tarifas.length > 0);
  const sample = data.comerciantes[0];
  for (const key of ['id', 'codigo', 'dni_ruc', 'nombre', 'rubro', 'zona', 'saldo', 'monto_total']) {
    assert.ok(key in sample, `falta ${key}`);
  }
  assert.ok(data.comerciantes.every((item) => Number.isFinite(item.saldo) && item.saldo >= 0));

  assert.equal((await api('/jornada/paquete')).status, 401);
  const comerciante = await login('comerciante@salcedo.gob.pe', 'comercio123');
  assert.equal((await api('/jornada/paquete', { token: comerciante.token })).status, 403);
});
