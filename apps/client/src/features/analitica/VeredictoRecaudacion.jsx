// Veredicto del próximo mes (apps/server/src/veredictoRecaudacion.js). El servidor decide; aquí solo se muestra.
// El estado va en texto y flecha, no solo en color.
const ESTADOS = {
  sube: { flecha: '↗', titulo: 'Se espera que suba' },
  baja: { flecha: '↘', titulo: 'Se espera que baje' },
  estable: { flecha: '→', titulo: 'Se espera que se mantenga' },
  no_concluye: { flecha: '?', titulo: 'No se puede concluir' }
};

const soles = (valor) => `S/ ${Number(valor).toFixed(2)}`;
const conSigno = (valor) => `${valor > 0 ? '+' : ''}${valor} %`;

export function VeredictoRecaudacion({ veredicto }) {
  if (!veredicto) return null;
  const { flecha, titulo } = ESTADOS[veredicto.estado] || ESTADOS.no_concluye;
  const causas = veredicto.causas || [];
  const acciones = veredicto.acciones || [];
  const hayComparacion = veredicto.base !== null && veredicto.base !== undefined;

  return (
    <section className={`panel veredicto veredicto-${veredicto.estado}`} aria-label="Veredicto de recaudación del próximo mes">
      <div className="veredicto-cabecera">
        <span className="veredicto-flecha" aria-hidden="true">{flecha}</span>
        <div>
          <div className="veredicto-rotulo">Recaudación del próximo mes</div>
          <h2 className="veredicto-titulo">{titulo}</h2>
          {hayComparacion && (
            <p className="veredicto-comparacion">
              {soles(veredicto.proyectado)} proyectados frente a {soles(veredicto.base)} de promedio en los últimos 3 meses ({conSigno(veredicto.cambio_pct)})
            </p>
          )}
          {veredicto.motivo && <p className="veredicto-comparacion">{veredicto.motivo}</p>}
        </div>
      </div>

      {(causas.length > 0 || acciones.length > 0) && (
        <div className="veredicto-detalle">
          {causas.length > 0 && (
            <div>
              <h3>Por qué</h3>
              <ul>{causas.map((causa) => <li key={`${causa.tipo}-${causa.zona}`}>{causa.detalle}</li>)}</ul>
            </div>
          )}
          {acciones.length > 0 && (
            <div>
              <h3>Qué se sugiere hacer</h3>
              <ul>{acciones.map((accion) => <li key={`${accion.tipo}-${accion.zona}`}>{accion.texto}</li>)}</ul>
            </div>
          )}
        </div>
      )}

      <p className="veredicto-nota">Estimación según los pagos y la asistencia registrados, no según las ventas de los comerciantes. La decisión es de la oficina.</p>
    </section>
  );
}
