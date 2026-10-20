import { useTickets } from '../hooks/useTickets';

const numero = (valor) => (valor === null || valor === undefined ? '—' : String(valor).padStart(6, '0'));

export function TicketsPage() {
  const tickets = useTickets();
  const { nuevo, setNuevo } = tickets;

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">COBRO / TICKETS PREIMPRESOS</div>
          <h1>Tickets</h1>
          <p>Rangos de tickets numerados entregados a cada cobrador. Un ticket por puesto y día cobrado: S/ 3 en vía asfaltada, S/ 2 sin asfaltar.</p>
        </div>
      </div>
      {tickets.message && <div className="form-message">{tickets.message}</div>}

      {tickets.puedeEditar && (
        <form className="panel merchant-form" onSubmit={tickets.asignar}>
          <div className="panel-title">Asignar un lote</div>
          <div className="merchant-form-grid">
            <label>
              <span>Serie</span>
              <select value={nuevo.serie} onChange={(event) => setNuevo({ ...nuevo, serie: event.target.value })}>
                {tickets.series.map((serie) => <option key={serie.serie} value={serie.serie}>{serie.serie} · S/ {serie.valor.toFixed(2)} ({serie.tipo_via === 'asfaltada' ? 'vía asfaltada' : 'sin asfaltar'})</option>)}
              </select>
            </label>
            <label><span>Desde el N°</span><input required type="number" min="1" inputMode="numeric" value={nuevo.numero_desde} onChange={(event) => setNuevo({ ...nuevo, numero_desde: event.target.value })} /></label>
            <label><span>Hasta el N°</span><input required type="number" min="1" inputMode="numeric" value={nuevo.numero_hasta} onChange={(event) => setNuevo({ ...nuevo, numero_hasta: event.target.value })} /></label>
            <label>
              <span>Cobrador</span>
              <select required value={nuevo.cobrador_id} onChange={(event) => setNuevo({ ...nuevo, cobrador_id: event.target.value })}>
                <option value="">Elegir cobrador</option>
                {tickets.cobradores.map((cobrador) => <option key={cobrador.id} value={cobrador.id}>{cobrador.nombre} (S3: {cobrador.disponibles_s3}, S2: {cobrador.disponibles_s2})</option>)}
              </select>
            </label>
            <input placeholder="Observación (opcional)" maxLength={300} value={nuevo.observacion} onChange={(event) => setNuevo({ ...nuevo, observacion: event.target.value })} />
          </div>
          <button className="primary-button" type="submit">Asignar lote</button>
        </form>
      )}

      <div className="table-card">
        <table>
          <thead>
            <tr><th>Lote</th><th>Serie</th><th>Rango</th><th>Cobrador</th><th>Siguiente</th><th>Disponibles</th><th>Usados</th><th>Anulados</th><th>Devueltos</th><th>Estado</th>{tickets.puedeEditar && <th>Acciones</th>}</tr>
          </thead>
          <tbody>
            {tickets.lotes.length ? tickets.lotes.map((lote) => (
              <tr key={lote.id}>
                <td>{lote.id}{lote.lote_origen_id ? ` (de ${lote.lote_origen_id})` : ''}</td>
                <td>{lote.serie} · S/ {lote.valor.toFixed(2)}</td>
                <td>{numero(lote.numero_desde)} – {numero(lote.numero_hasta)}</td>
                <td>{lote.cobrador}</td>
                <td>{numero(lote.siguiente)}</td>
                <td>{lote.disponibles}</td><td>{lote.usados}</td><td>{lote.anulados}</td><td>{lote.devueltos}</td>
                <td><span className={`status ${lote.estado === 'activo' ? 'paid' : 'pending'}`}>{lote.estado}</span></td>
                {tickets.puedeEditar && (
                  <td>
                    {lote.disponibles > 0 && (
                      <>
                        <select aria-label={`Reasignar el lote ${lote.id}`} value="" onChange={(event) => tickets.reasignar(lote, event.target.value)}>
                          <option value="">Reasignar a…</option>
                          {tickets.cobradores.filter((cobrador) => cobrador.id !== lote.cobrador_id).map((cobrador) => <option key={cobrador.id} value={cobrador.id}>{cobrador.nombre}</option>)}
                        </select>
                        <button className="secondary-button compact" type="button" onClick={() => tickets.devolver(lote)}>Devolver</button>
                      </>
                    )}
                  </td>
                )}
              </tr>
            )) : <tr><td colSpan={tickets.puedeEditar ? 11 : 10}>Todavía no hay lotes de tickets asignados.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
