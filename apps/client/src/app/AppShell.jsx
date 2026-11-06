import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { SyncStatusBadge } from '../components/ui/SyncStatusBadge';
import { fechaLargaEnLima, formatRole, getInitials } from '../lib/formato';
import { periodoEnLima } from '../services/jornadaOffline';
import { Icono } from './iconos';
import { canSee, gruposMenu, navItemByPath, navItems, navItemsFor } from './navegacion';
import { useSisrec } from './SisrecContext';

const navClass = (base) => ({ isActive }) => `${base} ${isActive ? 'active' : ''}`.trim();

// Barra inferior del celular: las cuatro primeras páginas de esta lista que el rol puede ver.
// Cobrador y super_admin: Cobrar, Mapa, Caja, Inicio. Auditor: Caja, Inicio, Revisión, Reportes.
const accesosCelular = [
  { key: 'pagos', label: 'Cobrar' },
  { key: 'mapa', label: 'Mapa' },
  { key: 'caja', label: 'Caja' },
  { key: 'dashboard', label: 'Inicio' },
  { key: 'revision', label: 'Revisión' },
  { key: 'reportes', label: 'Reportes' }
];

const accesosPara = (rol) => accesosCelular
  .map((acceso) => ({ ...acceso, item: navItems.find((item) => item.key === acceso.key) }))
  .filter(({ item }) => item && canSee(item, rol))
  .slice(0, 4);

// Marco de las páginas del personal: menú lateral por grupos, barra superior y accesos rápidos del celular.
export function AppShell({ onLogout }) {
  const { user, isOnline, apiConnected, offlineQueue } = useSisrec();
  const { pathname } = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pendingSyncCount = offlineQueue.counts.pendiente + offlineQueue.counts.error;
  const visibles = navItemsFor(user?.rol);

  return (
    <div className="app-shell">
      <div className={`sidebar-backdrop ${sidebarOpen ? 'visible' : ''}`} onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`} id="sidebar">
        <div className="sidebar-header">
          <span className="marca-logo" aria-hidden="true">S</span>
          <div>
            <div className="marca-sisrec">SISREC</div>
            <div className="marca-sub">Municipalidad de Salcedo</div>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Menú principal">
          {gruposMenu.map((grupo) => {
            const items = visibles.filter((item) => item.grupo === grupo.key);
            if (!items.length) return null;
            return (
              <div className="nav-grupo" key={grupo.key}>
                <div className="nav-grupo-titulo">{grupo.label}</div>
                {items.map((item) => (
                  <NavLink key={item.key} to={item.path} className={navClass('nav-item')} onClick={() => setSidebarOpen(false)}>
                    <Icono nombre={item.key} />
                    <span>{item.label}</span>
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <span className="sidebar-hoy-eyebrow">Hoy en Salcedo</span>
          <strong>{fechaLargaEnLima()}</strong>
          <span>Periodo {periodoEnLima()}</span>
          {user?.rol === 'auditor' && <span className="rol-solo-lectura">Auditor · solo lectura</span>}
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-left">
            <button className="menu-button" type="button" aria-label="Abrir menú" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen((open) => !open)}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
            <div className="topbar-titulo">
              <h2>{navItemByPath(pathname)?.label || 'Dashboard'}</h2>
              <div className="eyebrow">Municipalidad de Salcedo</div>
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
            <button type="button" className="secondary-button compact boton-salir" aria-label="Cerrar sesión" onClick={onLogout}>
              <Icono nombre="salir" size={18} />
              <span>Cerrar sesión</span>
            </button>
          </div>
        </header>

        <div className="page-content" id="pageContent"><Outlet /></div>
        <nav className="mobile-bottom-nav" aria-label="Accesos del celular">
          {accesosPara(user?.rol).map(({ key, label, item }) => (
            <NavLink key={key} to={item.path} className={navClass('')}>
              <Icono nombre={key} size={22} />
              {label}
            </NavLink>
          ))}
        </nav>
      </main>
    </div>
  );
}
