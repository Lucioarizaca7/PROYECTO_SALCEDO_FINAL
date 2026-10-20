import { useCallback, useEffect, useState } from 'react';

import {
  anulacionesPendientes, anularLocal, CLAVE_TICKETS, consumir, desdeServidor, estadoGuardado, estadoVacio,
  marcarAnulacionesEnviadas, seriesConPocos
} from '../../services/ticketsOffline';
import { storeFor } from '../../services/offlineStore';
import { apiBase, authFetch } from '../../services/session';

const jornadaStore = storeFor('jornada');
const leer = async () => estadoGuardado(await jornadaStore.get(CLAVE_TICKETS).catch(() => null));

/**
 * Tickets preimpresos del cobrador en el celular: los números de sus lotes (bajados con el paquete de
 * jornada o con /tickets/mios), los que entregó sin señal y las anulaciones por subir.
 */
export function useTicketsCobrador({ isOnline, jornadaMeta }) {
  const [estado, setEstado] = useState(estadoVacio);
  const [mensaje, setMensaje] = useState('');

  const guardar = async (siguiente) => {
    setEstado(siguiente);
    await jornadaStore.put(siguiente).catch(() => null);
    return siguiente;
  };

  useEffect(() => {
    leer().then(setEstado);
  }, [jornadaMeta?.descargadoEn]);

  const enviarAnulaciones = useCallback(async () => {
    const pendientes = anulacionesPendientes(await leer());
    if (!pendientes.length || !navigator.onLine) return;
    try {
      const response = await authFetch(`${apiBase}/tickets/anulaciones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anulaciones: pendientes })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || 'No se pudieron subir las anulaciones');
      await guardar(marcarAnulacionesEnviadas(await leer(), body.data?.resultados || []));
      const rechazadas = (body.data?.resultados || []).filter((item) => item.estado === 'rechazado');
      setMensaje(rechazadas.length ? rechazadas.map((item) => item.mensaje).join('; ') : body.message);
    } catch (error) {
      setMensaje(error instanceof TypeError ? 'Sin conexión: la anulación queda guardada en el celular.' : error.message);
    }
  }, []);

  // Números al día desde el servidor (después de un cobro en línea o al volver la señal).
  const refrescar = useCallback(async () => {
    if (!navigator.onLine) return;
    try {
      const response = await authFetch(`${apiBase}/tickets/mios`);
      const body = await response.json().catch(() => ({}));
      if (response.ok) await guardar(desdeServidor(await leer(), body.data));
    } catch {
      // Sin conexión: se sigue con la numeración del celular.
    }
  }, []);

  const consumirTickets = async (tickets) => guardar(consumir(await leer(), tickets));

  // Lanza un error con el motivo si no se puede anular (motivo corto, número no disponible).
  const anular = async (serie, numero, motivo) => {
    await guardar(anularLocal(await leer(), serie, numero, motivo));
    if (navigator.onLine) await enviarAnulaciones();
  };

  useEffect(() => {
    if (!isOnline) return;
    enviarAnulaciones().then(refrescar);
  }, [isOnline, enviarAnulaciones, refrescar]);

  return { estado, pocos: seriesConPocos(estado), anulacionesPendientes: anulacionesPendientes(estado).length, mensaje, refrescar, consumirTickets, anular };
}
