import { useEffect, useState } from 'react';
import { useSisrec } from '../app/SisrecContext';
import { apiBase, authFetch } from '../services/session';

const EMPTY_ZONE = { nombre: '', descripcion: '' };
const emptyCalle = (zonaId = '') => ({ zona_id: String(zonaId), nombre: '', descripcion: '', estado: 'activo' });

// Página Zonas y calles: listas propias (GET /zonas trae también las calles) y su CRUD.
export function useZonas() {
  const { catalogos, refresh } = useSisrec();
  const [zoneRecords, setZoneRecords] = useState([]);
  const [calleRecords, setCalleRecords] = useState([]);
  const [zoneForm, setZoneForm] = useState(EMPTY_ZONE);
  const [calleForm, setCalleForm] = useState(() => emptyCalle());
  const [editingZoneId, setEditingZoneId] = useState(null);
  const [editingCalleId, setEditingCalleId] = useState(null);
  const [message, setMessage] = useState('');

  const loadCatalog = async () => {
    try {
      const response = await authFetch(`${apiBase}/zonas`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudieron cargar las zonas');
      const zonas = Array.isArray(data.data) ? data.data : [];
      setZoneRecords(zonas);
      setCalleRecords(Array.isArray(data.calles) ? data.calles : []);
      if (zonas[0]?.id) setCalleForm((current) => (current.zona_id ? current : { ...current, zona_id: String(zonas[0].id) }));
    } catch (error) {
      console.warn('No se pudo recargar la zona/calle:', error);
    }
  };

  useEffect(() => {
    loadCatalog();
  }, []);

  // Guarda o elimina y, si sale bien, recarga las listas de esta página y los catálogos compartidos.
  const mutate = async (endpoint, options, fallbackMessage, onSuccess) => {
    setMessage('');
    try {
      const response = await authFetch(endpoint, options);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || fallbackMessage);
      setMessage(data.message);
      onSuccess?.();
      await loadCatalog();
      await refresh();
    } catch (error) {
      setMessage(error.message);
    }
  };

  const jsonBody = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  const submitZone = (event) => {
    event.preventDefault();
    return mutate(
      editingZoneId ? `${apiBase}/zonas/${editingZoneId}` : `${apiBase}/zonas`,
      jsonBody(editingZoneId ? 'PUT' : 'POST', zoneForm),
      'No se pudo guardar la zona',
      () => { setZoneForm(EMPTY_ZONE); setEditingZoneId(null); }
    );
  };

  const submitCalle = (event) => {
    event.preventDefault();
    return mutate(
      editingCalleId ? `${apiBase}/calles/${editingCalleId}` : `${apiBase}/calles`,
      jsonBody(editingCalleId ? 'PUT' : 'POST', calleForm),
      'No se pudo guardar la calle',
      () => { setCalleForm(emptyCalle(zoneRecords[0]?.id || '')); setEditingCalleId(null); }
    );
  };

  const deleteZone = (id) => mutate(`${apiBase}/zonas/${id}`, { method: 'DELETE' }, 'No se pudo eliminar la zona');
  const deleteCalle = (id) => mutate(`${apiBase}/calles/${id}`, { method: 'DELETE' }, 'No se pudo eliminar la calle');

  const editZone = (zona) => {
    setEditingZoneId(zona.id);
    setZoneForm({ nombre: zona.nombre, descripcion: zona.descripcion || '' });
  };
  const cancelZone = () => {
    setEditingZoneId(null);
    setZoneForm(EMPTY_ZONE);
  };
  const editCalle = (calle) => {
    setEditingCalleId(calle.id);
    setCalleForm({ zona_id: String(calle.zona_id || ''), nombre: calle.nombre, descripcion: calle.descripcion || '', estado: calle.estado || 'activo' });
  };

  const cancelCalle = () => {
    setEditingCalleId(null);
    setCalleForm(emptyCalle((catalogos.zonas || [])[0]?.id || ''));
  };

  return {
    zoneRecords, calleRecords, zoneForm, setZoneForm, calleForm, setCalleForm, editingZoneId, editingCalleId, message,
    submitZone, submitCalle, deleteZone, deleteCalle, editZone, cancelZone, editCalle, cancelCalle
  };
}
