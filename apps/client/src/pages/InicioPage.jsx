import { useNavigate } from 'react-router-dom';
import { KpiCard } from '../components/ui/KpiCard';
import { ScrollSnapContainer, ScrollSnapSection } from '../components/layout/ScrollSnapContainer';
import { TariffCalculator } from '../components/landing/TariffCalculator';
import { TransparencySection, LandingFooter } from '../components/landing/TransparencySection';

const presentationSections = [
  { id: 'inicio', label: 'Inicio' },
  { id: 'beneficios', label: 'Capacidades' },
  { id: 'impacto', label: 'Impacto fiscal' },
  { id: 'modulos', label: 'Módulos' },
  { id: 'tarifas', label: 'Tarificador' },
  { id: 'transparencia', label: 'Transparencia' }
];

// Página principal pública, con las cifras agregadas de /publico/resumen.
export function InicioPage({ stats }) {
  const navigate = useNavigate();
  const openLogin = () => navigate('/ingresar');
  const openPortal = () => navigate('/portal');

  return (
    <ScrollSnapContainer sections={presentationSections}>
      <header className="landing-nav">
        <a className="landing-brand" href="#inicio">
          <span className="brand-mark">S</span>
          <span><strong>SISREC</strong><small>Salcedo</small></span>
        </a>
        <nav>
          <a href="#beneficios">Beneficios</a>
          <a href="#modulos">Módulos</a>
          <a href="#soporte">Soporte</a>
        </nav>
        <button type="button" className="landing-login" onClick={openLogin}>
          Ingresar al sistema <span>→</span>
        </button>
        <button type="button" className="secondary-button" onClick={openPortal}>Portal comerciante</button>
      </header>

      <ScrollSnapSection id="inicio" className="landing-screen landing-hero-section">
        <div className="hero-content">
          <div className="hero-copy">
            <div className="eyebrow">GESTIÓN PÚBLICA · SALCEDO</div>
            <h1>Recaudación moderna para una gestión más cercana a la comunidad.</h1>
            <p>
              SISREC Salcedo centraliza el padrón de comerciantes, la cobranza, la valoración de sitios y los reportes para impulsar una administración más transparente, eficiente y operativa.
            </p>
            <div className="hero-actions">
              <button type="button" className="primary-button" onClick={openLogin}>Comenzar</button>
              <button type="button" className="secondary-button" onClick={openLogin}>Ver demo</button>
            </div>
          </div>
          <div className="hero-panel">
            <div className="panel-card highlight-card">
              <div className="stat-top"><span>Recaudación total</span><span className="stat-icon green">↗</span></div>
              <div className="stat-value">{stats.recaudacion}</div>
              <div className="stat-change">Acumulado del periodo actual</div>
            </div>
          </div>
        </div>
        <div className="scroll-snap-hint">Desliza para explorar <span>↓</span></div>
      </ScrollSnapSection>

      <ScrollSnapSection id="beneficios" className="landing-section landing-features-section">
        <div className="section-intro"><div className="eyebrow">OPERACIÓN MUNICIPAL</div><h2>Una vista clara para cada jornada.</h2><p>Herramientas conectadas para registrar, cobrar y supervisar con menos fricción.</p></div>
        <div className="landing-features">
          <div className="feature-box">
            <span>01</span>
            <h3>Registro automatizado</h3>
            <p>Actualiza el padrón con validación de rubro, zona y tipo de comercio.</p>
          </div>
          <div className="feature-box">
            <span>02</span>
            <h3>Cobro en campo</h3>
            <p>Atención rápida para cobradores, con comprobantes inmediatos y trazabilidad.</p>
          </div>
          <div className="feature-box">
            <span>03</span>
            <h3>Reportes inteligentes</h3>
            <p>Supervisa morosidad, flujo de caja y evolución por sectores o ferias.</p>
          </div>
        </div>
      </ScrollSnapSection>

      <ScrollSnapSection id="impacto" className="landing-section landing-impact-section">
        <div className="section-intro"><div className="eyebrow">LECTURA EJECUTIVA</div><h2>El pulso fiscal, en una sola pantalla.</h2><p>Indicadores para tomar decisiones con trazabilidad y contexto territorial.</p></div>
        <div className="landing-kpi-grid">
          <KpiCard label="Recaudacion del periodo" value={stats.recaudacion} change="Acumulado del mes" icon="R" accent="green" />
          <KpiCard label="Pagos registrados" value={stats.pagos} change="Operaciones confirmadas" icon="P" accent="blue" />
          <KpiCard label="Morosidad" value={stats.morosidad} change="Indicador calculado por SISREC" icon="!" accent="amber" />
        </div>
      </ScrollSnapSection>

      <ScrollSnapSection id="modulos" className="landing-section landing-modules-section">
        <div className="section-title">Módulos clave</div>
        <div className="module-grid">
          <div className="module-item">Padrón de comerciantes</div>
          <div className="module-item">Cobros y pagos</div>
          <div className="module-item">Tarifas y liquidación</div>
          <div className="module-item">Dashboard municipal</div>
          <div className="module-item">Auditoría</div>
          <div className="module-item">Portal del comerciante</div>
        </div>
        <button type="button" className="primary-button landing-final-action" onClick={openLogin}>Ingresar al sistema <span>→</span></button>
      </ScrollSnapSection>

      <ScrollSnapSection id="tarifas" className="landing-tariff-section">
        <TariffCalculator onRegister={openLogin} />
      </ScrollSnapSection>

      <ScrollSnapSection id="transparencia" className="landing-transparency-section">
        <TransparencySection onOpenPortal={openPortal} />
        <LandingFooter onOpenLogin={openLogin} onOpenPortal={openPortal} />
      </ScrollSnapSection>
    </ScrollSnapContainer>
  );
}
