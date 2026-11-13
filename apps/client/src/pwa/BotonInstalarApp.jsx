import { useState } from 'react';
import { instalarApp, useModoInstalacion } from './instalacion';

const PASOS = {
  ios: 'En Safari toca Compartir (el cuadrado con la flecha hacia arriba) y luego «Agregar a inicio».',
  manual: 'En Chrome toca el menú ⋮ (arriba a la derecha) y luego «Instalar aplicación» o «Agregar a la pantalla principal».'
};

// Entrada fija del menú para instalar SISREC en el celular. Cuando Chrome lo permite instala con un toque;
// si no (iPhone, o el aviso ya se usó), muestra los pasos a mano. Ya instalada, no aparece.
export function BotonInstalarApp() {
  const modo = useModoInstalacion();
  const [verPasos, setVerPasos] = useState(false);

  if (modo === 'instalada') return null;

  const alTocar = () => {
    if (modo === 'directa') instalarApp();
    else setVerPasos((visible) => !visible);
  };

  return (
    <div className="instalar-app">
      <button type="button" className="instalar-app-boton" aria-expanded={modo === 'directa' ? undefined : verPasos} onClick={alTocar}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 21h14" />
        </svg>
        <span>Instalar app</span>
      </button>
      {verPasos && modo !== 'directa' && (
        <p className="instalar-app-pasos">{PASOS[modo]} Quedará un ícono en la pantalla de inicio y abrirá sin la barra del navegador.</p>
      )}
    </div>
  );
}
