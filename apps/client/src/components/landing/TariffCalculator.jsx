import { useMemo, useState } from 'react';
import './landing-extra.css';
import inspectionImage from '../../assets/images/municipal-tablet-inspection.jpg';

import { calcularCobroFeria, VIAS } from '../../lib/cobroFeria';

const money = (value) => `S/ ${value.toFixed(2)}`;

export function TariffCalculator({ onRegister }) {
  const [via, setVia] = useState('asfaltada');
  const [puestos, setPuestos] = useState(1);
  const [dias, setDias] = useState(4);

  const result = useMemo(() => calcularCobroFeria({ via, puestos, dias }), [via, puestos, dias]);

  return (
    <div className="lx-tariff">
      <div className="lx-header">
        <div className="eyebrow">COBRO TRANSPARENTE EN LA FERIA</div>
        <h2>¿Cuánto se paga por un puesto?</h2>
        <p>Se cobra por puesto y por día cobrado, según la vía donde está el puesto. Es una referencia: el cobro oficial lo liquida el sistema con las tarifas vigentes de la municipalidad.</p>
      </div>

      <div className="lx-tariff-grid">
        <form className="lx-card lx-form" onSubmit={(event) => event.preventDefault()}>
          <div className="lx-segment" role="group" aria-label="Tipo de vía">
            {VIAS.map((item) => (
              <button key={item.value} type="button" className={via === item.value ? 'active' : ''} onClick={() => setVia(item.value)}>
                {item.label} · S/ {item.monto}
              </button>
            ))}
          </div>
          <label>
            <span>Puestos: <strong>{result.puestos}</strong></span>
            <input type="range" min="1" max="5" step="1" value={puestos} onChange={(event) => setPuestos(Number(event.target.value))} />
          </label>
          <label>
            <span>Días cobrados: <strong>{result.dias}</strong></span>
            <input type="range" min="0" max="31" step="1" value={dias} onChange={(event) => setDias(Number(event.target.value))} />
          </label>
          <p className="lx-note">Sin día cobrado no hay deuda. Por cada puesto y día cobrado se entrega un ticket preimpreso.</p>
        </form>

        <aside className="lx-card lx-result" aria-live="polite">
          <img src={inspectionImage} alt="Fiscalizador municipal con tableta en un mercado de Salcedo" loading="lazy" />
          <div className="lx-result-body">
            <small>{result.tarifa.label} · {result.puestos} {result.puestos === 1 ? 'puesto' : 'puestos'} · {result.dias} {result.dias === 1 ? 'día' : 'días'}</small>
            <div className="lx-total">{money(result.total)}</div>
            <p>{money(result.tarifa.monto)} por puesto y día cobrado</p>
            <dl>
              <div><dt>Tarifa del día ({result.tarifa.label.toLowerCase()})</dt><dd>{money(result.tarifa.monto)}</dd></div>
              <div><dt>Puestos × días cobrados</dt><dd>{result.puestos} × {result.dias}</dd></div>
              <div><dt>Tickets {result.tarifa.serie} que recibe</dt><dd>{result.tickets}</dd></div>
            </dl>
            {onRegister && <button type="button" className="primary-button" onClick={onRegister}>Registrar cobro en el sistema →</button>}
          </div>
        </aside>
      </div>
    </div>
  );
}
