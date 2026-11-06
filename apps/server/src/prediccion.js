/**
 * Proyección de recaudación con suavizado exponencial y su error medido (MAPE).
 *
 * Es el respaldo local del microservicio Python (apps/analytics/app.py), que aplica exactamente el mismo
 * algoritmo: si el servicio no responde, la API calcula aquí y lo indica con fuente 'respaldo_local'.
 *
 *   menos de 3 meses   promedio simple (no hay historia para más); sin MAPE.
 *   3 a 5 meses        suavizado exponencial simple (SES).
 *   6 meses o más      Holt (nivel + tendencia), si mide menos error que SES; si no, SES.
 *
 * alpha y beta se eligen probando una grilla y quedándose con los que dan menor error "walk-forward":
 * cada mes se pronostica solo con los meses anteriores, como pasaría en la realidad.
 */

const GRILLA = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
const redondear = (valor, decimales = 2) => Number(Number(valor).toFixed(decimales));

// Pronósticos a un paso: para cada t >= 1 devuelve la predicción de serie[t] hecha con serie[0..t-1].
function pasosSes(serie, alpha) {
  let nivel = serie[0];
  const predicciones = [];
  for (let t = 1; t < serie.length; t += 1) {
    predicciones.push(nivel);
    nivel = alpha * serie[t] + (1 - alpha) * nivel;
  }
  return { predicciones, nivel, tendencia: 0 };
}

function pasosHolt(serie, alpha, beta) {
  let nivel = serie[0];
  let tendencia = serie[1] - serie[0];
  const predicciones = [];
  for (let t = 1; t < serie.length; t += 1) {
    predicciones.push(nivel + tendencia);
    const anterior = nivel;
    nivel = alpha * serie[t] + (1 - alpha) * (nivel + tendencia);
    tendencia = beta * (nivel - anterior) + (1 - beta) * tendencia;
  }
  return { predicciones, nivel, tendencia };
}

/** MAPE (%) de las predicciones a un paso, desde el índice `desde` (los primeros meses solo calientan el modelo). */
export function mape(serie, predicciones, desde = 1) {
  const errores = [];
  for (let t = Math.max(desde, 1); t < serie.length; t += 1) {
    if (serie[t] > 0) errores.push(Math.abs(serie[t] - predicciones[t - 1]) / serie[t]);
  }
  return errores.length ? redondear((errores.reduce((a, b) => a + b, 0) / errores.length) * 100) : null;
}

/**
 * serie: montos mensuales (de más antiguo a más reciente, sin el mes en curso). horizonteMeses >= 1.
 * Devuelve { modelo, alpha, beta, mape, n, proyeccion_mensual, total }.
 */
export function pronosticar(serie, horizonteMeses = 3) {
  const datos = (serie || []).map((valor) => Math.max(Number(valor) || 0, 0));
  const meses = Math.max(1, Math.round(Number(horizonteMeses) || 1));
  const n = datos.length;
  if (n === 0) return { modelo: 'sin_datos', alpha: null, beta: null, mape: null, n, proyeccion_mensual: Array(meses).fill(0), total: 0 };
  if (n < 3) {
    const promedio = datos.reduce((a, b) => a + b, 0) / n;
    const proyeccion = Array(meses).fill(redondear(promedio));
    return { modelo: 'promedio', alpha: null, beta: null, mape: null, n, proyeccion_mensual: proyeccion, total: redondear(promedio * meses) };
  }

  // El error se mide desde el 2.º mes pronosticado (índice 2): el 1.º depende solo del valor inicial.
  let mejor = null;
  for (const alpha of GRILLA) {
    const pasos = pasosSes(datos, alpha);
    const error = mape(datos, pasos.predicciones, 2);
    if (!mejor || (error ?? Infinity) < (mejor.mape ?? Infinity)) mejor = { modelo: 'ses', alpha, beta: null, mape: error, ...pasos };
  }
  if (n >= 6) {
    for (const alpha of GRILLA) {
      for (const beta of GRILLA) {
        const pasos = pasosHolt(datos, alpha, beta);
        const error = mape(datos, pasos.predicciones, 2);
        if ((error ?? Infinity) < (mejor.mape ?? Infinity)) mejor = { modelo: 'holt', alpha, beta, mape: error, ...pasos };
      }
    }
  }

  const proyeccion = [];
  for (let h = 1; h <= meses; h += 1) proyeccion.push(redondear(Math.max(mejor.nivel + h * mejor.tendencia, 0)));
  return {
    modelo: mejor.modelo,
    alpha: mejor.alpha,
    beta: mejor.beta,
    mape: mejor.mape,
    n,
    proyeccion_mensual: proyeccion,
    total: redondear(proyeccion.reduce((a, b) => a + b, 0))
  };
}

/** Varias series a la vez ({ clave: [montos] }), como el endpoint del microservicio. */
export function pronosticarSeries(series, horizonteMeses) {
  return Object.fromEntries(Object.entries(series).map(([clave, serie]) => [clave, pronosticar(serie, horizonteMeses)]));
}
