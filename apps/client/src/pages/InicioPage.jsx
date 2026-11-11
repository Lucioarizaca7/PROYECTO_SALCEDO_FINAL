import { useNavigate } from 'react-router-dom';
import '../components/landing/pagina-publica.css';
import inspeccionImage from '../assets/images/municipal-tablet-inspection.jpg';
import comercianteImage from '../assets/images/merchant-artisan-puno.jpg';
import vestimentaImage from '../assets/images/puno-traditional-clothing.jpg';

// Página pública según el Penpot (Público y portal · P1), con la paleta del escudo. Solo explica cómo
// funciona y qué beneficios trae; las cifras son las agregadas de /publico/resumen, sin datos personales.
const PASOS = [
  { icono: 'padron', titulo: '1. Estás en el padrón', texto: 'La municipalidad registra tu puesto, su zona y los días que vienes.' },
  { icono: 'carnet', titulo: '2. Recibes tu carnet', texto: 'Al frente tiene el QR para el cobrador y atrás tu llave para el portal.' },
  { icono: 'pago', titulo: '3. Pagas y consultas', texto: 'Pagas en efectivo, Yape o Plin, recibes tu recibo y lo ves desde el celular.' }
];

const BENEFICIOS = [
  {
    titulo: 'Para el comerciante',
    imagen: vestimentaImage,
    alt: 'Comerciantes con vestimenta tradicional en una feria de Puno',
    puntos: [
      'Pagas solo los días que se te cobra: sin día cobrado no hay deuda.',
      'Cada pago trae un recibo con QR que cualquiera puede verificar.',
      'Ves tus pagos y tu deuda con la llave de tu carnet, sin ir a la oficina.'
    ]
  },
  {
    titulo: 'Para la municipalidad',
    imagen: inspeccionImage,
    alt: 'Personal municipal registrando un cobro en una tableta',
    puntos: [
      'El cobrador trabaja sin señal: los cobros se guardan en el celular y se suben al volver la conexión.',
      'Ningún cobro se borra: se anula con motivo y responsable, y queda en la auditoría.',
      'Caja diaria, reportes por zona y proyección de la recaudación en un solo sistema.'
    ]
  }
];

function Icono({ nombre }) {
  const trazos = {
    padron: <><circle cx="9" cy="8" r="3.2" /><path d="M3 19c.6-3.2 3-5 6-5s5.4 1.8 6 5" /><path d="M15.5 5.2a3 3 0 0 1 0 5.6M18 14.5c1.6.7 2.6 2.3 3 4.5" /></>,
    carnet: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><circle cx="8.5" cy="11" r="2" /><path d="M5.8 16c.5-1.4 1.5-2.1 2.7-2.1s2.2.7 2.7 2.1M14 10h4M14 13.5h3" /></>,
    pago: <><rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M3 10.5h18M7 15h4" /></>
  };
  return (
    <svg className="pp-icono" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {trazos[nombre]}
    </svg>
  );
}

