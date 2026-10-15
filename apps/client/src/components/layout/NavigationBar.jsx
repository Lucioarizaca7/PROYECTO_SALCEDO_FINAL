import { useEffect, useState } from 'react';
import { useNetworkStatus } from '../../hooks/useNetworkStatus.js';
import { Link } from 'react-router-dom';

export function NavigationBar() {
  const isOnline = useNetworkStatus();
  const [activeSection, setActiveSection] = useState('hero');

  useEffect(() => {
    // Observer para detectar qué sección está visible y actualizar la barra de navegación
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        });
      },
      {
        root: document.querySelector('#snap-main-container'),
        threshold: 0.5,
      }
    );

    // Observar todas las secciones con scroll snap
    const sections = document.querySelectorAll('.snap-section');
    sections.forEach((section) => {
      observer.observe(section);
    });

    return () => observer.disconnect();
  }, []);

  const navItems = [
    { id: 'padron', label: 'Padrón & Territorio', number: '01' },
    { id: 'ventanilla', label: 'Ventanilla Ágil', number: '02' },
    { id: 'autogestion', label: 'Portal Ciudadano', number: '03' },
  ];

  return (
    <header
      className="landing-nav civic-nav fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-100 transition-all duration-300"
    >
      <div className="landing-nav-inner max-w-7xl mx-auto px-6 sm:px-8 h-20 flex items-center justify-between">
        {/* Brand Logo */}
        <Link to="#hero" className="flex items-center gap-3 group" title="SISREC Salcedo">
          <svg
            className="h-10 w-auto transition-transform duration-300 group-hover:scale-[1.02]"
            viewBox="0 0 260 64"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect fill="#1D4ED8" height="48" rx="12" width="48"></rect>
            <path
              d="M24 10L36 17V31C36 38.5 24 43 24 43C24 43 12 38.5 12 31V17L24 10Z"
              fill="#1E40AF"
              stroke="#FFFFFF"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.5"
            ></path>
            <path
              d="M24 19V33M19 24H29M20 28H28"
              stroke="#38BDF8"
              strokeLinecap="round"
              strokeWidth="2"
            ></path>
            <text
              fill="#0F172A"
              fontFamily="var(--font-sans)"
              fontSize="20"
              fontWeight="800"
              letterSpacing="-0.02em"
              x="60"
              y="28"
            >
              SISREC
            </text>
            <rect fill="#EFF6FF" height="18" rx="4" width="62" x="146" y="14"></rect>
            <text
              fill="#1D4ED8"
              fontFamily="var(--font-sans)"
              fontSize="10"
              fontWeight="700"
              letterSpacing="0.05em"
              x="151"
              y="27"
            >
              SALCEDO
            </text>
            <text
              fill="#64748B"
              fontFamily="var(--font-sans)"
              fontSize="11"
              fontWeight="500"
              x="60"
              y="44"
            >
              Sistema Integrado de Recaudación
            </text>
          </svg>
        </Link>

        {/* Navigation Links */}
        <nav
          className={`hidden md:flex items-center space-x-10 text-xs font-semibold uppercase tracking-wider text-civic-subtle font-sans`}
          data-purpose="editorial-nav"
        >
          {navItems.map((item) => (
            <Link
              key={item.id}
              to={`#${item.id}`}
              className={`hover:text-municipal transition-colors ${
                activeSection === item.id ? 'text-municipal' : ''
              }`}
            >
              <span className={`text-municipal font-mono mr-1`}>
                {item.number}
              </span>
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Action Button */}
        <div className="flex items-center gap-3">
          <Link
            to="#autogestion"
            className="inline-flex items-center justify-center px-4 py-2 text-xs font-bold tracking-wide text-slate-800 border border-slate-300 rounded-md hover:border-municipal hover:text-municipal transition-all font-sans"
          >
            Acceso Funcionarios
          </Link>
        </div>
      </div>
    </header>
  );
}
