// Envío de los cambios del mapa hechos sin señal (lógica pura: el almacén y el envío llegan como funciones,
// así se prueba sin IndexedDB ni servidor; ver tests/colaMapa.test.js).
//
// Un rechazo del servidor que reintentar no arregla (permiso, puesto que ya no existe, lugar ocupado…) no
// traba la cola: el cambio queda marcado "rechazado", con el mensaje del servidor, y se sigue con el resto.
// No se borra solo: el cobrador lo ve en el mapa y decide si lo reintenta o lo descarta, como los cobros
// rechazados (offlineQueue.js). Sin conexión, 401, 429 o un error del servidor se para y se reintenta luego.

// 400 datos inválidos, 403 sin permiso, 404 ya no existe, 409 choca con otro dato, 410 ya no vale, 422 regla.
const RECHAZO_PERMANENTE = new Set([400, 403, 404, 409, 410, 422]);

export const esRechazoPermanente = (status) => RECHAZO_PERMANENTE.has(Number(status));

/**
 * Sube en orden los cambios pendientes que no están rechazados.
 * - enviar(cambio) devuelve la respuesta del servidor (o lanza si no hay conexión);
 * - quitar(cambio) lo saca de la cola; marcarRechazado(cambio, mensaje, status) lo deja marcado.
 * Devuelve { enviados, rechazados, detenido }: detenido = quedó algo por reintentar más tarde.
 */
export async function subirCambiosMapa({ pendientes, enviar, quitar, marcarRechazado }) {
  const resumen = { enviados: 0, rechazados: 0, detenido: false };
  const cola = [...pendientes].filter((cambio) => !cambio.rechazado).sort((a, b) => Number(a.id) - Number(b.id));

  for (const cambio of cola) {
    let respuesta;
    try {
      respuesta = await enviar(cambio);
    } catch {
      resumen.detenido = true;
      break;
    }
    if (respuesta.ok) {
      await quitar(cambio);
      resumen.enviados += 1;
    } else if (esRechazoPermanente(respuesta.status)) {
      const cuerpo = await respuesta.json().catch(() => ({}));
      await marcarRechazado(cambio, cuerpo.message || 'El servidor rechazó este cambio', respuesta.status);
      resumen.rechazados += 1;
    } else {
      resumen.detenido = true;
      break;
    }
  }
  return resumen;
}

const QUE_CAMBIO = { create: 'Puesto nuevo', update: 'Cambio de puesto', delete: 'Baja de puesto' };

// Texto corto para el aviso del mapa: "Cambio de puesto 12" / "Puesto nuevo S-014".
export function describirCambioMapa(cambio) {
  const { operation, payload = {} } = cambio;
  const cual = operation === 'create' ? (payload.codigo_puesto || payload.codigoPuesto || payload.direccion || '') : payload.id;
  return `${QUE_CAMBIO[operation] || 'Cambio'}${cual ? ` ${cual}` : ''}`;
}