export function InicioPage({ stats }) {
  const navigate = useNavigate();
  const abrirPortal = () => navigate('/portal');
  const abrirIngreso = () => navigate('/ingresar');

  return (
    <div className="pp">
      <header className="pp-nav">
        <div className="pp-contenedor pp-nav-fila">
          <a className="pp-marca" href="#inicio">
            <span className="pp-escudo" aria-hidden="true">S</span>
            <span><strong>SISREC Salcedo</strong><small>Municipalidad del Centro Poblado de Salcedo</small></span>
          </a>
          <nav className="pp-enlaces" aria-label="Secciones">
            <a href="#como-funciona">Cómo funciona</a>
            <a href="#beneficios">Beneficios</a>
            <a href="#transparencia">Transparencia</a>
          </nav>
          <div className="pp-nav-acciones">
            <button type="button" className="pp-boton pp-boton-borde" onClick={abrirPortal}>Portal del comerciante</button>
            <button type="button" className="pp-boton pp-boton-principal" onClick={abrirIngreso}>Ingreso del personal</button>
          </div>
        </div>
      </header>

      <main>
        <section id="inicio" className="pp-portada" aria-labelledby="pp-titulo">
          <div className="pp-contenedor pp-portada-fila">
            <div className="pp-mensaje">
              <div className="pp-rotulo pp-rotulo-claro">FERIA DE SALCEDO · MARTES Y MIÉRCOLES</div>
              <h1 id="pp-titulo">La feria ordenada,<br />cobros claros para todos</h1>
              <p>Cada comerciante paga por día de feria según la zona de su puesto. Con tu carnet ves tus pagos y tu deuda desde el celular, sin hacer cola.</p>
              <div className="pp-acciones">
                <button type="button" className="pp-boton pp-boton-dorado" onClick={abrirPortal}>Entrar con mi carnet</button>
                <a className="pp-boton pp-boton-claro" href="#como-funciona">Cómo funciona</a>
              </div>
            </div>
            <figure className="pp-portada-imagen">
              <img src={inspeccionImage} alt="Cobrador municipal registrando un pago en la feria" />
            </figure>
          </div>
        </section>

        <section id="como-funciona" className="pp-seccion pp-seccion-blanca" aria-labelledby="pp-como">
          <div className="pp-contenedor">
            <div className="pp-rotulo">PASO A PASO</div>
            <h2 id="pp-como">Cómo funciona</h2>
            <ol className="pp-pasos">
              {PASOS.map((paso) => (
                <li key={paso.titulo} className="pp-paso">
                  <span className="pp-paso-icono"><Icono nombre={paso.icono} /></span>
                  <h3>{paso.titulo}</h3>
                  <p>{paso.texto}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="beneficios" className="pp-seccion" aria-labelledby="pp-beneficios">
          <div className="pp-contenedor">
            <div className="pp-rotulo">BENEFICIOS</div>
            <h2 id="pp-beneficios">Qué gana cada uno</h2>
            <div className="pp-beneficios">
              {BENEFICIOS.map((grupo) => (
                <article key={grupo.titulo} className="pp-tarjeta pp-beneficio">
                  <img src={grupo.imagen} alt={grupo.alt} loading="lazy" />
                  <div className="pp-beneficio-cuerpo">
                    <h3>{grupo.titulo}</h3>
                    <ul>{grupo.puntos.map((punto) => <li key={punto}>{punto}</li>)}</ul>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="transparencia" className="pp-seccion pp-seccion-blanca" aria-labelledby="pp-transparencia">
          <div className="pp-contenedor">
            <div className="pp-rotulo">TRANSPARENCIA · ESTE MES</div>
            <h2 id="pp-transparencia">Lo que se recauda, a la vista</h2>
            <div className="pp-indicadores">
              <div className="pp-tarjeta pp-indicador"><span>Recaudado este mes</span><strong>{stats.recaudacion}</strong><small>Pagos confirmados</small></div>
              <div className="pp-tarjeta pp-indicador"><span>Pagos registrados</span><strong>{stats.pagos}</strong><small>Cada uno con su recibo</small></div>
              <div className="pp-tarjeta pp-indicador"><span>Comerciantes en el padrón</span><strong>{stats.comerciantes}</strong><small>Registrados por la municipalidad</small></div>
            </div>
            <aside className="pp-tarjeta pp-portal">
              <img src={comercianteImage} alt="Comerciante artesana en una feria de Puno" loading="lazy" />
              <div className="pp-portal-cuerpo">
                <h3>¿Eres comerciante de la feria?</h3>
                <p>Consulta tus pagos, revisa si tienes deuda y descarga tus recibos con la llave de tu carnet.</p>
                <button type="button" className="pp-boton pp-boton-principal" onClick={abrirPortal}>Entrar con mi carnet</button>
              </div>
            </aside>
          </div>
        </section>
      </main>

      <footer className="pp-pie">
        <div className="pp-contenedor pp-pie-fila">
          <strong>Municipalidad del Centro Poblado de Salcedo · Puno</strong>
          <span>Oficina de Rentas · Lunes a viernes, 8:00 a 16:00</span>
          <button type="button" onClick={abrirIngreso}>Ingreso del personal</button>
        </div>
      </footer>
    </div>
  );
}
