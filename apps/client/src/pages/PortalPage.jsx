import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiBase, leerJson } from '../services/session';
import { textoMetodo } from '../lib/formato';
import { QrScanner } from '../features/payments/QrScanner';
import { llaveDelFragmento, llaveDesdeQr } from '../features/portal/llaveQr';

const TEXTOS_LECTOR = {
  eyebrow: 'PORTAL DEL COMERCIANTE',
  instruccion: 'Apunta el QR del reverso de tu carnet',
  detectado: 'Carnet detectado. Consultando tu cuenta...',
  sinLectura: 'No se detectó el QR en 10 segundos. Acerca el carnet con buena luz o escribe tu llave.',
  cerrar: 'Cerrar y escribir la llave'
};

// Portal del comerciante (Penpot P3): consulta de su deuda y sus pagos con el DNI o el código y la llave de
// su carnet, o con la llave sola al escanear el QR del reverso. No se guarda ninguna sesión en el celular.
export function PortalPage() {
  const [identifier, setIdentifier] = useState('');
  const [llave, setLlave] = useState('');
  const [escaneando, setEscaneando] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [consultando, setConsultando] = useState(false);

  const consultar = async (credencial) => {
    setError('');
    setConsultando(true);
    try {
      const response = await fetch(`${apiBase}/portal/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credencial) });
      const body = await leerJson(response);
      if (!response.ok) throw new Error(body.message || 'No se pudo consultar el portal');
      setData(body.data);
    } catch (portalError) {
      setData(null);
      setError(portalError.message);
    } finally {
      setLlave('');
      setConsultando(false);
    }
  };

  // Al llegar desde el QR (cámara del celular): entra con la llave y la borra de la barra de direcciones y del historial.
  useEffect(() => {
    const desdeQr = llaveDelFragmento(window.location.hash);
    if (!desdeQr) return;
    window.history.replaceState(null, '', window.location.pathname);
    consultar({ llave: desdeQr });
  }, []);

  const submit = (event) => {
    event.preventDefault();
    consultar({ identifier, llave });
  };

  // Lector del portal: solo sirve el QR del reverso; el del frente es para el cobrador.
  const alEscanear = (texto) => {
    setEscaneando(false);
    const leida = llaveDesdeQr(texto);
    if (leida) consultar({ llave: leida });
    else setError('Ese QR no es el del reverso de tu carnet. Voltea el carnet y escanea el QR que está junto a la llave.');
  };

  // La deuda que importa es la total (meses anteriores + mes en curso): con solo el mes en curso, alguien
  // con meses atrasados veía "Cuenta al día".
  const deudaTotal = data ? Number(data.deuda.deuda_total ?? (Number(data.deuda.saldo || 0) + Number(data.deuda.deuda_vencida || 0))) : 0;
  const reminder = data ? `Recordatorio SISREC: deuda pendiente S/ ${deudaTotal.toFixed(2)}` : '';

  return (
    <section className="portal-screen">
      <div className="portal-header">
        <Link className="landing-brand" to="/portal"><span className="brand-mark">S</span><span><strong>SISREC</strong><small>Portal del comerciante</small></span></Link>
        <Link className="login-back" to="/">← Volver a inicio</Link>
      </div>
      {!data ? (
        <form className="portal-login panel" onSubmit={submit}>
          <div className="eyebrow">PORTAL DEL COMERCIANTE</div>
          <h1>Mira tus pagos y tu deuda</h1>
          <p>Necesitas el carnet que te dieron en la municipalidad.</p>
          <label htmlFor="portal-identificador">DNI o código del carnet</label>
          <input id="portal-identificador" required autoComplete="username" placeholder="41258796 o COM-0012-…" value={identifier} onChange={(event) => setIdentifier(event.target.value)} />
          <label htmlFor="portal-llave">Llave del carnet (reverso)</label>
          <input id="portal-llave" required autoComplete="current-password" autoCapitalize="characters" spellCheck="false" maxLength={14} placeholder="XXXX-XXXX-XX" value={llave} onChange={(event) => setLlave(event.target.value.toUpperCase())} />
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="primary-button" type="submit" disabled={consultando}>{consultando ? 'Consultando…' : 'Ingresar'}</button>
          <button className="secondary-button portal-escanear" type="button" disabled={consultando} onClick={() => { setError(''); setEscaneando(true); }}>Escanear el QR del reverso</button>
          <div className="portal-ayuda">
            <strong>¿Perdiste tu carnet?</strong>
            <span>Pide uno nuevo en la municipalidad. El anterior deja de funcionar al instante.</span>
          </div>
        </form>
      ) : (
        <div className="portal-content">
          <div className="page-heading">
            <div><div className="eyebrow">MI CUENTA / INFORMACIÓN MUNICIPAL</div><h1>Hola, {data.comerciante.nombre}</h1><p>{data.comerciante.codigo} · {data.comerciante.rubro} · {data.comerciante.zona}{data.comerciante.documento ? ` · Doc. ${data.comerciante.documento}` : ''}</p></div>
            {data.deuda.sin_tarifa && !deudaTotal
              ? <span className="status pending">Sin tarifa vigente</span>
              : <span className={`status ${deudaTotal > 0 ? 'pending' : 'paid'}`}>{deudaTotal > 0 ? `Debe: S/ ${deudaTotal.toFixed(2)}` : 'Cuenta al día'}</span>}
          </div>
          {/* Sin tarifa vigente el servidor no puede calcular el mes: no se dice "al día" (podría no estarlo). */}
          {data.deuda.sin_tarifa ? (
            <div className="offline-banner" role="status">Aún no hay una tarifa vigente para su puesto: consulte en la municipalidad. Sus pagos y recibos están abajo.</div>
          ) : (
          <div className="portal-debt panel">
            <div><span>Periodo</span><strong>{data.deuda.periodo}</strong></div>
            <div><span>Total</span><strong>S/ {data.deuda.monto_total.toFixed(2)}</strong></div>
            <div><span>Pagado</span><strong>S/ {data.deuda.monto_pagado.toFixed(2)}</strong></div>
            <div><span>Saldo pendiente</span><strong>S/ {data.deuda.saldo.toFixed(2)}</strong></div>
            {data.deuda.deuda_vencida > 0 && <div><span>Meses anteriores</span><strong>S/ {data.deuda.deuda_vencida.toFixed(2)}</strong></div>}
          </div>
          )}
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
              <thead><tr><th>Fecha</th><th>Concepto</th><th>Monto</th><th>Método</th><th>Comprobante</th><th>Estado</th><th>Acción</th></tr></thead>
              <tbody>
                {data.pagos.length ? data.pagos.map((payment) => (
                  <tr key={payment.id} className={payment.estado === 'anulado' ? 'fila-anulada' : undefined}>
                    <td>{payment.fecha}</td><td>{payment.concepto}</td><td>S/ {Number(payment.monto).toFixed(2)}</td><td>{textoMetodo(payment.metodo_pago)}</td><td>{payment.comprobante}</td>
                    {/* Un pago anulado no cuenta como pagado: se dice, en vez de mostrarlo como válido. */}
                    <td><span className={`status ${payment.estado === 'anulado' ? 'danger' : payment.estado === 'confirmado' ? 'paid' : 'pending'}`}>{payment.estado === 'anulado' ? 'Anulado' : payment.estado === 'confirmado' ? 'Válido' : 'En revisión'}</span></td>
                    <td>{payment.descarga ? <a className="table-action" href={`${apiBase}/portal/recibos/${payment.descarga}/pdf`} download>Descargar PDF</a> : '—'}</td>
                  </tr>
                )) : <tr><td colSpan="7">Aún no tienes pagos registrados.</td></tr>}
              </tbody>
            </table>
          </div>
          {deudaTotal > 0 && (
            <div className="portal-reminder">
              <strong>Recordatorio de deuda</strong>
              <span>Tu deuda pendiente es de S/ {deudaTotal.toFixed(2)}{data.deuda.deuda_vencida > 0 ? `, de la que S/ ${Number(data.deuda.deuda_vencida).toFixed(2)} es de meses anteriores` : ''}.</span>
              <button className="secondary-button" type="button" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(reminder)}`, '_blank')}>Enviar recordatorio por WhatsApp</button>
            </div>
          )}
        </div>
      )}
      {escaneando && <QrScanner textos={TEXTOS_LECTOR} onScan={alEscanear} onClose={() => setEscaneando(false)} />}
    </section>
  );
}
