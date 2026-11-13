import { useEffect, useState } from 'react';
import { hoyEnLima } from '../services/jornadaOffline';
import { apiBase, authFetch } from '../services/session';

const POR_PAGINA = 50;
const ESPERA_BUSQUEDA_MS = 300;

/**
 * Auditoría con fechas, búsqueda y páginas en el servidor (GET /auditoria). Antes la pantalla mostraba los
 * últimos 200 registros que cargaba el panel: en un día de feria no se llegaba más allá de unas horas.
 * `verificar` comprueba la cadena de hashes (GET /auditoria/verificacion), que ninguna pantalla usaba.
 */
export function useAuditoria() {
  const hoy = hoyEnLima();
  const [filtro, setFiltroEstado] = useState({ desde: `${hoy.slice(0, 7)}-01`, hasta: hoy, buscar: '' });
  const [buscar, setBuscar] = useState('');
  const [page, setPage] = useState(1);
  const [filas, setFilas] = useState([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [verificacion, setVerificacion] = useState(null);

  useEffect(() => {
    const espera = setTimeout(() => setBuscar(filtro.buscar.trim()), ESPERA_BUSQUEDA_MS);
    return () => clearTimeout(espera);
  }, [filtro.buscar]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), limit: String(POR_PAGINA) });
    if (filtro.desde) params.set('desde', filtro.desde);
    if (filtro.hasta) params.set('hasta', filtro.hasta);
    if (buscar) params.set('buscar', buscar);
    setCargando(true);
    authFetch(`${apiBase}/auditoria?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.message || 'No se pudo cargar la auditoría');
        setFilas(body.data || []);
        setTotal(Number(body.total || 0));
        setMensaje('');
      })
      .catch((error) => { if (!controller.signal.aborted) setMensaje(error.message); })
      .finally(() => { if (!controller.signal.aborted) setCargando(false); });
    return () => controller.abort();
  }, [filtro.desde, filtro.hasta, buscar, page]);

  const verificar = async () => {
    setVerificacion({ cargando: true });
    try {
      const response = await authFetch(`${apiBase}/auditoria/verificacion`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || 'No se pudo verificar la auditoría');
      setVerificacion(body.data);
    } catch (error) {
      setVerificacion({ error: error.message });
    }
  };

  const totalPaginas = Math.max(Math.ceil(total / POR_PAGINA), 1);
  return {
    filtro,
    // Cambiar un filtro vuelve a la primera página.
    setFiltro: (cambio) => { setFiltroEstado((actual) => ({ ...actual, ...cambio })); setPage(1); },
    filas, total, cargando, mensaje, page: Math.min(page, totalPaginas), totalPaginas, setPage, verificacion, verificar
  };
}
