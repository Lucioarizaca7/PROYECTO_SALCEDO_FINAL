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

  // "Nuevo registro" abre siempre un formulario vacío. Antes, cerrar una edición y pulsar "Nuevo registro"
  // reabría los datos del último editado y "Guardar" sobrescribía a ese comerciante en vez de crear uno.
  const toggleForm = () => {
    if (showForm || editingId) {
      setEditingId(null);
      setForm(EMPTY_MERCHANT);
    }
    setShowForm(!showForm);
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

  // PIN del portal: el servidor lo devuelve una sola vez; el carnet QR lo muestra para imprimirlo.
  const generatePortalPin = async (id) => {
    const response = await authFetch(`${apiBase}/comerciantes/${id}/portal-pin`, { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'No se pudo generar el PIN del portal');
    return data.data;
  };

  // Con previewToken la confirmación no vuelve a subir el Excel: el servidor usa el libro ya leído.
  const sendPadron = ({ file = null, dryRun, previewToken = null }) => {
    const body = new FormData();
    if (previewToken) body.append('previewToken', previewToken);
    else body.append('file', file);
    body.append('dryRun', String(dryRun));
    return authFetch(`${apiBase}/comerciantes/importar-padron`, { method: 'POST', body });
  };

  const downloadPadronTemplate = async () => {
    try {
      const response = await authFetch(`${apiBase}/comerciantes/plantilla-padron`);
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || 'No se pudo descargar la plantilla');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'plantilla-padron-sisrec.xlsx';
      link.click();
      URL.revokeObjectURL(url);
    } catch (templateError) {
      setPadronMessage(templateError.message || 'No se pudo descargar la plantilla');
    }
  };

  const previewPadron = async (file) => {
    setPadronFile(file);
    setPadronPreview(null);
    setPadronMessage('');
    if (!file) return;
    setPadronLoading(true);
    try {
      const response = await sendPadron({ file, dryRun: true });
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
      let response = padronPreview?.previewToken
        ? await sendPadron({ previewToken: padronPreview.previewToken, dryRun: false })
        : await sendPadron({ file: padronFile, dryRun: false });
      // 410: la previsualización venció en el servidor; se reenvía el archivo.
      if (response.status === 410) response = await sendPadron({ file: padronFile, dryRun: false });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo importar el padrón');
      setPadronPreview(data.data);
      const { result } = data.data;
      const detalle = [
        `${result.createdMerchants} comerciantes nuevos`,
        `${result.createdPosts} puestos nuevos`,
        result.reactivatedMerchants ? `${result.reactivatedMerchants} reactivados` : null,
        result.regularizedMerchants ? `${result.regularizedMerchants} regularizados` : null,
        `omitidas: ${result.skippedRows}`
      ].filter(Boolean).join('; ');
      setPadronMessage(`${data.message} ${detalle}.`);
      setPadronFile(null);
      await refresh();
    } catch (importError) {
      setPadronMessage(importError.message || 'No se pudo importar el padrón');
    } finally {
      setPadronLoading(false);
    }
  };

  return {
    showForm, toggleForm, message, form, setForm, editingId,
    padronPreview, padronMessage, padronLoading,
    submit, edit, deactivate, previewPadron, importPadron, downloadPadronTemplate, generatePortalPin
  };
}
