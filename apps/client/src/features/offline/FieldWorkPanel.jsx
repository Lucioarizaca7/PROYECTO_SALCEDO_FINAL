const formatPEN = (value) => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(Number(value) || 0);
const formatTime = (value) => (value ? new Date(value).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }) : '—');

const STATE_LABEL = { pendiente: 'Pendiente', sincronizado: 'Sincronizado', error: 'Error' };
const STATE_CLASS = { pendiente: 'pending', sincronizado: 'paid', error: 'danger' };

function syncSummary(result) {
  if (!result) return null;
  if (result.error) return `No se pudo sincronizar: ${result.error}`;
  if (result.detenido === 'sin_conexion') return 'Sin conexión con el servidor: los cobros siguen guardados en el celular.';
  if (result.detenido === 'sesion_vencida') return 'La sesión venció: ingresa de nuevo para subir los cobros (no se pierden).';
  const parts = [];
  if (result.sincronizados) parts.push(`${result.sincronizados} subidos`);
  if (result.observados) parts.push(`${result.observados} en revisión`);
  if (result.duplicados) parts.push(`${result.duplicados} ya estaban registrados`);
  if (result.reintentar) parts.push(`${result.reintentar} se reintentarán`);
  if (result.errores) parts.push(`${result.errores} con error`);
  return parts.length ? `Última sincronización: ${parts.join(', ')}.` : 'No había cobros por subir.';
}

/**
 * Panel del cobrador en "Cobro rápido": padrón de la jornada (para buscar sin señal)
 * y la cola de cobros offline con su estado.
 */
export function FieldWorkPanel({ isOnline, jornada, queue }) {
  const { meta, vigente, downloading, error, download } = jornada;
  const { items, counts, syncing, lastResult, sync, retry } = queue;
  const visible = items.filter((item) => item.estado !== 'sincronizado').concat(items.filter((item) => item.estado === 'sincronizado').slice(0, 5));

  return (
    <div className="panel field-panel">
      <div className="field-panel-row">
        <div>
          <div className="panel-title">Jornada sin señal</div>
          <div className="panel-subtitle">
            {meta
              ? `Padrón del ${formatTime(meta.descargadoEn)} · ${meta.comerciantes} comerciantes · periodo ${meta.periodo}`
              : 'Aún no se descargó el padrón en este celular.'}
          </div>
        </div>
        <span className={`status ${vigente ? 'paid' : 'pending'}`}>{vigente ? 'Listo para hoy' : 'Desactualizado'}</span>
      </div>
      <button type="button" className="secondary-button" disabled={downloading || !isOnline} onClick={download}>
        {downloading ? 'Descargando…' : vigente ? 'Volver a descargar padrón y tarifas' : 'Descargar padrón y tarifas'}
      </button>
      {error && <div className="form-error">{error}</div>}

      <div className="field-panel-row field-queue-head">
        <div>
          <div className="panel-title">Cobros sin enviar</div>
          <div className="panel-subtitle">
            {counts.pendiente} pendientes · {counts.error} con error · {counts.sincronizado} sincronizados
          </div>
        </div>
        <button type="button" className="primary-button compact" disabled={syncing || !isOnline || counts.pendiente === 0} onClick={sync}>
          {syncing ? 'Sincronizando…' : 'Sincronizar ahora'}
        </button>
      </div>
      {lastResult && <div className="form-message">{syncSummary(lastResult)}</div>}

      <ul className="field-queue" aria-label="Cola de cobros offline">
        {visible.map((item) => (
          <li key={item.hashTransaccion} className={`field-queue-item is-${item.estado}`}>
            <div>
              <strong>{item.comerciante || `Comerciante ${item.comercianteId}`}</strong>
              <span>{formatPEN(item.monto)} · {item.metodoPago} · {formatTime(item.fechaCobro)}</span>
              {item.comprobante && <span>Comprobante {item.comprobante}{item.resultado === 'observado' ? ' · en revisión' : ''}</span>}
              {item.ultimoError && <span className="field-queue-error">{item.ultimoError}{item.estado === 'pendiente' ? ` (intento ${item.intentos} de 3)` : ''}</span>}
            </div>
            <div className="field-queue-actions">
              <span className={`status ${STATE_CLASS[item.estado] || 'neutral'}`}>{STATE_LABEL[item.estado] || item.estado}</span>
              {item.estado === 'error' && (
                <button type="button" className="table-action" disabled={!isOnline} onClick={() => retry(item.hashTransaccion)}>Reintentar</button>
              )}
            </div>
          </li>
        ))}
        {!visible.length && <li className="empty-state">No hay cobros guardados en este celular.</li>}
      </ul>
    </div>
  );
}
