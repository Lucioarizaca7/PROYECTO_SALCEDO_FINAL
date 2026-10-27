import { useEffect, useState } from 'react';
import { formatPEN } from '../lib/formato';
import { periodoEnLima } from '../services/jornadaOffline';
import { readMapSnapshot, saveMapSnapshot, syncPendingMapMutations } from '../services/mapaOffline';
import { apiBase, authFetch } from '../services/session';

const EMPTY_OPERATIONAL = { porZona: [], porRubro: [], porCobrador: [] };
const EMPTY_FORECAST = { totalProyectado: 0, promedioDiario: 0, porZona: [], porRubro: [] };
const EMPTY_RISK = { summary: { total: 0, bajo: 0, medio: 0, alto: 0, critico: 0 }, records: [] };

const toDashboardStats = (stats = {}, sitios) => ({
  recaudacion: formatPEN(stats.recaudacion ?? stats.totalRecaudado ?? 0),
  pagos: stats.pagos ?? stats.totalCobros ?? 0,
  sitios: String(sitios ?? stats.sitios ?? 0),
  pendientes: stats.deudaPendiente ?? 0,
  morosidad: `${stats.morosidad ?? 0}%`,
  comerciantes: stats.totalComerciantes ?? 0
});

// Datos del servidor que comparten varias páginas (panel, sitios, mapa, pagos, auditoría…).
// Se cargan juntos al iniciar sesión y se recargan con refresh() después de cada cambio.
export function useDatosSisrec({ user, onSessionExpired }) {
  const [apiConnected, setApiConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dashboardStats, setDashboardStats] = useState(() => toDashboardStats());
  const [operational, setOperational] = useState(EMPTY_OPERATIONAL);
  const [comerciantes, setComerciantes] = useState([]);
  const [tariffRecords, setTariffRecords] = useState([]);
  const [cobros, setCobros] = useState([]);
  const [mapPuestos, setMapPuestos] = useState([]);
  const [auditRecords, setAuditRecords] = useState([]);
  const [catalogos, setCatalogos] = useState({ rubros: [], zonas: [] });
  const [predictiveData, setPredictiveData] = useState(EMPTY_FORECAST);
  const [riskData, setRiskData] = useState(EMPTY_RISK);

  // Resumen público para la página principal: solo cifras agregadas, sin datos personales.
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(`${apiBase}/publico/resumen`, { signal: controller.signal });
        if (!response.ok) throw new Error('API no disponible');
        const dashboard = await response.json();
        setDashboardStats(toDashboardStats(dashboard.stats));
        setOperational(dashboard.operational || EMPTY_OPERATIONAL);
        setApiConnected(true);
      } catch {
        if (!controller.signal.aborted) setApiConnected(false);
      }
    })();
    return () => controller.abort();
  }, []);

  const refresh = async () => {
    try {
      const period = periodoEnLima();
      const request = async (path) => {
        const response = await authFetch(path);
        // Un módulo que el rol no puede ver queda vacío en vez de vaciar todo el panel.
        if (response.status === 403) return { data: [], total: 0 };
        if (response.status === 401) throw Object.assign(new Error('Tu sesión expiró. Ingresa de nuevo.'), { sessionExpired: true });
        const body = await response.json();
        if (!response.ok) throw new Error(body.message || `Error ${response.status}`);
        return body;
      };
      const canReadAudit = ['super_admin', 'auditor'].includes(user?.rol);
      const [dashboard, merchants, tarifas, catalogs, payments, puestos, audit, forecast, risk] = await Promise.all([
        request(`${apiBase}/dashboard?periodo=${encodeURIComponent(period)}`),
        request(`${apiBase}/comerciantes?limit=100&includeInactive=true`),
        request(`${apiBase}/tarifas`),
        request(`${apiBase}/catalogos`),
        request(`${apiBase}/cobros`),
        request(`${apiBase}/puestos`),
        canReadAudit ? request(`${apiBase}/auditoria`) : Promise.resolve({ data: [] }),
        request(`${apiBase}/analitica/prediccion?periodo=${encodeURIComponent(period)}&horizonte_dias=90`),
        request(`${apiBase}/analitica/riesgo?limit=5`)
      ]);

      setApiConnected(true);
      setDashboardStats(toDashboardStats(dashboard.stats, puestos.total ?? (puestos.data || []).length));
      setOperational(dashboard.operational || EMPTY_OPERATIONAL);
      // Filas del directorio: [id, nombre, rubro, dni_ruc, zona, estado, fecha, tipo, código, correlativo].
      setComerciantes((merchants.data || []).map((item) => [item.id, item.nombre, item.rubro, item.dni_ruc, item.zona, item.estado, new Date(item.fecha_registro).toLocaleDateString('es-PE'), item.tipo_comerciante || item.categoria, item.codigo, item.correlativo]));
      setTariffRecords(tarifas.data || []);
      setCobros(payments.data || []);
      setMapPuestos(puestos.data || []);
      setAuditRecords(audit.data || []);
      setCatalogos({ rubros: catalogs.rubros || [], zonas: catalogs.zonas || [] });
      setPredictiveData(forecast.data || EMPTY_FORECAST);
      setRiskData(risk.data || EMPTY_RISK);

      await saveMapSnapshot(puestos.data || []);
    } catch (err) {
      if (err.sessionExpired) {
        onSessionExpired(err.message);
        return;
      }
      console.error('No se pudo cargar la información del servidor SISREC.', err);
      setComerciantes([]);
      setTariffRecords([]);
      setCobros([]);
      setMapPuestos(await readMapSnapshot().catch(() => []));
      setAuditRecords([]);
      setOperational(EMPTY_OPERATIONAL);
      setCatalogos({ rubros: [], zonas: [] });
      setApiConnected(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return undefined;
    }
    refresh();
    // La cola de cobros offline se sincroniza sola (useOfflineQueue); aquí, los cambios del mapa.
    // Al abrir solo se recarga si se envió algo: antes cada página cargaba todos los datos dos veces.
    syncPendingMapMutations().then((enviados) => { if (enviados) refresh(); }).catch(() => undefined);
    // Al volver la señal se recarga siempre: los datos en pantalla pueden ser de antes del corte.
    const alVolverLaSenal = () => {
      syncPendingMapMutations().then(() => refresh()).catch(() => undefined);
    };
    window.addEventListener('online', alVolverLaSenal);
    return () => window.removeEventListener('online', alVolverLaSenal);
  }, [user]);

  return {
    apiConnected, loading, dashboardStats, operational, comerciantes, tariffRecords, cobros,
    mapPuestos, auditRecords, catalogos, predictiveData, riskData, refresh
  };
}
