/**
 * Cola de cobros hechos sin señal.
 *
 * Cada cobro pasa por tres estados:
 *   pendiente     → guardado en el celular, falta subirlo;
 *   sincronizado  → el servidor lo registró (también si ya lo tenía o si lo dejó "observado");
 *   error         → el servidor lo rechazó por sus datos, o falló 3 veces seguidas.
 *
 * La sincronización sube los pendientes en lotes (POST /cobros/sincronizar-lote) y nunca se detiene
 * por un cobro con problemas: ese cobro suma un intento y la cola sigue con el resto. Solo se detiene
 * si no hay conexión o si la sesión venció; en ese caso no se cuenta ningún intento.
 *
 * El módulo no conoce IndexedDB ni fetch: recibe un `store` ({ getAll, put, delete }) y una función
 * `enviarLote`, así se prueba en Node sin navegador.
 */

import { periodoEnLima } from './jornadaOffline.js';

export const MAX_INTENTOS = 3;
export const TAMANO_LOTE = 25;
export const ESTADO = Object.freeze({ PENDIENTE: 'pendiente', SINCRONIZADO: 'sincronizado', ERROR: 'error' });

const toHex = (buffer) => Array.from(new Uint8Array(buffer)).map((byte) => byte.toString(16).padStart(2, '0')).join('');

/**
 * Hash SHA-256 que identifica el cobro (idempotencia: el servidor no lo registra dos veces).
 * crypto.subtle solo existe en contexto seguro (HTTPS o localhost); si falta se usa un id aleatorio
 * largo, que también es único.
 */
export async function crearHashCobro({ cobradorId, comercianteId, monto, fechaCobro, salt }, cryptoImpl = globalThis.crypto) {
  const source = `${cobradorId}|${comercianteId}|${fechaCobro}|${monto}|${salt ?? ''}`;
  if (cryptoImpl?.subtle) {
    return toHex(await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(source)));
  }
  const random = () => Math.random().toString(16).slice(2).padEnd(13, '0');
  return `offline-${Date.now().toString(16)}-${random()}${random()}${random()}`.slice(0, 64);
}

/** Lo que viaja al servidor. El cobrador NO se envía: el servidor lo toma del token. */
export function aPayloadServidor(item) {
  return {
    hash_transaccion: item.hashTransaccion,
    comerciante_id: Number(item.comercianteId),
    monto: Number(item.monto),
    metodo_pago: item.metodoPago || 'efectivo',
    codigo_operacion: item.codigoOperacion || undefined,
    observaciones: item.observaciones || undefined,
    concepto: item.concepto || undefined,
    periodo: item.periodo,
    fecha_cobro: item.fechaCobro,
    inicio_atencion: item.inicioAtencion || undefined,
    // Tickets preimpresos entregados: el servidor valida que sean del lote del cobrador y que la suma cuadre.
    tickets: item.tickets?.length ? item.tickets.map(({ serie, numero }) => ({ serie, numero: Number(numero) })) : undefined
  };
}

const porFecha = (a, b) => String(a.fechaCobro).localeCompare(String(b.fechaCobro));

