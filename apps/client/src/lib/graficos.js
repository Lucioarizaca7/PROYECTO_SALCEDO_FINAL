// Cálculos de los gráficos del panel (24/11/2026). Sin librerías: el panel dibuja SVG y barras con CSS.
import { mapPaymentStatus } from '../components/features/map/sitesGeo.js';

/**
 * Marcas redondas del eje de valores, de 0 a un tope que cubre el máximo: 0 / 20 / 40 / 60. Con máximo 0 da
 * [0, 1] para que la escala no divida por cero.
 */
export function marcasEje(maximo, cantidad = 4) {
  const max = Number(maximo) || 0;
  if (max <= 0) return [0, 1];
  const bruto = max / cantidad;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const paso = [1, 2, 2.5, 5, 10].map((m) => m * potencia).find((p) => p >= bruto);
  const marcas = [];
  for (let v = 0; v < max + paso / 2; v += paso) marcas.push(Number(v.toFixed(2)));
  if (marcas[marcas.length - 1] < max) marcas.push(Number((marcas[marcas.length - 1] + paso).toFixed(2)));
  return marcas;
}

/** Todos los días del periodo AAAA-MM, con lo recaudado (0 los días sin cobros). */
export function diasDelPeriodo(periodo, porDia = []) {
  const [anio, mes] = String(periodo).split('-').map(Number);
  if (!anio || !mes) return [];
  const total = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const porFecha = new Map(porDia.map((fila) => [String(fila.dia).slice(0, 10), fila]));
  return Array.from({ length: total }, (_, i) => {
    const dia = `${periodo}-${String(i + 1).padStart(2, '0')}`;
    const fila = porFecha.get(dia);
    return { dia, numero: i + 1, valor: Number(fila?.recaudado || 0), pagos: Number(fila?.pagos || 0) };
  });
}

// Orden fijo de la barra de puestos. Los colores son los del mapa y su leyenda; en este orden los vecinos se
// distinguen también con daltonismo (validado: ΔE CVD ≥ 9.5). El gris de «No devenga» es el estado neutro.
export const ORDEN_ESTADOS_PUESTO = ['al-dia', 'libre', 'sin-tarifa', 'no-devengo', 'deuda'];

/** Cuántos puestos hay en cada estado de pago, con el mismo criterio que el mapa (mapPaymentStatus). */
export function puestosPorEstado(puestos = []) {
  const cuenta = Object.fromEntries(ORDEN_ESTADOS_PUESTO.map((clave) => [clave, 0]));
  for (const puesto of puestos) {
    if (puesto.estado === 'inactivo') continue;
    const clave = mapPaymentStatus(puesto);
    if (clave in cuenta) cuenta[clave] += 1;
  }
  return ORDEN_ESTADOS_PUESTO.map((clave) => ({ clave, valor: cuenta[clave] }));
}

// ---------------------------------------------------------------------------
// Analítica (24/11/2026): meses cobrados y proyectados, y reparto del riesgo de morosidad.

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** «nov 26» para el periodo 2026-11. */
export function mesCorto(periodo) {
  const [anio, mes] = String(periodo).split('-').map(Number);
  if (!anio || !mes) return String(periodo || '');
  return `${MESES_CORTOS[mes - 1]} ${String(anio).slice(2)}`;
}

function mesSiguiente(periodo) {
  const [anio, mes] = String(periodo).split('-').map(Number);
  return mes === 12 ? `${anio + 1}-01` : `${anio}-${String(mes + 1).padStart(2, '0')}`;
}

/**
 * Meses para el gráfico de la proyección: los cobrados (serie) y, a continuación, los proyectados. La serie
 * termina el mes anterior al periodo, así que el primer mes proyectado es el periodo en curso. Cada mes
 * proyectado lleva su margen según el error del modelo (±MAPE %) y, el mes en curso, lo cobrado hasta hoy.
 */
export function mesesDeProyeccion({ serie = [], proyeccion = [], periodo, mape = null, cobradoEnCurso = null }) {
  const cobrados = serie.map((fila) => ({ periodo: fila.periodo, etiqueta: mesCorto(fila.periodo), valor: Number(fila.monto || 0), tipo: 'cobrado' }));
  let siguiente = serie.length ? mesSiguiente(serie[serie.length - 1].periodo) : periodo;
  const margen = mape === null || mape === undefined ? null : Number(mape) / 100;
  const proyectados = proyeccion.map((valor, i) => {
    const mes = siguiente;
    siguiente = mesSiguiente(siguiente);
    const monto = Number(valor || 0);
    return {
      periodo: mes,
      etiqueta: mesCorto(mes),
      valor: monto,
      tipo: 'proyectado',
      minimo: margen === null ? null : Number(Math.max(monto * (1 - margen), 0).toFixed(2)),
      maximo: margen === null ? null : Number((monto * (1 + margen)).toFixed(2)),
      enCurso: i === 0 && mes === periodo && cobradoEnCurso !== null ? Number(cobradoEnCurso) : null
    };
  });
  return [...cobrados, ...proyectados];
}

// Niveles de riesgo de menor a mayor. Rampa de un solo tono, de claro a oscuro: es un orden, no categorías
// (validada como ordinal: luminosidad monótona, saltos visibles, el extremo claro se ve sobre el fondo).
export const NIVELES_RIESGO = [
  { clave: 'bajo', etiqueta: 'Bajo', color: '#eaa07f' },
  { clave: 'medio', etiqueta: 'Medio', color: '#d6683f' },
  { clave: 'alto', etiqueta: 'Alto', color: '#ad3a22' },
  { clave: 'critico', etiqueta: 'Crítico', color: '#6e1d0e' }
];

/** Segmentos de la barra apilada del riesgo a partir del resumen de /analitica/riesgo. */
export function riesgoPorNivel(summary = {}) {
  return NIVELES_RIESGO.map((nivel) => ({ ...nivel, valor: Number(summary?.[nivel.clave] || 0) }));
}
