import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { SyncStatusBadge } from '../components/ui/SyncStatusBadge';
import { formatRole, getInitials } from '../lib/formato';
import { periodoEnLima } from '../services/jornadaOffline';
import { canSee, navItemByPath, navItems, navItemsFor } from './navegacion';
import { useSisrec } from './SisrecContext';

const navClass = (base) => ({ isActive }) => `${base} ${isActive ? 'active' : ''}`.trim();

// Barra inferior del celular: las cuatro primeras páginas de esta lista que el rol puede ver.
// Cobrador y super_admin: Cobrar, Mapa, Caja, Inicio. Auditor: Caja, Inicio, Revisión, Reportes.
const accesosCelular = [
  { key: 'pagos', label: 'Cobrar', icono: <><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></> },
  { key: 'mapa', label: 'Mapa', icono: <><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" /><path d="M9 4v14M15 6v14" /></> },
  { key: 'caja', label: 'Caja', icono: <><rect x="3" y="8" width="18" height="12" rx="2" /><path d="M7 8V5h10v3M3 13h18" /></> },
  { key: 'dashboard', label: 'Inicio', icono: <><path d="m3 11 9-7 9 7" /><path d="M5 10v10h14V10" /></> },
  { key: 'revision', label: 'Revisión', icono: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></> },
  { key: 'reportes', label: 'Reportes', icono: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></> }
];

const accesosPara = (rol) => accesosCelular
  .map((acceso) => ({ ...acceso, item: navItems.find((item) => item.key === acceso.key) }))
  .filter(({ item }) => item && canSee(item, rol))
  .slice(0, 4);

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
          <div className="marca-sisrec">SISREC</div>
          <div className="marca-sub">Municipalidad C. P. Salcedo</div>
          <div className="marca-periodo">Periodo {periodoEnLima()}</div>
        </div>

        <nav className="sidebar-nav">
          {navItemsFor(user?.rol).map((item) => (
            <NavLink key={item.key} to={item.path} className={navClass('nav-item')} onClick={() => setSidebarOpen(false)}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          {user?.rol === 'auditor' && <span className="rol-solo-lectura">Auditor</span>}
          <strong>{user?.nombre || 'Usuario'}</strong>
          {formatRole(user?.rol)}
        </div>
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
        <nav className="mobile-bottom-nav" aria-label="Accesos del celular">
          {accesosPara(user?.rol).map(({ key, label, icono, item }) => (
            <NavLink key={key} to={item.path} className={navClass('')}>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icono}</svg>
              {label}
            </NavLink>
          ))}
        </nav>
      </main>
    </div>
  );
}
