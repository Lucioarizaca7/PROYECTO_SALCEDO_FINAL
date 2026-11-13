import { useEffect, useRef, useState } from 'react';
import { fechaDeTexto } from '../lib/formato';
import { apiBase, authFetch } from '../services/session';

const pageSize = 10;
const ESPERA_BUSQUEDA_MS = 300;

// Fila del directorio: [id, nombre, rubro, dni_ruc, zona, estado, fecha, tipo, código, correlativo, carnet].
export const aFilaDirectorio = (item) => [
  item.id, item.nombre, item.rubro, item.dni_ruc, item.zona, item.estado,
  fechaDeTexto(item.fecha_registro)?.toLocaleDateString('es-PE') || '', item.tipo_comerciante || item.categoria,
  item.codigo, item.correlativo, item.carnet_emitido_en || null
];

/**
 * Directorio de comerciantes con búsqueda, filtros y páginas EN EL SERVIDOR (GET /comerciantes). Antes la
 * pantalla filtraba en el navegador los 100 más recientes y, con el padrón importado, la mayoría no aparecía.
 * Los filtros de rubro y zona van por id: por texto, "Salcedo" también traía "Barrio Alto Salcedo".
 * `recarga` (la lista del contexto) cambia después de guardar o dar de baja: se vuelve a pedir la página.
 */
export function useMerchantDirectory(recarga) {
  const [search, setSearch] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [rubro, setRubro] = useState('');
  const [zona, setZona] = useState('');
  const [page, setPage] = useState(1);
  const [filas, setFilas] = useState([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  // Filas vistas en cualquier página: para emitir carnets de una selección que abarca varias páginas.
  const vistas = useRef(new Map());

  useEffect(() => {
    const espera = setTimeout(() => { setBusqueda(search.trim()); }, ESPERA_BUSQUEDA_MS);
    return () => clearTimeout(espera);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), limit: String(pageSize), includeInactive: 'true' });
    if (busqueda) params.set('search', busqueda);
    if (rubro) params.set('rubro_id', rubro);
    if (zona) params.set('zona_id', zona);
    setCargando(true);
    authFetch(`${apiBase}/comerciantes?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.message || 'No se pudo cargar el padrón');
        const nuevas = (body.data || []).map(aFilaDirectorio);
        for (const fila of nuevas) vistas.current.set(fila[0], fila);
        setFilas(nuevas);
        setTotal(Number(body.total || 0));
        setError('');
      })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setCargando(false); });
    return () => controller.abort();
  }, [busqueda, rubro, zona, page, recarga]);

  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const reiniciar = (setter) => (value) => { setter(value); setPage(1); };

  return {
    search,
    rubro,
    zona,
    page: Math.min(page, totalPages),
    pageSize,
    totalPages,
    total,
    cargando,
    error,
    visibleMerchants: filas,
    filaPorId: (id) => vistas.current.get(id) || null,
    changeSearch: reiniciar(setSearch),
    changeRubro: reiniciar(setRubro),
    changeZona: reiniciar(setZona),
    clearFilters: () => { setSearch(''); setRubro(''); setZona(''); setPage(1); },
    setPage
  };
}
