import { Link } from 'react-router-dom';
import { canSee, navItems, pathOf } from '../app/navegacion';
import { useSisrec } from '../app/SisrecContext';
import { DashboardSkeleton } from '../components/ui/DashboardSkeleton';
import { KpiCard } from '../components/ui/KpiCard';
import { BarraApilada, BarrasHorizontales, ColumnasPorDia } from '../components/ui/Graficos';
import { PAYMENT_COLORS, PAYMENT_LABELS } from '../components/features/map/sitesGeo';
import { diasDelPeriodo, puestosPorEstado } from '../lib/graficos';
import { fechaHoraEnLima, formatPEN, textoPuntajeRiesgo } from '../lib/formato';
import { periodoEnLima } from '../services/jornadaOffline';

const nombreDelMes = (periodo) => {
  const [anio, mes] = periodo.split('-').map(Number);
  return new Date(Date.UTC(anio, mes - 1, 15)).toLocaleDateString('es-PE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

export function PanelPage() {
  const { user, loading, dashboardStats, operational, mapPuestos, auditRecords, riskData } = useSisrec();
  if (loading) return <DashboardSkeleton />;
  const periodo = periodoEnLima();
  const dias = diasDelPeriodo(periodo, operational.porDia || []);
  const totalMes = dias.reduce((total, dia) => total + dia.valor, 0);
  const veAuditoria = canSee(navItems.find((item) => item.key === 'auditoria'), user?.rol);
  // El auditor no tiene el mapa: el enlace lo devolvía al panel.
  const veMapa = canSee(navItems.find((item) => item.key === 'mapa'), user?.rol);
  // Alerta = riesgo alto o crítico, el mismo criterio con que el servidor marca `alerta` en la métrica.
  const alertas = (riskData.records || []).filter((item) => ['alto', 'critico'].includes(item.nivel_riesgo));

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

      {/* Sin gráficos por rubro (decisión del usuario, 24/11/2026): el precio lo pone la zona, no el rubro. */}
      <div className="dashboard-grid">
        <div className="panel panel-ancho">
          <div className="panel-heading">
            <div>
              <div className="panel-title">Recaudación por día</div>
              <div className="panel-subtitle">Cobros confirmados de cada día de {nombreDelMes(periodo)}</div>
            </div>
            <span className="date-chip">{formatPEN(totalMes)} en el mes</span>
          </div>
          <ColumnasPorDia dias={dias} formato={formatPEN} titulo={`Recaudación por día de ${nombreDelMes(periodo)}`} />
        </div>

        <div className="panel">
          <div className="panel-heading">
            <div>
              <div className="panel-title">Cobros por zona</div>
              <div className="panel-subtitle">Lo recaudado en el mes en cada zona, con su precio de hoy</div>
            </div>
            {canSee(navItems.find((item) => item.key === 'zonas'), user?.rol) && <Link className="view-all" to={pathOf('zonas')}>Zonas y tarifas →</Link>}
          </div>
          <BarrasHorizontales
            filas={operational.porZona.map((zona) => ({
              clave: zona.zona,
              etiqueta: zona.zona,
              valor: Number(zona.recaudado || 0),
              detalle: [
                zona.precio_dia == null ? 'Sin precio vigente' : `Precio por día: ${formatPEN(zona.precio_dia)}`,
                `${Number(zona.pagos || 0)} pagos`,
                `${Number(zona.ocupados || 0)} de ${Number(zona.puestos || 0)} puestos ocupados`
              ]
            }))}
            formato={formatPEN} columnas={['Zona', 'Recaudado', 'Precio', 'Pagos', 'Puestos']} vacio="Aún no hay zonas registradas."
          />
        </div>

        <div className="panel">
          <div className="panel-heading">
            <div>
              <div className="panel-title">Estado de los puestos</div>
              <div className="panel-subtitle">{mapPuestos.filter((site) => site.estado !== 'inactivo').length} puestos, con los colores del mapa</div>
            </div>
            {veMapa && <Link className="view-all" to={pathOf('mapa')}>Ver mapa →</Link>}
          </div>
          <BarraApilada
            segmentos={puestosPorEstado(mapPuestos).map((fila) => ({ ...fila, etiqueta: PAYMENT_LABELS[fila.clave], color: PAYMENT_COLORS[fila.clave] }))}
            unidad="puestos" vacio="Todavía no hay puestos registrados."
          />
        </div>
      </div>

      <div className="lower-grid">
        <div className="panel">
          <div className="panel-heading">
            <div>
              <div className="panel-title">Recaudación por cobrador</div>
              <div className="panel-subtitle">Cobros confirmados en el mes</div>
            </div>
          </div>
          <BarrasHorizontales
            filas={(operational.porCobrador || []).map((fila) => ({
              clave: fila.cobrador,
              etiqueta: fila.cobrador,
              valor: Number(fila.recaudado || 0),
              detalle: [`${Number(fila.pagos || 0)} pagos`]
            }))}
            formato={formatPEN} columnas={['Cobrador', 'Recaudado', 'Pagos']} vacio="Aún no hay cobros en el mes."
          />
        </div>

        <div className="panel">
          <div className="panel-heading">
            <div>
              <div className="panel-title">Alertas importantes</div>
              <div className="panel-subtitle">Requieren atención del equipo{textoPuntajeRiesgo(riskData) && <> · {textoPuntajeRiesgo(riskData)}</>}</div>
            </div>
            <span className="status pending">{alertas.length} {alertas.length === 1 ? 'alerta' : 'alertas'}</span>
          </div>
          <div className="alerts-list">
            {alertas.slice(0, 4).map((item) => (
              <div className="alert-item" key={item.comerciante_id}>{item.nombre} · Riesgo {item.nivel_riesgo}: {item.motivo_principal}</div>
            ))}
            {!alertas.length && <div className="empty-state">Ningún comerciante con riesgo alto de morosidad.</div>}
          </div>
        </div>
      </div>

      {veAuditoria && (
        <div className="dashboard-grid">
          <div className="panel panel-ancho">
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
                  <div><strong>{item.accion} · {item.entidad}</strong><small>{item.usuario || `Usuario ${item.usuario_id}`} · {fechaHoraEnLima(item.fecha)}</small></div>
                </div>
              ))}
              {!auditRecords.length && <div className="empty-state">Todavia no hay actividad de auditoria para mostrar.</div>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
