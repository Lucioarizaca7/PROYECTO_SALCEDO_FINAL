/**
 * Cola de cobros offline (src/services/offlineQueue.js) con un almacén en memoria y un servidor simulado:
 * estados pendiente / sincronizado / error, 3 intentos, seguir con el resto y no gastar intentos sin señal.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { aPayloadServidor, crearColaOffline, crearHashCobro, crearTransporteLote, ESTADO, MAX_INTENTOS } from '../src/services/offlineQueue.js';

function memoryStore() {
  const data = new Map();
  return {
    data,
    getAll: async () => [...data.values()].map((item) => ({ ...item })),
    put: async (item) => { data.set(item.hashTransaccion, { ...item }); },
    delete: async (key) => { data.delete(key); }
  };
}

// Servidor simulado: decide el resultado de cada cobro según su comerciante.
function fakeServer(rules = {}) {
  const calls = [];
  const enviarLote = async (cobros) => {
    calls.push(cobros);
    if (rules.throwAll) throw rules.throwAll();
    return {
      resultados: cobros.map((cobro, index) => {
        const rule = rules[cobro.comerciante_id] || 'sincronizado';
        const estado = typeof rule === 'function' ? rule(cobro, calls.length) : rule;
        return { hash_transaccion: cobro.hash_transaccion, estado, mensaje: estado === 'sincronizado' ? 'ok' : `resultado ${estado}`, comprobante: ['sincronizado', 'observado'].includes(estado) ? `R-${String(index + 1).padStart(6, '0')}` : null };
      })
    };
  };
  return { calls, enviarLote };
}

let clock = Date.parse('2026-11-10T14:00:00Z');
const ahora = () => new Date(clock += 1000);

async function cobrar(cola, comercianteId, extra = {}) {
  return cola.encolar({ comerciante_id: comercianteId, cobrador_id: 7, monto: 2, metodo_pago: 'efectivo', periodo: '2026-11', ...extra });
}

test('un cobro nuevo queda pendiente con su hash de idempotencia', async () => {
  const store = memoryStore();
  const cola = crearColaOffline({ store, enviarLote: fakeServer().enviarLote, ahora });
  const item = await cobrar(cola, 1);
  assert.equal(item.estado, ESTADO.PENDIENTE);
  assert.equal(item.intentos, 0);
  assert.match(item.hashTransaccion, /^[0-9a-f]{64}$/);
  assert.deepEqual(await cola.contar(), { pendiente: 1, sincronizado: 0, error: 0, observado: 0 });
});

test('dos cobros iguales al mismo comerciante tienen hashes distintos (no se confunden con duplicados)', async () => {
  const cola = crearColaOffline({ store: memoryStore(), enviarLote: fakeServer().enviarLote, ahora });
  const a = await cobrar(cola, 1);
  const b = await cobrar(cola, 1);
  assert.notEqual(a.hashTransaccion, b.hashTransaccion);
});

test('el payload al servidor no incluye el cobrador (lo pone el token)', async () => {
  const cola = crearColaOffline({ store: memoryStore(), enviarLote: fakeServer().enviarLote, ahora });
  const payload = aPayloadServidor(await cobrar(cola, 3, { codigo_operacion: 'YP-1', metodo_pago: 'yape' }));
  assert.equal(payload.cobrador_id, undefined);
  assert.equal(payload.comerciante_id, 3);
  assert.equal(payload.codigo_operacion, 'YP-1');
  assert.ok(payload.hash_transaccion && payload.fecha_cobro);
});

test('el cobro sin señal conserva la hora en que se empezó a atender al comerciante', async () => {
  const cola = crearColaOffline({ store: memoryStore(), enviarLote: fakeServer().enviarLote, ahora });
  const item = await cobrar(cola, 3, { inicio_atencion: '2026-10-10T14:58:00.000Z' });
  assert.equal(aPayloadServidor(item).inicio_atencion, '2026-10-10T14:58:00.000Z');
  assert.equal(aPayloadServidor(await cobrar(cola, 4)).inicio_atencion, undefined);
});

test('un cobro rechazado no detiene la cola: los demás se sincronizan', async () => {
  const store = memoryStore();
  const server = fakeServer({ 2: 'rechazado', 3: 'observado', 4: 'duplicado' });
  const cola = crearColaOffline({ store, enviarLote: server.enviarLote, ahora });
  for (const id of [1, 2, 3, 4, 5]) await cobrar(cola, id);

  const resumen = await cola.sincronizar({ cobradorId: 7 });
  assert.equal(resumen.enviados, 5);
  assert.equal(resumen.sincronizados, 2);
  assert.equal(resumen.observados, 1);
  assert.equal(resumen.duplicados, 1);
  assert.equal(resumen.errores, 1);

  const byMerchant = Object.fromEntries((await cola.listar()).map((item) => [item.comercianteId, item]));
  assert.equal(byMerchant[1].estado, ESTADO.SINCRONIZADO);
  assert.equal(byMerchant[2].estado, ESTADO.ERROR, 'un rechazo por datos pasa a error sin reintentos inútiles');
  assert.match(byMerchant[2].ultimoError, /rechazado/);
  assert.equal(byMerchant[3].estado, ESTADO.SINCRONIZADO);
  assert.equal(byMerchant[3].resultado, 'observado');
  assert.equal(byMerchant[4].estado, ESTADO.SINCRONIZADO, 'si el servidor ya lo tenía, cuenta como sincronizado');
  assert.equal(byMerchant[5].estado, ESTADO.SINCRONIZADO);
  assert.deepEqual(await cola.contar(), { pendiente: 0, sincronizado: 4, error: 1, observado: 1 });
});

test(`un error temporal se reintenta y a los ${MAX_INTENTOS} intentos pasa a error, sin frenar a los demás`, async () => {
  const store = memoryStore();
  const server = fakeServer({ 2: 'error' });
  const cola = crearColaOffline({ store, enviarLote: server.enviarLote, ahora });
  await cobrar(cola, 1);
  await cobrar(cola, 2);

  for (let attempt = 1; attempt <= MAX_INTENTOS; attempt += 1) {
    const resumen = await cola.sincronizar({ cobradorId: 7 });
    const failing = (await cola.listar()).find((item) => item.comercianteId === 2);
    assert.equal(failing.intentos, attempt);
    assert.equal(failing.estado, attempt < MAX_INTENTOS ? ESTADO.PENDIENTE : ESTADO.ERROR);
    assert.equal(resumen.reintentar, attempt < MAX_INTENTOS ? 1 : 0);
  }
  assert.equal((await cola.listar()).find((item) => item.comercianteId === 1).estado, ESTADO.SINCRONIZADO);

  // En "error" ya no se reenvía solo.
  const callsBefore = server.calls.length;
  await cola.sincronizar({ cobradorId: 7 });
  assert.equal(server.calls.length, callsBefore, 'no hay pendientes que enviar');
});

test('si el servidor falla con todo un lote, cuenta un intento para cada cobro y sigue con el siguiente lote', async () => {
  const store = memoryStore();
  let call = 0;
  const enviarLote = async (cobros) => {
    call += 1;
    if (call === 1) throw new Error('El servidor respondió 500');
    return { resultados: cobros.map((cobro) => ({ hash_transaccion: cobro.hash_transaccion, estado: 'sincronizado' })) };
  };
  const cola = crearColaOffline({ store, enviarLote, ahora, tamanoLote: 2 });
  for (const id of [1, 2, 3, 4]) await cobrar(cola, id);

  const resumen = await cola.sincronizar({ cobradorId: 7 });
  assert.equal(call, 2, 'después del lote fallido se envía el siguiente');
  assert.equal(resumen.sincronizados, 2);
  assert.equal(resumen.reintentar, 2);
  const items = (await cola.listar()).sort((a, b) => a.comercianteId - b.comercianteId);
  assert.deepEqual(items.map((item) => [item.estado, item.intentos]), [['pendiente', 1], ['pendiente', 1], ['sincronizado', 0], ['sincronizado', 0]]);
});

test('sin conexión la cola se detiene sin gastar intentos', async () => {
  const store = memoryStore();
  const server = fakeServer({ throwAll: () => Object.assign(new Error('Sin conexión'), { sinConexion: true }) });
  const cola = crearColaOffline({ store, enviarLote: server.enviarLote, ahora, tamanoLote: 1 });
  await cobrar(cola, 1);
  await cobrar(cola, 2);

  for (let i = 0; i < 5; i += 1) {
    const resumen = await cola.sincronizar({ cobradorId: 7 });
    assert.equal(resumen.detenido, 'sin_conexion');
  }
  assert.equal(server.calls.length, 5, 'un intento de envío por sincronización, no uno por cobro');
  for (const item of await cola.listar()) {
    assert.equal(item.estado, ESTADO.PENDIENTE);
    assert.equal(item.intentos, 0);
  }
});

test('con la sesión vencida la cola se detiene y conserva los cobros', async () => {
  const cola = crearColaOffline({
    store: memoryStore(),
    enviarLote: async () => { throw Object.assign(new Error('La sesión venció'), { sesionVencida: true }); },
    ahora
  });
  await cobrar(cola, 1);
  const resumen = await cola.sincronizar({ cobradorId: 7 });
  assert.equal(resumen.detenido, 'sesion_vencida');
  assert.equal((await cola.listar())[0].estado, ESTADO.PENDIENTE);
});

test('cada cobrador sube solo sus propios cobros', async () => {
  const server = fakeServer();
  const cola = crearColaOffline({ store: memoryStore(), enviarLote: server.enviarLote, ahora });
  await cobrar(cola, 1, { cobrador_id: 7 });
  await cobrar(cola, 2, { cobrador_id: 8 });
  await cola.sincronizar({ cobradorId: 7 });
  assert.deepEqual(server.calls.flat().map((cobro) => cobro.comerciante_id), [1]);
  const pending = (await cola.listar()).filter((item) => item.estado === ESTADO.PENDIENTE);
  assert.deepEqual(pending.map((item) => item.cobradorId), [8]);
});

test('los cobros se envían en el orden en que se hicieron', async () => {
  const server = fakeServer();
  const cola = crearColaOffline({ store: memoryStore(), enviarLote: server.enviarLote, ahora });
  await cobrar(cola, 3, { fecha_cobro: '2026-11-10T15:00:00.000Z' });
  await cobrar(cola, 1, { fecha_cobro: '2026-11-10T13:00:00.000Z' });
  await cobrar(cola, 2, { fecha_cobro: '2026-11-10T14:00:00.000Z' });
  await cola.sincronizar({});
  assert.deepEqual(server.calls[0].map((cobro) => cobro.comerciante_id), [1, 2, 3]);
});

test('30 cobros en modo avión suben en lotes, sin duplicados, aunque se sincronice dos veces a la vez', async () => {
  const store = memoryStore();
  const received = new Map();
  const enviarLote = async (cobros) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return {
      resultados: cobros.map((cobro) => {
        const estado = received.has(cobro.hash_transaccion) ? 'duplicado' : 'sincronizado';
        received.set(cobro.hash_transaccion, cobro);
        return { hash_transaccion: cobro.hash_transaccion, estado };
      })
    };
  };
  const cola = crearColaOffline({ store, enviarLote, ahora, tamanoLote: 25 });
  for (let i = 1; i <= 30; i += 1) await cobrar(cola, i);

  const [first, second] = await Promise.all([cola.sincronizar({ cobradorId: 7 }), cola.sincronizar({ cobradorId: 7 })]);
  assert.equal(first, second, 'una sincronización en curso no se duplica');
  assert.equal(first.sincronizados, 30);
  assert.equal(first.duplicados, 0);
  assert.equal(received.size, 30);
  assert.deepEqual(await cola.contar(), { pendiente: 0, sincronizado: 30, error: 0, observado: 0 });
});

test('"Reintentar" devuelve un cobro con error a la cola con los intentos en cero', async () => {
  let fail = true;
  const enviarLote = async (cobros) => ({ resultados: cobros.map((cobro) => ({ hash_transaccion: cobro.hash_transaccion, estado: fail ? 'rechazado' : 'sincronizado' })) });
  const cola = crearColaOffline({ store: memoryStore(), enviarLote, ahora });
  const item = await cobrar(cola, 1);
  await cola.sincronizar({});
  assert.equal((await cola.listar())[0].estado, ESTADO.ERROR);

  const retried = await cola.reintentar(item.hashTransaccion);
  assert.equal(retried.estado, ESTADO.PENDIENTE);
  assert.equal(retried.intentos, 0);
  fail = false;
  await cola.sincronizar({});
  assert.equal((await cola.listar())[0].estado, ESTADO.SINCRONIZADO);
});

test('si el servidor no informa el resultado de un cobro, cuenta como intento fallido', async () => {
  const cola = crearColaOffline({ store: memoryStore(), enviarLote: async () => ({ resultados: [] }), ahora });
  await cobrar(cola, 1);
  await cola.sincronizar({});
  const [item] = await cola.listar();
  assert.equal(item.estado, ESTADO.PENDIENTE);
  assert.equal(item.intentos, 1);
});

test('la limpieza borra solo los sincronizados antiguos', async () => {
  const store = memoryStore();
  const cola = crearColaOffline({ store, enviarLote: fakeServer({ 2: 'rechazado' }).enviarLote, ahora });
  await cobrar(cola, 1);
  await cobrar(cola, 2);
  await cobrar(cola, 3);
  await cola.sincronizar({});
  await cobrar(cola, 4); // pendiente
  clock += 10 * 24 * 60 * 60 * 1000;
  assert.equal(await cola.limpiarSincronizados({ dias: 7 }), 2);
  assert.deepEqual((await cola.listar()).map((item) => item.estado).sort(), ['error', 'pendiente']);
});

test('se conserva el hash de un cobro que ya intentó subirse en línea', async () => {
  const cola = crearColaOffline({ store: memoryStore(), enviarLote: fakeServer().enviarLote, ahora });
  const hash = await crearHashCobro({ cobradorId: 7, comercianteId: 1, monto: 2, fechaCobro: '2026-11-10T14:00:00Z', salt: 'x' });
  const item = await cobrar(cola, 1, { hash_transaccion: hash });
  assert.equal(item.hashTransaccion, hash);
});

test('sin crypto.subtle (HTTP sin TLS) el hash igual es único', async () => {
  const a = await crearHashCobro({ cobradorId: 1, comercianteId: 1, monto: 1, fechaCobro: 'x' }, {});
  const b = await crearHashCobro({ cobradorId: 1, comercianteId: 1, monto: 1, fechaCobro: 'x' }, {});
  assert.notEqual(a, b);
  assert.ok(a.length >= 40);
});

test('el transporte distingue sin conexión, proxy caído, sesión vencida y error del servidor', async () => {
  const send = (fetchImpl) => crearTransporteLote({ url: 'https://api/x', fetchImpl, deviceId: 'cel-1' })([{ hash_transaccion: 'h' }]);
  const response = (status, body = {}) => ({ status, ok: status < 300, json: async () => body });

  await assert.rejects(send(async () => { throw new TypeError('Failed to fetch'); }), (error) => error.sinConexion === true);
  await assert.rejects(send(async () => response(502)), (error) => error.sinConexion === true);
  await assert.rejects(send(async () => response(401)), (error) => error.sesionVencida === true);
  await assert.rejects(send(async () => response(500, { message: 'falló' })), (error) => !error.sinConexion && /falló/.test(error.message));

  let sentBody;
  const ok = await send(async (_url, options) => { sentBody = JSON.parse(options.body); return response(200, { data: { resultados: [] } }); });
  assert.deepEqual(ok, { resultados: [] });
  assert.equal(sentBody.device_id, 'cel-1');
});

test('sin periodo, el cobro toma el mes de Lima de su fecha (no el de UTC)', async () => {
  const cola = crearColaOffline({ store: memoryStore(), enviarLote: fakeServer().enviarLote, ahora });
  const item = await cola.encolar({ comerciante_id: 5, cobrador_id: 7, monto: 2, fecha_cobro: '2026-11-01T00:30:00.000Z' });
  assert.equal(item.periodo, '2026-10');
  assert.equal(aPayloadServidor(item).periodo, '2026-10');
});
