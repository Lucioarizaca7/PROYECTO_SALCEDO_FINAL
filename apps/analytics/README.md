# Microservicio analítico para SISREC Salcedo

Este módulo está desacoplado del backend principal para procesar tareas analíticas y de inteligencia artificial sin bloquear la API REST de cobranza y padrón.

## Objetivo

- Scoring de morosidad.
- Proyección de recaudación.
- Cálculos analíticos en segundo plano.

## Stack

- Python
- FastAPI
- Pydantic

## Ejecutar

```bash
cd apps/analytics
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app:app --reload --host 0.0.0.0 --port 8001
```

## Endpoints

- `GET /api/health`
- `POST /api/recaudacion/proyeccion`: `{ series: { total: [montos mensuales…], "zona:1": […] }, horizonte_meses: 3 }`.
  Responde, por serie, `{ modelo, alpha, beta, mape, n, proyeccion_mensual, total }`.

## Modelo (`modelo.py`)

| Historia | Modelo |
|---|---|
| Menos de 3 meses | promedio simple; sin MAPE |
| De 3 a 5 meses | suavizado exponencial simple |
| 6 meses o más | Holt (nivel y tendencia), si mide menos error |

- alpha y beta se eligen con una grilla minimizando el error *walk-forward*: cada mes se pronostica solo con los anteriores.
- El error se informa como MAPE (%).
- La API de Node (`apps/server/src/prediccion.js`) aplica el mismo algoritmo como respaldo si este servicio no responde. Ambos tienen las mismas pruebas con la misma serie.

## Pruebas

```bash
python -m unittest -v
```

Corren sin dependencias, porque `modelo.py` no usa FastAPI.
