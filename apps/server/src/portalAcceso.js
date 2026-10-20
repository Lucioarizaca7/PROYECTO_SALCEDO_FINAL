/**
 * Acceso al portal del comerciante: DNI o código + PIN de 6 dígitos (impreso en el carnet QR).
 *
 * - El PIN se guarda con bcrypt en comerciante_portal_acceso y se muestra una sola vez, al generarlo.
 * - Tras 5 PIN errados seguidos el acceso queda bloqueado 15 minutos (además del límite por IP).
 * - DNI desconocido, PIN errado o comerciante sin PIN responden el mismo 401: no se revela quién existe.
 * - El portal devuelve lo justo: el documento oculto salvo sus 3 últimos dígitos y los últimos 24 pagos.
 */
import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';

import { config } from './config.js';
import { buscarComerciantePorCodigo, calcularLiquidacion, calcularDeudaAcumulada } from './db.js';
import { tokenDescarga } from './reciboPdf.js';
import { AppError, NotFoundError, ValidationError } from './errors.js';

export const PIN_MAX_INTENTOS = 5;
export const PIN_BLOQUEO_MINUTOS = 15;
const PAGOS_EN_PORTAL = 24;

const CREDENCIALES_INVALIDAS = 'DNI o código y PIN no coinciden. Si no tiene PIN, pídalo en la municipalidad.';
// Se compara contra este hash cuando no hay comerciante o PIN, para que la respuesta tarde lo mismo.
const HASH_DE_RELLENO = bcrypt.hashSync('sin-pin-registrado', 10);

export const ocultarDocumento = (documento) => {
  const value = String(documento || '');
  return value.length <= 3 ? value : `${'*'.repeat(value.length - 3)}${value.slice(-3)}`;
};

// Evita PIN obvios (000000, 123456, 654321…) que alguien probaría primero.
function pinAleatorio() {
  for (;;) {
    const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const repetido = /^(\d)\1{5}$/.test(pin);
    const escalera = '0123456789'.includes(pin) || '9876543210'.includes(pin);
    if (!repetido && !escalera) return pin;
  }
}

/** Genera (o reemplaza) el PIN del comerciante. Devuelve el PIN en claro: es la única vez que se ve. */
export async function generarPinPortal(db, comercianteId, usuarioId = null) {
  const id = Number(comercianteId);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError('Comerciante no válido');
  const { rows: [merchant] } = await db.query('SELECT id, estado FROM comerciantes WHERE id = $1', [id]);
  if (!merchant) throw new NotFoundError('Comerciante no encontrado');
  if (merchant.estado === 'inactivo') throw new ValidationError('El comerciante está dado de baja: no puede tener acceso al portal');

  const pin = pinAleatorio();
  const pinHash = await bcrypt.hash(pin, 10);
  const { rows: [saved] } = await db.query(`
    INSERT INTO comerciante_portal_acceso (comerciante_id, pin_hash, creado_por)
    VALUES ($1, $2, $3)
    ON CONFLICT (comerciante_id) DO UPDATE
      SET pin_hash = EXCLUDED.pin_hash, creado_por = EXCLUDED.creado_por, creado_en = now(),
          intentos_fallidos = 0, bloqueado_hasta = NULL
    RETURNING comerciante_id, creado_en`, [id, pinHash, usuarioId ? Number(usuarioId) : null]);
  return { comerciante_id: Number(saved.comerciante_id), pin, creado_en: saved.creado_en };
}

async function registrarFallo(db, comercianteId) {
  // Al quinto fallo se bloquea y el contador vuelve a 0 para la siguiente ventana.
  const { rows: [row] } = await db.query(`
    UPDATE comerciante_portal_acceso
       SET bloqueado_hasta = CASE WHEN intentos_fallidos + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE bloqueado_hasta END,
           intentos_fallidos = CASE WHEN intentos_fallidos + 1 >= $2 THEN 0 ELSE intentos_fallidos + 1 END
     WHERE comerciante_id = $1
     RETURNING bloqueado_hasta > now() AS bloqueado`, [comercianteId, PIN_MAX_INTENTOS, PIN_BLOQUEO_MINUTOS]);
  return Boolean(row?.bloqueado);
}

