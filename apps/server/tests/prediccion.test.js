/**
 * Proyección de recaudación (src/prediccion.js y generateForecastProjection). Las series y resultados
 * son los mismos de apps/analytics/test_modelo.py: el respaldo local da lo mismo que el microservicio.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { pronosticar, mape } from '../src/prediccion.js';
import { initializeDatabase, insertComerciante, insertPuesto, insertTarifa, registrarCobro, generateForecastProjection } from '../src/db.js';

const SERIE_CRECIENTE = [1200, 1260, 1310, 1290, 1380, 1420, 1460, 1500];

test('Holt con tendencia, SES con poca historia y promedio con muy poca (igual que Python)', () => {
  const holt = pronosticar(SERIE_CRECIENTE, 3);
  assert.equal(holt.modelo, 'holt');
  assert.deepEqual([holt.alpha, holt.beta, holt.mape], [0.4, 0.5, 1.28]);
  assert.deepEqual(holt.proyeccion_mensual, [1540.65, 1580.61, 1620.57]);
  assert.equal(holt.total, 4741.83);

  const ses = pronosticar([500, 520, 480, 510], 2);
  assert.deepEqual([ses.modelo, ses.alpha, ses.mape], ['ses', 0.1, 3.29]);
  assert.deepEqual(ses.proyeccion_mensual, [500.82, 500.82]);

  assert.equal(pronosticar([300, 330], 3).total, 945);
  assert.equal(pronosticar([300, 330], 3).mape, null);
  assert.equal(pronosticar([], 2).modelo, 'sin_datos');
  assert.equal(mape([100, 100, 100], [90, 80]), 15);
});

test('la proyección usa los cobros reales por mes y, sin el microservicio, el respaldo local', async () => {
  const db = await initializeDatabase();
  const nombre = `rubro proyección ${process.pid} ${Date.now()}`;
  const rubroId = (await db.query('INSERT INTO rubros (nombre) VALUES ($1) RETURNING id', [nombre])).rows[0].id;
  await insertTarifa(db, { rubro_id: rubroId, tipo_tarifa: 'fija', monto_fijo: 2000, unidad_medida: 'mensual', vigencia_inicio: '2020-01-01' });
  const comerciante = await insertComerciante(db, {
    dni_ruc: '20444000001', nombre: 'Comerciante Proyección', rubro_id: rubroId, zona_id: 1,
    tipo_comerciante: 'permanente', estado: 'activo', usuario_creador: 1
  });
  await insertPuesto(db, { zona_id: 1, metros_cuadrados: 1, direccion: 'Proyección P-1', comerciante_id: comerciante.id });

  // Ocho meses de 2027 (ene–ago) con la serie creciente; se proyecta desde septiembre.
  for (const [i, monto] of SERIE_CRECIENTE.entries()) {
    const periodo = `2027-${String(i + 1).padStart(2, '0')}`;
    await registrarCobro(db, { comerciante_id: comerciante.id, cobrador_id: 2, monto, metodo_pago: 'efectivo', periodo, fecha_cobro: `${periodo}-10T15:00:00Z` });
  }

  const forecast = await generateForecastProjection(db, { period: '2027-09', horizonteDias: 90 });
  assert.equal(forecast.modelo.fuente, 'respaldo_local', 'en las pruebas no hay ANALYTICS_URL');
  assert.equal(forecast.modelo.nombre, 'holt');
  assert.equal(forecast.modelo.mape, 1.28);
  assert.equal(forecast.modelo.meses_historia, 8, 'empieza en el primer mes con cobros');
  assert.equal(forecast.totalHistorico, SERIE_CRECIENTE.reduce((a, b) => a + b, 0));
  assert.equal(forecast.totalProyectado, 4741.83);
  assert.deepEqual(forecast.proyeccion_mensual, [1540.65, 1580.61, 1620.57]);
  assert.equal(forecast.porRubro.find((item) => item.rubro_id === Number(rubroId)).proyectado, 4741.83);

  const guardada = (await db.query(`SELECT version, metricas FROM modelos_ia_metricas WHERE periodo = '2027-09' ORDER BY id DESC LIMIT 1`)).rows[0];
  assert.equal(guardada.version, 'holt-v2');
  assert.equal(guardada.metricas.mape, 1.28);
});
