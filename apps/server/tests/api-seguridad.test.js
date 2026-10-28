/**
 * Pruebas de la API levantada de verdad (puerto libre, esquema de prueba propio):
 * ninguna ruta GET queda abierta, el cobro toma el cobrador del token y se audita
 * en la misma transacción, y los periodos se cuentan con la hora de Lima.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { app, startServer } from '../src/index.ts';
import { loginUser } from '../src/auth.ts';
import { MAX_COBROS_LISTADO, calcularLiquidacion, celdaCsv, closeDatabase, currentPeriod, findUserByEmail, getAuditTrail, getComerciantes, getReportRows, getZonas, insertPuesto, registrarCobro } from '../src/db.js';
import { pool } from '../src/pg.js';

// Únicas rutas GET que se pueden consultar sin iniciar sesión.
// Públicas a propósito: la verificación del QR del recibo y la descarga con enlace firmado del portal
// (sin token de sesión, pero sin datos si la firma no corresponde).
const PUBLIC_GET = new Set(['/api/v1/health', '/api/v1/publico/resumen', '/api/v1/publico/verificar/:token', '/api/v1/portal/recibos/:token/pdf']);

let server;
let baseUrl;
const tokens = {};

before(async () => {
  server = await startServer(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  for (const [rol, email, password] of [
    ['cobrador', 'cobrador@salcedo.gob.pe', 'cobro123'],
    ['admin', 'admin@salcedo.gob.pe', 'admin123'],
    ['comerciante', 'comerciante@salcedo.gob.pe', 'comercio123']
  ]) {
    tokens[rol] = (await loginUser({ email, password }, pool)).token;
  }
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closeDatabase();
});

// Recorre también los routers montados (routes/*.ts): si no, sus rutas quedarían sin revisar.
function registeredGetRoutes(stack = app.router.stack) {
  return stack.flatMap((layer) => {
    if (layer.route) return layer.route.methods?.get && typeof layer.route.path === 'string' ? [layer.route.path] : [];
    return layer.handle?.stack ? registeredGetRoutes(layer.handle.stack) : [];
  });
}

const concrete = (path) => path.replace(/:[A-Za-z_]+/g, '1');

test('toda ruta GET de la API exige token, salvo las públicas declaradas', async () => {
  const routes = registeredGetRoutes();
  // 27 rutas GET al dividir index.ts en routers, más /cobros/tiempos, /asistencias, /parametros, /caja/resumen, /caja/cierres, /asistencias/observaciones y las dos
  // públicas del recibo (fase 3), /tickets/series, /tickets/lotes, /tickets/cobradores, /tickets/mios y
  // /comerciantes/plantilla-padron. Si cambia, revise que las nuevas pidan token.
  assert.equal(routes.length, 40, `cambió el número de rutas GET: ${routes.length}`);

  const open = [];
  for (const path of routes) {
    if (PUBLIC_GET.has(path)) continue;
    const response = await fetch(`${baseUrl}${concrete(path)}`);
    if (response.status !== 401) open.push(`${path} → ${response.status}`);
  }
  assert.deepEqual(open, [], `Rutas GET accesibles sin token:\n${open.join('\n')}`);
});

test('las rutas con datos personales rechazan al rol comerciante', async () => {
  for (const path of ['/api/v1/comerciantes', '/api/v1/cobros', '/api/v1/reportes', '/api/v1/dashboard']) {
    const response = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${tokens.comerciante}` } });
    assert.equal(response.status, 403, path);
  }
});

test('la plantilla y la importación del padrón son solo del administrador y el auditor', async () => {
  for (const rol of ['cobrador', 'comerciante']) {
    const headers = { Authorization: `Bearer ${tokens[rol]}` };
    assert.equal((await fetch(`${baseUrl}/api/v1/comerciantes/plantilla-padron`, { headers })).status, 403, rol);
    const importar = await fetch(`${baseUrl}/api/v1/comerciantes/importar-padron`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ previewToken: 'x' })
    });
    assert.equal(importar.status, 403, rol);
  }
  const plantilla = await fetch(`${baseUrl}/api/v1/comerciantes/plantilla-padron`, { headers: { Authorization: `Bearer ${tokens.admin}` } });
  assert.equal(plantilla.status, 200);
  assert.match(plantilla.headers.get('content-type'), /spreadsheetml/);
  const vencida = await fetch(`${baseUrl}/api/v1/comerciantes/importar-padron`, {
    method: 'POST', headers: { Authorization: `Bearer ${tokens.admin}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ previewToken: 'no-existe' })
  });
  assert.equal(vencida.status, 410, 'un token desconocido o vencido pide volver a subir el archivo');
});

test('solo el administrador asigna, reasigna y devuelve lotes de tickets', async () => {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.cobrador}` };
  for (const path of ['/api/v1/tickets/lotes', '/api/v1/tickets/lotes/1/reasignar', '/api/v1/tickets/lotes/1/devolver']) {
    const response = await fetch(`${baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify({ serie: 'S3', numero_desde: 1, numero_hasta: 2, cobrador_id: 1 }) });
    assert.equal(response.status, 403, path);
  }
  const lotes = await fetch(`${baseUrl}/api/v1/tickets/lotes`, { headers });
  assert.equal(lotes.status, 403, 'el cobrador no ve los lotes de los demás');
  const mios = await fetch(`${baseUrl}/api/v1/tickets/mios`, { headers });
  assert.equal(mios.status, 200, 'el cobrador ve sus propios tickets');
});

test('solo el administrador cambia la zona de un puesto; el cobrador lo mueve en el mapa', async () => {
  const [zonaA, zonaB] = await getZonas(pool);
  assert.ok(zonaB, 'la semilla trae al menos dos zonas');
  const puesto = await insertPuesto(pool, { zona_id: zonaA.id, direccion: `Puesto zona ${Date.now()}`, metros_cuadrados: 4 });
  await pool.query(`UPDATE puestos SET zona_por_regularizar = 'Barrio Alto' WHERE id = $1`, [puesto.id]);
  const put = (token, body) => fetch(`${baseUrl}/api/v1/puestos-mapa/${puesto.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body)
  });
  const leer = async () => (await pool.query('SELECT zona_id, zona_por_regularizar, latitud FROM puestos WHERE id = $1', [puesto.id])).rows[0];

  const cambio = await put(tokens.cobrador, { zona_id: zonaB.id });
  assert.equal(cambio.status, 403, 'la zona fija la tarifa: el cobrador no la cambia');
  assert.match((await cambio.json()).message, /super administrador/);
  assert.equal((await put(tokens.cobrador, { zona_id: zonaA.id, latitud: -15.88, longitud: -70.02 })).status, 200, 'reenviar la misma zona no es un cambio');
  assert.equal((await put(tokens.cobrador, { zona_por_regularizar: null })).status, 200);
  let fila = await leer();
  assert.equal(Number(fila.zona_id), Number(zonaA.id));
  assert.equal(fila.zona_por_regularizar, 'Barrio Alto', 'el cobrador no confirma la zona ni borra la marca del padrón');
  assert.equal(Number(fila.latitud), -15.88, 'sí mueve el puesto en el mapa');

  assert.equal((await put(tokens.admin, { zona_id: zonaB.id })).status, 200);
  fila = await leer();
  assert.equal(Number(fila.zona_id), Number(zonaB.id));
  assert.equal(fila.zona_por_regularizar, null, 'asignar la zona la regulariza');
});

test('el resumen público solo entrega cifras agregadas', async () => {
  const response = await fetch(`${baseUrl}/api/v1/publico/resumen`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(typeof body.stats.recaudacion, 'number');
  assert.deepEqual(body.operational.porCobrador, []);
  assert.doesNotMatch(JSON.stringify(body), /dni|dni_ruc|email|cobrador@/i);
});

test('una ruta inexistente de la API responde 404 en JSON', async () => {
  const response = await fetch(`${baseUrl}/api/v1/no-existe`, { headers: { Authorization: `Bearer ${tokens.admin}` } });
  assert.equal(response.status, 404);
  assert.ok((await response.json()).message);
});

test('POST /cobros usa el cobrador del token, rechaza "manual" y audita en la misma transacción', async () => {
  const cobrador = await findUserByEmail(pool, 'cobrador@salcedo.gob.pe');
  const admin = await findUserByEmail(pool, 'admin@salcedo.gob.pe');
  const [merchant] = await getComerciantes(pool, { search: 'Comerciante Demo', limit: 1 });
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.cobrador}` };

  const manual = await fetch(`${baseUrl}/api/v1/cobros`, {
    method: 'POST', headers, body: JSON.stringify({ comerciante_id: merchant.id, monto: 1, metodo_pago: 'manual' })
  });
  assert.equal(manual.status, 400);

  const response = await fetch(`${baseUrl}/api/v1/cobros`, {
    method: 'POST',
    headers,
    // El navegador intenta registrar el cobro a nombre del administrador.
    body: JSON.stringify({ comerciante_id: merchant.id, cobrador_id: admin.id, monto: 1, metodo_pago: 'efectivo' })
  });
  const body = await response.json();
  assert.equal(response.status, 201, body.message);
  assert.equal(body.data.cobrador_id, Number(cobrador.id));

  const audit = await getAuditTrail(pool, { entidad: 'cobros' });
  const entry = audit.find((item) => item.accion === 'REGISTRAR_COBRO' && item.detalle.includes(body.data.comprobante));
  assert.ok(entry, 'el cobro debe quedar en la auditoría');
  assert.equal(Number(entry.usuario_id), Number(cobrador.id));
});

test('POST /comerciantes registra como creador al usuario del token, no al que diga el navegador', async () => {
  const cobrador = await findUserByEmail(pool, 'cobrador@salcedo.gob.pe');
  const admin = await findUserByEmail(pool, 'admin@salcedo.gob.pe');
  const { rows: [{ rubro_id, zona_id }] } = await pool.query('SELECT (SELECT id FROM rubros ORDER BY id LIMIT 1) AS rubro_id, (SELECT id FROM zonas ORDER BY id LIMIT 1) AS zona_id');
  const dni = String(70000000 + (process.pid % 1_000_000) * 7 + (Date.now() % 7)).slice(0, 8);

  const response = await fetch(`${baseUrl}/api/v1/comerciantes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.admin}` },
    // El navegador intenta atribuir el alta al cobrador.
    body: JSON.stringify({ nombre: 'Alta Atribuida Prueba', dni_ruc: dni, rubro_id, zona_id, usuario_creador: cobrador.id })
  });
  const body = await response.json();
  assert.equal(response.status, 201, body.message);
  const { rows: [guardado] } = await pool.query('SELECT usuario_creador_id FROM comerciantes WHERE id = $1', [body.data.id]);
  assert.equal(Number(guardado.usuario_creador_id), Number(admin.id));
});

test('GET /cobros: el cobrador ve solo sus cobros; el administrador ve todos, con tope', async () => {
  const cobrador = await findUserByEmail(pool, 'cobrador@salcedo.gob.pe');
  const admin = await findUserByEmail(pool, 'admin@salcedo.gob.pe');
  // Un periodo futuro propio para no gastar el saldo que usan las demás pruebas.
  const periodo = '2032-02';
  let merchant;
  for (const item of await getComerciantes(pool, { limit: 100 })) {
    const liquidacion = await calcularLiquidacion(pool, item.id, periodo).catch(() => null);
    if (liquidacion && !liquidacion.no_devengo && !liquidacion.cobro_diario && liquidacion.saldo >= 2) { merchant = item; break; }
  }
  assert.ok(merchant, `la semilla no tiene un comerciante con saldo en ${periodo}`);
  const cobrar = (cobradorId) => registrarCobro(pool, {
    comerciante_id: merchant.id, cobrador_id: cobradorId, monto: 1, metodo_pago: 'efectivo', periodo, codigo_operacion: `LIST-${cobradorId}-${Date.now()}`
  });
  const delCobrador = await cobrar(cobrador.id);
  const delAdmin = await cobrar(admin.id);

  const listar = async (token, query = '') => (await (await fetch(`${baseUrl}/api/v1/cobros${query}`, { headers: { Authorization: `Bearer ${token}` } })).json()).data;
  const vistosPorCobrador = await listar(tokens.cobrador);
  assert.ok(vistosPorCobrador.length > 0);
  assert.ok(vistosPorCobrador.every((item) => Number(item.cobrador_id) === Number(cobrador.id)), 'solo los suyos');
  assert.ok(vistosPorCobrador.some((item) => item.id === delCobrador.id));
  assert.ok(!vistosPorCobrador.some((item) => item.id === delAdmin.id), 'no ve el cobro de otro');

  const vistosPorAdmin = await listar(tokens.admin);
  assert.ok(vistosPorAdmin.some((item) => item.id === delCobrador.id) && vistosPorAdmin.some((item) => item.id === delAdmin.id));
  assert.equal((await listar(tokens.admin, '?limit=1')).length, 1);
  assert.ok((await listar(tokens.admin, '?limit=999999')).length <= MAX_COBROS_LISTADO, 'el tope no se puede pasar');
});

test('el reporte CSV no deja fórmulas ejecutables (inyección CSV)', () => {
  assert.equal(celdaCsv('=HYPERLINK("http://x","ver")'), `"'=HYPERLINK(""http://x"",""ver"")"`);
  assert.equal(celdaCsv('+51 999'), "'+51 999");
  assert.equal(celdaCsv('-2+3'), "'-2+3");
  assert.equal(celdaCsv('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(celdaCsv('\tcmd'), "'\tcmd");
  assert.equal(celdaCsv('Mercado Central'), 'Mercado Central');
  assert.equal(celdaCsv('Pérez, Juan'), '"Pérez, Juan"');
  assert.equal(celdaCsv(-3), '-3', 'un número no se toca');
  assert.equal(celdaCsv('12.50'), '12.50');
  assert.equal(celdaCsv(null), '');
});

test('un cobro fallido no deja comprobante ni auditoría a medias', async () => {
  const cobrador = await findUserByEmail(pool, 'cobrador@salcedo.gob.pe');
  const [merchant] = await getComerciantes(pool, { search: 'Comerciante Demo', limit: 1 });
  const count = async (table) => Number((await pool.query(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n);
  const before = { comprobantes: await count('comprobantes'), auditoria: await count('auditoria_logs') };

  await assert.rejects(
    registrarCobro(pool, { comerciante_id: merchant.id, cobrador_id: cobrador.id, monto: 999999, metodo_pago: 'efectivo' },
      { audit: { accion: 'REGISTRAR_COBRO' } }),
    /excede el saldo/
  );
  assert.equal(await count('comprobantes'), before.comprobantes);
  assert.equal(await count('auditoria_logs'), before.auditoria);
});

test('un cobro de las 19:30 del 31 de octubre en Salcedo cuenta para octubre', async () => {
  // 2026-10-31 19:30 en Lima = 2026-11-01 00:30 UTC
  const fechaCobro = '2026-11-01T00:30:00.000Z';
  assert.equal(currentPeriod(new Date(fechaCobro)), '2026-10');

  const cobrador = await findUserByEmail(pool, 'cobrador@salcedo.gob.pe');
  const [merchant] = await getComerciantes(pool, { search: 'Comerciante Demo', limit: 1 });
  const cobro = await registrarCobro(pool, {
    comerciante_id: merchant.id, cobrador_id: cobrador.id, monto: 2, metodo_pago: 'efectivo',
    periodo: '2026-10', fecha_cobro: fechaCobro, codigo_operacion: `TZ-${Date.now()}`
  });

  const octubre = await getReportRows(pool, { periodo: '2026-10' });
  const noviembre = await getReportRows(pool, { periodo: '2026-11' });
  assert.ok(octubre.some((row) => row.id === cobro.id), 'debe aparecer en el reporte de octubre');
  assert.ok(!noviembre.some((row) => row.id === cobro.id), 'no debe aparecer en el reporte de noviembre');
  assert.equal(octubre.find((row) => row.id === cobro.id).fecha, '2026-10-31 19:30:00');
});
