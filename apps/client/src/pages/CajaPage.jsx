import { useState } from 'react';
import { useSisrec } from '../app/SisrecContext';
import { METODOS_CAJA, useCaja } from '../hooks/useCaja';
import { textoConstancia } from '../lib/caja';
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

// Puestos que quedaron sin marcar en las zonas donde hoy se cobró (RN-26). El cobrador los revisa antes de
// cerrar: si el comerciante no salió, se marca "no salió" en Pagos y cobros; así el día no queda en duda.
function SinMarcarHoy({ zonas }) {
  if (!zonas.length) return null;
  const total = zonas.reduce((suma, zona) => suma + zona.sinMarcar.length, 0);
  return (
    <details className="panel">
      <summary className="panel-title">{total} puesto(s) sin marcar hoy</summary>
      <p className="panel-subtitle">En estas zonas ya marcó a otros puestos. Antes de cerrar, marque cada uno en Pagos y cobros: si no salió, «No salió»; si estuvo, se cobra o se anota el motivo.</p>
      <div className="table-card">
        <table>
          <thead><tr><th>Zona</th><th>Puesto</th><th>Comerciante</th></tr></thead>
          <tbody>
            {zonas.flatMap((zona) => zona.sinMarcar.map((puesto) => (
              <tr key={puesto.puesto_id}><td>{zona.zona} ({zona.sinMarcar.length} de {zona.total})</td><td>{puesto.codigo_puesto || '—'}</td><td>{puesto.comerciante}</td></tr>
            )))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// Entregas ya registradas de un cierre, con su constancia (RN-41).
function EntregasDelCierre({ cierre }) {
  if (!cierre.entregas?.length) return <p className="panel-subtitle">Efectivo pendiente de entrega.</p>;
  return cierre.entregas.map((entrega) => (
    <div className="form-message" key={entrega.id}>
      {textoConstancia(cierre, entrega)}{entrega.observaciones ? ` Observaciones: ${entrega.observaciones}` : ''}
    </div>
  ));
}

// Lo que hace el super administrador con un cierre: recibir el efectivo (RN-41), recibir lo que entró después
// del cierre (RN-44) y rectificar un error (RN-43). El cierre original nunca se edita.
function GestionCierre({ cierre, caja, onCerrar }) {
  const vigente = cierre.vigente;
  const [entrega, setEntrega] = useState({ tipo: cierre.entregado ? 'complementaria' : 'cierre', monto: cierre.entregado ? '' : String(vigente.declarado_efectivo), observaciones: '' });
  const [rectificacion, setRectificacion] = useState({ ...Object.fromEntries(METODOS_CAJA.map(({ key }) => [key, String(vigente[`declarado_${key}`])])), motivo: '' });
  const propia = cierre.cobrador_id === caja.usuarioId;

  const enviarEntrega = async (event) => {
    event.preventDefault();
    await caja.entregar(cierre.id, { tipo: entrega.tipo, monto: Number(entrega.monto), observaciones: entrega.observaciones });
  };
  const enviarRectificacion = async (event) => {
    event.preventDefault();
    const { motivo, ...montos } = rectificacion;
    await caja.rectificar(cierre.id, { declarado: Object.fromEntries(Object.entries(montos).map(([key, valor]) => [key, Number(valor || 0)])), motivo });
  };

  return (
    <div className="panel">
      <div className="panel-heading">
        <div>
          <div className="panel-title">Caja del {cierre.fecha} · {cierre.cobrador}</div>
          <div className="panel-subtitle">Declaró {formatPEN(vigente.declarado_efectivo)} en efectivo · <span className={`status ${claseDiferencia(vigente.diferencia)}`}>{textoDiferencia(vigente.diferencia)}</span></div>
        </div>
        <button className="secondary-button compact" type="button" onClick={onCerrar}>Cerrar</button>
      </div>
      {cierre.justificacion && <p className="panel-subtitle">Justificación del cobrador: {cierre.justificacion}</p>}
      {cierre.rectificacion && <p className="panel-subtitle">Rectificado por {cierre.rectificacion.rectificado_por} el {cierre.rectificacion.rectificado_en}: {cierre.rectificacion.motivo}</p>}
      <EntregasDelCierre cierre={cierre} />

      {propia
        ? <p className="panel-subtitle">Es su propia caja: la entrega debe recibirla otro super administrador.</p>
        : (
          <form className="merchant-form" onSubmit={enviarEntrega}>
            <div className="panel-title">Registrar entrega de efectivo</div>
            <div className="merchant-form-grid">
              <select aria-label="Tipo de entrega" value={entrega.tipo} onChange={(event) => setEntrega({ ...entrega, tipo: event.target.value })}>
                {!cierre.entregado && <option value="cierre">Entrega del cierre</option>}
                <option value="complementaria">Complementaria (cobros posteriores al cierre)</option>
              </select>
              <input type="number" min="0" step="0.01" inputMode="decimal" required placeholder="Efectivo recibido (S/)" aria-label="Efectivo recibido en soles" value={entrega.monto} onChange={(event) => setEntrega({ ...entrega, monto: event.target.value })} />
              <input placeholder="Observaciones (obligatorias si el monto no coincide)" maxLength={500} aria-label="Observaciones de la entrega" value={entrega.observaciones} onChange={(event) => setEntrega({ ...entrega, observaciones: event.target.value })} />
            </div>
            <button className="primary-button" type="submit">Registrar entrega</button>
          </form>
        )}

      <form className="merchant-form" onSubmit={enviarRectificacion}>
        <div className="panel-title">Rectificar el cierre</div>
        <p className="panel-subtitle">El cierre original se conserva. Escriba los montos correctos y el motivo.</p>
        <div className="merchant-form-grid">
          {METODOS_CAJA.map(({ key, label }) => (
            <label key={key}>
              <span>{label}: esperado {formatPEN(cierre[`esperado_${key}`])}</span>
              <input type="number" min="0" step="0.01" inputMode="decimal" required aria-label={`${label} corregido`} value={rectificacion[key]} onChange={(event) => setRectificacion({ ...rectificacion, [key]: event.target.value })} />
            </label>
          ))}
          <input required minLength={5} maxLength={500} placeholder="Motivo de la rectificación" aria-label="Motivo de la rectificación" value={rectificacion.motivo} onChange={(event) => setRectificacion({ ...rectificacion, motivo: event.target.value })} />
        </div>
        <button className="secondary-button" type="submit">Guardar rectificación</button>
      </form>
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
      {cierre.observaciones && <p className="panel-subtitle">Observaciones: {cierre.observaciones}</p>}
      {cierre.justificacion && <p className="panel-subtitle">Justificación de la diferencia: {cierre.justificacion}</p>}
      {cierre.rectificacion && (
        <p className="panel-subtitle">Rectificado por {cierre.rectificacion.rectificado_por}: <span className={`status ${claseDiferencia(cierre.vigente.diferencia)}`}>{textoDiferencia(cierre.vigente.diferencia)}</span> · {cierre.rectificacion.motivo}</p>
      )}
      <EntregasDelCierre cierre={cierre} />
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
  const [cierreAbierto, setCierreAbierto] = useState(null);
  const enGestion = caja.cierres.find((cierre) => cierre.id === cierreAbierto);

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
      {caja.esCobrador && resumen && !resumen.cierre && <SinMarcarHoy zonas={caja.sinMarcar} />}

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
              <input placeholder="Observaciones (opcional)" maxLength={500} value={caja.observaciones} onChange={(event) => caja.setObservaciones(event.target.value)} />
            </div>
            <p className="caja-diferencia"><span className={`status ${claseDiferencia(caja.diferencia)}`}>{textoDiferencia(caja.diferencia)}</span></p>
            {caja.necesitaJustificacion && (
              <input required minLength={5} maxLength={500} placeholder="Justificación de la diferencia (obligatoria)" aria-label="Justificación de la diferencia" value={caja.justificacion} onChange={(event) => caja.setJustificacion(event.target.value)} />
            )}
            <TicketsDelDia tickets={resumen.tickets} />
            <button className="primary-button" type="submit">Cerrar caja del día</button>
          </form>
        ))}

      {caja.veTodos && (
        <div className="table-card">
          <table>
            <thead><tr><th>Día</th><th>Cobrador</th><th>Cobros</th><th>Esperado</th><th>Declarado</th><th>Diferencia</th><th>Entrega</th><th>Tickets</th><th>Observaciones</th>{caja.puedeGestionar && <th>Acciones</th>}</tr></thead>
            <tbody>
              {caja.cierres.length ? caja.cierres.map((cierre) => {
                const esperado = METODOS_CAJA.reduce((suma, { key }) => suma + cierre[`esperado_${key}`], 0);
                const declaradoTotal = METODOS_CAJA.reduce((suma, { key }) => suma + cierre.vigente[`declarado_${key}`], 0);
                const recibido = cierre.entregas.reduce((suma, entrega) => suma + entrega.monto, 0);
                return (
                  <tr key={cierre.id}>
                    <td>{cierre.fecha}</td><td>{cierre.cobrador}</td><td>{cierre.cobros}</td>
                    <td>{formatPEN(esperado)}</td><td>{formatPEN(declaradoTotal)}</td>
                    <td><span className={`status ${claseDiferencia(cierre.vigente.diferencia)}`}>{textoDiferencia(cierre.vigente.diferencia)}</span>{cierre.rectificacion && ' (rectificado)'}</td>
                    <td>{cierre.entregado ? <span className="status paid">Recibido {formatPEN(recibido)}</span> : <span className="status pending">Pendiente</span>}</td>
                    <td>{cierre.tickets ? (cierre.tickets.alertas ? <span className="status pending">{cierre.tickets.alertas} alerta(s)</span> : <span className="status paid">Sin alertas</span>) : '—'}</td>
                    <td>{[cierre.observaciones, cierre.justificacion && `Justificación: ${cierre.justificacion}`].filter(Boolean).join(' · ') || '—'}</td>
                    {caja.puedeGestionar && <td><button className="secondary-button compact" type="button" onClick={() => setCierreAbierto(cierre.id)}>Entrega / rectificar</button></td>}
                  </tr>
                );
              }) : <tr><td colSpan="10">No hay cierres de caja en este mes.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {caja.puedeGestionar && enGestion && <GestionCierre key={`${enGestion.id}-${enGestion.entregas.length}-${enGestion.rectificacion?.rectificado_en || ''}`} cierre={enGestion} caja={caja} onCerrar={() => setCierreAbierto(null)} />}
    </section>
  );
}
