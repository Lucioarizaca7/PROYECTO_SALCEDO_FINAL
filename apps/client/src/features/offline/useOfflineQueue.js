import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { crearColaOffline, crearTransporteLote } from '../../services/offlineQueue';
import { storeFor } from '../../services/offlineStore';
import { apiBase, authFetch, getDeviceId } from '../../services/session';

const AUTO_SYNC_MS = 2 * 60 * 1000;
const CAN_COLLECT = ['super_admin', 'cobrador'];

/**
 * Estado de la cola de cobros offline para la interfaz: lista, conteos y sincronización.
 * Sincroniza al iniciar sesión, al volver la señal y cada 2 minutos mientras hay pendientes.
 */
export function useOfflineQueue({ user, onSynced }) {
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({ pendiente: 0, sincronizado: 0, error: 0, observado: 0 });
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const onSyncedRef = useRef(onSynced);
  onSyncedRef.current = onSynced;

  const queue = useMemo(() => crearColaOffline({
    store: storeFor('cobros_cola'),
    enviarLote: crearTransporteLote({ url: `${apiBase}/cobros/sincronizar-lote`, fetchImpl: authFetch, deviceId: getDeviceId() })
  }), []);

  const refresh = useCallback(async () => {
    try {
      const [list, totals] = await Promise.all([queue.listar(), queue.contar()]);
      setItems(list);
      setCounts(totals);
    } catch (error) {
      console.warn('No se pudo leer la cola offline:', error);
    }
  }, [queue]);

  const canCollect = CAN_COLLECT.includes(user?.rol);

  const sync = useCallback(async () => {
    if (!canCollect || (typeof navigator !== 'undefined' && !navigator.onLine)) return null;
    setSyncing(true);
    try {
      const result = await queue.sincronizar({ cobradorId: user?.id ?? null });
      setLastResult({ ...result, at: new Date().toISOString() });
      if (result.sincronizados + result.observados > 0) onSyncedRef.current?.(result);
      return result;
    } catch (error) {
      setLastResult({ error: error.message, at: new Date().toISOString() });
      return null;
    } finally {
      setSyncing(false);
      await refresh();
    }
  }, [canCollect, queue, refresh, user?.id]);

  const enqueue = useCallback(async (payload) => {
    const item = await queue.encolar(payload);
    await refresh();
    return item;
  }, [queue, refresh]);

  const retry = useCallback(async (hash) => {
    await queue.reintentar(hash);
    await refresh();
    return sync();
  }, [queue, refresh, sync]);

  useEffect(() => {
    refresh();
    if (!user || !canCollect) return undefined;
    queue.limpiarSincronizados({ dias: 7 }).catch(() => 0);
    sync();
    const onOnline = () => sync();
    window.addEventListener('online', onOnline);
    const timer = setInterval(() => {
      if (navigator.onLine) queue.contar().then((totals) => { if (totals.pendiente > 0) sync(); }).catch(() => undefined);
    }, AUTO_SYNC_MS);
    return () => {
      window.removeEventListener('online', onOnline);
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, canCollect]);

  return { items, counts, syncing, lastResult, sync, enqueue, retry, refresh };
}
