/**
 * Acceso al portal del comerciante. Dos credenciales que conviven (decisión del 28/10/2026):
 *   - DNI o código + PIN de 6 dígitos (migración 0007);
 *   - DNI o código + llave del carnet (XXXX-XXXX-XX), o la llave sola desde el QR del reverso (0016).
 *
 * - El PIN se guarda con bcrypt y la llave con su huella SHA-256; las dos se muestran una sola vez.
 * - Tras 5 errores seguidos (PIN o llave) el acceso queda bloqueado 15 minutos (además del límite por IP).
 * - DNI desconocido, credencial errada o comerciante sin credencial responden el mismo 401.
 * - El portal devuelve lo justo: el documento oculto salvo sus 3 últimos dígitos y los últimos 24 pagos.
 * - No hay sesión guardada: cada consulta vuelve a pedir la credencial.
 */
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';

import { config } from './config.js';
import { buscarComerciantePorCodigo, calcularLiquidacion, calcularDeudaAcumulada, esDocumentoTemporal } from './db.js';
import { withTransaction } from './pg.js';
import { tokenDescarga } from './reciboPdf.js';
import { AppError, NotFoundError, ValidationError } from './errors.js';

export const PIN_MAX_INTENTOS = 5;
export const PIN_BLOQUEO_MINUTOS = 15;
const PAGOS_EN_PORTAL = 24;

// Llave del carnet: sin 0/O, 1/I/L para que se lea bien impresa. 31^10 ≈ 8·10^14 combinaciones.
export const LLAVE_ALFABETO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const LLAVE_LARGO = 10;
// Tope de una emisión en lote: un padrón entero de una feria, sin dejar que una petición bloquee la base.
export const MAX_CARNETS_POR_LOTE = 500;

const CREDENCIALES_INVALIDAS = 'Los datos no coinciden. Revise su DNI o código y el PIN o la llave de su carnet; si no los tiene, pídalos en la municipalidad.';
// Se compara contra este hash cuando no hay comerciante o PIN, para que la respuesta tarde lo mismo.
const HASH_DE_RELLENO = bcrypt.hashSync('sin-pin-registrado', 10);

export const ocultarDocumento = (documento) => {
  const value = String(documento || '');
  return value.length <= 3 ? value : `${'*'.repeat(value.length - 3)}${value.slice(-3)}`;
};

