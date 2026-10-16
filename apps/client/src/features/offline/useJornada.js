import { useCallback, useEffect, useState } from 'react';

import { aplicarCobroLocal, buscarEnPadron, jornadaVigente, normalizarComerciante } from '../../services/jornadaOffline';
import { storeFor } from '../../services/offlineStore';
import { apiBase, authFetch } from '../../services/session';

const CAN_COLLECT = ['super_admin', 'cobrador'];
const padronStore = storeFor('padron');
const jornadaStore = storeFor('jornada');

/**
 * Padrón y tarifas de la jornada en el celular. Se descargan solos al iniciar sesión si el que hay
 * no es de hoy, y a pedido con el botón "Descargar padrón". Así se busca y se cobra sin señal.
 */
export function useJornada({ user }) {
  const [meta, setMeta] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const canCollect = CAN_COLLECT.includes(user?.rol);

  const loadMeta = useCallback(async () => {
    try {
      setMeta((await jornadaStore.get('meta')) || null);
    } catch {
      setMeta(null);
    }
  }, []);

  const download = useCallback(async () => {
    setDownloading(true);
    setError('');
    try {
      const response = await authFetch(`${apiBase}/jornada/paquete`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || `No se pudo descargar el padrón (${response.status})`);
      const descargadoEn = new Date().toISOString();
      const registros = body.data.comerciantes.map((item) => normalizarComerciante(item, descargadoEn));
      await padronStore.replaceAll(registros);
      await jornadaStore.put({ clave: 'tarifas', tarifas: body.data.tarifas || [], rubros: body.data.rubros || [], zonas: body.data.zonas || [] });
      const nextMeta = {
        clave: 'meta',
        descargadoEn,
        generadoEn: body.data.generado_en,
        periodo: body.data.periodo,
        comerciantes: registros.length,
        tarifas: (body.data.tarifas || []).length,
        usuarioId: user?.id ?? null
      };
      await jornadaStore.put(nextMeta);
      setMeta(nextMeta);
      return nextMeta;
    } catch (downloadError) {
      setError(downloadError instanceof TypeError ? 'Sin conexión: no se pudo descargar el padrón.' : downloadError.message);
      return null;
    } finally {
      setDownloading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user || !canCollect) return;
    (async () => {
      const current = await jornadaStore.get('meta').catch(() => null);
      setMeta(current || null);
      if (!jornadaVigente(current) && navigator.onLine) await download();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, canCollect]);

  const search = useCallback(async (query) => buscarEnPadron(await padronStore.getAll(), query), []);

  // Descuenta del saldo local un cobro hecho sin señal.
  const applyLocalPayment = useCallback(async (merchantId, monto) => {
    const registro = await padronStore.get(String(merchantId));
    if (!registro) return null;
    const updated = aplicarCobroLocal(registro, monto);
    await padronStore.put(updated);
    return updated;
  }, []);

  return { meta, vigente: jornadaVigente(meta), downloading, error, download, search, applyLocalPayment, reload: loadMeta };
}
