import './landing-extra.css';
import merchantImage from '../../assets/images/merchant-artisan-puno.jpg';

const SERVICES = [
  { title: 'Limpieza y manejo de residuos', text: 'Barrido diario de ferias y mercados, desinfección semanal y contenedores ecológicos.' },
  { title: 'Seguridad y ordenamiento', text: 'Presencia de fiscalizadores y serenazgo municipal en horas punta de comercio.' },
  { title: 'Mantenimiento de puestos', text: 'Reparación de techos, señalización de evacuación y alumbrado público.' },
  { title: 'Trazabilidad de fondos', text: 'Reportes cruzados entre boletas generadas y registros de auditoría con cadena de hash.' }
];

export function TransparencySection({ onOpenPortal }) {
  return (
    <div className="lx-transparency">
      <div className="lx-transparency-copy">
        <div className="eyebrow">TRANSPARENCIA Y RENDICIÓN DE CUENTAS</div>
        <h2>Cada sol recaudado se transforma en servicios para Salcedo.</h2>
        <p>La digitalización de cobros y comprobantes permite que la sisa y los derechos de sitio ingresen formalmente al Centro Poblado, con trazabilidad por comerciante.</p>
        <div className="lx-service-grid">
          {SERVICES.map((item) => (
            <div key={item.title} className="lx-service">
              <strong>✓ {item.title}</strong>
              <span>{item.text}</span>
            </div>
          ))}
        </div>
      </div>

      <aside className="lx-card lx-portal-card">
        <img src={merchantImage} alt="Comerciante artesana en una feria de Puno" loading="lazy" />
        <div className="lx-portal-body">
          <h3>¿Es usted comerciante de Salcedo?</h3>
          <p>Consulte el historial de sus pagos, verifique pendientes y descargue sus comprobantes desde el portal.</p>
          <button type="button" className="primary-button" onClick={onOpenPortal}>Consultar mi padrón ahora</button>
        </div>
      </aside>
    </div>
  );
}

export function LandingFooter({ onOpenLogin, onOpenPortal }) {
  return (
    <footer className="lx-footer">
      <div className="lx-footer-grid">
        <div>
          <div className="lx-footer-brand"><span className="brand-mark">S</span> SISREC SALCEDO</div>
          <p>Sistema integrado de recaudación y padrón de comerciantes del Centro Poblado de Salcedo, Puno.</p>
        </div>
        <div>
          <h4>Sectores comerciales</h4>
          <ul>
            <li>Mercado Central Salcedo</li>
            <li>Feria Dominical Chejoña</li>
            <li>Av. El Sol y corredor</li>
            <li>Ribera turística Lago Titicaca</li>
            <li>Plaza Principal de Salcedo</li>
          </ul>
        </div>
        <div>
          <h4>Servicios en línea</h4>
          <ul>
            <li><button type="button" onClick={onOpenPortal}>Portal del comerciante</button></li>
            <li><a href="#tarifas">Tarificador referencial</a></li>
            <li><button type="button" onClick={onOpenLogin}>Ingreso del personal</button></li>
          </ul>
        </div>
      </div>
      <div className="lx-footer-bottom">
        <span>© {new Date().getFullYear()} Municipalidad del Centro Poblado de Salcedo · Puno, Perú</span>
        <span>Sistema SISREC</span>
      </div>
    </footer>
  );
}
