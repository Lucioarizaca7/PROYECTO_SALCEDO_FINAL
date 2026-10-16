import { useSisrec } from '../app/SisrecContext';
import { FieldWorkPanel } from '../features/offline/FieldWorkPanel';
import { QrScanner } from '../features/payments/QrScanner';
import { printThermalReceipt, shareViaWhatsApp } from '../features/payments/recibo';
import { usePagos } from '../hooks/usePagos';

const muted = { display: 'block', fontSize: '12px', color: 'var(--civic-muted)' };

function DebtBreakdown({ balance }) {
  if (!balance) return <div className="empty-state">Busca un comerciante para mostrar su liquidación.</div>;
  return (
    <div className="debt-breakdown">
      {balance.cobro_diario
        ? <><div><span>Cobro del día (eventual)</span><strong>S/ {Number(balance.monto_total || 0).toFixed(2)}</strong></div><div><span>Día</span><strong>{balance.dia}</strong></div></>
        : <><div><span>Tarifa</span><strong>S/ {(balance.tarifa?.monto_fijo ?? 0)}</strong></div><div><span>Periodo</span><strong>{balance.periodo}</strong></div></>}
      <div><span>Pagado</span><strong>S/ {Number(balance.monto_pagado || 0).toFixed(2)}</strong></div>
      <div className="debt-total"><span>Saldo pendiente</span><strong>S/ {balance.saldo.toFixed(2)}</strong></div>
    </div>
  );
}

function ReceiptCard({ receipt, printStatus, setPrintStatus }) {
  const shareText = () => (navigator.share
    ? navigator.share({ title: `Recibo ${receipt.comprobante}`, text: `Recibo ${receipt.comprobante} por S/ ${receipt.monto.toFixed(2)}` })
    : navigator.clipboard?.writeText(`Recibo ${receipt.comprobante} - S/ ${receipt.monto.toFixed(2)}`));
  return (
    <div className="receipt-card" id="receiptCard">
      <div className="receipt-header"><strong>SISREC SALCEDO</strong><span>RECIBO DE PAGO</span></div>
      <div className="receipt-number">{receipt.comprobante}</div>
      {receipt.provisional && <div className="receipt-provisional">Recibo provisional: el número oficial se asigna al sincronizar.</div>}
      <div className="receipt-lines">
        <div><span>Comerciante</span><strong>{receipt.comerciante}</strong></div>
        <div><span>Fecha</span><strong>{new Date().toLocaleString('es-PE')}</strong></div>
        <div><span>Concepto</span><strong>{receipt.concepto}</strong></div>
        <div><span>Método</span><strong>{receipt.metodo_pago}</strong></div>
        <div><span>Cobrador</span><strong>{receipt.cobrador}</strong></div>
        <div><span>Operación</span><strong>{receipt.codigo_operacion || 'No aplica'}</strong></div>
        <div><span>Hash</span><strong>{receipt.hash_idempotencia || 'N/A'}</strong></div>
        <div className="receipt-total"><span>Total pagado</span><strong>S/ {receipt.monto.toFixed(2)}</strong></div>
      </div>
      <div className="receipt-actions">
        <button className="secondary-button" type="button" onClick={() => printThermalReceipt(receipt, setPrintStatus)}>{printStatus.isPrinting ? 'Imprimiendo...' : 'Imprimir térmica / PDF'}</button>
        <button className="secondary-button" type="button" onClick={() => shareViaWhatsApp(receipt)}>WhatsApp</button>
        <button className="secondary-button" type="button" onClick={shareText}>Compartir</button>
      </div>
    </div>
  );
}

function RecentPayments({ cobros }) {
  return (
    <div className="panel payment-history">
      <div className="panel-heading"><div><div className="panel-title">Cobros recientes</div><div className="panel-subtitle">Estado actualizado al instante</div></div></div>
      {cobros.slice(0, 6).map((item, index) => (
        <div className="payment-row" key={item.comprobante || index}>
          <div><strong>{item.comprobante || `#${item.id}`}</strong><span>{item.comerciante} · {item.metodo_pago}</span></div>
          <div><strong>{typeof item.monto === 'number' ? `S/ ${item.monto.toFixed(2)}` : item.monto}</strong><span className={`status ${item.estado === 'observado' ? 'pending' : item.estado === 'anulado' ? 'danger' : 'paid'}`}>{item.estado}</span></div>
        </div>
      ))}
    </div>
  );
}

