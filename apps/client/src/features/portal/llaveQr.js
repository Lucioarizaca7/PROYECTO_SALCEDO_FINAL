// Llave del carnet a partir de lo que trae el QR del reverso o el enlace "/portal#llave=XXXX-XXXX-XX".
// Mismo alfabeto y largo que el servidor (apps/server/src/portalAcceso.js: LLAVE_ALFABETO, LLAVE_LARGO).
const LLAVE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/;

const normalizar = (texto) => String(texto || '').toUpperCase().replace(/[^0-9A-Z]/g, '');

// Lo que va después del "#": el fragmento no viaja al servidor ni queda en sus registros.
export function llaveDelFragmento(hash) {
  return new URLSearchParams(String(hash || '').replace(/^#/, '')).get('llave') || '';
}

/**
 * Devuelve la llave formateada (XXXX-XXXX-XX) o '' si el QR no es el del reverso del carnet
 * (por ejemplo, el QR del frente "SISREC://comerciante/…", que es para el cobrador).
 */
export function llaveDesdeQr(texto) {
  const valor = String(texto || '').trim();
  const posicion = valor.indexOf('#');
  const candidata = normalizar(posicion >= 0 ? llaveDelFragmento(valor.slice(posicion)) : valor);
  return LLAVE_RE.test(candidata) ? candidata.replace(/^(.{4})(.{4})(.*)$/, '$1-$2-$3') : '';
}
