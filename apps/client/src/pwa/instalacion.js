import { useSyncExternalStore } from 'react';

// Instalar SISREC como app (PWA) en el celular del cobrador.
// Chrome avisa una sola vez con "beforeinstallprompt"; se guarda aquí, fuera de React, para que el botón
// "Instalar app" del menú siga funcionando aunque el cobrador cierre el aviso flotante (PwaPrompt).
// iPhone (Safari) nunca da ese aviso: allí solo se puede instalar a mano, con Compartir → "Agregar a inicio".

let avisoGuardado = null;
let instalada = false;
const oyentes = new Set();
const avisar = () => oyentes.forEach((oyente) => oyente());

const enModoApp = () => typeof window !== 'undefined' && (
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
);

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // sin esto Chrome muestra su propia barra y el aviso ya no se puede reusar
    avisoGuardado = event;
    avisar();
  });
  window.addEventListener('appinstalled', () => {
    avisoGuardado = null;
    instalada = true;
    avisar();
  });
}

/**
 * Qué puede hacer el usuario para instalar:
 *  'instalada' ya abre como app (o se acaba de instalar): no se muestra nada;
 *  'directa'   Chrome dio su aviso: un toque abre el diálogo de instalación;
 *  'ios'       iPhone o iPad: pasos de Safari (Compartir → Agregar a inicio);
 *  'manual'    otro caso (aviso ya usado, Chrome aún no lo da, otro navegador): pasos del menú ⋮.
 */
export function modoInstalacion({ standalone, hayAviso, userAgent = '' }) {
  if (standalone) return 'instalada';
  if (hayAviso) return 'directa';
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  return 'manual';
}

const instantanea = () => (instalada || enModoApp() ? 'instalada' : modoInstalacion({
  standalone: false,
  hayAviso: Boolean(avisoGuardado),
  userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent
}));

const suscribir = (oyente) => {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
};

/** Abre el diálogo de instalación de Chrome. Devuelve true si el usuario aceptó. */
export async function instalarApp() {
  const aviso = avisoGuardado;
  if (!aviso) return false;
  aviso.prompt();
  const eleccion = await aviso.userChoice.catch(() => null);
  avisoGuardado = null; // Chrome no deja usar el mismo aviso dos veces
  if (eleccion?.outcome === 'accepted') instalada = true;
  avisar();
  return eleccion?.outcome === 'accepted';
}

export function useModoInstalacion() {
  return useSyncExternalStore(suscribir, instantanea, () => 'manual');
}
