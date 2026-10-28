/**
 * Recibo PDF con QR de verificación y descarga solo del dueño desde el portal (src/reciboPdf.js).
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../src/index.ts';
import { closeDatabase, insertComerciante, insertPuesto, insertTarifa, registrarCobro, anularCobro } from '../src/db.js';
import { emitirCarnets } from '../src/portalAcceso.js';
import { tokenVerificacion, tokenDescarga, leerTokenDescarga } from '../src/reciboPdf.js';
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
  await insertTarifa(pool, { rubro_id: rubroId, tipo_tarifa: 'fija', monto_fijo: 30, unidad_medida: 'mensual', vigencia_inicio: '2026-01-01' });
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
