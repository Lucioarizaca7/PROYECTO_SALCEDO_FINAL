import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { pathOf } from '../app/navegacion';
import { useSisrec } from '../app/SisrecContext';
import { mapFetch, queueMapMutation } from '../services/mapaOffline';
import { apiBase } from '../services/session';

// Páginas Sitios de venta y Mapa: filtros de la tabla y cambios de puestos.
// Sin señal, cada cambio se guarda en la cola del mapa y se envía al volver la conexión.
export function useSitios() {
  const { refresh } = useSisrec();
  const navigate = useNavigate();
  const [message, setMessage] = useState('');
  const [filters, setFilters] = useState({ estado: 'todos', zona: 'todas', bajas: false });
  const [sitesWithInactive, setSitesWithInactive] = useState(null);

  // Si la red no está, encola; si está, llama al servidor y recarga los datos.
  const mutate = async ({ offline, offlineMessage, request, failMessage }) => {
    setMessage('');
    if (!navigator.onLine) {
      await queueMapMutation(...offline);
      setMessage(offlineMessage);
      return;
    }
    const response = await mapFetch(...request);
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || failMessage);
    setMessage(data.message);
    await refresh();
  };

  const json = (method, payload) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });

  const createSite = (payload) => mutate({
    offline: ['create', payload],
    offlineMessage: 'Puesto guardado localmente; quedará pendiente de sincronización.',
    request: [`${apiBase}/puestos-mapa`, json('POST', payload)],
    failMessage: 'No se pudo guardar el puesto'
  });

  const updateSite = (id, payload) => mutate({
    offline: ['update', { id, ...payload }],
    offlineMessage: 'Nueva posición guardada localmente; pendiente de sincronización.',
    request: [`${apiBase}/puestos-mapa/${id}`, json('PUT', payload)],
    failMessage: 'No se pudo actualizar el puesto'
  });

  const deleteSite = async (site) => {
    if (!window.confirm(`¿Dar de baja el puesto ${site.codigo}?`)) return;
    await mutate({
      offline: ['delete', { id: site.id }],
      offlineMessage: 'Baja guardada localmente; pendiente de sincronización.',
      request: [`${apiBase}/puestos-mapa/${site.id}`, { method: 'DELETE' }],
      failMessage: 'No se pudo dar de baja el puesto'
    });
  };

  const assignSite = (site, comercianteId) => updateSite(site.id, { comerciante_id: comercianteId });

  // Sin señal se encola como actualización con comerciante_id null (el servidor lo deja disponible).
  const releaseSite = async (site) => {
    if (!window.confirm(`¿Liberar el puesto ${site.codigo}? Quedará sin titular y disponible para otro comerciante.`)) return;
    await mutate({
      offline: ['update', { id: site.id, comerciante_id: null }],
      offlineMessage: 'Liberación guardada localmente; pendiente de sincronización.',
      request: [`${apiBase}/puestos/${site.id}/liberar`, { method: 'POST' }],
      failMessage: 'No se pudo liberar el puesto'
    });
  };

  const searchMerchants = useCallback(async (query) => {
    const response = await mapFetch(`${apiBase}/comerciantes?limit=10&search=${encodeURIComponent(query)}`);
    const data = await response.json();
    return (data.data || []).filter((merchant) => merchant.estado !== 'inactivo');
  }, []);

  // Lleva al cobro del titular del puesto; la página Pagos carga su saldo del mes.
  const collectFromSite = (site) => {
    if (!site.comerciante_id) {
      setMessage(`El puesto ${site.codigo} está libre: no tiene titular a quien cobrar.`);
      return;
    }
    navigate(pathOf('pagos'), {
      state: { cobrarPuesto: { id: site.comerciante_id, nombre: site.comerciante, codigo: site.codigo, rubro: site.categoria, zona: site.zona, saldo: site.saldo_pendiente } }
    });
  };

  const toggleInactive = async (bajas) => {
    setFilters((current) => ({ ...current, bajas }));
    if (!bajas) return setSitesWithInactive(null);
    try {
      const response = await mapFetch(`${apiBase}/puestos?incluirInactivos=1`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudieron cargar los puestos dados de baja');
      setSitesWithInactive(data.data || []);
    } catch (error) {
      setMessage(error.message);
      setFilters((current) => ({ ...current, bajas: false }));
    }
  };

  return {
    message, filters, setFilters, sitesWithInactive,
    createSite, updateSite, deleteSite, assignSite, releaseSite, searchMerchants, collectFromSite, toggleInactive
  };
}
