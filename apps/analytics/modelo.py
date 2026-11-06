"""Modelo de proyección de recaudación de SISREC Salcedo (sin dependencias).

Proyección de recaudación con suavizado exponencial y su error medido (MAPE). La API de Node
(apps/server/src/prediccion.js) aplica exactamente el mismo algoritmo como respaldo si este
servicio no responde; las pruebas de ambos usan la misma serie y deben dar el mismo resultado.

  menos de 3 meses   promedio simple; sin MAPE.
  3 a 5 meses        suavizado exponencial simple (SES).
  6 meses o más      Holt (nivel + tendencia), si mide menos error que SES.

alpha y beta se eligen con una grilla minimizando el error "walk-forward": cada mes se pronostica
solo con los meses anteriores.
"""
GRILLA = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]


def redondear(valor: float, decimales: int = 2) -> float:
    # Igual que Number(x.toFixed(2)) en JavaScript para los montos que maneja el sistema.
    return float(f'{valor:.{decimales}f}')


def pasos_ses(serie, alpha):
    nivel = serie[0]
    predicciones = []
    for t in range(1, len(serie)):
        predicciones.append(nivel)
        nivel = alpha * serie[t] + (1 - alpha) * nivel
    return predicciones, nivel, 0.0


def pasos_holt(serie, alpha, beta):
    nivel = serie[0]
    tendencia = serie[1] - serie[0]
    predicciones = []
    for t in range(1, len(serie)):
        predicciones.append(nivel + tendencia)
        anterior = nivel
        nivel = alpha * serie[t] + (1 - alpha) * (nivel + tendencia)
        tendencia = beta * (nivel - anterior) + (1 - beta) * tendencia
    return predicciones, nivel, tendencia


def mape(serie, predicciones, desde=1):
    errores = [abs(serie[t] - predicciones[t - 1]) / serie[t]
               for t in range(max(desde, 1), len(serie)) if serie[t] > 0]
    return redondear(sum(errores) / len(errores) * 100) if errores else None


def _menor(a, b):
    return (a if a is not None else float('inf')) < (b if b is not None else float('inf'))


def pronosticar(serie, horizonte_meses=3):
    datos = [max(float(v or 0), 0.0) for v in (serie or [])]
    meses = max(1, round(float(horizonte_meses or 1)))
    n = len(datos)
    if n == 0:
        return {'modelo': 'sin_datos', 'alpha': None, 'beta': None, 'mape': None, 'n': 0,
                'proyeccion_mensual': [0] * meses, 'total': 0}
    if n < 3:
        promedio = sum(datos) / n
        return {'modelo': 'promedio', 'alpha': None, 'beta': None, 'mape': None, 'n': n,
                'proyeccion_mensual': [redondear(promedio)] * meses, 'total': redondear(promedio * meses)}

    mejor = None
    for alpha in GRILLA:
        predicciones, nivel, tendencia = pasos_ses(datos, alpha)
        error = mape(datos, predicciones, 2)
        if mejor is None or _menor(error, mejor['mape']):
            mejor = {'modelo': 'ses', 'alpha': alpha, 'beta': None, 'mape': error, 'nivel': nivel, 'tendencia': tendencia}
    if n >= 6:
        for alpha in GRILLA:
            for beta in GRILLA:
                predicciones, nivel, tendencia = pasos_holt(datos, alpha, beta)
                error = mape(datos, predicciones, 2)
                if _menor(error, mejor['mape']):
                    mejor = {'modelo': 'holt', 'alpha': alpha, 'beta': beta, 'mape': error, 'nivel': nivel, 'tendencia': tendencia}

    proyeccion = [redondear(max(mejor['nivel'] + h * mejor['tendencia'], 0)) for h in range(1, meses + 1)]
    return {'modelo': mejor['modelo'], 'alpha': mejor['alpha'], 'beta': mejor['beta'], 'mape': mejor['mape'],
            'n': n, 'proyeccion_mensual': proyeccion, 'total': redondear(sum(proyeccion))}