// Mayúsculas y sin guiones ni espacios: "h4tw-9kq2-mp" y "H4TW9KQ2MP" son la misma llave.
export const normalizarLlave = (llave) => String(llave || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
export const formatearLlave = (llave) => normalizarLlave(llave).replace(/^(.{4})(.{4})(.*)$/, '$1-$2-$3');
const huellaLlave = (llave) => createHash('sha256').update(normalizarLlave(llave)).digest('hex');
const mismaHuella = (a, b) => Boolean(a && b) && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function llaveAleatoria() {
  let llave = '';
  for (let i = 0; i < LLAVE_LARGO; i += 1) llave += LLAVE_ALFABETO[randomInt(LLAVE_ALFABETO.length)];
  return llave;
}

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

/**
 * Emite el carnet (una llave nueva) a uno o varios comerciantes, todo o nada. La llave nueva reemplaza
 * a la anterior, que deja de abrir el portal; el PIN, si lo tiene, sigue igual.
 * Devuelve las llaves en claro: es la única vez que se ven.
 */
export async function emitirCarnets(db, comercianteIds, usuarioId = null) {
  const ids = [...new Set((Array.isArray(comercianteIds) ? comercianteIds : [comercianteIds]).map(Number))];
  if (!ids.length || ids.some((id) => !Number.isInteger(id) || id <= 0)) throw new ValidationError('Elija al menos un comerciante válido');
  if (ids.length > MAX_CARNETS_POR_LOTE) throw new ValidationError(`Se pueden emitir hasta ${MAX_CARNETS_POR_LOTE} carnets a la vez`);

  const { rows: merchants } = await db.query(`
    SELECT c.id, c.codigo, c.nombre, c.estado, z.nombre AS zona,
           (SELECT string_agg(p.codigo_puesto, ', ' ORDER BY p.codigo_puesto) FROM puestos p
             WHERE p.comerciante_id = c.id AND p.estado <> 'inactivo') AS puestos
    FROM comerciantes c JOIN zonas z ON z.id = c.zona_id
    WHERE c.id = ANY($1::int[])`, [ids]);
  if (merchants.length !== ids.length) throw new NotFoundError('Algún comerciante no existe');
  const deBaja = merchants.filter((merchant) => merchant.estado === 'inactivo');
  if (deBaja.length) throw new ValidationError(`No se emite carnet a un comerciante dado de baja: ${deBaja.map((m) => m.nombre).join(', ')}`);

  const emitidos = merchants.map((merchant) => ({ merchant, llave: llaveAleatoria() }));
  await withTransaction(async (client) => {
    for (const { merchant, llave } of emitidos) {
      await client.query(`
        INSERT INTO comerciante_portal_acceso (comerciante_id, llave_hash, llave_emitida_en, llave_emitida_por)
        VALUES ($1, $2, now(), $3)
        ON CONFLICT (comerciante_id) DO UPDATE
          SET llave_hash = EXCLUDED.llave_hash, llave_emitida_en = now(), llave_emitida_por = EXCLUDED.llave_emitida_por,
              intentos_fallidos = 0, bloqueado_hasta = NULL`,
        [merchant.id, huellaLlave(llave), usuarioId ? Number(usuarioId) : null]);
    }
  });

  return emitidos.map(({ merchant, llave }) => ({
    comerciante_id: Number(merchant.id),
    codigo: merchant.codigo,
    nombre: merchant.nombre,
    zona: merchant.zona,
    puestos: merchant.puestos || '',
    llave: formatearLlave(llave)
  }));
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

const bloqueadoError = () => new AppError(`Demasiados intentos errados. Intente de nuevo en ${PIN_BLOQUEO_MINUTOS} minutos o pida un carnet o PIN nuevo en la municipalidad.`, 429);

/**
 * Comprueba la credencial y devuelve los datos del portal. Acepta:
 *   { identifier, pin }   DNI o código + PIN
 *   { identifier, llave } DNI o código + llave del carnet
 *   { llave }             la llave sola (QR del reverso del carnet)
 */
export async function ingresarAlPortal(db, { identifier, pin, llave } = {}) {
  const value = String(identifier || '').trim();
  const pinValue = String(pin || '').trim();
  const llaveValue = normalizarLlave(llave);
  if (!pinValue && !llaveValue) throw new ValidationError('Ingrese su DNI o código y el PIN o la llave de su carnet');
  if (pinValue && !value) throw new ValidationError('Ingrese su DNI o código de comerciante junto con su PIN');

  // Con la llave sola se busca al dueño por la huella; una llave inexistente no suma intentos a nadie
  // y solo la frena el límite por IP.
  const comercianteId = value
    ? await buscarComerciantePorCodigo(db, value)
    : (await db.query('SELECT comerciante_id FROM comerciante_portal_acceso WHERE llave_hash = $1', [huellaLlave(llaveValue)])).rows[0]?.comerciante_id;
  const { rows: [acceso] } = comercianteId ? await db.query(`
    SELECT a.pin_hash, a.llave_hash, a.bloqueado_hasta > now() AS bloqueado
    FROM comerciante_portal_acceso a JOIN comerciantes c ON c.id = a.comerciante_id
    WHERE a.comerciante_id = $1 AND c.estado <> 'inactivo'`, [comercianteId]) : { rows: [] };

  if (acceso?.bloqueado) throw bloqueadoError();
  const correcto = pinValue
    ? await bcrypt.compare(pinValue, acceso?.pin_hash || HASH_DE_RELLENO)
    : mismaHuella(huellaLlave(llaveValue), acceso?.llave_hash);
  if (!acceso || !correcto) {
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
      // El documento provisional (TEMP_DNI_…) de un pendiente de regularización no se muestra.
      documento: esDocumentoTemporal(merchant.dni_ruc) ? null : ocultarDocumento(merchant.dni_ruc),
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
