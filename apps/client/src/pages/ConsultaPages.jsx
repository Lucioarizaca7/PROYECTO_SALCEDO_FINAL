import { useSisrec } from '../app/SisrecContext';
import { apiBase } from '../services/session';

// Páginas de solo lectura: muestran datos que ya cargó useDatosSisrec y no tienen hook propio.

export function ReportesPage() {
  const { reportRows } = useSisrec();
  return (
    <section className="page">
      <div className="page-heading">
        <div><div className="eyebrow">ANÁLISIS / EXPORTACIÓN</div><h1>Reportes personalizados</h1><p>Consulta cobros por periodo, zona, rubro o cobrador.</p></div>
        <div className="report-actions"><button className="secondary-button" type="button" onClick={() => window.print()}>Imprimir / PDF</button><a className="primary-button" href={`${apiBase}/reportes?formato=csv`} download="reporte-cobros.csv">Exportar CSV</a></div>
      </div>
      <div className="report-kpis">
        <div className="stat-card"><span>Total cobrado</span><strong>S/ {reportRows.reduce((total, item) => total + Number(item.monto || 0), 0).toFixed(2)}</strong></div>
        <div className="stat-card"><span>Operaciones</span><strong>{reportRows.length}</strong></div>
        <div className="stat-card"><span>Zonas cubiertas</span><strong>{new Set(reportRows.map((item) => item.zona)).size}</strong></div>
      </div>
      <div className="table-card">
        <table>
          <thead><tr><th>Fecha</th><th>Comerciante</th><th>Rubro</th><th>Zona</th><th>Cobrador</th><th>Monto</th><th>Método</th><th>Comprobante</th></tr></thead>
          <tbody>{reportRows.map((item) => <tr key={item.id}><td>{item.fecha}</td><td>{item.comerciante}</td><td>{item.rubro}</td><td>{item.zona}</td><td>{item.cobrador}</td><td>S/ {Number(item.monto).toFixed(2)}</td><td>{item.metodo_pago}</td><td>{item.comprobante}</td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}

export function AuditoriaPage() {
  const { auditRecords } = useSisrec();
  return (
    <section className="page">
      <div className="page-heading"><div><div className="eyebrow">CONTROL / TRAZABILIDAD</div><h1>Auditoría</h1><p>Historial de acciones sensibles, usuario responsable y timestamp.</p></div></div>
      <div className="table-card">
        <table>
          <thead><tr><th>Fecha</th><th>Usuario</th><th>Entidad</th><th>Acción</th><th>Detalle</th></tr></thead>
          <tbody>{auditRecords.map((item) => <tr key={item.id}><td>{item.fecha}</td><td>{item.usuario || `Usuario ${item.usuario_id}`}</td><td>{item.entidad}</td><td><span className="status paid">{item.accion}</span></td><td>{item.detalle}</td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}

export function AnaliticaPage() {
  const { predictiveData, riskData } = useSisrec();
  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">IA / PREDICCIÓN</div>
          <h1>Centro de inteligencia</h1>
          <p>Predicción de recaudación y riesgo de morosidad con modelado operativo del padrón.</p>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-top"><span>Proyección 90 días</span><span className="stat-icon green">↗</span></div>
          <div className="stat-value">S/ {Number(predictiveData.totalProyectado || 0).toFixed(2)}</div>
          <div className="stat-change"><span className="up">{Number(predictiveData.promedioDiario || 0).toFixed(2)}</span> por día promedio</div>
        </div>
        <div className="stat-card">
          <div className="stat-top"><span>Riesgo alto</span><span className="stat-icon red">!</span></div>
          <div className="stat-value">{riskData.summary?.alto || 0}</div>
          <div className="stat-change"><span className="downchange">{riskData.summary?.critico || 0}</span> críticos</div>
        </div>
      </div>

      <div className="page-grid two-grid">
        <div className="panel detail-card">
          <h3>Predicción de recaudación</h3>
          {(predictiveData.porZona || []).slice(0, 4).map((item) => (
            <div className="metric-line" key={item.zona || item.zona_id}>
              <span>{item.zona}</span>
              <strong>S/ {Number(item.proyectado || 0).toFixed(2)}</strong>
            </div>
          ))}
          {!(predictiveData.porZona || []).length && <div className="empty-state">No hay datos predictivos aún.</div>}
        </div>
        <div className="panel detail-card">
          <h3>Scoring de morosidad</h3>
          {(riskData.records || []).slice(0, 4).map((item) => (
            <div className="metric-line" key={item.comerciante_id}>
              <span>{item.nombre}</span>
              <strong>{item.nivel || item.nivel_riesgo}</strong>
            </div>
          ))}
          {!(riskData.records || []).length && <div className="empty-state">Sin alertas de morosidad para esta ventana.</div>}
        </div>
      </div>
    </section>
  );
}
