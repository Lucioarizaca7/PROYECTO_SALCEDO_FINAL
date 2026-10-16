import { Link } from 'react-router-dom';
import { pathOf } from '../app/navegacion';
import { useSisrec } from '../app/SisrecContext';
import { DashboardSkeleton } from '../components/ui/DashboardSkeleton';
import { KpiCard } from '../components/ui/KpiCard';
import { formatPEN } from '../lib/formato';

export function PanelPage() {
  const { user, loading, dashboardStats, operational, mapPuestos, auditRecords, riskData } = useSisrec();
  if (loading) return <DashboardSkeleton />;

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">RESUMEN OPERATIVO | {new Date().toLocaleDateString('es-PE', { dateStyle: 'long' })}</div>
          <h1>Bienvenido, {user?.nombre?.split(' ')[0] || 'equipo'}</h1>
          <p>Este es el estado de la recaudación en Salcedo.</p>
        </div>
        <span className="date-chip">{new Date().toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'short' })}</span>
      </div>

      <div className="stats-grid">
        <KpiCard label="Recaudacion del periodo" value={dashboardStats.recaudacion} change="Acumulado del mes" icon="R" accent="green" />
        <KpiCard label="Pagos registrados" value={dashboardStats.pagos} change="Operaciones confirmadas" icon="P" accent="blue" />
        <KpiCard label="Puestos registrados" value={dashboardStats.sitios} change={`${dashboardStats.comerciantes} comerciantes activos`} icon="S" accent="amber" />
        <KpiCard label="Deuda pendiente" value={formatPEN(dashboardStats.pendientes)} change={`Morosidad ${dashboardStats.morosidad}`} icon="!" accent="red" />
      </div>

      <div className="dashboard-grid">
        <div className="panel">
          <div className="panel-heading">
            <div>
              <div className="panel-title">Recaudacion por rubro</div>
              <div className="panel-subtitle">Importes acumulados en el periodo actual</div>
            </div>
            <select className="select-small"><option>Esta semana</option></select>
          </div>
          <div className="activity-list">
            {operational.porRubro.length ? operational.porRubro.map((row) => (
              <div className="metric-line" key={row.rubro}><span>{row.rubro}</span><strong>{formatPEN(row.recaudado)}</strong></div>
            )) : <div className="empty-state">Sin recaudacion registrada en este periodo.</div>}
          </div>
        </div>

        <div className="panel">
          <div className="panel-heading">
            <div>
              <div className="panel-title">Mapa de sitios</div>
              <div className="panel-subtitle">Distribución por estado de pago</div>
            </div>
            <Link className="view-all" to={pathOf('mapa')}>Ver mapa →</Link>
          </div>
          <div className="activity-list dashboard-site-stats">
            <div className="metric-line"><span>Puestos registrados</span><strong>{mapPuestos.length}</strong></div>
            <div className="metric-line"><span>Ocupados</span><strong>{mapPuestos.filter((site) => site.estado !== 'disponible').length}</strong></div>
          </div>
        </div>
      </div>

      <div className="lower-grid">
        <div className="panel">
          <div className="panel-heading">
            <div>
              <div className="panel-title">Actividad reciente</div>
              <div className="panel-subtitle">Últimos movimientos registrados</div>
            </div>
            <Link className="view-all" to={pathOf('auditoria')}>Ver todo →</Link>
          </div>
          <div className="activity-list">
            {auditRecords.slice(0, 5).map((item) => (
              <div className="activity-item" key={item.id}>
                <span className="activity-bullet"></span>
                <div><strong>{item.accion} · {item.entidad}</strong><small>{item.usuario || `Usuario ${item.usuario_id}`} · {new Date(item.fecha).toLocaleString('es-PE')}</small></div>
              </div>
            ))}
            {!auditRecords.length && <div className="empty-state">Todavia no hay actividad de auditoria para mostrar.</div>}
          </div>
        </div>

        <div className="panel">
          <div className="panel-heading">
            <div>
              <div className="panel-title">Alertas importantes</div>
              <div className="panel-subtitle">Requieren atención del equipo</div>
            </div>
            <span className="status pending">{riskData.records?.length || 0} alertas</span>
          </div>
          <div className="alerts-list">
            {(riskData.records || []).slice(0, 4).map((item) => (
              <div className="alert-item" key={item.comerciante_id}>{item.nombre} · Riesgo {item.nivel}: {item.motivo_principal}</div>
            ))}
            {!riskData.records?.length && <div className="empty-state">No hay alertas de morosidad calculadas.</div>}
          </div>
        </div>
      </div>

      <div className="dashboard-grid">
        {[['Deuda y cobros por zona', operational.porZona, 'zona'], ['Pagos por rubro', operational.porRubro, 'rubro']].map(([title, rows, label]) => (
          <div className="panel" key={title}>
            <div className="panel-heading"><div><div className="panel-title">{title}</div><div className="panel-subtitle">Periodo operativo actual</div></div></div>
            <div className="activity-list">{rows.length ? rows.map((row) => <div className="metric-line" key={row[label]}><span>{row[label]}</span><strong>S/ {Number(row.recaudado || 0).toFixed(2)}</strong></div>) : <div className="empty-state">Aún no hay movimientos registrados.</div>}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
