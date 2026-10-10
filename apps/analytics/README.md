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

- GET /api/health
- POST /api/risk/score
- POST /api/recaudacion/proyeccion
