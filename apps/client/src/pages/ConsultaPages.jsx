import { useEffect, useState } from 'react';
import { useSisrec } from '../app/SisrecContext';
import { textoMotivo } from '../services/asistenciaOffline';
import { useReportes } from '../hooks/useReportes';
import { useAuditoria } from '../hooks/useAuditoria';
import { formatPEN, textoMetodo, textoPuntajeRiesgo, textoVerificacion } from '../lib/formato';
import { textoDelPeriodo } from '../lib/reportes';
import { FirmasHoja, ResumenHoja, TablaCobrosHoja, VistaImpresion } from '../components/ui/VistaImpresion';
import { hoyEnLima, periodoEnLima } from '../services/jornadaOffline';
import { textoTicket } from '../services/ticketsOffline';
import { VeredictoRecaudacion } from '../features/analitica/VeredictoRecaudacion';
import { BarraApilada, BarrasHorizontales, ColumnasMensuales } from '../components/ui/Graficos';
import { NIVELES_RIESGO, mesesDeProyeccion, riesgoPorNivel } from '../lib/graficos';
import { apiBase, authFetch } from '../services/session';

// Páginas de solo lectura: muestran datos que ya cargó useDatosSisrec (y, en Analítica, el tiempo por cobro).

export function ReportesPage() {
  const { catalogos, user } = useSisrec();
  const { filtro, setFiltro, periodoPedido, filas, cargando, mensaje, exportarExcel, anular, puedeAnular, total, confirmadas } = useReportes();
  const [vistaPrevia, setVistaPrevia] = useState(false);
  const cambiar = (campo) => (event) => setFiltro((actual) => ({ ...actual, [campo]: event.target.value }));
  const nombreZona = (catalogos.zonas || []).find((zona) => String(zona.id) === String(filtro.zona_id))?.nombre;
  const nombreRubro = (catalogos.rubros || []).find((rubro) => String(rubro.id) === String(filtro.rubro_id))?.nombre;
  const fueraDelTotal = filas.length - confirmadas.length;
  return (
    <section className="page">
      <div className="page-heading">
        <div><div className="eyebrow">ANÁLISIS / EXPORTACIÓN</div><h1>Reportes personalizados</h1><p>Consulta cobros de un mes, de un día o todos los registrados, por zona o rubro.</p></div>
        <div className="report-actions"><button className="secondary-button" type="button" onClick={() => setVistaPrevia(true)}>Vista previa e imprimir</button><button className="primary-button" type="button" onClick={exportarExcel}>Exportar Excel</button></div>
      </div>
      <div className="map-toolbar">
        <div className="filtro-alcance" role="radiogroup" aria-label="Reporte de un mes, de un día o de todo el registro">
          {[['mes', 'Mes'], ['dia', 'Día'], ['todo', 'Todo']].map(([valor, texto]) => (
            <button key={valor} type="button" role="radio" aria-checked={filtro.alcance === valor} className={`secondary-button compact${filtro.alcance === valor ? ' activo' : ''}`} onClick={() => setFiltro((actual) => ({ ...actual, alcance: valor }))}>{texto}</button>
          ))}
        </div>
        {filtro.alcance === 'dia' && <label><span>Día</span><input type="date" aria-label="Día del reporte" max={hoyEnLima()} value={filtro.dia} onChange={cambiar('dia')} /></label>}
        {filtro.alcance === 'mes' && <label><span>Mes</span><input type="month" aria-label="Mes del reporte" value={filtro.periodo} onChange={cambiar('periodo')} /></label>}
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
      {vistaPrevia && (
        <VistaImpresion
          titulo={`Reporte de cobros ${textoDelPeriodo(periodoPedido)}`}
          subtitulo={[nombreZona ? `Zona: ${nombreZona}` : 'Todas las zonas', nombreRubro ? `Rubro: ${nombreRubro}` : 'Todos los rubros'].join(' · ')}
          onCerrar={() => setVistaPrevia(false)}
        >
          <ResumenHoja cifras={[
            { etiqueta: 'Total cobrado', valor: formatPEN(total) },
            { etiqueta: 'Cobros confirmados', valor: confirmadas.length },
            { etiqueta: 'Anulados u observados', valor: fueraDelTotal, detalle: fueraDelTotal ? 'Tachados, fuera del total' : undefined },
            { etiqueta: 'Zonas cubiertas', valor: new Set(confirmadas.map((item) => item.zona)).size }
          ]} />
          <TablaCobrosHoja filas={filas} conFecha={filtro.alcance !== 'dia'} />
          <FirmasHoja firmas={['Responsable de Rentas', 'Revisado por']} />
        </VistaImpresion>
      )}
      <ObservacionesCobro />
      {['super_admin', 'auditor'].includes(user?.rol) && <CobrosEnOtraZona />}
      {['super_admin', 'auditor'].includes(user?.rol) && <MarcasFueraDeAsignacion />}
    </section>
  );
}

