/**
 * Veredicto de recaudación: dice si el próximo mes se espera que suba, baje o se mantenga, por qué y qué
 * conviene hacer. Compara la proyección con el promedio de los últimos meses; no calcula otra proyección.
 * Habla de recaudación, no de ventas: el sistema solo conoce los pagos y la asistencia.
 * Las acciones son sugerencias: la decisión es de la oficina.
 */

// Decisión del usuario, 02/11/2026: más de +5 % sube, menos de −5 % baja.
export const UMBRAL_CAMBIO_PCT = 5;
// Con menos meses no hay tendencia que afirmar. También es el tamaño de la base de comparación.
export const MESES_BASE = 3;
// Decisión del usuario, 05/11/2026 (este umbral y el de concentración).
// Cuánto debe caer la asistencia o el cobro por día marcado de una zona para señalarlo como causa.
export const UMBRAL_CAUSA_PCT = 10;
// Parte de la caída total desde la que el problema se considera de una sola zona.
export const CONCENTRACION_UNA_ZONA = 0.6;
const MAX_ZONAS_CAUSA = 3;

const redondear = (valor, decimales = 1) => Number(valor.toFixed(decimales));
const promedio = (lista) => (lista.length ? lista.reduce((a, b) => a + b, 0) / lista.length : 0);
const variacionPct = (actual, anterior) => (anterior > 0 ? ((actual - anterior) / anterior) * 100 : null);

// El último mes frente al promedio de los anteriores (hasta MESES_BASE), para cada zona.
function compararZona({ zona, cobrado, dias = [] }) {
  const anterioresCobrado = cobrado.slice(0, -1).slice(-MESES_BASE);
  const anterioresDias = dias.slice(0, -1).slice(-MESES_BASE);
  const cobradoReciente = cobrado.at(-1) ?? 0;
  const cobradoAntes = promedio(anterioresCobrado);
  const diasReciente = dias.at(-1) ?? 0;
  const diasAntes = promedio(anterioresDias);
  const porDiaReciente = diasReciente > 0 ? cobradoReciente / diasReciente : null;
  const porDiaAntes = diasAntes > 0 ? cobradoAntes / diasAntes : null;
  return {
    zona,
    diferencia: cobradoReciente - cobradoAntes,
    cambioDias: variacionPct(diasReciente, diasAntes),
    cambioPorDia: porDiaReciente !== null && porDiaAntes !== null ? variacionPct(porDiaReciente, porDiaAntes) : null
  };
}

function explicarBaja(zonas) {
  const caidas = zonas.filter((item) => item.diferencia < 0).sort((a, b) => a.diferencia - b.diferencia);
  const caidaTotal = caidas.reduce((total, item) => total + item.diferencia, 0);
  const causas = [];
  const acciones = [];

  for (const item of caidas.slice(0, MAX_ZONAS_CAUSA)) {
    const monto = Math.abs(item.diferencia).toFixed(2);
    if (item.cambioDias !== null && item.cambioDias <= -UMBRAL_CAUSA_PCT) {
      const pct = Math.abs(redondear(item.cambioDias));
      causas.push({ tipo: 'baja_asistencia', zona: item.zona, detalle: `${item.zona}: la asistencia bajó ${pct} % y se cobraron S/ ${monto} menos.` });
      acciones.push({ tipo: 'baja_asistencia', zona: item.zona, texto: `Ir a ${item.zona} y averiguar por qué bajó la asistencia.` });
    } else if (item.cambioPorDia !== null && item.cambioPorDia <= -UMBRAL_CAUSA_PCT) {
      const pct = Math.abs(redondear(item.cambioPorDia));
      causas.push({ tipo: 'no_pagan', zona: item.zona, detalle: `${item.zona}: siguen asistiendo, pero se cobra ${pct} % menos por cada día marcado.` });
      acciones.push({ tipo: 'no_pagan', zona: item.zona, texto: `Reforzar la cobranza en ${item.zona}, empezando por quienes más deben.` });
    } else {
      causas.push({ tipo: 'sin_detalle', zona: item.zona, detalle: `${item.zona}: se cobraron S/ ${monto} menos, sin marcas de asistencia suficientes para saber el motivo.` });
    }
  }

  const principal = caidas[0];
  if (principal && caidas.length > 1 && principal.diferencia / caidaTotal >= CONCENTRACION_UNA_ZONA) {
    const parte = Math.round((principal.diferencia / caidaTotal) * 100);
    acciones.push({ tipo: 'una_zona', zona: principal.zona, texto: `Revisar al cobrador o la ruta de ${principal.zona}: concentra ${parte} % de la caída.` });
  }
  return { causas, acciones };
}

function explicarSubida(zonas) {
  const alzas = zonas.filter((item) => item.diferencia > 0).sort((a, b) => b.diferencia - a.diferencia).slice(0, MAX_ZONAS_CAUSA);
  return {
    causas: alzas.map((item) => ({ tipo: 'sube_zona', zona: item.zona, detalle: `${item.zona}: se cobraron S/ ${item.diferencia.toFixed(2)} más que el promedio anterior.` })),
    acciones: alzas.slice(0, 1).map((item) => ({ tipo: 'prever_recursos', zona: item.zona, texto: `Prever más tickets y cobradores para ${item.zona}.` }))
  };
}

/**
 * @param serie      montos mensuales cobrados, del más antiguo al más reciente, sin el mes en curso
 * @param proyectado monto proyectado para el próximo mes
 * @param mape       error del modelo en % (null si no se pudo medir)
 * @param zonas      [{ zona, cobrado: [por mes], dias: [días marcados por mes] }], alineados con serie
 */
export function veredictoRecaudacion({ serie = [], proyectado = 0, mape = null, zonas = [] } = {}) {
  const noConcluye = (motivo, extra = {}) => ({ estado: 'no_concluye', motivo, cambio_pct: null, base: null, proyectado: null, mape, causas: [], acciones: [], ...extra });

  if (serie.length < MESES_BASE) {
    const meses = serie.length === 1 ? '1 mes' : `${serie.length} meses`;
    return noConcluye(`Solo hay ${meses} con cobros y hacen falta al menos ${MESES_BASE} para ver una tendencia.`);
  }
  const base = redondear(promedio(serie.slice(-MESES_BASE)), 2);
  if (base <= 0) return noConcluye(`No hubo cobros en los últimos ${MESES_BASE} meses.`);

  const cambio = variacionPct(proyectado, base);
  const datos = { cambio_pct: redondear(cambio), base, proyectado: redondear(proyectado, 2) };
  if (mape === null || mape === undefined) return noConcluye('No se pudo medir el error del modelo con estos datos.', datos);

  // El error debe ser menor que lo que se quiere afirmar: que cambió, o que se mantuvo dentro del umbral.
  const referencia = Math.abs(cambio) > UMBRAL_CAMBIO_PCT ? Math.abs(cambio) : UMBRAL_CAMBIO_PCT;
  if (mape > referencia) {
    return noConcluye(`El modelo se equivoca en promedio ${mape} %, más que el cambio que se podría afirmar (${redondear(referencia)} %).`, datos);
  }

  if (Math.abs(cambio) <= UMBRAL_CAMBIO_PCT) {
    return { estado: 'estable', motivo: null, ...datos, mape, causas: [], acciones: [] };
  }

  const comparadas = zonas.filter((item) => item.cobrado?.length >= 2).map(compararZona);
  const explicacion = cambio > 0 ? explicarSubida(comparadas) : explicarBaja(comparadas);
  return { estado: cambio > 0 ? 'sube' : 'baja', motivo: null, ...datos, mape, ...explicacion };
}
