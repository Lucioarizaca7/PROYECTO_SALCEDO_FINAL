import { useSisrec } from '../app/SisrecContext';
import { AsistenciaFerialPanel } from '../features/offline/AsistenciaFerialPanel';
import { FieldWorkPanel } from '../features/offline/FieldWorkPanel';
import { QrScanner } from '../features/payments/QrScanner';
import { printThermalReceipt, shareViaWhatsApp } from '../features/payments/recibo';
import { usePagos } from '../hooks/usePagos';
import { textoTarifa } from '../lib/formato';
import { textoTicket } from '../services/ticketsOffline';
import '../features/payments/pagos.css';

// Meses con saldo desde el inicio de cobro; el cobro se aplica al mes elegido (por omisión, el más antiguo).
function UnpaidMonths({ balance, onSelect }) {
  const deuda = balance?.deuda_acumulada;
  const impagos = (deuda?.periodos || []).filter((item) => item.saldo > 0);
  // Se muestra si debe algún mes anterior o más de un mes; si solo debe el mes en curso, basta el desglose.
  if (!deuda || !impagos.length || (impagos.length === 1 && !impagos[0].vencida)) return null;
  return (
    <div className="debt-months">
      <div><span>Deuda acumulada desde {deuda.desde}</span><strong>S/ {Number(deuda.deuda_total).toFixed(2)}</strong></div>
      <label>
        <span>Aplicar el cobro a</span>
        <select value={balance.periodo} onChange={(event) => onSelect(event.target.value)}>
          {impagos.map((item) => <option key={item.periodo} value={item.periodo}>{item.periodo} · debe S/ {item.saldo.toFixed(2)}{item.vencida ? ' (vencido)' : ''}</option>)}
        </select>
      </label>
    </div>
  );
}

function DebtBreakdown({ balance }) {
  if (!balance) return <div className="empty-state">Busca un comerciante para mostrar su liquidación.</div>;
  return (
    <div className="debt-breakdown">
      {balance.cobro_diario
        ? <><div><span>Cobro del día (eventual)</span><strong>S/ {Number(balance.monto_total || 0).toFixed(2)}</strong></div><div><span>Día</span><strong>{balance.dia}</strong></div></>
        : <><div><span>Tarifa</span><strong>{textoTarifa(balance)}</strong></div><div><span>Periodo</span><strong>{balance.periodo}</strong></div></>}
      <div><span>Pagado</span><strong>S/ {Number(balance.monto_pagado || 0).toFixed(2)}</strong></div>
      <div className="debt-total"><span>Saldo pendiente</span><strong>S/ {balance.saldo.toFixed(2)}</strong></div>
    </div>
  );
}

// Tickets preimpresos: qué números entregar (los siguientes del lote del cobrador), cuántos por serie y
// el botón para anular uno dañado. El monto del cobro es lo que valen los tickets.
function TicketsDelCobro({ pagos }) {
  const { requeridos, entrega, cambiarTickets, anularTicket, tickets } = pagos;
  const monto = requeridos.reduce((total, item) => total + item.valor * item.cantidad, 0);
  return (
    <div className="ticket-panel" aria-label="Tickets a entregar">
      {requeridos.map((item) => (
        <div className="ticket-row" key={item.serie}>
          <span>Tickets de S/ {item.valor.toFixed(2)} ({item.serie}) · quedan {tickets.estado.series[item.serie]?.disponibles.length ?? 0}</span>
          <div className="ticket-stepper">
            <button className="secondary-button compact" type="button" aria-label={`Un ticket ${item.serie} menos`} onClick={() => cambiarTickets(item.serie, -1)}>−</button>
            <strong>{item.cantidad}</strong>
            <button className="secondary-button compact" type="button" aria-label={`Un ticket ${item.serie} más`} onClick={() => cambiarTickets(item.serie, 1)}>+</button>
          </div>
        </div>
      ))}
      <div className="ticket-entrega">
        <span>Cobrar S/ {monto.toFixed(2)}</span>
        <strong>{entrega.tickets.length ? `Entregar ${entrega.tickets.length === 1 ? 'ticket' : 'tickets'} ${entrega.tickets.map((ticket) => textoTicket(ticket.serie, ticket.numero)).join(', ')}` : 'Sin tickets que entregar'}</strong>
      </div>
      {entrega.faltan.length > 0 && <div className="form-message">No te quedan tickets suficientes de {entrega.faltan.map((item) => item.serie).join(' y ')}.</div>}
      <div className="ticket-chips">
        {entrega.tickets.map((ticket) => (
          <button key={`${ticket.serie}-${ticket.numero}`} className="secondary-button compact" type="button" onClick={() => anularTicket(ticket)}>Anular {textoTicket(ticket.serie, ticket.numero)}</button>
        ))}
      </div>
      {tickets.anulacionesPendientes > 0 && <small>{tickets.anulacionesPendientes} anulación(es) por subir.</small>}
    </div>
  );
}