export function crearColaOffline({ store, enviarLote, ahora = () => new Date(), maxIntentos = MAX_INTENTOS, tamanoLote = TAMANO_LOTE }) {
  if (!store || !enviarLote) throw new Error('crearColaOffline necesita store y enviarLote');
  let enCurso = null;

  async function encolar(payload) {
    const fechaCobro = payload.fecha_cobro || payload.fechaCobro || ahora().toISOString();
    const cobradorId = payload.cobrador_id ?? payload.cobradorId;
    const comercianteId = payload.comerciante_id ?? payload.comercianteId;
    const monto = Number(payload.monto);
    if (!comercianteId || !Number.isFinite(monto) || monto <= 0) throw new Error('Cobro incompleto: comerciante y monto son obligatorios');

    const codigoOperacion = String(payload.codigo_operacion ?? payload.codigoOperacion ?? '').trim();
    // Si el cobro ya intentó subirse en línea con un hash, se conserva: así el servidor no lo duplica
    // cuando la primera petición sí llegó pero la respuesta se perdió.
    const hashTransaccion = payload.hash_transaccion || await crearHashCobro({
      cobradorId,
      comercianteId,
      monto,
      fechaCobro,
      salt: codigoOperacion || `${ahora().getTime()}-${Math.random()}`
    });
    const creadoEn = ahora().toISOString();
    const item = {
      hashTransaccion,
      estado: ESTADO.PENDIENTE,
      intentos: 0,
      ultimoError: null,
      cobradorId: cobradorId === undefined || cobradorId === null ? null : Number(cobradorId),
      comercianteId: Number(comercianteId),
      comerciante: payload.comerciante || null,
      monto,
      metodoPago: payload.metodo_pago || payload.metodoPago || 'efectivo',
      codigoOperacion: codigoOperacion || null,
      observaciones: String(payload.observaciones || '').trim() || null,
      concepto: payload.concepto || null,
      periodo: payload.periodo || periodoEnLima(new Date(fechaCobro)),
      fechaCobro,
      // Hora en que el cobrador abrió al comerciante: mide el tiempo de cada cobro (indicador de −50 %).
      inicioAtencion: payload.inicio_atencion || payload.inicioAtencion || null,
      tickets: Array.isArray(payload.tickets) && payload.tickets.length ? payload.tickets : null,
      creadoEn,
      actualizadoEn: creadoEn
    };
    await store.put(item);
    return item;
  }

  async function listar() {
    return (await store.getAll()).sort((a, b) => porFecha(b, a));
  }

  async function contar() {
    const counts = { pendiente: 0, sincronizado: 0, error: 0, observado: 0 };
    for (const item of await store.getAll()) {
      counts[item.estado] = (counts[item.estado] || 0) + 1;
      if (item.resultado === 'observado') counts.observado += 1;
    }
    return counts;
  }

  async function guardar(item, cambios) {
    const actualizado = { ...item, ...cambios, actualizadoEn: ahora().toISOString() };
    await store.put(actualizado);
    return actualizado;
  }

  // Un intento fallido (error temporal del servidor): a los 3 pasa a "error" y deja de reintentarse solo.
  async function registrarFallo(item, mensaje, resumen) {
    const intentos = Number(item.intentos || 0) + 1;
    const agotado = intentos >= maxIntentos;
    await guardar(item, { intentos, ultimoError: mensaje || 'Error al sincronizar', estado: agotado ? ESTADO.ERROR : ESTADO.PENDIENTE });
    if (agotado) resumen.errores += 1;
    else resumen.reintentar += 1;
  }

  async function procesar({ cobradorId = null } = {}) {
    const resumen = { enviados: 0, sincronizados: 0, observados: 0, duplicados: 0, errores: 0, reintentar: 0, detenido: null };
    const pendientes = (await store.getAll())
      .filter((item) => item.estado === ESTADO.PENDIENTE)
      // Cada cobrador sube solo lo que cobró él: el servidor lo registrará a nombre de quien inició sesión.
      .filter((item) => cobradorId === null || item.cobradorId === null || Number(item.cobradorId) === Number(cobradorId))
      .sort(porFecha);

    for (let start = 0; start < pendientes.length; start += tamanoLote) {
      const lote = pendientes.slice(start, start + tamanoLote);
      let respuesta;
      try {
        respuesta = await enviarLote(lote.map(aPayloadServidor));
      } catch (error) {
        if (error?.sinConexion || error?.sesionVencida) {
          resumen.detenido = error.sinConexion ? 'sin_conexion' : 'sesion_vencida';
          break;
        }
        // El servidor respondió pero falló con todo el lote: cuenta como un intento para cada cobro
        // y se sigue con el siguiente lote.
        for (const item of lote) await registrarFallo(item, error?.message, resumen);
        continue;
      }

      resumen.enviados += lote.length;
      const resultados = new Map((respuesta?.resultados || []).map((resultado) => [resultado.hash_transaccion, resultado]));
      for (const item of lote) {
        const resultado = resultados.get(item.hashTransaccion);
        if (!resultado) {
          await registrarFallo(item, 'El servidor no informó el resultado de este cobro', resumen);
        } else if (['sincronizado', 'duplicado', 'observado'].includes(resultado.estado)) {
          await guardar(item, {
            estado: ESTADO.SINCRONIZADO,
            resultado: resultado.estado,
            comprobante: resultado.comprobante || item.comprobante || null,
            mensaje: resultado.mensaje || null,
            ultimoError: null,
            sincronizadoEn: ahora().toISOString()
          });
          if (resultado.estado === 'observado') resumen.observados += 1;
          else if (resultado.estado === 'duplicado') resumen.duplicados += 1;
          else resumen.sincronizados += 1;
        } else if (resultado.estado === 'rechazado') {
          // Datos inválidos (p. ej. comerciante dado de baja): reintentar no lo arregla.
          await guardar(item, { estado: ESTADO.ERROR, rechazado: true, intentos: Number(item.intentos || 0) + 1, ultimoError: resultado.mensaje || 'Rechazado por el servidor' });
          resumen.errores += 1;
        } else {
          await registrarFallo(item, resultado.mensaje, resumen);
        }
      }
    }
    return resumen;
  }

  /** Sube los pendientes. Si ya hay una sincronización en curso, devuelve esa misma. */
  function sincronizar(opciones) {
    if (!enCurso) enCurso = procesar(opciones).finally(() => { enCurso = null; });
    return enCurso;
  }

  /** Devuelve un cobro en "error" a la cola, con los intentos en cero (botón "Reintentar"). */
  async function reintentar(hashTransaccion) {
    const item = (await store.getAll()).find((entry) => entry.hashTransaccion === hashTransaccion);
    if (!item) return null;
    return guardar(item, { estado: ESTADO.PENDIENTE, intentos: 0, ultimoError: null, rechazado: false });
  }

  /** Borra del celular los cobros ya sincronizados hace más de N días (nunca los pendientes ni los con error). */
  async function limpiarSincronizados({ dias = 7 } = {}) {
    const limite = ahora().getTime() - dias * 24 * 60 * 60 * 1000;
    let borrados = 0;
    for (const item of await store.getAll()) {
      if (item.estado === ESTADO.SINCRONIZADO && Date.parse(item.sincronizadoEn || item.actualizadoEn) < limite) {
        await store.delete(item.hashTransaccion);
        borrados += 1;
      }
    }
    return borrados;
  }

  return { encolar, listar, contar, sincronizar, reintentar, limpiarSincronizados };
}

/**
 * Transporte HTTP para la cola: POST /cobros/sincronizar-lote.
 * Distingue "sin conexión" y "sesión vencida" (la cola se detiene sin gastar intentos)
 * de un error del servidor (cuenta como intento).
 */
export function crearTransporteLote({ url, fetchImpl, deviceId }) {
  return async function enviarLote(cobros) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Device-Id': deviceId || '' },
        body: JSON.stringify({ device_id: deviceId, cobros })
      });
    } catch (error) {
      if (error?.sessionExpired) throw Object.assign(new Error(error.message), { sesionVencida: true });
      throw Object.assign(new Error('Sin conexión con el servidor'), { sinConexion: true, causa: error });
    }
    if (response.status === 401) throw Object.assign(new Error('La sesión venció'), { sesionVencida: true });
    // El proxy responde 502/503/504 cuando la API no está disponible: es como no tener señal.
    if ([502, 503, 504].includes(response.status)) {
      throw Object.assign(new Error('El servidor no está disponible'), { sinConexion: true });
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || `El servidor respondió ${response.status}`);
    return body.data;
  };
}
