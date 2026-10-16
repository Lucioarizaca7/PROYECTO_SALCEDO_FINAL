import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { SyncStatusBadge } from '../components/ui/SyncStatusBadge';
import { formatRole, getInitials } from '../lib/formato';
import { navItemByPath, navItemsFor, pathOf } from './navegacion';
import { useSisrec } from './SisrecContext';

const navClass = (base) => ({ isActive }) => `${base} ${isActive ? 'active' : ''}`.trim();

// Marco de las páginas del personal: menú lateral, barra superior y accesos rápidos del celular.
export function AppShell({ onLogout }) {
  const { user, isOnline, apiConnected, offlineQueue } = useSisrec();
  const { pathname } = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pendingSyncCount = offlineQueue.counts.pendiente + offlineQueue.counts.error;

  return (
    <div className="app-shell">
      <div className={`sidebar-backdrop ${sidebarOpen ? 'visible' : ''}`} onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`} id="sidebar">
        <div className="sidebar-header">
          <div className="landing-brand sidebar-brand">
            <span className="brand-mark">S</span>
            <span><strong>SISREC</strong><small>Salcedo</small></span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {navItemsFor(user?.rol).map((item) => (
            <NavLink key={item.key} to={item.path} className={navClass('nav-item')} onClick={() => setSidebarOpen(false)}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-left">
            <button className="menu-button" type="button" aria-label="Abrir menú" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen((open) => !open)}>
              ☰
            </button>
            <div>
              <div className="eyebrow">MUNICIPALIDAD DE SALCEDO</div>
              <h2>{navItemByPath(pathname)?.label || 'Dashboard'}</h2>
            </div>
          </div>

          <div className="topbar-right">
            <SyncStatusBadge isOnline={isOnline} apiConnected={apiConnected} pendingSyncCount={pendingSyncCount} />
            <div className="search-box">
              <span>⌕</span>
              <input type="text" placeholder="Buscar registro" />
            </div>
            <button type="button" className="notification-button" aria-label="Notificaciones" title="Notificaciones">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
              </svg>
            </button>
            <div className="user-badge" title={`${user?.nombre || 'Usuario'} · ${formatRole(user?.rol)}`}>
              <span className="user-avatar" aria-hidden="true">{getInitials(user?.nombre)}</span>
              <div className="user-meta">
                <strong>{user?.nombre || 'Usuario'}</strong>
                <small>{formatRole(user?.rol)}</small>
              </div>
            </div>
            <button type="button" className="primary-button compact" onClick={onLogout}>Cerrar sesión</button>
          </div>
        </header>

        <div className="page-content" id="pageContent"><Outlet /></div>
        <nav className="mobile-bottom-nav" aria-label="Acciones rápidas">
          <NavLink to={pathOf('dashboard')} className={navClass('')}><span>⌂</span>Inicio</NavLink>
          <NavLink to={pathOf('pagos')} className={navClass('')}><span>＋</span>Cobro rápido</NavLink>
          <NavLink to={pathOf('mapa')} className={navClass('')}><span>⌖</span>Mapa</NavLink>
          <NavLink to={pathOf('reportes')} className={navClass('')}><span>▤</span>Reportes</NavLink>
        </nav>
      </main>
    </div>
  );
}
