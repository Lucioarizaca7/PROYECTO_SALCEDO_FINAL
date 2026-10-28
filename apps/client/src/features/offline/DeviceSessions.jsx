import { useCallback, useEffect, useState } from 'react';

import { apiBase, authFetch } from '../../services/session';

const formatTime = (value) => (value ? new Date(value).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }) : '—');

/**
 * Sesiones abiertas por dispositivo (token de renovación de 12 h). El administrador ve todas y puede
 * revocar la de un celular perdido o de un cobrador que dejó el puesto: el celular deberá ingresar de nuevo.
 */
export function DeviceSessions() {
  const [rows, setRows] = useState([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authFetch(`${apiBase}/auth/sesiones`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || 'No se pudieron cargar las sesiones');
      setRows(body.data || []);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const revoke = async (row) => {
    if (!window.confirm(`¿Cerrar la sesión de ${row.usuario} en "${row.device_nombre || row.device_id}"?`)) return;
    const response = await authFetch(`${apiBase}/auth/sesiones/${row.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motivo: 'Revocada desde el panel de dispositivos' })
    });
    const body = await response.json().catch(() => ({}));
    setMessage(body.message || (response.ok ? 'Sesión revocada' : 'No se pudo revocar'));
    await load();
  };

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">SEGURIDAD / DISPOSITIVOS</div>
          <h1>Sesiones por dispositivo</h1>
          <p>Cada celular conserva su sesión hasta 12 horas sin pedir la clave. Revoca la de un equipo perdido o que ya no se usa.</p>
        </div>
        <button type="button" className="secondary-button" onClick={load} disabled={loading}>{loading ? 'Cargando…' : 'Actualizar'}</button>
      </div>
      {message && <div className="form-message">{message}</div>}
      <div className="table-card">
        <table>
          <thead><tr><th>Usuario</th><th>Rol</th><th>Dispositivo</th><th>Inicio</th><th>Último uso</th><th>Vence</th><th>Acción</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.usuario}<br /><small>{row.email}</small></td>
                <td>{row.rol}</td>
                <td>{row.device_nombre || 'Sin nombre'}<br /><small>{row.ip_origen || ''}</small></td>
                <td>{formatTime(row.creado_en)}</td>
                <td>{formatTime(row.ultimo_uso_en)}</td>
                <td>{formatTime(row.expira_en)}</td>
                <td>{row.actual ? <span className="status paid">Esta sesión</span> : <button type="button" className="table-action peligro" onClick={() => revoke(row)}>Revocar</button>}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan="7">No hay sesiones abiertas.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