const bloqueadoError = () => new AppError(`Demasiados intentos con PIN errado. Intente de nuevo en ${PIN_BLOQUEO_MINUTOS} minutos o pida un PIN nuevo en la municipalidad.`, 429);

/** Comprueba DNI/código + PIN y devuelve los datos del portal. */
export async function ingresarAlPortal(db, identifier, pin) {
  const value = String(identifier || '').trim();
  const pinValue = String(pin || '').trim();
  if (!value || !pinValue) throw new ValidationError('Ingrese su DNI o código de comerciante y su PIN');

  const comercianteId = await buscarComerciantePorCodigo(db, value);
  const { rows: [acceso] } = comercianteId ? await db.query(`
    SELECT a.pin_hash, a.bloqueado_hasta > now() AS bloqueado
    FROM comerciante_portal_acceso a JOIN comerciantes c ON c.id = a.comerciante_id
    WHERE a.comerciante_id = $1 AND c.estado <> 'inactivo'`, [comercianteId]) : { rows: [] };

  if (acceso?.bloqueado) throw bloqueadoError();
  const pinCorrecto = await bcrypt.compare(pinValue, acceso?.pin_hash || HASH_DE_RELLENO);
  if (!acceso || !pinCorrecto) {
    if (acceso && await registrarFallo(db, comercianteId)) throw bloqueadoError();
    throw new AppError(CREDENCIALES_INVALIDAS, 401);
  }

  await db.query(`
    UPDATE comerciante_portal_acceso SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_ingreso = now()
    WHERE comerciante_id = $1`, [comercianteId]);
  return obtenerDatosPortal(db, comercianteId);
}

async function obtenerDatosPortal(db, comercianteId) {
  const { rows: [merchant] } = await db.query(`
    SELECT c.codigo, c.dni_ruc, c.nombre, r.nombre AS rubro, z.nombre AS zona
    FROM comerciantes c JOIN rubros r ON r.id = c.rubro_id JOIN zonas z ON z.id = c.zona_id
    WHERE c.id = $1`, [comercianteId]);
  const { rows: pagos } = await db.query(`
    SELECT co.id, to_char(co.fecha_cobro_cliente AT TIME ZONE '${config.timeZone}', 'YYYY-MM-DD HH24:MI') AS fecha,
           co.concepto, co.monto, co.metodo_pago, co.estado, cp.numero_correlativo AS comprobante
    FROM transacciones co LEFT JOIN comprobantes cp ON cp.id = co.comprobante_id
    WHERE co.comerciante_id = $1 ORDER BY co.fecha_cobro_cliente DESC LIMIT $2`, [comercianteId, PAGOS_EN_PORTAL]);
  const liquidacion = await calcularLiquidacion(db, comercianteId);
  const acumulada = await calcularDeudaAcumulada(db, comercianteId);

  return {
    comerciante: {
      codigo: merchant.codigo,
      nombre: merchant.nombre,
      documento: ocultarDocumento(merchant.dni_ruc),
      rubro: merchant.rubro,
      zona: merchant.zona
    },
    // Cada recibo con su enlace de descarga firmado (30 minutos): solo el dueño lo recibe.
    pagos: pagos.map((pago) => ({ ...pago, descarga: pago.comprobante ? tokenDescarga(pago.id) : null })),
    deuda: {
      periodo: liquidacion.periodo,
      monto_total: Number(liquidacion.monto_total || 0),
      monto_pagado: Number(liquidacion.monto_pagado || 0),
      saldo: Number(liquidacion.saldo || 0),
      estado: liquidacion.estado,
      // Meses anteriores con saldo (desde el inicio de cobro) y total adeudado.
      meses_impagos: acumulada.periodos.filter((item) => item.saldo > 0).map(({ periodo, saldo }) => ({ periodo, saldo })),
      deuda_vencida: acumulada.deuda_vencida,
      deuda_total: acumulada.deuda_total
    }
  };
}
