import { useState } from 'react';
import { useSisrec } from '../app/SisrecContext';
import { apiBase, authFetch } from '../services/session';

const EMPTY_MERCHANT = { dni_ruc: '', nombre: '', rubro_id: '1', zona_id: '1', categoria: 'permanente', tipo_comerciante: 'permanente', estado: 'activo' };

// Página Comerciantes: alta, edición y baja, e importación del padrón en Excel/CSV.
export function useComerciantes() {
  const { user, comerciantes, catalogos, refresh } = useSisrec();
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState(EMPTY_MERCHANT);
  const [editingId, setEditingId] = useState(null);
  const [padronFile, setPadronFile] = useState(null);
  const [padronPreview, setPadronPreview] = useState(null);
  const [padronMessage, setPadronMessage] = useState('');
  const [padronLoading, setPadronLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setMessage('');
    try {
      const response = await authFetch(`${apiBase}/comerciantes${editingId ? `/${editingId}` : ''}`, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, usuario_creador: user?.id || 1 })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo registrar el comerciante');

      setForm(EMPTY_MERCHANT);
      setEditingId(null);
      setMessage(data.message);
      setShowForm(false);
      await refresh();
    } catch (submitError) {
      setMessage(submitError.message);
    }
  };

  // row es una fila del directorio (ver useDatosSisrec): [id, nombre, rubro, dni_ruc, zona, estado, …, tipo].
  const edit = (row) => {
    const [id, name, category, document, zone] = row;
    const rubro = catalogos.rubros.find((item) => item.nombre.toLowerCase() === String(category).toLowerCase());
    const zona = catalogos.zonas.find((item) => item.nombre.toLowerCase() === String(zone).toLowerCase());
    const merchant = comerciantes.find((item) => Number(item[0]) === Number(id));
    const tipoComerciante = merchant?.[7] || 'permanente';
    setEditingId(id);
    setForm({ dni_ruc: document, nombre: name, rubro_id: String(rubro?.id || 1), zona_id: String(zona?.id || 1), categoria: tipoComerciante, tipo_comerciante: tipoComerciante, estado: String(merchant?.[5] || 'activo').toLowerCase() });
    setShowForm(true);
    setMessage('');
  };

  const deactivate = async (id) => {
    try {
      const response = await authFetch(`${apiBase}/comerciantes/${id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo dar de baja');
      setMessage(data.message);
      await refresh();
    } catch (deactivateError) {
      setMessage(deactivateError.message);
    }
  };

  const sendPadron = (file, dryRun) => {
    const body = new FormData();
    body.append('file', file);
    body.append('dryRun', String(dryRun));
    return authFetch(`${apiBase}/comerciantes/importar-padron`, { method: 'POST', body });
  };

  const previewPadron = async (file) => {
    setPadronFile(file);
    setPadronPreview(null);
    setPadronMessage('');
    if (!file) return;
    setPadronLoading(true);
    try {
      const response = await sendPadron(file, true);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo leer el padrón');
      setPadronPreview(data.data);
      setPadronMessage(data.message || 'Previsualización lista.');
    } catch (importError) {
      setPadronMessage(importError.message || 'No se pudo leer el padrón');
    } finally {
      setPadronLoading(false);
    }
  };

  const importPadron = async () => {
    if (!padronFile) return;
    setPadronLoading(true);
    setPadronMessage('');
    try {
      const response = await sendPadron(padronFile, false);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo importar el padrón');
      setPadronPreview(data.data);
      setPadronMessage(`${data.message} Nuevos: ${data.data.result.createdMerchants} comerciantes y ${data.data.result.createdPosts} puestos; omitidos: ${data.data.result.skippedRows}.`);
      setPadronFile(null);
      await refresh();
    } catch (importError) {
      setPadronMessage(importError.message || 'No se pudo importar el padrón');
    } finally {
      setPadronLoading(false);
    }
  };

  return {
    showForm, setShowForm, message, form, setForm, editingId,
    padronPreview, padronMessage, padronLoading,
    submit, edit, deactivate, previewPadron, importPadron
  };
}
