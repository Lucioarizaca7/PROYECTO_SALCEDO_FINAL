import { useEffect, useState } from 'react';
import { useSisrec } from '../app/SisrecContext';
import { hoyEnLima } from '../services/jornadaOffline';
import { apiBase, authFetch, leerJson } from '../services/session';

/** Un precio que ya empezó a regir no cambia lo que cobra: solo se puede cerrar (decisión del 11/11/2026). */
export const tarifaYaRige = (tarifa, hoy = hoyEnLima()) => Boolean(tarifa?.vigencia_inicio) && tarifa.vigencia_inicio <= hoy;

/**
 * Precio sugerido para una zona que aún no tiene: el de su tipo de vía (S/ 3 asfaltada, S/ 2 sin asfaltar). Solo
 * sugiere: el precio lo decide el super_admin (13/11/2026).
 */
export const precioSugerido = (zona) => (zona?.precio_dia != null ? String(Number(zona.precio_dia))
  : zona?.tipo_via === 'asfaltada' ? '3' : zona?.tipo_via === 'sin_asfaltar' ? '2' : '');

// Un precio nuevo empieza hoy por omisión: con una fecha pasada cambiaría la deuda de días ya cobrados.
const nuevoPrecio = (zona = null) => ({ zona_id: zona ? String(zona.id) : '', monto_fijo: precioSugerido(zona), vigencia_inicio: hoyEnLima(), vigencia_fin: '', norma: '' });

// Página Tarifas: el precio por día de cada zona (cobro solo por día cobrado, 13/11/2026). Crear un precio
// cierra el anterior de esa zona el día previo; el servidor rechaza la edición si otro usuario la cambió antes.
export function useTarifas() {
  const { refresh, user } = useSisrec();
  const [showForm, setShowForm] = useState(false);
  // Primer mes desde el que se suma la deuda acumulada (lo cambia solo el administrador).
  const [inicioCobro, setInicioCobro] = useState('');
  const [inicioFeedback, setInicioFeedback] = useState(null);
  const [cargandoInicio, setCargandoInicio] = useState(true);
  const [savingInicio, setSavingInicio] = useState(false);
  const [editingTariff, setEditingTariff] = useState(null);
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(nuevoPrecio);
  const hoy = hoyEnLima();
  const editingId = editingTariff?.id ?? null;
  const yaRige = tarifaYaRige(editingTariff, hoy);
  const yaFinalizo = Boolean(editingTariff?.vigencia_fin && editingTariff.vigencia_fin < hoy);
  const normaRequerida = !editingTariff || Boolean(editingTariff.norma?.trim());

  useEffect(() => {
    const controller = new AbortController();

    const cargarInicio = async () => {
      try {
        const response = await authFetch(`${apiBase}/parametros`, { signal: controller.signal });
        const data = await leerJson(response);
        if (!response.ok) throw new Error(data.message || 'No se pudo cargar el inicio de cobro');
        if (!controller.signal.aborted) setInicioCobro(data.data?.find((item) => item.clave === 'inicio_cobro')?.valor || '');
      } catch (error) {
        if (!controller.signal.aborted) setInicioFeedback({ message: error.message, success: false });
      } finally {
        if (!controller.signal.aborted) setCargandoInicio(false);
      }
    };

    cargarInicio();
    return () => controller.abort();
  }, []);

  const guardarInicioCobro = async (event) => {
    event.preventDefault();
    if (savingInicio || cargandoInicio) return false;
    setSavingInicio(true);
    setInicioFeedback(null);
    try {
      const response = await authFetch(`${apiBase}/parametros/inicio_cobro`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ valor: inicioCobro })
      });
      const data = await leerJson(response);
      if (!response.ok) throw new Error(data.message || 'No se pudo guardar el inicio de cobro');
      setInicioCobro(data.data.valor);
      setInicioFeedback({ message: data.message, success: true });
      return true;
    } catch (error) {
      setInicioFeedback({ message: error.message, success: false });
      return false;
    } finally {
      setSavingInicio(false);
    }
  };

  /** "Poner precio" / "Cambiar precio" de una zona: un precio nuevo desde hoy (o la fecha que se elija). */
  const cambiarPrecio = (zona = null) => {
    setEditingTariff(null);
    setForm(nuevoPrecio(zona));
    setMessage('');
    setSuccess(false);
    setShowForm(true);
  };

  // Un precio que ya rigió mantiene su monto e inicio. Su norma se puede corregir.
  const edit = (item) => {
    setEditingTariff(item);
    setForm({ zona_id: String(item.zona_id), monto_fijo: String(Number(item.monto_fijo)), vigencia_inicio: item.vigencia_inicio, vigencia_fin: item.vigencia_fin || '', norma: item.norma || '' });
    setMessage('');
    setSuccess(false);
    setShowForm(true);
  };

  const cerrarFormulario = () => { setShowForm(false); setEditingTariff(null); };

  const submit = async (event) => {
    event.preventDefault();
    if (saving) return false;
    setSaving(true);
    setMessage('');
    setSuccess(false);
    try {
      const { vigencia_fin, norma, ...campos } = form;
      const payload = { ...campos, zona_id: Number(form.zona_id) };
      // El servidor conserva campos omitidos. La fecha pasada y la norma vacía heredada no son cambios.
      if (!editingTariff || vigencia_fin !== (editingTariff.vigencia_fin || '')) payload.vigencia_fin = vigencia_fin;
      if (normaRequerida || norma.trim()) payload.norma = norma;
      if (editingTariff) payload.version = editingTariff.version;
      const response = await authFetch(`${apiBase}/tarifas${editingId ? `/${editingId}` : ''}`, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await leerJson(response);
      if (!response.ok) throw new Error(data.message || 'No se pudo guardar el precio');
      cerrarFormulario();
      await refresh();
      setMessage(data.message);
      setSuccess(true);
      return true;
    } catch (tariffError) {
      setMessage(tariffError.message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  return {
    showForm, editingId, yaRige, yaFinalizo, normaRequerida, message, success, saving,
    form, setForm, cambiarPrecio, edit, cerrarFormulario, submit,
    inicioCobro, setInicioCobro, guardarInicioCobro, inicioFeedback, cargandoInicio, savingInicio,
    puedeEditar: user?.rol === 'super_admin'
  };
}
