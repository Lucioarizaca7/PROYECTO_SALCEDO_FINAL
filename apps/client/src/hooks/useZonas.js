import { useEffect, useState } from 'react';
import { useSisrec } from '../app/SisrecContext';
import { apiBase, authFetch, leerJson } from '../services/session';

const EMPTY_ZONE = { nombre: '', descripcion: '', tipo_via: '' };

// Página Zonas: lista propia (GET /zonas) y su CRUD. No hay calles (decisión del 14/11/2026).
export function useZonas() {
  const { refresh } = useSisrec();
  const [zoneRecords, setZoneRecords] = useState([]);
  const [zoneForm, setZoneForm] = useState(EMPTY_ZONE);
  const [editingZoneId, setEditingZoneId] = useState(null);
  const [message, setMessage] = useState('');

  const loadCatalog = async () => {
    try {
      const response = await authFetch(`${apiBase}/zonas`);
      const data = await leerJson(response);
      if (!response.ok) throw new Error(data.message || 'No se pudieron cargar las zonas');
      setZoneRecords(Array.isArray(data.data) ? data.data : []);
    } catch (error) {
      console.warn('No se pudieron recargar las zonas:', error);
    }
  };

  useEffect(() => {
    loadCatalog();
  }, []);

  // Guarda o elimina y, si sale bien, recarga la lista de esta página y los catálogos compartidos.
  const mutate = async (endpoint, options, fallbackMessage, onSuccess) => {
    setMessage('');
    try {
      const response = await authFetch(endpoint, options);
      const data = await leerJson(response);
      if (!response.ok) throw new Error(data.message || fallbackMessage);
      setMessage(data.message);
      onSuccess?.();
      await loadCatalog();
      await refresh();
    } catch (error) {
      setMessage(error.message);
    }
  };

  const submitZone = (event) => {
    event.preventDefault();
    return mutate(
      editingZoneId ? `${apiBase}/zonas/${editingZoneId}` : `${apiBase}/zonas`,
      { method: editingZoneId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(zoneForm) },
      'No se pudo guardar la zona',
      () => { setZoneForm(EMPTY_ZONE); setEditingZoneId(null); }
    );
  };

  const deleteZone = (id) => mutate(`${apiBase}/zonas/${id}`, { method: 'DELETE' }, 'No se pudo eliminar la zona');

  const editZone = (zona) => {
    setEditingZoneId(zona.id);
    setZoneForm({ nombre: zona.nombre, descripcion: zona.descripcion || '', tipo_via: zona.tipo_via || '' });
  };
  const cancelZone = () => {
    setEditingZoneId(null);
    setZoneForm(EMPTY_ZONE);
  };

  return { zoneRecords, zoneForm, setZoneForm, editingZoneId, message, submitZone, deleteZone, editZone, cancelZone };
}
