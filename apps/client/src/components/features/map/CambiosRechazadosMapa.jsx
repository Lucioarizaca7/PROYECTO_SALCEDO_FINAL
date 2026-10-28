import { useCallback, useEffect, useState } from 'react';
import { useSisrec } from '../../../app/SisrecContext';
import { describirCambioMapa } from '../../../services/colaMapa';
import { discardMapMutation, EVENTO_RECHAZOS_MAPA, readRejectedMapMutations, retryMapMutation } from '../../../services/mapaOffline';

// Cambios del mapa hechos sin señal que el servidor rechazó al sincronizar. Quedan guardados en el celular
// hasta que el usuario los reintente o los descarte: nunca se pierden en silencio.
export function CambiosRechazadosMapa() {
  const { refresh } = useSisrec();
  const [rechazados, setRechazados] = useState([]);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(() => {
    readRejectedMapMutations().then(setRechazados).catch(() => setRechazados([]));
  }, []);

  useEffect(() => {
    cargar();
    window.addEventListener(EVENTO_RECHAZOS_MAPA, cargar);
    return () => window.removeEventListener(EVENTO_RECHAZOS_MAPA, cargar);
  }, [cargar]);

  if (!rechazados.length) return null;

  const actuar = async (accion) => {
    setOcupado(true);
    try {
      await accion();
      await refresh();
    } finally {
      setOcupado(false);
    }
  };

  const descartar = (cambio) => {
    if (!window.confirm(`¿Descartar "${describirCambioMapa(cambio)}"? Ese cambio no llegará al servidor.`)) return;
    actuar(() => discardMapMutation(cambio));
  };

  return (
    <div className="form-error cambios-rechazados" role="alert">
      <strong>
        {rechazados.length === 1 ? '1 cambio hecho sin señal fue rechazado' : `${rechazados.length} cambios hechos sin señal fueron rechazados`}
      </strong>
      <ul>
        {rechazados.map((cambio) => (
          <li key={cambio.id}>
            <span><b>{describirCambioMapa(cambio)}:</b> {cambio.mensaje}</span>
            <span className="cambios-rechazados-acciones">
              <button type="button" className="table-action" disabled={ocupado || !navigator.onLine} onClick={() => actuar(() => retryMapMutation(cambio))}>Reintentar</button>
              <button type="button" className="table-action" disabled={ocupado} onClick={() => descartar(cambio)}>Descartar</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
