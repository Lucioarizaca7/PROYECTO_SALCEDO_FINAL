"""Microservicio de analítica de SISREC Salcedo (FastAPI). El modelo vive en modelo.py."""
from fastapi import FastAPI
from pydantic import BaseModel, Field

from modelo import pronosticar

app = FastAPI(title='SISREC Salcedo Analytics', version='0.2.0')


class ProyeccionInput(BaseModel):
    series: dict[str, list[float]] = Field(default_factory=dict)
    horizonte_meses: int = 3


@app.get('/api/health')
def health():
    return {'status': 'ok', 'service': 'sisrec-analytics'}


@app.post('/api/recaudacion/proyeccion')
def proyeccion(payload: ProyeccionInput):
    return {
        'resultados': {clave: pronosticar(serie, payload.horizonte_meses) for clave, serie in payload.series.items()},
        'fuente': 'analytics'
    }