function AvisoPocosTickets({ tickets }) {
  if (!tickets.pocos.length) return null;
  return (
    <div className="offline-banner" role="status">
      {tickets.pocos.map((item) => `Te quedan ${item.quedan} tickets de S/ ${item.valor.toFixed(2)} (${item.serie})`).join(' · ')}. Pide un lote nuevo a la oficina.
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
        {receipt.tickets?.length > 0 && <div><span>Tickets</span><strong>{receipt.tickets.map((ticket) => ticket.texto || textoTicket(ticket.serie, ticket.numero)).join(', ')}</strong></div>}
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

function RecentPayments({ cobros, puedeAnular, onAnular }) {
  return (
    <div className="panel payment-history">
      <div className="panel-heading"><div><div className="panel-title">Cobros recientes</div><div className="panel-subtitle">Estado actualizado al instante</div></div></div>
      {cobros.slice(0, 6).map((item, index) => (
        <div className="payment-row" key={item.comprobante || index}>
          <div><strong>{item.comprobante || `#${item.id}`}</strong><span>{item.comerciante} · {item.metodo_pago}</span></div>
          <div><strong>{typeof item.monto === 'number' ? `S/ ${item.monto.toFixed(2)}` : item.monto}</strong><span className={`status ${item.estado === 'observado' ? 'pending' : item.estado === 'anulado' ? 'danger' : 'paid'}`}>{item.estado}</span></div>
          {item.estado === 'anulado' && item.motivo_anulacion && <small className="payment-void-reason">Anulado: {item.motivo_anulacion}</small>}
          {puedeAnular && item.estado === 'confirmado' && <button className="secondary-button payment-void" type="button" onClick={() => onAnular(item)}>Anular</button>}
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
      <AvisoPocosTickets tickets={pagos.tickets} />
      <div className="payment-workspace">
        <form className="panel payment-form" onSubmit={pagos.submit}>
          <div className="step-label">01 · Localizar comerciante</div>
          {/* Enter busca. El campo está dentro del formulario del cobro: sin el onKeyDown, Enter enviaba
              "Confirmar y emitir comprobante" y cobraba al comerciante que ya estaba en pantalla. */}
          <div className="payment-search">
            <input required aria-label="Buscar comerciante por documento, nombre, puesto o QR" placeholder="DNI, RUC, nombre, puesto o QR" value={form.search} onChange={(event) => setForm({ ...form, search: event.target.value })}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); pagos.findMerchant(); } }} />
            <button className="primary-button" type="button" onClick={pagos.findMerchant}>Buscar</button>
            <button className="secondary-button qr-open-button" type="button" onClick={() => pagos.setShowQrScanner(true)} aria-label="Escanear código QR">▦ <span>Escanear QR</span></button>
          </div>
          {merchant && <div className="merchant-summary"><strong>{merchant.nombre}</strong><span>{merchant.dni_ruc} · {merchant.rubro} · {merchant.zona}</span>{merchant.codigo && <span>Código: {merchant.codigo}</span>}{merchant.codigo_puesto && <span>Puesto: {merchant.codigo_puesto}</span>}</div>}
          {merchant && balance && (
            <div className="panel express-card">
              <div className="express-head">
                <div>
                  <div className="eyebrow">MODO EXPRESS</div>
                  <strong>{merchant.nombre}</strong>
                </div>
                <button className="primary-button" type="button" onClick={pagos.applySuggestion}>Cobrar sugerido</button>
              </div>
              <div className="express-grid">
                <div><span>Saldo pendiente</span><strong>S/ {Number(balance.saldo || 0).toFixed(2)}</strong></div>
                <div><span>Sugerencia</span><strong>S/ {Number(suggestion.suggestedAmount || 0).toFixed(2)}</strong></div>
                <div><span>Método preferido</span><strong>{String(suggestion.preferredMethod || 'efectivo').toUpperCase()}</strong></div>
              </div>
              <div className="express-last">{suggestion.lastLabel}</div>
            </div>
          )}
          <div className="step-label">02 · Revisar deuda</div>
          <UnpaidMonths balance={balance} onSelect={pagos.elegirPeriodo} />
          <DebtBreakdown balance={balance} />
          <div className="step-label">03 · Confirmar cobro</div>
          {pagos.usaTickets && <TicketsDelCobro pagos={pagos} />}
          <div className="payment-fields">
            <input required min="0.01" max={balance?.saldo || undefined} step="0.01" type="number" placeholder="Monto a cobrar" aria-label="Monto a cobrar" readOnly={pagos.usaTickets} title={pagos.usaTickets ? 'El monto es lo que valen los tickets a entregar' : undefined} value={form.monto} onChange={(event) => setForm({ ...form, monto: event.target.value })} />
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
          <AsistenciaFerialPanel isOnline={isOnline} jornada={jornada} />
          <RecentPayments cobros={cobros} puedeAnular={pagos.puedeAnular} onAnular={pagos.anularCobro} />
        </div>
      </div>
      {pagos.showQrScanner && <QrScanner onScan={pagos.scanQr} onClose={() => pagos.setShowQrScanner(false)} />}
    </section>
  );
}