export function PagosPage() {
  const { isOnline, jornada, offlineQueue, cobros } = useSisrec();
  const pagos = usePagos();
  const { form, setForm, merchant, balance, suggestion } = pagos;

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">COBRO / CAMPO Y VENTANILLA</div>
          <h1>Cobro rápido</h1>
          <p>Localiza al comerciante, revisa su saldo y confirma el pago.</p>
        </div>
      </div>
      {!isOnline && <div className="offline-banner">Sin señal: la búsqueda usa el padrón guardado y los cobros se guardan en el celular.</div>}
      <div className="payment-workspace">
        <form className="panel payment-form" onSubmit={pagos.submit}>
          <div className="step-label">01 · Localizar comerciante</div>
          <div className="payment-search">
            <input required aria-label="Buscar comerciante por documento, nombre, puesto o QR" placeholder="DNI, RUC, nombre, puesto o QR" value={form.search} onChange={(event) => setForm({ ...form, search: event.target.value })} />
            <button className="primary-button" type="button" onClick={pagos.findMerchant}>Buscar</button>
            <button className="secondary-button qr-open-button" type="button" onClick={() => pagos.setShowQrScanner(true)} aria-label="Escanear código QR">▦ <span>Escanear QR</span></button>
          </div>
          {merchant && <div className="merchant-summary"><strong>{merchant.nombre}</strong><span>{merchant.dni_ruc} · {merchant.rubro} · {merchant.zona}</span><span>Puesto: {merchant.codigo}</span></div>}
          {merchant && balance && (
            <div className="panel express-card" style={{ background: 'linear-gradient(135deg, rgba(39,174,96,0.12), rgba(15,23,42,0.08))', border: '1px solid rgba(39,174,96,0.3)', padding: '16px', borderRadius: '14px', marginTop: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                <div>
                  <div className="eyebrow" style={{ color: '#1f9d63' }}>MODO EXPRESS</div>
                  <strong>{merchant.nombre}</strong>
                </div>
                <button className="primary-button" type="button" onClick={pagos.applySuggestion}>Cobrar sugerido</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginTop: '14px' }}>
                <div><span style={muted}>Saldo pendiente</span><strong>S/ {Number(balance.saldo || 0).toFixed(2)}</strong></div>
                <div><span style={muted}>Sugerencia</span><strong>S/ {Number(suggestion.suggestedAmount || 0).toFixed(2)}</strong></div>
                <div><span style={muted}>Método preferido</span><strong>{String(suggestion.preferredMethod || 'efectivo').toUpperCase()}</strong></div>
              </div>
              <div style={{ marginTop: '12px', fontWeight: 600, color: '#0f172a' }}>{suggestion.lastLabel}</div>
            </div>
          )}
          <div className="step-label">02 · Revisar deuda</div>
          <DebtBreakdown balance={balance} />
          <div className="step-label">03 · Confirmar cobro</div>
          <div className="payment-fields">
            <input required min="0.01" max={balance?.saldo || undefined} step="0.01" type="number" placeholder="Monto a cobrar" value={form.monto} onChange={(event) => setForm({ ...form, monto: event.target.value })} />
            <select value={form.metodo_pago} onChange={(event) => setForm({ ...form, metodo_pago: event.target.value })}><option value="efectivo">Efectivo</option><option value="yape">Yape</option><option value="plin">Plin</option><option value="pos">POS</option></select>
          </div>
          {form.metodo_pago !== 'efectivo' && <input required placeholder="Código de operación digital" value={form.codigo_operacion} onChange={(event) => setForm({ ...form, codigo_operacion: event.target.value })} />}
          <input placeholder="Observaciones (opcional)" value={form.observaciones} onChange={(event) => setForm({ ...form, observaciones: event.target.value })} />
          {pagos.message && <div className="form-message">{pagos.message}</div>}
          <button className="primary-button payment-submit" disabled={!merchant || !balance || balance.saldo <= 0} type="submit">Confirmar y emitir comprobante</button>
          {pagos.receipt && <ReceiptCard receipt={pagos.receipt} printStatus={pagos.printStatus} setPrintStatus={pagos.setPrintStatus} />}
        </form>
        <div className="payment-side">
          <FieldWorkPanel isOnline={isOnline} jornada={jornada} queue={offlineQueue} />
          <RecentPayments cobros={cobros} />
        </div>
      </div>
      {pagos.showQrScanner && <QrScanner onScan={pagos.scanQr} onClose={() => pagos.setShowQrScanner(false)} />}
    </section>
  );
}
