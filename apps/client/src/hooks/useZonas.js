import { useState } from 'react';
import { useSisrec } from '../app/SisrecContext';
import { apiBase, authFetch, leerJson } from '../services/session';

// El precio inicial se envía al crear. Los precios de zonas existentes se guardan por separado.
const EMPTY_ZONE = { nombre: '', descripcion: '', tipo_via: '', precio_dia: '', norma: '' };

export function useZonas() {
  const { catalogos, refresh } = useSisrec();
  const [zoneForm, setZoneForm] = useState(EMPTY_ZONE);
  const [editingZoneId, setEditingZoneId] = useState(null);
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  const mutate = async (endpoint, options, fallbackMessage) => {
    if (saving) return false;
    setSaving(true);
    setMessage('');
    setSuccess(false);
    try {
      const response = await authFetch(endpoint, options);
      const data = await leerJson(response);
      if (!response.ok) throw new Error(data.message || fallbackMessage);
      await refresh();
      setMessage(data.message);
      setSuccess(true);
      return true;
    } catch (error) {
      setMessage(error.message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const submitZone = (event) => {
    event.preventDefault();
    const { nombre, descripcion, tipo_via } = zoneForm;
    return mutate(
      editingZoneId ? `${apiBase}/zonas/${editingZoneId}` : `${apiBase}/zonas`,
      { method: editingZoneId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editingZoneId ? { nombre, descripcion, tipo_via } : zoneForm) },
      'No se pudo guardar la zona'
    );
  };

  const deleteZone = (id) => mutate(`${apiBase}/zonas/${id}`, { method: 'DELETE' }, 'No se pudo eliminar la zona');

  const editZone = (zona) => {
    setMessage('');
    setSuccess(false);
    setEditingZoneId(zona.id);
    setZoneForm({ nombre: zona.nombre, descripcion: zona.descripcion || '', tipo_via: zona.tipo_via || '', precio_dia: '', norma: '' });
  };
  const cancelZone = () => {
    setEditingZoneId(null);
    setZoneForm(EMPTY_ZONE);
  };

  return {
    zoneRecords: catalogos.zonas, zoneForm, setZoneForm, editingZoneId,
    message, success, saving, submitZone, deleteZone, editZone, cancelZone
  };
}
