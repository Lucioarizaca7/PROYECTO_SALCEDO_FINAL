from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title='SISREC Salcedo Analytics', version='0.1.0')


class RiskInput(BaseModel):
    comerciante_id: int | None = None
    zona_id: int | None = None
    rubro_id: int | None = None
    monto_total: float = 0.0
    pagos_ultimos_30d: int = 0
    morosidad_promedio: float = 0.0


@app.get('/api/health')
def health():
    return {
        'status': 'ok',
        'service': 'sisrec-analytics',
        'architecture': 'independent-python-microservice'
    }


@app.post('/api/risk/score')
def risk_score(payload: RiskInput):
    score = 0.15 * (1 if payload.morosidad_promedio > 0 else 0)
    score += min(payload.pagos_ultimos_30d / 30, 1.0) * 0.25
    score += min((payload.monto_total or 0) / 5000, 1.0) * 0.35
    score += (payload.zona_id is not None) * 0.1
    score += (payload.comerciante_id is not None) * 0.15
    score = round(max(0.0, min(score, 1.0)), 4)

    if score < 0.35:
        level = 'bajo'
    elif score < 0.7:
        level = 'medio'
    elif score < 0.9:
        level = 'alto'
    else:
        level = 'critico'

    return {
        'score': score,
        'nivel': level,
        'modelo': 'heuristic-risk-model',
        'source': 'analytics-microservice'
    }


@app.post('/api/recaudacion/proyeccion')
def revenue_projection(payload: RiskInput):
    base = max(payload.monto_total or 0, 0)
    projection = round(base * 1.12 + (payload.pagos_ultimos_30d * 2.25), 2)
    return {
        'proyeccion': projection,
        'periodo': 'mes',
        'metrica': 'recaudacion_estimada'
    }
