/**
 * Recibo PDF con QR de verificación y descarga solo del dueño desde el portal (src/reciboPdf.js).
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../src/index.ts';
import { closeDatabase, createUser, insertComerciante, insertPuesto, insertTarifa, registrarCobro, anularCobro } from '../src/db.js';
import { emitirCarnets } from '../src/portalAcceso.js';
import { tokenVerificacion, tokenDescarga, leerTokenDescarga, buscarRecibo, generarReciboPdf } from '../src/reciboPdf.js';
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

async function api(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const type = response.headers.get('content-type') || '';
  const buffer = Buffer.from(await response.arrayBuffer());
  return { status: response.status, type, buffer, body: type.includes('json') ? JSON.parse(buffer.toString('utf8')) : null };
}

let documento = 20555000000;

// Dos permanentes con deuda propia (rubro y tarifa nuevos), para no depender de la semilla.
async function dosComerciantesConSaldo() {
  const nombre = `rubro recibo ${process.pid} ${Date.now()} ${Math.random().toString(16).slice(2, 6)}`;
  const rubroId = (await pool.query('INSERT INTO rubros (nombre) VALUES ($1) RETURNING id', [nombre])).rows[0].id;
  await insertTarifa(pool, { rubro_id: rubroId, tipo_tarifa: 'fija', monto_fijo: 30, unidad_medida: 'mensual', vigencia_inicio: '2026-01-01' }, { permitirInicioPasado: true });
  const crear = async () => {
    const comerciante = await insertComerciante(pool, {
      dni_ruc: String(documento += 1), nombre: `Comerciante Señor Ñandú ${documento}`, rubro_id: rubroId, zona_id: 1,
      tipo_comerciante: 'permanente', estado: 'activo', usuario_creador: 1
    });
    await insertPuesto(pool, { zona_id: 1, metros_cuadrados: 1, direccion: `Recibo ${documento}`, comerciante_id: comerciante.id });
    return comerciante;
  };
  return [await crear(), await crear()];
}

const cobrar = (merchant, periodo, monto = 2) => registrarCobro(pool, {
  comerciante_id: merchant.id, cobrador_id: 2, monto, metodo_pago: 'efectivo', periodo, fecha_cobro: `${periodo}-15T15:00:00Z`
});

test('el personal baja el recibo en PDF y el QR verifica número, monto y estado', async () => {
  const periodo = '2031-06';
  const [merchant] = await dosComerciantesConSaldo();
  const cobro = await cobrar(merchant, periodo);

  const admin = (await api('/auth/login', { method: 'POST', body: { email: 'admin@salcedo.gob.pe', password: 'admin123', device_id: 'pc-recibo' } })).body.token;
  const pdf = await api(`/comprobantes/${cobro.comprobante}/pdf`, { token: admin });
  assert.equal(pdf.status, 200);
  assert.match(pdf.type, /application\/pdf/);
  assert.equal(pdf.buffer.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.ok(pdf.buffer.includes('WinAnsiEncoding'), 'fuente con tildes y ñ');
  assert.equal((await api(`/comprobantes/${cobro.comprobante}/pdf`)).status, 401, 'sin sesión no hay PDF');

  const token = tokenVerificacion(cobro.comprobante, cobro.monto);
  const verificado = await api(`/publico/verificar/${encodeURIComponent(token)}`);
  assert.equal(verificado.status, 200);
  assert.deepEqual(Object.keys(verificado.body.data).sort(), ['estado', 'fecha', 'monto', 'numero']);
  assert.equal(verificado.body.data.numero, cobro.comprobante);
  assert.equal(verificado.body.data.estado, 'confirmado');

  const alterado = `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`;
  assert.equal((await api(`/publico/verificar/${encodeURIComponent(alterado)}`)).status, 404);
  assert.equal((await api(`/publico/verificar/${encodeURIComponent(tokenVerificacion(cobro.comprobante, 999))}`)).status, 404, 'otro monto no verifica');

  await anularCobro(pool, cobro.id, { motivo: 'Prueba de recibo anulado', usuarioId: 1 });
  assert.equal((await api(`/publico/verificar/${encodeURIComponent(token)}`)).body.data.estado, 'anulado');
});

test('desde el portal el comerciante baja solo sus recibos, con un enlace que vence', async () => {
  const periodo = '2031-07';
  const [propio, ajeno] = await dosComerciantesConSaldo();
  await cobrar(propio, periodo);
  const cobroAjeno = await cobrar(ajeno, periodo);
  const [{ llave }] = await emitirCarnets(pool, [propio.id], 1);

  const portal = await api('/portal/login', { method: 'POST', body: { identifier: propio.dni_ruc, llave } });
  assert.equal(portal.status, 200, portal.body?.message);
  const pago = portal.body.data.pagos.find((item) => item.descarga);
  assert.ok(pago, 'cada pago trae su enlace de descarga');

  const descarga = await api(`/portal/recibos/${pago.descarga}/pdf`);
  assert.equal(descarga.status, 200);
  assert.match(descarga.type, /application\/pdf/);

  // Cambiar el id del enlace para pedir el recibo de otro comerciante no funciona.
  const [, vence, firma] = pago.descarga.split('.');
  assert.equal((await api(`/portal/recibos/${cobroAjeno.id}.${vence}.${firma}/pdf`)).status, 404);
  assert.equal(leerTokenDescarga(tokenDescarga(5, Date.now()), Date.now() + 31 * 60_000), null, 'vence a los 30 minutos');
  assert.equal(leerTokenDescarga(tokenDescarga(5)), 5);
});

test('el recibo trae los tickets entregados con el cobro', async () => {
  const [merchant] = await dosComerciantesConSaldo();
  const cobro = await cobrar(merchant, '2031-08');
  await pool.query(`UPDATE transacciones SET tickets = '[{"serie":"S3","numero":12}]'::jsonb WHERE id = $1`, [cobro.id]);
  const recibo = await buscarRecibo(pool, cobro.comprobante);
  assert.deepEqual(recibo.tickets, [{ serie: 'S3', numero: 12 }]);
  const pdf = await generarReciboPdf(recibo);
  assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
});

// Decisión del 13/11/2026: el ticket preimpreso es el comprobante físico y el portal guarda el recibo. Cada pago
// del portal dice qué tickets se entregaron, para que el comerciante empareje su papel con el recibo.
test('el portal muestra con cada pago los tickets preimpresos que se entregaron', async () => {
  const [merchant] = await dosComerciantesConSaldo();
  const conTicket = await cobrar(merchant, '2031-09');
  await pool.query(`UPDATE transacciones SET tickets = '[{"serie":"S3","numero":12},{"serie":"S2","numero":4}]'::jsonb WHERE id = $1`, [conTicket.id]);
  await cobrar(merchant, '2031-10');
  const [{ llave }] = await emitirCarnets(pool, [merchant.id], 1);

  const portal = await api('/portal/login', { method: 'POST', body: { identifier: merchant.dni_ruc, llave } });
  assert.equal(portal.status, 200, portal.body?.message);
  const pagos = portal.body.data.pagos;
  assert.equal(pagos.find((item) => item.id === conTicket.id).tickets, 'S3 N° 000012, S2 N° 000004');
  assert.equal(pagos.find((item) => item.id !== conTicket.id).tickets, '', 'sin tickets queda vacío');
});

// Ronda 19 (12/11/2026): el recibo oficial se vuelve a compartir, y cada cobrador solo ve los suyos.
const ingresar = async (email, password) => (await api('/auth/login', { method: 'POST', body: { email, password, device_id: `pc-${email}` } })).body.token;

test('el cobrador trae su recibo oficial para reenviarlo; el de otro cobrador no existe para él', async () => {
  const periodo = '2031-07';
  const [merchant] = await dosComerciantesConSaldo();
  const cobro = await cobrar(merchant, periodo);
  const dueno = await ingresar('cobrador@salcedo.gob.pe', 'cobro123');
  const clave = `clave-otro-${process.pid}`;
  const otroEmail = `otro-cobrador-${process.pid}-${Date.now()}@prueba.pe`;
  await createUser({ nombre: 'Otro cobrador', email: otroEmail, password: clave, rol: 'cobrador' });
  const otro = await ingresar(otroEmail, clave);
  const admin = await ingresar('admin@salcedo.gob.pe', 'admin123');

  const propio = await api(`/comprobantes/${cobro.comprobante}/recibo`, { token: dueno });
  assert.equal(propio.status, 200);
  assert.equal(propio.body.data.comprobante, cobro.comprobante);
  assert.equal(propio.body.data.fecha_cobro, `${periodo}-15T15:00:00Z`, 'la fecha del cobro, no la de ahora');
  const token = decodeURIComponent(propio.body.data.url_verificacion.split('/verificar/')[1]);
  assert.equal((await api(`/publico/verificar/${encodeURIComponent(token)}`)).body.data.numero, cobro.comprobante);
  assert.match(propio.body.data.qr_verificacion, /^data:image\/png;base64,/);

  for (const ruta of ['recibo', 'pdf']) {
    assert.equal((await api(`/comprobantes/${cobro.comprobante}/${ruta}`, { token: otro })).status, 404, `antes otro cobrador bajaba el ${ruta}`);
    assert.equal((await api(`/comprobantes/${cobro.comprobante}/${ruta}`, { token: admin })).status, 200);
  }

  await anularCobro(pool, cobro.id, { motivo: 'Prueba de recibo anulado', usuarioId: 1 });
  assert.equal((await api(`/comprobantes/${cobro.comprobante}/recibo`, { token: dueno })).body.data.estado, 'anulado');
});
