import { useEffect, useState } from 'react';
import { useSisrec } from '../app/SisrecContext';
import { textoMotivo } from '../services/asistenciaOffline';
import { useReportes } from '../hooks/useReportes';
import { textoMetodo, textoPuntajeRiesgo } from '../lib/formato';
import { hoyEnLima } from '../services/jornadaOffline';
import { textoTicket } from '../services/ticketsOffline';
import { VeredictoRecaudacion } from '../features/analitica/VeredictoRecaudacion';
import { apiBase, authFetch } from '../services/session';

// Páginas de solo lectura: muestran datos que ya cargó useDatosSisrec (y, en Analítica, el tiempo por cobro).

export function ReportesPage() {
  const { catalogos } = useSisrec();
  const { filtro, setFiltro, filas, cargando, mensaje, exportarCsv, anular, puedeAnular, total, confirmadas } = useReportes();
  const cambiar = (campo) => (event) => setFiltro((actual) => ({ ...actual, [campo]: event.target.value }));
  return (
    <section className="page">
      <div className="page-heading">
        <div><div className="eyebrow">ANÁLISIS / EXPORTACIÓN</div><h1>Reportes personalizados</h1><p>Consulta cobros por periodo, zona o rubro.</p></div>
        <div className="report-actions"><button className="secondary-button" type="button" onClick={() => window.print()}>Imprimir / PDF</button><button className="primary-button" type="button" onClick={exportarCsv}>Exportar CSV</button></div>
      </div>
      <div className="map-toolbar">
        <label><span>Periodo</span><input type="month" aria-label="Periodo" value={filtro.periodo} onChange={cambiar('periodo')} /></label>
        <select aria-label="Filtrar por zona" value={filtro.zona_id} onChange={cambiar('zona_id')}>
          <option value="">Todas las zonas</option>
          {(catalogos.zonas || []).map((zona) => <option key={zona.id} value={zona.id}>{zona.nombre}</option>)}
        </select>
        <select aria-label="Filtrar por rubro" value={filtro.rubro_id} onChange={cambiar('rubro_id')}>
          <option value="">Todos los rubros</option>
          {(catalogos.rubros || []).map((rubro) => <option key={rubro.id} value={rubro.id}>{rubro.nombre}</option>)}
        </select>
      </div>
      {mensaje && <div className="form-message">{mensaje}</div>}
      <div className="report-kpis">
        <div className="stat-card"><span>Total cobrado</span><strong>S/ {total.toFixed(2)}</strong></div>
        <div className="stat-card"><span>Operaciones</span><strong>{confirmadas.length}</strong>{filas.length > confirmadas.length && <small>{filas.length - confirmadas.length} anuladas u observadas, fuera del total</small>}</div>
        <div className="stat-card"><span>Zonas cubiertas</span><strong>{new Set(confirmadas.map((item) => item.zona)).size}</strong></div>
      </div>
      <div className="table-card">
        <table>
          <thead><tr><th>Fecha</th><th>Comerciante</th><th>Rubro</th><th>Zona</th><th>Cobrador</th><th>Monto</th><th>Método</th><th>Comprobante</th><th>Tickets</th><th>Estado</th><th>Nota del cobrador</th>{puedeAnular && <th aria-label="Acciones" />}</tr></thead>
          <tbody>
            {filas.map((item) => (
              <tr key={item.id} className={item.estado === 'anulado' ? 'fila-anulada' : undefined}>
                <td>{item.fecha}</td><td>{item.comerciante}</td><td>{item.rubro}</td><td>{item.zona}</td><td>{item.cobrador}</td>
                <td>S/ {Number(item.monto).toFixed(2)}</td>
                <td>{textoMetodo(item.metodo_pago)}{item.metodo_pago !== 'efectivo' && item.codigo_operacion ? <small className="celda-detalle">Op. {item.codigo_operacion}</small> : null}</td>
                <td>{item.comprobante}</td>
                <td>{(item.tickets || []).map((ticket) => textoTicket(ticket.serie, ticket.numero)).join(', ') || '—'}</td>
                <td>
                  <span className={`status ${item.estado === 'anulado' ? 'danger' : item.estado === 'confirmado' ? 'paid' : 'pending'}`}>{item.estado}</span>
                  {item.estado === 'anulado' && <small className="celda-detalle">{item.anulado_por ? `${item.anulado_por}: ` : ''}{item.motivo_anulacion}</small>}
                </td>
                <td>{item.observaciones || '—'}</td>
                {puedeAnular && <td>{item.estado === 'confirmado' && <button className="secondary-button compact" type="button" onClick={() => anular(item)}>Anular</button>}</td>}
              </tr>
            ))}
            {!filas.length && <tr><td colSpan={puedeAnular ? 12 : 11} className="empty-state">{cargando ? 'Cargando…' : 'No hay cobros con estos filtros.'}</td></tr>}
          </tbody>
        </table>
      </div>
      <ObservacionesCobro />
    </section>
  );
}

