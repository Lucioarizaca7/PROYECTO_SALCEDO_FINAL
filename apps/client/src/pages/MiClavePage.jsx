import { useState } from 'react';
import { MIN_CLAVE } from '../hooks/useUsuarios';
import { apiBase, authFetch, leerJson } from '../services/session';

const VACIO = { actual: '', nueva: '', confirmacion: '' };

// Mi clave: cada persona del personal cambia su propia clave, por ejemplo la que le entregó el super_admin.
// No es obligatorio (decisión del 13/11/2026). El servidor pide la actual y cierra sus otras sesiones.
export function MiClavePage() {
  const [form, setForm] = useState(VACIO);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const campo = (nombre) => (event) => setForm({ ...form, [nombre]: event.target.value });
  const coinciden = form.nueva === form.confirmacion;

  const guardar = async (event) => {
    event.preventDefault();
    setMessage('');
    setError('');
    if (!coinciden) {
      setError('Las dos claves nuevas no coinciden');
      return;
    }
    setOcupado(true);
    try {
      const response = await authFetch(`${apiBase}/auth/mi-clave`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actual: form.actual, nueva: form.nueva })
      });
      const data = await leerJson(response);
      if (!response.ok) throw new Error(data.message || 'No se pudo cambiar la clave');
      setForm(VACIO);
      setMessage(data.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">CONFIGURACIÓN / MI CLAVE</div>
          <h1>Mi clave</h1>
          <p>Cambie la clave con la que entra a SISREC, por ejemplo la que le entregó el super administrador. Las sesiones abiertas en otros celulares o computadoras se cerrarán.</p>
        </div>
      </div>

      {message && <div className="form-message">{message}</div>}
      {error && <div className="form-error" role="alert">{error}</div>}

      <div className="panel detail-card mi-clave">
        <form className="merchant-form" onSubmit={guardar}>
          <div className="merchant-form-grid">
            <input required type="password" autoComplete="current-password" placeholder="Clave actual" aria-label="Clave actual" value={form.actual} onChange={campo('actual')} />
            <input required type="password" minLength={MIN_CLAVE} autoComplete="new-password" placeholder={`Clave nueva (mín. ${MIN_CLAVE} caracteres)`} aria-label="Clave nueva" value={form.nueva} onChange={campo('nueva')} />
            <input required type="password" minLength={MIN_CLAVE} autoComplete="new-password" placeholder="Repita la clave nueva" aria-label="Repita la clave nueva" value={form.confirmacion} onChange={campo('confirmacion')} />
            {!coinciden && form.confirmacion && <span className="usuario-clave-aviso">No coinciden</span>}
            <button className="primary-button" type="submit" disabled={ocupado || !coinciden}>Cambiar mi clave</button>
          </div>
        </form>
      </div>
    </section>
  );
}
