/**
 * Acceso al portal del comerciante, solo con la llave del carnet (decisión del 28/10/2026, como el Penpot P3;
 * el PIN de la 0007 se quitó en la 0017):
 *   - DNI o código + llave del carnet (XXXX-XXXX-XX);
 *   - la llave sola, desde el QR del reverso (leído con la cámara del celular o con el lector del portal).
 *
 * - La llave se guarda con su huella SHA-256 y se muestra una sola vez, al emitir el carnet.
 * - Tras 5 llaves erradas seguidas el acceso queda bloqueado 15 minutos (además del límite por IP).
 * - DNI desconocido, credencial errada o comerciante sin credencial responden el mismo 401.
 * - El portal devuelve lo justo: el documento oculto salvo sus 3 últimos dígitos y los últimos 24 pagos.
 * - No hay sesión guardada: cada consulta vuelve a pedir la credencial.
 */
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

import { config } from './config.js';
import { buscarComerciantePorCodigo, calcularLiquidacion, calcularDeudaAcumulada, esDocumentoTemporal } from './db.js';
import { withTransaction } from './pg.js';
import { tokenDescarga } from './reciboPdf.js';
import { AppError, NotFoundError, ValidationError } from './errors.js';

export const MAX_INTENTOS_PORTAL = 5;
export const BLOQUEO_PORTAL_MINUTOS = 15;
const PAGOS_EN_PORTAL = 24;

// Llave del carnet: sin 0/O, 1/I/L para que se lea bien impresa. 31^10 ≈ 8·10^14 combinaciones.
export const LLAVE_ALFABETO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const LLAVE_LARGO = 10;
// Tope de una emisión en lote: un padrón entero de una feria, sin dejar que una petición bloquee la base.
export const MAX_CARNETS_POR_LOTE = 500;

const CREDENCIALES_INVALIDAS = 'Los datos no coinciden. Revise su DNI o código y la llave de su carnet; si no tiene carnet, pídalo en la municipalidad.';

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

/**
 * Emite el carnet (una llave nueva) a uno o varios comerciantes, todo o nada. La llave nueva reemplaza
 * a la anterior, que deja de abrir el portal.
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
     RETURNING bloqueado_hasta > now() AS bloqueado`, [comercianteId, MAX_INTENTOS_PORTAL, BLOQUEO_PORTAL_MINUTOS]);
  return Boolean(row?.bloqueado);
}

const bloqueadoError = () => new AppError(`Demasiados intentos errados. Intente de nuevo en ${BLOQUEO_PORTAL_MINUTOS} minutos o pida un carnet nuevo en la municipalidad.`, 429);

/**
 * Comprueba la llave y devuelve los datos del portal. Acepta:
 *   { identifier, llave } DNI o código + llave del carnet
 *   { llave }             la llave sola (QR del reverso del carnet)
 */
export async function ingresarAlPortal(db, { identifier, llave } = {}) {
  const value = String(identifier || '').trim();
  const llaveValue = normalizarLlave(llave);
  if (!llaveValue) throw new ValidationError('Ingrese la llave de su carnet o escanee el QR del reverso');

  // Con la llave sola se busca al dueño por la huella; una llave inexistente no suma intentos a nadie
  // y solo la frena el límite por IP.
  const comercianteId = value
    ? await buscarComerciantePorCodigo(db, value)
    : (await db.query('SELECT comerciante_id FROM comerciante_portal_acceso WHERE llave_hash = $1', [huellaLlave(llaveValue)])).rows[0]?.comerciante_id;
  const { rows: [acceso] } = comercianteId ? await db.query(`
    SELECT a.llave_hash, a.bloqueado_hasta > now() AS bloqueado
    FROM comerciante_portal_acceso a JOIN comerciantes c ON c.id = a.comerciante_id
    WHERE a.comerciante_id = $1 AND c.estado <> 'inactivo'`, [comercianteId]) : { rows: [] };

  if (acceso?.bloqueado) throw bloqueadoError();
  const correcto = mismaHuella(huellaLlave(llaveValue), acceso?.llave_hash);
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
