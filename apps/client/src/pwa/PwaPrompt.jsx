import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

// Revisa si hay versión nueva cada hora mientras la app está abierta (una jornada dura horas).
const UPDATE_CHECK_MS = 60 * 60 * 1000;

/**
 * Avisos de la PWA:
 *  - "Instalar SISREC" en Android/Chrome (evento beforeinstallprompt);
 *  - "Lista para trabajar sin señal" la primera vez que el Service Worker guarda la app;
 *  - "Nueva versión disponible" con botón para actualizar. No se recarga sola para no
 *    interrumpir un cobro a medio llenar.
 */
export function PwaPrompt() {
  const [installEvent, setInstallEvent] = useState(null);
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (registration) setInterval(() => registration.update().catch(() => undefined), UPDATE_CHECK_MS);
    },
    onRegisterError(error) {
      console.warn('No se pudo registrar el Service Worker:', error);
    }
  });

  useEffect(() => {
    const onBeforeInstall = (event) => {
      event.preventDefault();
      setInstallEvent(event);
    };
    const onInstalled = () => setInstallEvent(null);
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  useEffect(() => {
    if (!offlineReady) return undefined;
    const timer = setTimeout(() => setOfflineReady(false), 6000);
    return () => clearTimeout(timer);
  }, [offlineReady, setOfflineReady]);

  const install = async () => {
    if (!installEvent) return;
    installEvent.prompt();
    await installEvent.userChoice.catch(() => null);
    setInstallEvent(null);
  };

  if (!needRefresh && !offlineReady && !installEvent) return null;

  return (
    <div className="pwa-toast" role="status" aria-live="polite">
      {needRefresh ? (
        <>
          <span>Hay una nueva versión de SISREC.</span>
          <button type="button" className="primary-button compact" onClick={() => updateServiceWorker(true)}>Actualizar</button>
          <button type="button" className="pwa-toast-close" aria-label="Más tarde" onClick={() => setNeedRefresh(false)}>×</button>
        </>
      ) : offlineReady ? (
        <>
          <span>SISREC está lista para trabajar sin señal.</span>
          <button type="button" className="pwa-toast-close" aria-label="Cerrar" onClick={() => setOfflineReady(false)}>×</button>
        </>
      ) : (
        <>
          <span>Instala SISREC en este celular para abrirla sin navegador y sin señal.</span>
          <button type="button" className="primary-button compact" onClick={install}>Instalar</button>
          <button type="button" className="pwa-toast-close" aria-label="Ahora no" onClick={() => setInstallEvent(null)}>×</button>
        </>
      )}
    </div>
  );
}
