import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { AppShell } from './app/AppShell';
import { canSee, HOME_PATH, navItems } from './app/navegacion';
import { SisrecContext } from './app/SisrecContext';
import { useDatosSisrec } from './app/useDatosSisrec';
import { useSesion } from './app/useSesion';
import { DeviceSessions } from './features/offline/DeviceSessions';
import { ReviewPanel } from './features/offline/ReviewPanel';
import { useJornada } from './features/offline/useJornada';
import { useOfflineQueue } from './features/offline/useOfflineQueue';
import { useColaImpresion } from './hooks/useColaImpresion';
import { useNetworkStatus } from './hooks/useNetworkStatus';
import { ComerciantesPage } from './pages/ComerciantesPage';
import { AnaliticaPage, AuditoriaPage, ReportesPage } from './pages/ConsultaPages';
import { IngresarPage } from './pages/IngresarPage';
import { InicioPage } from './pages/InicioPage';
import { MapaPage } from './pages/MapaPage';
import { PagosPage } from './pages/PagosPage';
import { PanelPage } from './pages/PanelPage';
import { PortalPage } from './pages/PortalPage';
import { SitiosPage } from './pages/SitiosPage';
import { TarifasPage } from './pages/TarifasPage';
import { ZonasPage } from './pages/ZonasPage';

// Una página por ruta de navegacion.js. Cada página trae su propio hook (usePagos, useSitios…).
function pageFor(key, { user, refresh }) {
  switch (key) {
    case 'dashboard': return <PanelPage />;
    case 'comerciantes': return <ComerciantesPage />;
    case 'sitios': return <SitiosPage />;
    case 'pagos': return <PagosPage />;
    case 'zonas': return <ZonasPage />;
    case 'mapa': return <MapaPage />;
    case 'reportes': return <ReportesPage />;
    case 'auditoria': return <AuditoriaPage />;
    case 'revision': return <ReviewPanel canResolve={user?.rol === 'super_admin'} onResolved={refresh} />;
    case 'dispositivos': return <DeviceSessions />;
    case 'ia': return <AnaliticaPage />;
    case 'tarifas': return <TarifasPage />;
    default: return <Navigate to={HOME_PATH} replace />;
  }
}

function SisrecRoutes() {
  const location = useLocation();
  const isOnline = useNetworkStatus();
  const sesion = useSesion();
  const { user } = sesion;
  const datos = useDatosSisrec({ user, onSessionExpired: sesion.expire });
  // Fase 2: padrón de la jornada en el celular y cola de cobros sin señal.
  const jornada = useJornada({ user });
  const offlineQueue = useOfflineQueue({ user, onSynced: () => datos.refresh() });
  useColaImpresion();
  // Al cerrar sesión se vuelve a la página principal, no al formulario de ingreso.
  // (React Router navega como transición: el usuario se borra antes de que cambie la ruta.)
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (leaving && !user && location.pathname === '/') setLeaving(false);
  }, [leaving, user, location.pathname]);

  if (!user) {
    return (
      <Routes>
        <Route path="/" element={<InicioPage stats={datos.dashboardStats} />} />
        <Route path="/ingresar" element={<IngresarPage onLogin={sesion.login} error={sesion.error} setError={sesion.setError} />} />
        <Route path="/portal" element={<PortalPage />} />
        {/* Una página del personal sin sesión (enlace guardado o sesión vencida): primero ingresar, luego volver a ella. */}
        <Route path="*" element={leaving ? <Navigate to="/" replace /> : <Navigate to="/ingresar" replace state={{ from: location.pathname }} />} />
      </Routes>
    );
  }

  const logout = () => {
    setLeaving(true);
    sesion.logout();
  };
  const from = location.state?.from;
  const afterLogin = navItems.some((item) => item.path === from && canSee(item, user.rol)) ? from : HOME_PATH;

  return (
    <SisrecContext.Provider value={{ user, isOnline, jornada, offlineQueue, ...datos }}>
      <Routes>
        <Route element={<AppShell onLogout={logout} />}>
          {navItems.map((item) => (
            <Route
              key={item.key}
              path={item.path}
              element={canSee(item, user.rol) ? pageFor(item.key, { user, refresh: datos.refresh }) : <Navigate to={HOME_PATH} replace />}
            />
          ))}
        </Route>
        <Route path="/ingresar" element={<Navigate to={afterLogin} replace />} />
        <Route path="*" element={<Navigate to={HOME_PATH} replace />} />
      </Routes>
    </SisrecContext.Provider>
  );
}

function App() {
  return (
    <BrowserRouter>
      <SisrecRoutes />
    </BrowserRouter>
  );
}

export default App;
