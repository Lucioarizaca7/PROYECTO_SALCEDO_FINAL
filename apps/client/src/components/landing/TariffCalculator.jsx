import { useMemo, useState } from 'react';
import './landing-extra.css';
import inspectionImage from '../../assets/images/municipal-tablet-inspection.jpg';

const SECTORS = [
  { value: 'Mercado Central Salcedo', label: 'Mercado Central de Salcedo (techado)', rate: 0.5 },
  { value: 'Feria Dominical Chejoña', label: 'Feria Dominical de Chejoña', rate: 0.45 },
  { value: 'Ribera Titicaca', label: 'Ribera Titicaca (sector turístico y artesanal)', rate: 0.4 },
  { value: 'Plaza Principal Salcedo', label: 'Plaza Principal de Salcedo', rate: 0.55 },
  { value: 'Av. El Sol', label: 'Av. El Sol (comercio mixto)', rate: 0.35 }
];

const CATEGORIES = [
  { value: 'Frutas y Verduras', factor: 1 },
  { value: 'Gastronomía y Viandas', factor: 1.3 },
  { value: 'Abarrotes y Granos', factor: 1 },
  { value: 'Artesanías y Textiles', factor: 1.1 },
  { value: 'Carnes e Hidrobiológicos', factor: 1.25 },
  { value: 'Flores y Vivero', factor: 1 },
  { value: 'Ropa y Calzado', factor: 1 }
];

const PERIODS = [
  { value: 'diario', label: 'Diario (sisa)', days: 1, discount: 0, unit: 'por jornada' },
  { value: 'semanal', label: 'Semanal (-5%)', days: 7, discount: 0.05, unit: 'por 7 días' },
  { value: 'mensual', label: 'Mensual (-15%)', days: 30, discount: 0.15, unit: 'por mes calendario' }
];

const money = (value) => `S/ ${value.toFixed(2)}`;

export function TariffCalculator({ onRegister }) {
  const [sectorValue, setSectorValue] = useState(SECTORS[0].value);
  const [categoryValue, setCategoryValue] = useState(CATEGORIES[0].value);
  const [areaM2, setAreaM2] = useState(6);
  const [periodValue, setPeriodValue] = useState('diario');
  const [cleaning, setCleaning] = useState(true);
  const [electric, setElectric] = useState(false);

  const result = useMemo(() => {
    const sector = SECTORS.find((item) => item.value === sectorValue);
    const category = CATEGORIES.find((item) => item.value === categoryValue);
    const period = PERIODS.find((item) => item.value === periodValue);
    const dailyBase = Math.max(1.5, areaM2 * sector.rate * category.factor);
    const dailyTotal = dailyBase + (cleaning ? 0.5 : 0) + (electric ? 1 : 0);
    return {
      sector,
      category,
      period,
      baseM2: areaM2 * sector.rate,
      total: dailyTotal * period.days * (1 - period.discount)
    };
  }, [sectorValue, categoryValue, areaM2, periodValue, cleaning, electric]);

  return (
    <div className="lx-tariff">
      <div className="lx-header">
        <div className="eyebrow">VALORACIÓN TRANSPARENTE DE ESPACIOS PÚBLICOS</div>
        <h2>Tarificador municipal de sitios y sisa</h2>
        <p>Estime el valor de ocupación según metraje, giro comercial y sector de Salcedo. Es una referencia: el cobro oficial se liquida con las tarifas vigentes del sistema.</p>
      </div>

      <div className="lx-tariff-grid">
        <form className="lx-card lx-form" onSubmit={(event) => event.preventDefault()}>
          <label>
            <span>1. Sector o feria</span>
            <select value={sectorValue} onChange={(event) => setSectorValue(event.target.value)}>
              {SECTORS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label>
            <span>2. Giro comercial</span>
            <select value={categoryValue} onChange={(event) => setCategoryValue(event.target.value)}>
              {CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.value}</option>)}
            </select>
          </label>
          <label>
            <span>3. Espacio ocupado: <strong>{areaM2} m²</strong></span>
            <input type="range" min="2" max="24" step="0.5" value={areaM2} onChange={(event) => setAreaM2(parseFloat(event.target.value))} />
          </label>
          <div className="lx-segment" role="group" aria-label="Modalidad de pago">
            {PERIODS.map((item) => (
              <button key={item.value} type="button" className={periodValue === item.value ? 'active' : ''} onClick={() => setPeriodValue(item.value)}>
                {item.label}
              </button>
            ))}
          </div>
          <label className="lx-check"><input type="checkbox" checked={cleaning} onChange={(event) => setCleaning(event.target.checked)} /><span>Limpieza y recojo de residuos (+S/ 0.50/día)</span></label>
          <label className="lx-check"><input type="checkbox" checked={electric} onChange={(event) => setElectric(event.target.checked)} /><span>Punto de energía eléctrica (+S/ 1.00/día)</span></label>
        </form>

        <aside className="lx-card lx-result" aria-live="polite">
          <img src={inspectionImage} alt="Fiscalizador municipal con tableta en un mercado de Salcedo" loading="lazy" />
          <div className="lx-result-body">
            <small>{result.sector.value} · {result.category.value} · {areaM2} m²</small>
            <div className="lx-total">{money(result.total)}</div>
            <p>{result.period.unit}{result.period.discount > 0 ? ` · descuento ${Math.round(result.period.discount * 100)}% por pago adelantado` : ''}</p>
            <dl>
              <div><dt>Base por m² ({areaM2} m²)</dt><dd>{money(result.baseM2)}</dd></div>
              <div><dt>Factor giro</dt><dd>×{result.category.factor.toFixed(2)}</dd></div>
              <div><dt>Limpieza ({result.period.days} d)</dt><dd>{money(cleaning ? 0.5 * result.period.days : 0)}</dd></div>
              {electric && <div><dt>Punto eléctrico ({result.period.days} d)</dt><dd>{money(result.period.days)}</dd></div>}
            </dl>
            {onRegister && <button type="button" className="primary-button" onClick={onRegister}>Registrar cobro en el sistema →</button>}
          </div>
        </aside>
      </div>
    </div>
  );
}
