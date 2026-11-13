import { useCallback, useEffect, useState } from 'react';

import { aplicarMarca, CLAVE_ASISTENCIAS, estadoDelDia, ferialesDelPadron, marcarEnviadas, marcasPendientes, observacionQueSeConserva } from '../../services/asistenciaOffline';
import { hoyEnLima } from '../../services/jornadaOffline';
import { storeFor } from '../../services/offlineStore';
import { apiBase, authFetch } from '../../services/session';

const padronStore = storeFor('padron');
const jornadaStore = storeFor('jornada');

/**
 * Asistencia del día: el cobrador marca asistió / faltó (con una observación si hace falta) sobre el padrón
 * del celular, a quienes cobran por día cobrado.
 * Las marcas se guardan en el celular y suben solas cuando hay señal (reenviarlas no duplica nada).
 */
export function useAsistenciaFerial({ isOnline, jornadaMeta }) {
  const [feriales, setFeriales] = useState([]);
  const [estado, setEstado] = useState(() => estadoDelDia(null, hoyEnLima()));
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState('');
  // Zonas del paquete de la jornada, para elegir la zona del día sin señal.
  const [zonas, setZonas] = useState([]);

  useEffect(() => {
    (async () => {
      setFeriales(ferialesDelPadron(await padronStore.getAll().catch(() => [])));
      setZonas((await jornadaStore.get('tarifas').catch(() => null))?.zonas || []);
      const cargado = estadoDelDia(await jornadaStore.get(CLAVE_ASISTENCIAS).catch(() => null), hoyEnLima());
      setEstado(cargado);
      // Lo que quedó sin subir (también de días anteriores) sale apenas hay señal.
      if (navigator.onLine && marcasPendientes(cargado).length) enviar(cargado);
    })();
  }, [jornadaMeta?.descargadoEn]);

  const guardar = async (siguiente) => {
    setEstado(siguiente);
    await jornadaStore.put(siguiente).catch(() => null);
  };

  const enviar = useCallback(async (actual) => {
    const pendientes = marcasPendientes(actual);
    if (!pendientes.length || !navigator.onLine) return;
    setEnviando(true);
    try {
      const response = await authFetch(`${apiBase}/asistencias`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marcas: pendientes })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || 'No se pudo subir la asistencia');
      // El servidor guarda las buenas y devuelve las rechazadas (dado de baja, día muy antiguo) una por una.
      const rechazadas = Array.isArray(body.rechazadas) ? body.rechazadas : [];
      const enviadas = pendientes.filter((item) => !rechazadas.some((otra) => Number(otra.puesto_id) === item.puesto_id && otra.fecha === item.fecha));
      // Se relee lo guardado: el cobrador pudo cambiar una marca mientras se enviaba.
      const guardado = estadoDelDia(await jornadaStore.get(CLAVE_ASISTENCIAS).catch(() => null), actual.fecha);
      await guardar(marcarEnviadas(guardado.fecha === actual.fecha ? guardado : actual, enviadas, rechazadas));
      setMensaje(rechazadas.length
        ? `${enviadas.length} marca(s) subidas; ${rechazadas.length} no se registraron: ${rechazadas.map((item) => item.error).join(' · ')}`
        : `${pendientes.length} marca(s) de asistencia subidas.`);
    } catch (error) {
      setMensaje(error instanceof TypeError ? 'Sin conexión: la asistencia queda guardada en el celular.' : error.message);
    } finally {
      setEnviando(false);
    }
  }, []);

  // observacion: { motivo, observacion } (no salió, no vendió…). Sin ella, se conserva la que ya tenía la
  // marca si sigue siendo coherente.
  // zonaId: la zona del día (12/11/2026); sin ella se conserva la que ya tenía la marca.
  const marcar = async (puestoId, asistio, observacion, zonaId) => {
    const actual = estadoDelDia(estado, hoyEnLima());
    const nota = observacion ?? observacionQueSeConserva(actual.marcas[String(puestoId)], asistio);
    const siguiente = aplicarMarca(actual, puestoId, asistio, new Date(), { ...nota, ...(zonaId === undefined ? {} : { zonaId }) });
    await guardar(siguiente);
    if (navigator.onLine) await enviar(siguiente);
  };

  useEffect(() => {
    if (isOnline) enviar(estado);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  return { feriales, zonas, estado, pendientes: marcasPendientes(estado).length, enviando, mensaje, marcar, enviar: () => enviar(estado) };
}
