import { useEffect, useMemo, useState } from 'react';
import './landing-extra.css';
import inspectionImage from '../../assets/images/municipal-tablet-inspection.jpg';

// Ferias los martes (2) y miércoles (3), igual que la liquidación del servidor.
const FERIA_WEEKDAYS = [2, 3];

const PERIODS = [
  { value: 'por_feria', label: 'Por feria', unit: 'por día de feria' },
  { value: 'semanal', label: 'Semanal', unit: 'por semana (martes y miércoles)' },
  { value: 'mensual', label: 'Mensual', unit: 'por el mes en curso' }
];

const money = (value) => `S/ ${value.toFixed(2)}`;

function feriaDaysThisMonth() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  let count = 0;
  for (let day = 1; day <= lastDay; day += 1) {
    if (FERIA_WEEKDAYS.includes(new Date(year, month, day).getDay())) count += 1;
  }
  return count;
}

export function TariffCalculator({ apiBase, onRegister }) {
  const [zones, setZones] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [tariffId, setTariffId] = useState('');
  const [periodValue, setPeriodValue] = useState('semanal');

  useEffect(() => {
    let active = true;
    fetch(`${apiBase}/tarifas-zona`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`Error ${response.status}`))))
      .then((body) => {
        if (!active) return;
        // Una zona puede tener varias tarifas (pista asfaltada, sin asfaltar, ...): solo las que tienen monto.
        const priced = (body.data || [])
          .map((zona) => ({ ...zona, tarifas: zona.tarifas.filter((item) => item.monto_por_feria !== null) }))
          .filter((zona) => zona.tarifas.length);
        setZones(priced);
        setZoneId((current) => current || String(priced[0]?.zona_id || ''));
      })
      .catch(() => active && setLoadError('No se pudieron cargar los montos vigentes. Intente nuevamente más tarde.'));
    return () => { active = false; };
  }, [apiBase]);

  const zone = zones.find((item) => String(item.zona_id) === zoneId);
  const result = useMemo(() => {
    if (!zone) return null;
    const tariff = zone.tarifas.find((item) => String(item.categoria_id) === tariffId)
      || zone.tarifas.find((item) => item.predeterminada) || zone.tarifas[0];
    const period = PERIODS.find((item) => item.value === periodValue);
    const ferias = { por_feria: 1, semanal: FERIA_WEEKDAYS.length, mensual: feriaDaysThisMonth() }[periodValue];
    return { zone, tariff, period, ferias, total: tariff.monto_por_feria * ferias };
  }, [zone, tariffId, periodValue]);

  return (
    <div className="lx-tariff">
      <div className="lx-header">
        <div className="eyebrow">VALORACIÓN TRANSPARENTE DE ESPACIOS PÚBLICOS</div>
        <h2>Tarificador municipal por zona</h2>
        <p>El cobro es un monto fijo por día de feria según la zona y su tarifa (por ejemplo, pista asfaltada o sin asfaltar); las ferias son los martes y miércoles. Si falta a una feria ya pagada, el monto queda a cuenta para la siguiente.</p>
      </div>

      <div className="lx-tariff-grid">
        <form className="lx-card lx-form" onSubmit={(event) => event.preventDefault()}>
          <label>
            <span>1. Zona</span>
            <select value={zoneId} disabled={!zones.length} onChange={(event) => { setZoneId(event.target.value); setTariffId(''); }}>
              {zones.map((item) => <option key={item.zona_id} value={item.zona_id}>{item.zona}</option>)}
            </select>
          </label>
          <label>
            <span>2. Tarifa del puesto</span>
            <select value={result ? String(result.tariff.categoria_id) : ''} disabled={!zone} onChange={(event) => setTariffId(event.target.value)}>
              {zone?.tarifas.map((item) => <option key={item.categoria_id} value={item.categoria_id}>{item.nombre} · S/ {item.monto_por_feria.toFixed(2)} por feria</option>)}
            </select>
          </label>
          <div className="lx-segment" role="group" aria-label="Modalidad de pago">
            {PERIODS.map((item) => (
              <button key={item.value} type="button" className={periodValue === item.value ? 'active' : ''} onClick={() => setPeriodValue(item.value)}>
                {item.label}
              </button>
            ))}
          </div>
          {loadError && <p role="alert">{loadError}</p>}
        </form>

        <aside className="lx-card lx-result" aria-live="polite">
          <img src={inspectionImage} alt="Fiscalizador municipal con tableta en un mercado de Salcedo" loading="lazy" />
          <div className="lx-result-body">
            {result ? (
              <>
                <small>{result.zone.zona} · {result.tariff.nombre} · {result.period.label}</small>
                <div className="lx-total">{money(result.total)}</div>
                <p>{result.period.unit}</p>
                <dl>
                  <div><dt>Monto por día de feria</dt><dd>{money(result.tariff.monto_por_feria)}</dd></div>
                  <div><dt>Ferias consideradas</dt><dd>{result.ferias}</dd></div>
                </dl>
              </>
            ) : (
              <p>{loadError || 'Cargando montos vigentes…'}</p>
            )}
            {onRegister && <button type="button" className="primary-button" onClick={onRegister}>Registrar cobro en el sistema →</button>}
          </div>
        </aside>
      </div>
    </div>
  );
}
