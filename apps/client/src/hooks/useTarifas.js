import { useState } from 'react';
import { useSisrec } from '../app/SisrecContext';
import { apiBase, authFetch } from '../services/session';

const NEW_TARIFF = { rubro_id: '1', tipo_tarifa: 'fija', monto_fijo: '18', monto_variable: '0', unidad_medida: 'diaria', vigencia_inicio: '2026-01-01', vigencia_fin: '' };

// Página Tarifas: crear y editar tarifas (el servidor rechaza la edición si otro usuario la cambió antes).
export function useTarifas() {
  const { refresh } = useSisrec();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState(NEW_TARIFF);

  const toggleNew = () => {
    setEditingId(null);
    setMessage('');
    setShowForm((current) => !current);
  };

  const edit = (item) => {
    setEditingId(item.id);
    setForm({ rubro_id: String(item.rubro_id), tipo_tarifa: item.tipo_tarifa, monto_fijo: String(item.monto_fijo), monto_variable: String(item.monto_variable), unidad_medida: item.unidad_medida, vigencia_inicio: item.vigencia_inicio, vigencia_fin: item.vigencia_fin || '' });
    setShowForm(true);
  };

  const submit = async (event) => {
    event.preventDefault();
    setMessage('');
    try {
      const response = await authFetch(`${apiBase}/tarifas${editingId ? `/${editingId}` : ''}`, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo guardar la tarifa');
      setMessage(data.message);
      setShowForm(false);
      setEditingId(null);
      await refresh();
    } catch (tariffError) {
      setMessage(tariffError.message);
    }
  };

  return { showForm, editingId, message, form, setForm, toggleNew, edit, submit };
}
