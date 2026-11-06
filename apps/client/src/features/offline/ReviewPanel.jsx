import { useCallback, useEffect, useState } from 'react';

import { apiBase, authFetch } from '../../services/session';

const formatPEN = (value) => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(Number(value) || 0);

async function getJson(path) {
  const response = await authFetch(`${apiBase}${path}`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `Error ${response.status}`);
  return body;
}

/**
 * Revisión manual de cobros offline:
 *  - Observados: el servidor los aceptó (el dinero ya se cobró) pero exceden el saldo o caen en un periodo
 *    sin devengo. El administrador los acepta (p. ej. adelanto) o los anula (devolver el dinero).
 *  - Rechazados: el servidor no pudo registrarlos (datos inválidos); hay que regularizarlos a mano.
 */
export function ReviewPanel({ canResolve, onResolved }) {
  const [tab, setTab] = useState('pendiente');
  const [rows, setRows] = useState([]);
  const [errors, setErrors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [notes, setNotes] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      if (tab === 'rechazados') setErrors((await getJson('/cobros/sincronizacion/errores')).data || []);
      else setRows((await getJson(`/cobros/observados?estado=${tab}`)).data || []);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const resolve = async (row, decision) => {
    const resolucion = String(notes[row.id] || '').trim();
    if (resolucion.length < 5) {
      setMessage('Escribe el motivo de la decisión (al menos 5 caracteres).');
      return;
    }
    if (decision === 'anulado' && !window.confirm(`¿Anular el cobro ${row.comprobante} de ${formatPEN(row.monto)}? Habrá que devolver el dinero al comerciante.`)) return;
    try {
      const response = await authFetch(`${apiBase}/cobros/observados/${row.id}/resolver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, resolucion })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || 'No se pudo registrar la revisión');
      setNotes((current) => ({ ...current, [row.id]: '' }));
      await load();
      setMessage(body.message);
      onResolved?.();
    } catch (error) {
      setMessage(error.message);
    }
  };

  const tabs = [['pendiente', 'Por revisar'], ['aceptado', 'Aceptados'], ['anulado', 'Anulados'], ['rechazados', 'Rechazados']];

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">CONTROL / COBROS OFFLINE</div>
          <h1>Revisión de cobros</h1>
          <p>Cobros hechos sin señal que el sistema registró con observación o que no pudo registrar.</p>
        </div>
        <button type="button" className="secondary-button" onClick={load} disabled={loading}>{loading ? 'Cargando…' : 'Actualizar'}</button>
      </div>

      <div className="review-tabs" role="tablist">
        {tabs.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>
      {message && <div className="form-message">{message}</div>}

      {tab === 'rechazados' ? (
        <div className="table-card">
          <table>
            <thead><tr><th>Recibido</th><th>Dispositivo</th><th>Comerciante</th><th>Monto</th><th>Método</th><th>Motivo del rechazo</th></tr></thead>
            <tbody>
              {errors.map((item) => (
                <tr key={item.id}>
                  <td>{item.procesado || item.recibido}</td>
                  <td>{item.device_id}</td>
                  <td>{item.payload?.comerciante_id ?? '—'}</td>
                  <td>{formatPEN(item.payload?.monto)}</td>
                  <td>{item.payload?.metodo_pago || '—'}</td>
                  <td>{item.error}</td>
                </tr>
              ))}
              {!errors.length && <tr><td colSpan="6">No hay cobros rechazados.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="review-list">
          {rows.map((row) => (
            <article className="panel review-card" key={row.id}>
              <div className="review-card-head">
                <div>
                  <strong>{row.comerciante}</strong>
                  <span>{row.dni_ruc} · cobrado por {row.cobrador} el {row.fecha_cobro}</span>
                </div>
                <span className={`status ${row.estado === 'pendiente' ? 'pending' : row.estado === 'aceptado' ? 'paid' : 'danger'}`}>{row.estado === 'pendiente' ? 'Por revisar' : row.estado}</span>
              </div>
              <div className="review-figures">
                <div><span>Comprobante</span><strong>{row.comprobante}</strong></div>
                <div><span>Monto cobrado</span><strong>{formatPEN(row.monto)}</strong></div>
                <div><span>Saldo al sincronizar</span><strong>{formatPEN(row.saldo_al_sincronizar)}</strong></div>
                <div><span>Método</span><strong>{row.metodo_pago}{row.codigo_operacion && row.metodo_pago !== 'efectivo' ? ` · ${row.codigo_operacion}` : ''}</strong></div>
              </div>
              <p className="review-reason">{row.motivo}</p>
              {row.estado === 'pendiente' ? (
                canResolve ? (
                  <div className="review-actions">
                    <input
                      aria-label={`Motivo de la decisión para ${row.comprobante}`}
                      placeholder="Motivo (p. ej. adelanto del mes siguiente)"
                      value={notes[row.id] || ''}
                      onChange={(event) => setNotes((current) => ({ ...current, [row.id]: event.target.value }))}
                    />
                    <button type="button" className="primary-button compact" onClick={() => resolve(row, 'aceptado')}>Aceptar</button>
                    <button type="button" className="secondary-button danger-button" onClick={() => resolve(row, 'anulado')}>Anular</button>
                  </div>
                ) : <p className="panel-subtitle">Solo el administrador puede aceptar o anular.</p>
              ) : (
                <p className="panel-subtitle">{row.resolucion} — {row.revisado_por}, {row.fecha_revision}</p>
              )}
            </article>
          ))}
          {!rows.length && !loading && <div className="empty-state">No hay cobros en esta lista.</div>}
        </div>
      )}
    </section>
  );
}
