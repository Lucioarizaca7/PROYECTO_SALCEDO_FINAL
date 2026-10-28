import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiBase } from '../services/session';

// "/portal#llave=XXXX" viene del QR del reverso del carnet. El fragmento (#) no viaja al servidor.
const llaveDelEnlace = () => new URLSearchParams(window.location.hash.slice(1)).get('llave') || '';

// Portal del comerciante: consulta de su deuda y sus pagos con el DNI o el código y el PIN o la llave
// de su carnet, o con la llave sola desde el QR. No se guarda ninguna sesión en el celular.
export function PortalPage() {
  const [modo, setModo] = useState('llave');
  const [identifier, setIdentifier] = useState('');
  const [pin, setPin] = useState('');
  const [llave, setLlave] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [consultando, setConsultando] = useState(false);

  const consultar = async (credencial) => {
    setError('');
    setConsultando(true);
    try {
      const response = await fetch(`${apiBase}/portal/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credencial) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'No se pudo consultar el portal');
      setData(body.data);
    } catch (portalError) {
      setData(null);
      setError(portalError.message);
    } finally {
      setPin('');
      setLlave('');
      setConsultando(false);
    }
  };

  // Al llegar desde el QR: entra con la llave y la borra de la barra de direcciones y del historial.
  useEffect(() => {
    const desdeQr = llaveDelEnlace();
    if (!desdeQr) return;
    window.history.replaceState(null, '', window.location.pathname);
    consultar({ llave: desdeQr });
  }, []);

  const submit = (event) => {
    event.preventDefault();
    consultar(modo === 'pin' ? { identifier, pin } : { identifier, llave });
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
          <p>Escanea con tu celular el QR del reverso de tu carnet, o escribe tu DNI o código y la llave o el PIN de tu carnet.</p>
          <div className="segmentos" role="group" aria-label="Cómo quieres ingresar">
            <button type="button" className={modo === 'llave' ? 'activo' : ''} aria-pressed={modo === 'llave'} onClick={() => setModo('llave')}>Con llave</button>
            <button type="button" className={modo === 'pin' ? 'activo' : ''} aria-pressed={modo === 'pin'} onClick={() => setModo('pin')}>Con PIN</button>
          </div>
          <input required autoComplete="username" placeholder="DNI o código COM-0001" value={identifier} onChange={(event) => setIdentifier(event.target.value)} aria-label="DNI o código de comerciante" />
          {modo === 'pin'
            ? <input required inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} placeholder="PIN de 6 dígitos" aria-label="PIN del portal" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))} />
            : <input required autoComplete="current-password" autoCapitalize="characters" spellCheck="false" maxLength={14} placeholder="Llave XXXX-XXXX-XX" aria-label="Llave del carnet" value={llave} onChange={(event) => setLlave(event.target.value.toUpperCase())} />}
          <small className="portal-pin-help">¿No tienes carnet o lo perdiste? Pídelo en la municipalidad: el anterior dejará de funcionar.</small>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="primary-button" type="submit" disabled={consultando}>{consultando ? 'Consultando…' : 'Consultar información →'}</button>
        </form>
      ) : (
        <div className="portal-content">
          <div className="page-heading">
            <div><div className="eyebrow">MI CUENTA / INFORMACIÓN MUNICIPAL</div><h1>Hola, {data.comerciante.nombre}</h1><p>{data.comerciante.codigo} · {data.comerciante.rubro} · {data.comerciante.zona}{data.comerciante.documento ? ` · Doc. ${data.comerciante.documento}` : ''}</p></div>
            <span className="status pending">{data.deuda.saldo > 0 ? `Saldo: S/ ${data.deuda.saldo.toFixed(2)}` : 'Cuenta al día'}</span>
          </div>
          <div className="portal-debt panel">
            <div><span>Periodo</span><strong>{data.deuda.periodo}</strong></div>
            <div><span>Total</span><strong>S/ {data.deuda.monto_total.toFixed(2)}</strong></div>
            <div><span>Pagado</span><strong>S/ {data.deuda.monto_pagado.toFixed(2)}</strong></div>
            <div><span>Saldo pendiente</span><strong>S/ {data.deuda.saldo.toFixed(2)}</strong></div>
            {data.deuda.deuda_vencida > 0 && <div><span>Meses anteriores</span><strong>S/ {data.deuda.deuda_vencida.toFixed(2)}</strong></div>}
          </div>
          {data.deuda.meses_impagos?.length > 0 && (
            <div className="table-card">
              <table>
                <thead><tr><th>Mes impago</th><th>Debe</th></tr></thead>
                <tbody>
                  {data.deuda.meses_impagos.map((mes) => <tr key={mes.periodo}><td>{mes.periodo}</td><td>S/ {Number(mes.saldo).toFixed(2)}</td></tr>)}
                </tbody>
                <tfoot><tr><td><strong>Total adeudado</strong></td><td><strong>S/ {Number(data.deuda.deuda_total || 0).toFixed(2)}</strong></td></tr></tfoot>
              </table>
            </div>
          )}
          <div className="table-card">
            <table>
              <thead><tr><th>Fecha</th><th>Concepto</th><th>Monto</th><th>Método</th><th>Comprobante</th><th>Acción</th></tr></thead>
              <tbody>
                {data.pagos.length ? data.pagos.map((payment) => (
                  <tr key={payment.id}><td>{payment.fecha}</td><td>{payment.concepto}</td><td>S/ {Number(payment.monto).toFixed(2)}</td><td>{payment.metodo_pago}</td><td>{payment.comprobante}</td><td>{payment.descarga ? <a className="table-action" href={`${apiBase}/portal/recibos/${payment.descarga}/pdf`} download>Descargar PDF</a> : '—'}</td></tr>
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