// Cobros en otra zona por cobrador (RN-63): control mensual. El cobrador puede elegir la zona del día, y en una
// zona más barata el día vale menos; aquí se ve cuánto usa cada uno esa opción y cuánto dinero mueve.
const soles = (valor) => `S/ ${Math.abs(Number(valor)).toFixed(2)}`;
const textoDiferenciaZona = (valor) => (valor > 0 ? `${soles(valor)} menos` : valor < 0 ? `${soles(valor)} más` : 'Sin diferencia');

// Marcas en una zona que el cobrador no tenía asignada (RN-64): no se le impide, pero queda señalado.
function MarcasFueraDeAsignacion() {
  const hoy = hoyEnLima();
  const [filtro, setFiltro] = useState({ desde: `${hoy.slice(0, 7)}-01`, hasta: hoy });
  const [data, setData] = useState({ cobradores: [] });
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    authFetch(`${apiBase}/asistencias/fuera-de-asignacion?${new URLSearchParams(filtro)}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.message || 'No se pudo cargar el reporte de zonas asignadas');
        setError('');
        setData(body.data || { cobradores: [] });
      })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [filtro.desde, filtro.hasta]);

  return (
    <div className="table-card">
      <div className="panel-heading">
        <div><div className="panel-title">Marcas fuera de las zonas asignadas, por cobrador</div><div className="panel-subtitle">Días que un cobrador marcó o cobró en una zona que no tenía asignada. Las zonas se asignan en Usuarios.</div></div>
        <div className="report-actions">
          <input type="date" aria-label="Fuera de zona: desde" value={filtro.desde} max={filtro.hasta} onChange={(event) => setFiltro({ ...filtro, desde: event.target.value })} />
          <input type="date" aria-label="Fuera de zona: hasta" value={filtro.hasta} min={filtro.desde} onChange={(event) => setFiltro({ ...filtro, hasta: event.target.value })} />
        </div>
      </div>
      {error && <div className="form-error">{error}</div>}
      <table>
        <thead><tr><th>Cobrador</th><th>Zonas asignadas hoy</th><th>Marcas</th><th>Fuera de sus zonas</th><th>Detalle</th></tr></thead>
        <tbody>
          {data.cobradores.map((fila) => (
            <tr key={fila.cobrador_id}>
              <td>{fila.cobrador}</td><td>{fila.zonas_asignadas.join(', ') || 'Todas'}</td><td>{fila.marcas}</td>
              <td><span className="status pending">{fila.fuera} ({fila.porcentaje}%)</span></td>
              <td>{fila.detalle.map((item) => `${item.fecha} ${item.comerciante} (${item.zona || 'sin zona'})`).join(' · ')}</td>
            </tr>
          ))}
          {!data.cobradores.length && <tr><td colSpan={5} className="empty-state">Nadie marcó fuera de sus zonas asignadas en el rango.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function CobrosEnOtraZona() {
  const hoy = hoyEnLima();
  const [filtro, setFiltro] = useState({ desde: `${hoy.slice(0, 7)}-01`, hasta: hoy });
  const [data, setData] = useState({ cobradores: [] });
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    authFetch(`${apiBase}/asistencias/otra-zona?${new URLSearchParams(filtro)}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.message || 'No se pudo cargar el reporte de cobros en otra zona');
        setError('');
        setData(body.data || { cobradores: [] });
      })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [filtro.desde, filtro.hasta]);

  return (
    <div className="table-card">
      <div className="panel-heading">
        <div><div className="panel-title">Cobros en otra zona, por cobrador</div><div className="panel-subtitle">Días que cada cobrador marcó en una zona distinta a la del puesto, y la diferencia frente al precio de la zona del puesto.</div></div>
        <div className="report-actions">
          <input type="date" aria-label="Otra zona: desde" value={filtro.desde} max={filtro.hasta} onChange={(event) => setFiltro({ ...filtro, desde: event.target.value })} />
          <input type="date" aria-label="Otra zona: hasta" value={filtro.hasta} min={filtro.desde} onChange={(event) => setFiltro({ ...filtro, hasta: event.target.value })} />
        </div>
      </div>
      {error && <div className="form-error">{error}</div>}
      <table>
        <thead><tr><th>Cobrador</th><th>Días marcados</th><th>En otra zona</th><th>A zona más barata</th><th>A zona más cara</th><th>Diferencia</th><th>Detalle (zona del puesto → zona del día)</th></tr></thead>
        <tbody>
          {data.cobradores.map((fila) => (
            <tr key={fila.cobrador_id ?? 'sin-dato'}>
              <td>{fila.cobrador}</td><td>{fila.dias_marcados}</td><td>{fila.dias_otra_zona} ({fila.porcentaje}%)</td>
              <td>{fila.a_zona_mas_barata}</td><td>{fila.a_zona_mas_cara}</td>
              <td><span className={`status ${fila.diferencia > 0 ? 'pending' : 'paid'}`}>{textoDiferenciaZona(fila.diferencia)}</span>{fila.sin_precio > 0 && ` · ${fila.sin_precio} sin precio`}</td>
              <td>{fila.detalle.map((item) => `${item.zona_puesto || 'Sin zona'} → ${item.zona_dia || 'Sin zona'}: ${item.dias} día(s)`).join(' · ')}</td>
            </tr>
          ))}
          {!data.cobradores.length && <tr><td colSpan={7} className="empty-state">Nadie cobró en una zona distinta a la del puesto en el rango.</td></tr>}
        </tbody>
      </table>
    </div>
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
  const auditoria = useAuditoria();
  const { filtro, setFiltro } = auditoria;
  const hoy = hoyEnLima();
  return (
    <section className="page">
      <div className="page-heading">
        <div><div className="eyebrow">CONTROL / TRAZABILIDAD</div><h1>Auditoría</h1><p>Historial de acciones sensibles, usuario responsable y fecha.</p></div>
        <div className="report-actions"><button className="secondary-button" type="button" onClick={auditoria.verificar} disabled={auditoria.verificacion?.cargando}>Verificar integridad</button></div>
      </div>
      {auditoria.verificacion && (
        <div className={`form-message ${auditoria.verificacion.valid === false ? 'error' : ''}`} role="status">{textoVerificacion(auditoria.verificacion)}</div>
      )}
      <div className="map-toolbar">
        <label><span>Desde</span><input type="date" aria-label="Desde" max={hoy} value={filtro.desde} onChange={(event) => setFiltro({ desde: event.target.value })} /></label>
        <label><span>Hasta</span><input type="date" aria-label="Hasta" max={hoy} value={filtro.hasta} onChange={(event) => setFiltro({ hasta: event.target.value })} /></label>
        <label><span>Buscar</span><input type="search" aria-label="Buscar en la auditoría" placeholder="Acción, entidad o detalle (p. ej. R-000123)" value={filtro.buscar} onChange={(event) => setFiltro({ buscar: event.target.value })} /></label>
      </div>
      {auditoria.mensaje && <div className="form-message">{auditoria.mensaje}</div>}
      <div className="table-card">
        <table>
          <thead><tr><th>Fecha</th><th>Usuario</th><th>Entidad</th><th>Acción</th><th>Detalle</th></tr></thead>
          <tbody>
            {auditoria.filas.map((item) => <tr key={item.id}><td>{item.fecha}</td><td>{item.usuario || `Usuario ${item.usuario_id}`}</td><td>{item.entidad}</td><td><span className="status paid">{item.accion}</span></td><td>{item.detalle}</td></tr>)}
            {!auditoria.filas.length && !auditoria.cargando && <tr><td colSpan="5">No hay registros de auditoría con estos filtros.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="pagination-row" aria-label="Paginación de la auditoría">
        <span>{auditoria.cargando ? 'Buscando…' : `${auditoria.total} ${auditoria.total === 1 ? 'registro' : 'registros'}`}</span>
        <div>
          <button type="button" className="secondary-button" disabled={auditoria.page <= 1} onClick={() => auditoria.setPage((page) => page - 1)} aria-label="Página anterior">Anterior</button>
          <span className="page-number" aria-live="polite">Página {auditoria.page} de {auditoria.totalPaginas}</span>
          <button type="button" className="secondary-button" disabled={auditoria.page >= auditoria.totalPaginas} onClick={() => auditoria.setPage((page) => page + 1)} aria-label="Página siguiente">Siguiente</button>
        </div>
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
  const { predictiveData, riskData, operational, user } = useSisrec();
  const tiempos = useTiemposCobro(user?.rol);
  const modelo = predictiveData.modelo;
  const periodo = predictiveData.periodo || periodoEnLima();
  // El primer mes proyectado es el mes en curso: se muestra junto a lo cobrado hasta hoy (porDia del panel).
  const cobradoEnCurso = (operational.porDia || []).reduce((total, dia) => total + Number(dia.recaudado || 0), 0);
  const meses = mesesDeProyeccion({
    serie: predictiveData.serie || [], proyeccion: predictiveData.proyeccion_mensual || [], periodo,
    mape: modelo?.mape ?? null, cobradoEnCurso
  });
  const nombreNivel = Object.fromEntries(NIVELES_RIESGO.map((nivel) => [nivel.clave, nivel]));
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

      {/* Gráficos de la analítica (24/11/2026): sin reparto por rubro, el precio lo pone la zona. */}
      <div className="dashboard-grid">
        <div className="panel panel-ancho">
          <div className="panel-heading">
            <div>
              <div className="panel-title">Recaudación mensual y proyección</div>
              <div className="panel-subtitle">
                Cobros confirmados de cada mes y lo que se espera en los próximos {(predictiveData.proyeccion_mensual || []).length || 3} meses
              </div>
            </div>
            <span className="date-chip">{formatPEN(predictiveData.totalProyectado || 0)} en {predictiveData.horizonte_dias || 90} días</span>
          </div>
          <ColumnasMensuales meses={meses} formato={formatPEN} titulo="Recaudación mensual cobrada y proyectada" />
        </div>

        <div className="panel">
          <div className="panel-heading">
            <div>
              <div className="panel-title">Proyección por zona</div>
              <div className="panel-subtitle">Lo que se espera cobrar en cada zona en {predictiveData.horizonte_dias || 90} días</div>
            </div>
          </div>
          <BarrasHorizontales
            filas={(predictiveData.porZona || []).map((zona) => ({
              clave: String(zona.zona_id),
              etiqueta: zona.zona,
              valor: Number(zona.proyectado || 0),
              detalle: [
                `Cobrado en ${modelo?.meses_historia || 0} meses: ${formatPEN(zona.recaudado || 0)}`,
                zona.mape === null || zona.mape === undefined ? 'Error sin medir (poca historia)' : `Error del modelo: ${zona.mape} %`
              ]
            }))}
            formato={formatPEN} columnas={['Zona', 'Proyectado', 'Cobrado', 'Error']} vacio="No hay datos predictivos aún."
          />
        </div>

        <div className="panel">
          <div className="panel-heading">
            <div>
              <div className="panel-title">Riesgo de morosidad</div>
              <div className="panel-subtitle">{textoPuntajeRiesgo(riskData) || `${riskData.summary?.total || 0} comerciantes puntuados`}</div>
            </div>
          </div>
          <BarraApilada segmentos={riesgoPorNivel(riskData.summary)} unidad="comerciantes" vacio="Aún no hay comerciantes puntuados." />
        </div>

        <div className="panel panel-ancho">
          <div className="panel-heading">
            <div>
              <div className="panel-title">Comerciantes con mayor riesgo</div>
              <div className="panel-subtitle">Puntaje de 0 a 100: deuda acumulada, pagos y días sin pagar</div>
            </div>
          </div>
          <BarrasHorizontales
            filas={(riskData.records || []).filter((item) => Number(item.score_riesgo) > 0).map((item) => {
              const nivel = nombreNivel[item.nivel_riesgo] || nombreNivel.bajo;
              return {
                clave: String(item.comerciante_id),
                etiqueta: item.nombre,
                valor: Math.round(Number(item.score_riesgo || 0) * 100),
                color: nivel.color,
                detalle: [`Riesgo ${nivel.etiqueta.toLowerCase()}`, item.motivo_principal || 'Sin motivo registrado']
              };
            })}
            maximo={100} formato={(valor) => `${valor} / 100`} columnas={['Comerciante', 'Puntaje', 'Nivel', 'Motivo']}
            vacio="Ningún comerciante tiene días cobrados sin pagar: no hay riesgo de morosidad."
          />
        </div>
      </div>
    </section>
  );
}
