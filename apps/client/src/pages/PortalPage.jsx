import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiBase } from '../services/session';

// Portal del comerciante: consulta pública de su deuda y sus pagos con el DNI o el código.
export function PortalPage() {
  const [identifier, setIdentifier] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    try {
      const response = await fetch(`${apiBase}/portal/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'No se pudo consultar el portal');
      setData(body.data);
    } catch (portalError) {
      setData(null);
      setError(portalError.message);
    }
  };

  const reminder = data ? `Recordatorio SISREC: saldo pendiente S/ ${data.deuda.saldo.toFixed(2)}` : '';

  return (
    <section className="portal-screen">
      <div className="portal-header">
        <Link className="landing-brand" to="/portal"><span className="brand-mark">S</span><span><strong>SISREC</strong><small>Portal del comerciante</small></span></Link>
        <Link className="login-back" to="/">← Volver a inicio</Link>
      </div>
      {!data ? (
        <form className="portal-login panel" onSubmit={submit}>
          <div className="eyebrow">PORTAL DEL COMERCIANTE</div>
          <h1>Consulta tus pagos</h1>
          <p>Ingresa tu DNI o código de comerciante para revisar tu información.</p>
          <input required placeholder="DNI o código COM-0001" value={identifier} onChange={(event) => setIdentifier(event.target.value)} />
          {error && <div className="form-error">{error}</div>}
          <button className="primary-button" type="submit">Consultar información →</button>
        </form>
      ) : (
        <div className="portal-content">
          <div className="page-heading">
            <div><div className="eyebrow">MI CUENTA / INFORMACIÓN MUNICIPAL</div><h1>Hola, {data.comerciante.nombre}</h1><p>{data.comerciante.codigo} · {data.comerciante.rubro} · {data.comerciante.zona}</p></div>
            <span className="status pending">{data.deuda.saldo > 0 ? `Saldo: S/ ${data.deuda.saldo.toFixed(2)}` : 'Cuenta al día'}</span>
          </div>
          <div className="portal-debt panel">
            <div><span>Periodo</span><strong>{data.deuda.periodo}</strong></div>
            <div><span>Total</span><strong>S/ {data.deuda.monto_total.toFixed(2)}</strong></div>
            <div><span>Pagado</span><strong>S/ {data.deuda.monto_pagado.toFixed(2)}</strong></div>
            <div><span>Saldo pendiente</span><strong>S/ {data.deuda.saldo.toFixed(2)}</strong></div>
          </div>
          <div className="table-card">
            <table>
              <thead><tr><th>Fecha</th><th>Concepto</th><th>Monto</th><th>Método</th><th>Comprobante</th><th>Acción</th></tr></thead>
              <tbody>
                {data.pagos.length ? data.pagos.map((payment) => (
                  <tr key={payment.id}><td>{payment.fecha}</td><td>{payment.concepto}</td><td>S/ {Number(payment.monto).toFixed(2)}</td><td>{payment.metodo_pago}</td><td>{payment.comprobante}</td><td><button className="table-action" type="button" onClick={() => window.print()}>Descargar PDF</button></td></tr>
                )) : <tr><td colSpan="6">Aún no tienes pagos registrados.</td></tr>}
              </tbody>
            </table>
          </div>
          {data.deuda.saldo > 0 && (
            <div className="portal-reminder">
              <strong>Recordatorio de deuda</strong>
              <span>Tu saldo pendiente es de S/ {data.deuda.saldo.toFixed(2)}.</span>
              <button className="secondary-button" type="button" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(reminder)}`, '_blank')}>Enviar recordatorio por WhatsApp</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
