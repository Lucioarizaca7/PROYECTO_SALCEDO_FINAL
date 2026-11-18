// Puestos del día al cobrar (RN-22) y zona del día obligatoria en un puesto sin zona confirmada (RN-05).
// Solo guía la pantalla: el servidor vuelve a validar los puestos, la zona y el monto (marcarDiaCobrado).

/**
 * Los puestos entre los que el cobrador elige cuáles abrieron hoy. Solo si el comerciante tiene dos o más y hoy
 * todavía no tiene marca: con marca, mandan las marcas de la asistencia.
 * puestosDelDia: { puestos: [{ id, codigo, zona_id, zona_por_confirmar }], marcado_hoy }.
 */
export function puestosParaElegir(puestosDelDia, cobraHoy) {
  if (!cobraHoy || !puestosDelDia || puestosDelDia.marcado_hoy) return [];
  const puestos = Array.isArray(puestosDelDia.puestos) ? puestosDelDia.puestos : [];
  return puestos.length >= 2 ? puestos : [];
}

/**
 * Tickets de hoy según los puestos elegidos. `base` ya cuenta el puesto principal (el primero), que es el que el
 * servidor sugiere cuando nadie marcó el día. Cada puesto elegido de más suma un ticket de la serie de su zona; si
 * el principal no abrió, se quita el suyo. Con zona del día, todos van a la serie de esa zona.
 */
export function requeridosConPuestos(base = [], { puestos = [], elegidos = [], serieDePuesto, serieZona = null } = {}) {
  if (!puestos.length) return base;
  const lista = base.map((item) => ({ ...item }));
  const sumar = (serie, delta) => {
    if (!serie) return;
    let item = lista.find((otro) => otro.serie === serie.serie);
    if (!item) { item = { serie: serie.serie, valor: Number(serie.valor), cantidad: 0 }; lista.push(item); }
    item.cantidad = Math.max(0, item.cantidad + delta);
  };
  const marcados = new Set(elegidos.map(Number));
  puestos.forEach((puesto, indice) => {
    const serie = serieZona || serieDePuesto(puesto);
    const elegido = marcados.has(Number(puesto.id));
    if (indice === 0) { if (!elegido) sumar(serie, -1); } else if (elegido) sumar(serie, 1);
  });
  return lista;
}

/** Sin tickets: lo que valen hoy los puestos elegidos (el precio de la zona del día o el de la zona de cada puesto). */
export function montoDePuestos({ puestos = [], elegidos = [], precioDePuesto, precioZona = null } = {}) {
  const marcados = new Set(elegidos.map(Number));
  let total = 0;
  for (const puesto of puestos) {
    if (!marcados.has(Number(puesto.id))) continue;
    const precio = precioZona ?? precioDePuesto(puesto);
    if (precio === null || precio === undefined) return null;
    total += Number(precio);
  }
  return Number(total.toFixed(2));
}

/**
 * Falta elegir la zona de hoy: alguno de los puestos que el cobro va a marcar no tiene zona confirmada (RN-05).
 * Sin selector de puestos, el cobro marca el principal. Con marca de hoy ya no hace falta: la zona está en la marca.
 */
export function faltaZonaDelDia(puestosDelDia, { elegidos = null, zonaDia = '', cobraHoy = true } = {}) {
  if (!cobraHoy || zonaDia || !puestosDelDia || puestosDelDia.marcado_hoy) return false;
  const puestos = Array.isArray(puestosDelDia.puestos) ? puestosDelDia.puestos : [];
  const marcados = elegidos ? new Set(elegidos.map(Number)) : null;
  const queMarca = marcados ? puestos.filter((puesto) => marcados.has(Number(puesto.id))) : puestos.slice(0, 1);
  return queMarca.some((puesto) => puesto.zona_por_confirmar);
}

/**
 * La liquidación en pantalla justo después de un cobro en línea, con la respuesta del servidor: el saldo que
 * queda y lo cobrado sumado a «Pagado» (y su estado). Luego se reemplaza por la del servidor (recargarSaldo).
 */
export function pagadoTrasCobro(balance, cobro) {
  const saldo = Number(cobro?.saldo_restante ?? balance.saldo ?? 0);
  const montoPagado = Number((Number(balance.monto_pagado || 0) + Number(cobro?.monto || 0)).toFixed(2));
  return { ...balance, saldo, monto_pagado: montoPagado, estado: saldo > 0 ? 'pendiente' : 'pagado' };
}
