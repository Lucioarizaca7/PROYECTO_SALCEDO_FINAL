// Reglas de caja que el cliente necesita para guiar al cobrador. El servidor las vuelve a aplicar siempre
// (cerrarCaja y la restricción cierres_caja_diferencia_justificada de la migración 0034).

/** Desde este sobrante el cierre pide justificación (RN-42, decisión del 15/11/2026). */
export const SOBRANTE_SIN_JUSTIFICAR = 5;

/** Cualquier faltante se justifica; un sobrante, desde S/ 5. diferencia = declarado − esperado. */
export const pideJustificacion = (diferencia) => Number(diferencia) < 0 || Number(diferencia) >= SOBRANTE_SIN_JUSTIFICAR;

/**
 * Medios de pago que muestra la caja (RN-34, 17/11/2026: solo se cobra en efectivo). Yape, Plin y POS aparecen
 * solo si ese día tienen algún monto: cierres anteriores al cambio o un cobro sin señal que entró observado.
 * montos: listas de montos por medio, p. ej. [esperado.yape, declarado.yape].
 */
export const mediosDeCaja = (metodos, montosDe) => metodos.filter(({ key }) => key === 'efectivo' || montosDe(key).some((monto) => Number(monto) > 0));

/** Número de constancia de una entrega: E-000012. */
export const numeroConstancia = (entregaId) => `E-${String(entregaId).padStart(6, '0')}`;

/** Texto de la constancia de entrega (RN-41), para leer, imprimir o enviar. */
export function textoConstancia(cierre, entrega) {
  const tipo = entrega.tipo === 'complementaria' ? 'entrega complementaria (cobros posteriores al cierre)' : 'entrega del cierre';
  return `Constancia ${numeroConstancia(entrega.id)}: ${entrega.recibido_por} recibió de ${cierre.cobrador} S/ ${Number(entrega.monto).toFixed(2)} en efectivo, ` +
    `por la caja del ${cierre.fecha} (${tipo}). Registrado el ${entrega.recibido_en}.`;
}