// Lo que anotó el cobrador: al marcar el día ("no salió": no se cobra; "no vendió" / "se negó a pagar": estuvo,
// el día se debe igual) y la nota que escribe al cobrar (origen 'cobro', con su comprobante).
function ObservacionesCobro() {
  const hoy = hoyEnLima();
  const [filtro, setFiltro] = useState({ desde: `${hoy.slice(0, 7)}-01`, hasta: hoy });
  const [data, setData] = useState({ observaciones: [] });
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams(filtro);
    authFetch(`${apiBase}/asistencias/observaciones?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.message || 'No se pudieron cargar las observaciones');
        setError('');
        setData(body.data || { observaciones: [] });
      })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [filtro.desde, filtro.hasta]);

  return (
    <div className="table-card">
      <div className="panel-heading">
        <div><div className="panel-title">Observaciones de cobro</div><div className="panel-subtitle">{data.observaciones.length} anotaciones del cobrador en el rango.</div></div>
        <div className="report-actions">
          <input type="date" aria-label="Desde" value={filtro.desde} max={filtro.hasta} onChange={(event) => setFiltro({ ...filtro, desde: event.target.value })} />
          <input type="date" aria-label="Hasta" value={filtro.hasta} min={filtro.desde} onChange={(event) => setFiltro({ ...filtro, hasta: event.target.value })} />
        </div>
      </div>
      {error && <div className="form-error">{error}</div>}
      <table>
        <thead><tr><th>Fecha</th><th>Origen</th><th>Comerciante</th><th>Puesto / comprobante</th><th>Zona</th><th>Motivo</th><th>¿Se cobra el día?</th><th>Detalle</th><th>Cobrador</th></tr></thead>
        <tbody>{data.observaciones.map((item) => item.origen === 'cobro' ? (
          <tr key={`cobro-${item.id}`}>
            <td>{item.fecha}</td><td><span className="status paid">Cobro</span></td><td>{item.comerciante}</td>
            <td>{item.comprobante || '—'}{item.monto ? ` · S/ ${Number(item.monto).toFixed(2)}` : ''}</td><td>{item.zona || '—'}</td>
            <td>Nota al cobrar</td><td>{item.estado_cobro === 'anulado' ? 'Cobro anulado' : '—'}</td><td>{item.observacion}</td><td>{item.registrado_por || '—'}</td>
          </tr>
        ) : (
          <tr key={`asistencia-${item.id}`}>
            <td>{item.fecha}</td><td><span className="status pending">Asistencia</span></td><td>{item.comerciante}</td><td>{item.codigo_puesto || '—'}</td><td>{item.zona || '—'}</td>
            <td>{textoMotivo(item.motivo) || '—'}</td><td>{item.asistio ? 'Sí' : 'No'}</td><td>{item.observacion || '—'}</td><td>{item.registrado_por || '—'}</td>
          </tr>
        ))}
        {!data.observaciones.length && <tr><td colSpan={9} className="empty-state">Sin observaciones en el rango.</td></tr>}</tbody>
      </table>
    </div>
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

const NOMBRE_MODELO = { holt: 'Holt (nivel y tendencia)', ses: 'Suavizado exponencial simple', promedio: 'Promedio simple', sin_datos: 'Sin datos' };
const minutos = (segundos) => (segundos === null || segundos === undefined ? '—' : `${(segundos / 60).toFixed(1)} min`);

// Tiempo de atención por cobro frente a la línea base del DAP (indicador de −50 %).
function useTiemposCobro(rol) {
  const [tiempos, setTiempos] = useState(null);
  useEffect(() => {
    if (!['super_admin', 'auditor'].includes(rol)) return;
    authFetch(`${apiBase}/cobros/tiempos`).then((response) => (response.ok ? response.json() : null))
      .then((body) => setTiempos(body?.data || null)).catch(() => null);
  }, [rol]);
  return tiempos;
}

export function AnaliticaPage() {
  const { predictiveData, riskData, user } = useSisrec();
  const tiempos = useTiemposCobro(user?.rol);
  const modelo = predictiveData.modelo;
  const reduccion = tiempos?.general?.mediana_segundos
    ? Math.round((1 - tiempos.general.mediana_segundos / tiempos.linea_base.segundos_por_cobro) * 100)
    : null;
  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">IA / PREDICCIÓN</div>
          <h1>Centro de inteligencia</h1>
          <p>Proyección de recaudación con suavizado exponencial sobre los cobros reales, con su error medido, y riesgo de morosidad.</p>
        </div>
      </div>

      <VeredictoRecaudacion veredicto={predictiveData.veredicto} />

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-top"><span>Proyección 90 días</span><span className="stat-icon green">↗</span></div>
          <div className="stat-value">S/ {Number(predictiveData.totalProyectado || 0).toFixed(2)}</div>
          <div className="stat-change"><span className="up">{Number(predictiveData.promedioDiario || 0).toFixed(2)}</span> por día promedio</div>
        </div>
        <div className="stat-card">
          <div className="stat-top"><span>Error del modelo (MAPE)</span><span className="stat-icon green">±</span></div>
          <div className="stat-value">{modelo?.mape === null || modelo?.mape === undefined ? '—' : `${modelo.mape} %`}</div>
          <div className="stat-change">
            {modelo ? `${NOMBRE_MODELO[modelo.nombre] || modelo.nombre} · ${modelo.meses_historia} meses de historia${modelo.fuente === 'respaldo_local' ? ' · cálculo local' : ''}` : 'Sin proyección'}
          </div>
        </div>
        {tiempos && (
          <div className="stat-card">
            <div className="stat-top"><span>Tiempo por cobro (mediana)</span><span className="stat-icon green">⏱</span></div>
            <div className="stat-value">{minutos(tiempos.general.mediana_segundos)}</div>
            <div className="stat-change">
              {tiempos.general.cobros
                ? <>{tiempos.general.cobros} cobros medidos · línea base {minutos(tiempos.linea_base.segundos_por_cobro)}{reduccion !== null && <> · <span className={reduccion >= 50 ? 'up' : 'downchange'}>{reduccion}% menos</span></>}</>
                : 'Aún no hay cobros con tiempo medido este mes'}
            </div>
          </div>
        )}
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
          {textoPuntajeRiesgo(riskData) && <p className="panel-subtitle">{textoPuntajeRiesgo(riskData)}</p>}
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
