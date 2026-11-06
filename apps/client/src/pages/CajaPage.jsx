import { useSisrec } from '../app/SisrecContext';
import { METODOS_CAJA, useCaja } from '../hooks/useCaja';
import { formatPEN } from '../lib/formato';

const textoDiferencia = (valor) => (valor === 0 ? 'Cuadra' : valor > 0 ? `Sobran ${formatPEN(valor)}` : `Faltan ${formatPEN(Math.abs(valor))}`);
const claseDiferencia = (valor) => (valor === 0 ? 'paid' : valor > 0 ? 'pending' : 'danger');

const numero = (valor) => String(valor).padStart(6, '0');

// Tickets preimpresos del día: por serie, y lo que hay que revisar (saltos de numeración, cobros observados
// por un ticket y la diferencia entre lo cobrado con ticket y lo que valen los tickets usados).
function TicketsDelDia({ tickets }) {
  if (!tickets?.series?.length) return null;
  return (
    <div className="panel">
      <div className="panel-title">Tickets del día{tickets.alertas ? ` · ${tickets.alertas} alerta(s) por revisar` : ' · sin alertas'}</div>
      <div className="table-card">
        <table>
          <thead><tr><th>Serie</th><th>Asignados</th><th>Usados hoy</th><th>Anulados hoy</th><th>Devueltos hoy</th><th>Disponibles</th><th>Valor usado</th></tr></thead>
          <tbody>
            {tickets.series.map((serie) => (
              <tr key={serie.serie}>
                <td>{serie.serie} (S/ {serie.valor.toFixed(2)})</td><td>{serie.asignados}</td><td>{serie.usados}</td><td>{serie.anulados}</td>
                <td>{serie.devueltos}</td><td>{serie.disponibles}</td><td>{formatPEN(serie.monto_tickets)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Cobrado con ticket: {formatPEN(tickets.cobrado_con_ticket)} en {tickets.cobros_con_ticket} cobro(s) ·{' '}
        <span className={`status ${claseDiferencia(tickets.diferencia)}`}>{tickets.diferencia === 0 ? 'Cuadra con los tickets' : `Diferencia ${formatPEN(tickets.diferencia)}`}</span>
      </p>
      {tickets.series.filter((serie) => serie.saltos.length).map((serie) => (
        <div className="form-message" key={`saltos-${serie.serie}`}>
          Saltos en {serie.serie}: {serie.saltos.map(numero).join(', ')} siguen disponibles aunque ya se usó el {numero(serie.ultimo_usado)}. ¿Se entregaron sin registrar el cobro, o falta anularlos?
        </div>
      ))}
      {tickets.observados.map((item) => (
        <div className="form-message" key={`obs-${item.id}`}>
          {item.comprobante || `Cobro ${item.transaccion_id}`} · {item.comerciante} · {formatPEN(item.monto)}: {item.motivo}
        </div>
      ))}
    </div>
  );
}

// Cobros guardados en este celular que el servidor aún no tiene: no entran en lo esperado.
// Se avisa sin bloquear el cierre; los que suban después quedan como posteriores al cierre.
function AvisoPorSubir({ onSynced }) {
  const { isOnline, offlineQueue } = useSisrec();
  const porSubir = offlineQueue.counts.pendiente + offlineQueue.counts.error;
  if (!porSubir) return null;
  return (
    <div className="offline-banner" role="status">
      Tienes {porSubir} cobro(s) por subir: el servidor todavía no los cuenta en lo esperado.{' '}
      {isOnline
        ? <button className="secondary-button compact" type="button" disabled={offlineQueue.syncing} onClick={async () => { await offlineQueue.sync(); onSynced(); }}>{offlineQueue.syncing ? 'Sincronizando…' : 'Sincronizar ahora'}</button>
        : 'Sincroniza cuando tengas señal, antes de cerrar.'}
    </div>
  );
}

function CierreHecho({ cierre, posteriores }) {
  return (
    <div className="panel">
      <div className="panel-title">Caja cerrada el {cierre.cerrado_en}</div>
      <div className="table-card">
        <table>
          <thead><tr><th>Método</th><th>Esperado</th><th>Declarado</th></tr></thead>
          <tbody>
            {METODOS_CAJA.map(({ key, label }) => (
              <tr key={key}><td>{label}</td><td>{formatPEN(cierre[`esperado_${key}`])}</td><td>{formatPEN(cierre[`declarado_${key}`])}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p><span className={`status ${claseDiferencia(cierre.diferencia)}`}>{textoDiferencia(cierre.diferencia)}</span></p>
      {posteriores?.cobros > 0 && (
        <div className="form-message">Después del cierre entraron {posteriores.cobros} cobro(s) por {formatPEN(posteriores.monto)} (sincronizados tarde). Entréguelos aparte.</div>
      )}
      <TicketsDelDia tickets={cierre.tickets} />
    </div>
  );
}

export function CajaPage() {
  const caja = useCaja();
  const { resumen, declarado, setDeclarado } = caja;

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">COBRO / CIERRE DEL DÍA</div>
          <h1>Cierre de caja</h1>
          <p>Compara lo que el sistema registró con lo que el cobrador entrega, por método de pago.</p>
        </div>
        <input type="date" aria-label="Día de la caja" value={caja.fecha} max={caja.hoy} onChange={(event) => caja.setFecha(event.target.value)} />
      </div>
      {caja.message && <div className="form-message">{caja.message}</div>}
      {caja.esCobrador && <AvisoPorSubir onSynced={caja.recargar} />}

      {caja.esCobrador && resumen && (resumen.cierre
        ? <CierreHecho cierre={resumen.cierre} posteriores={resumen.posteriores_al_cierre} />
        : (
          <form className="panel merchant-form" onSubmit={caja.cerrar}>
            <div className="panel-title">Mi caja del {resumen.fecha}</div>
            <div className="caja-esperado">
              <span>Esperado según el servidor · {resumen.cobros} cobro(s)</span>
              <strong>{formatPEN(resumen.esperado_total)}</strong>
            </div>
            <div className="merchant-form-grid">
              {METODOS_CAJA.map(({ key, label }) => (
                <label key={key}>
                  <span>{label}: esperado {formatPEN(resumen.esperado[key])}</span>
                  <input type="number" min="0" step="0.01" inputMode="decimal" placeholder={`Lo que tengo en ${label}`} value={declarado[key]} onChange={(event) => setDeclarado({ ...declarado, [key]: event.target.value })} />
                </label>
              ))}
              <input placeholder="Observaciones (opcional)" value={caja.observaciones} onChange={(event) => caja.setObservaciones(event.target.value)} />
            </div>
            <p className="caja-diferencia"><span className={`status ${claseDiferencia(caja.diferencia)}`}>{textoDiferencia(caja.diferencia)}</span></p>
            <TicketsDelDia tickets={resumen.tickets} />
            <button className="primary-button" type="submit">Cerrar caja del día</button>
          </form>
        ))}

      {caja.veTodos && (
        <div className="table-card">
          <table>
            <thead><tr><th>Día</th><th>Cobrador</th><th>Cobros</th><th>Esperado</th><th>Declarado</th><th>Diferencia</th><th>Tickets</th></tr></thead>
            <tbody>
              {caja.cierres.length ? caja.cierres.map((cierre) => {
                const esperado = METODOS_CAJA.reduce((suma, { key }) => suma + cierre[`esperado_${key}`], 0);
                const declaradoTotal = METODOS_CAJA.reduce((suma, { key }) => suma + cierre[`declarado_${key}`], 0);
                return (
                  <tr key={cierre.id}>
                    <td>{cierre.fecha}</td><td>{cierre.cobrador}</td><td>{cierre.cobros}</td>
                    <td>{formatPEN(esperado)}</td><td>{formatPEN(declaradoTotal)}</td>
                    <td><span className={`status ${claseDiferencia(cierre.diferencia)}`}>{textoDiferencia(cierre.diferencia)}</span></td>
                    <td>{cierre.tickets ? (cierre.tickets.alertas ? <span className="status pending">{cierre.tickets.alertas} alerta(s)</span> : <span className="status paid">Sin alertas</span>) : '—'}</td>
                  </tr>
                );
              }) : <tr><td colSpan="7">No hay cierres de caja en este mes.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
