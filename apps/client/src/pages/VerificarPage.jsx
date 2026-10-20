import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatPEN } from '../lib/formato';
import { apiBase } from '../services/session';

// Página pública a la que lleva el QR del recibo: confirma que fue emitido por la municipalidad.
// Solo muestra número, fecha, monto y estado; ningún dato personal.
export function VerificarPage() {
  const { token } = useParams();
  const [estado, setEstado] = useState({ cargando: true });

  useEffect(() => {
    let vigente = true;
    fetch(`${apiBase}/publico/verificar/${encodeURIComponent(token || '')}`)
      .then(async (response) => ({ ok: response.ok, body: await response.json().catch(() => ({})) }))
      .then(({ ok, body }) => vigente && setEstado(ok ? { recibo: body.data } : { error: body.message || 'Recibo no encontrado' }))
      .catch(() => vigente && setEstado({ error: 'Sin conexión: no se pudo verificar el recibo. Inténtelo de nuevo con señal.' }));
    return () => { vigente = false; };
  }, [token]);

  const { recibo } = estado;
  return (
    <section className="portal-screen">
      <div className="portal-card panel">
        <div className="eyebrow">MUNICIPALIDAD DE SALCEDO · VERIFICACIÓN DE RECIBO</div>
        {estado.cargando && <p>Verificando…</p>}
        {estado.error && <><h1>No verificado</h1><div className="form-error">{estado.error}</div></>}
        {recibo && (
          <>
            <h1>{recibo.estado === 'anulado' ? 'Recibo anulado' : 'Recibo auténtico'}</h1>
            <div className="portal-debt">
              <div><span>Número</span><strong>{recibo.numero}</strong></div>
              <div><span>Fecha</span><strong>{recibo.fecha}</strong></div>
              <div><span>Monto</span><strong>{formatPEN(recibo.monto)}</strong></div>
              <div><span>Estado</span><strong><span className={`status ${recibo.estado === 'anulado' ? 'danger' : 'paid'}`}>{recibo.estado === 'anulado' ? 'Anulado' : 'Válido'}</span></strong></div>
            </div>
          </>
        )}
        <p><Link to="/">Ir al inicio</Link></p>
      </div>
    </section>
  );
}
