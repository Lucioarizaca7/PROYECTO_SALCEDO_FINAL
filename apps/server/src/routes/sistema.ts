// Salud, panel, analítica, reportes y catálogos de solo lectura.
import express from 'express';
import { currentPeriod, getDbStats, getRubros, getZonas, getPuestos, getOperationalDashboard, getReportRows, buildReportCsv, generateForecastProjection, getRiskDashboard, indicadoresPanel } from '../db.js';
import { requireAuth } from '../auth.js';
import { staffOnly, roles } from '../http/comunes.js';
import { pool as db } from '../pg.js';
import { config } from '../config.js';

export const router = express.Router();

// Para el monitoreo (UptimeRobot) y el healthcheck de Docker: 503 si la base no responde.
// La analítica es opcional (la API proyecta sola si falta): se informa, pero no tumba la salud.
router.get('/api/v1/health', async (_req, res) => {
  let baseDeDatos = 'ok';
  try {
    await db.query('SELECT 1');
  } catch {
    baseDeDatos = 'sin_conexion';
  }
  let analitica = 'no_configurada';
  if (config.analyticsUrl) {
    try {
      const response = await fetch(`${config.analyticsUrl}/api/health`, { signal: AbortSignal.timeout(2000) });
      analitica = response.ok ? 'ok' : 'error';
    } catch {
      analitica = 'sin_conexion';
    }
  }
  const ok = baseDeDatos === 'ok';
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'error',
    message: ok ? 'SISREC Salcedo API funcionando' : 'La base de datos no responde',
    base_de_datos: baseDeDatos,
    analitica
  });
});


router.get('/api/v1/dashboard', ...staffOnly, async (req, res) => {
  const period = String(req.query.periodo || currentPeriod());
  const metrics = await getOperationalDashboard(db, { periodo: period });

  res.json({
    stats: {
      ...(await getDbStats(db)),
      ...indicadoresPanel(metrics)
    },
    operational: {
      porZona: metrics.porZona || [],
      porRubro: metrics.porRubro || [],
      porCobrador: metrics.porCobrador || []
    }
  });
});

// Transparencia para la página de inicio: solo cifras agregadas, sin nombres ni DNI.
// Se guarda 60 s en memoria porque calcular la deuda recorre todo el padrón.
let publicSummaryCache: { at: number; body: unknown } | null = null;

router.get('/api/v1/publico/resumen', async (_req, res) => {
  if (publicSummaryCache && Date.now() - publicSummaryCache.at < 60_000) {
    return res.json(publicSummaryCache.body);
  }
  const periodo = currentPeriod();
  const [metrics, puestos] = await Promise.all([getOperationalDashboard(db, { periodo }), getPuestos(db, { conPagos: false })]);
  const stats = indicadoresPanel(metrics);
  const body = {
    periodo,
    stats: {
      recaudacion: stats.recaudacion,
      pagos: stats.pagos,
      deudaPendiente: stats.deudaPendiente,
      morosidad: stats.morosidad,
      totalComerciantes: stats.totalComerciantes,
      sitios: puestos.length
    },
    operational: {
      porZona: (metrics.porZona || []).map(({ zona, comerciantes, recaudado }) => ({ zona, comerciantes, recaudado })),
      porRubro: (metrics.porRubro || []).map(({ rubro, recaudado, pagos }) => ({ rubro, recaudado, pagos })),
      porCobrador: []
    }
  };
  publicSummaryCache = { at: Date.now(), body };
  return res.json(body);
});

router.get('/api/v1/analitica/prediccion', ...staffOnly, async (req, res) => {
  const period = String(req.query.periodo || currentPeriod());
  const forecast = await generateForecastProjection(db, { period, horizonteDias: Number(req.query.horizonte_dias || req.query.horizon || 90) });
  return res.json({ data: forecast, message: 'Proyección de recaudación generada correctamente' });
});

router.get('/api/v1/analitica/riesgo', ...staffOnly, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 5), 1), 20);
  const data = await getRiskDashboard(db, { limit });
  return res.json({ data, message: 'Scoring de morosidad actualizado' });
});

router.get('/api/v1/roles', requireAuth, (_req, res) => {
  res.json({ roles });
});

router.get('/api/v1/catalogos', requireAuth, async (_req, res) => {
  res.json({
    rubros: await getRubros(db),
    zonas: await getZonas(db)
  });
});

router.get('/api/v1/reportes', ...staffOnly, async (req, res) => {
  const options = {
    periodo: req.query.periodo,
    zona_id: req.query.zona_id,
    rubro_id: req.query.rubro_id,
    cobrador_id: req.query.cobrador_id
  };
  const data = await getReportRows(db, options);
  const formato = String(req.query.formato || 'json').toLowerCase();

  if (formato === 'csv') {
    const csv = await buildReportCsv(db, options);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="reporte-cobros.csv"');
    return res.send(csv);
  }

  return res.json({ data, total: data.length, periodo: options.periodo || null });
});
