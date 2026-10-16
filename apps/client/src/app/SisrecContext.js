import { createContext, useContext } from 'react';

// Lo que comparten las páginas del personal: usuario, datos del servidor (useDatosSisrec),
// señal, padrón de la jornada y cola de cobros offline. Lo provee App.jsx.
export const SisrecContext = createContext(null);

export function useSisrec() {
  const value = useContext(SisrecContext);
  if (!value) throw new Error('useSisrec debe usarse dentro de SisrecContext.Provider');
  return value;
}
