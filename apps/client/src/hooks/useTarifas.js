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
const nuevoPrecio = (zona = null) => ({ zona_id: zona ? String(zona.id) : '', monto_fijo: precioSugerido(zona), vigencia_inicio: hoyEnLima(), vigencia_fin: '' });

// Página Tarifas: el precio por día de cada zona (cobro solo por día cobrado, 13/11/2026). Crear un precio
// cierra el anterior de esa zona el día previo; el servidor rechaza la edición si otro usuario la cambió antes.
export function useTarifas() {
  const { refresh, user } = useSisrec();
  const [showForm, setShowForm] = useState(false);
  // Primer mes desde el que se suma la deuda acumulada (lo cambia solo el administrador).
  const [inicioCobro, setInicioCobro] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingVersion, setEditingVersion] = useState(null);
  const [yaRige, setYaRige] = useState(false);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState(nuevoPrecio);

  useEffect(() => {
    authFetch(`${apiBase}/parametros`).then((response) => response.json())
      .then((body) => setInicioCobro(body.data?.find((item) => item.clave === 'inicio_cobro')?.valor || ''))
      .catch(() => null);
  }, []);

  const guardarInicioCobro = async (event) => {
    event.preventDefault();
    setMessage('');
    try {
      const response = await authFetch(`${apiBase}/parametros/inicio_cobro`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ valor: inicioCobro })
      });
      const data = await leerJson(response);
      if (!response.ok) throw new Error(data.message || 'No se pudo guardar el inicio de cobro');
      setMessage(data.message);
    } catch (error) {
      setMessage(error.message);
    }
  };

  /** "Poner precio" / "Cambiar precio" de una zona: un precio nuevo desde hoy (o la fecha que se elija). */
  const cambiarPrecio = (zona = null) => {
    setEditingId(null);
    setEditingVersion(null);
    setYaRige(false);
    setForm(nuevoPrecio(zona));
    setMessage('');
    setShowForm(true);
  };

  // Editar un precio del historial: uno que todavía no empieza se corrige; uno que ya rige solo se cierra.
  const edit = (item) => {
    setEditingId(item.id);
    setEditingVersion(item.version);
    setYaRige(tarifaYaRige(item));
    setForm({ zona_id: String(item.zona_id), monto_fijo: String(Number(item.monto_fijo)), vigencia_inicio: item.vigencia_inicio, vigencia_fin: item.vigencia_fin || '' });
    setMessage('');
    setShowForm(true);
  };

  const cerrarFormulario = () => { setShowForm(false); setEditingId(null); };

  const submit = async (event) => {
    event.preventDefault();
    setMessage('');
    try {
      const response = await authFetch(`${apiBase}/tarifas${editingId ? `/${editingId}` : ''}`, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, zona_id: Number(form.zona_id), ...(editingId ? { version: editingVersion } : {}) })
      });
      const data = await leerJson(response);
      if (!response.ok) throw new Error(data.message || 'No se pudo guardar el precio');
      setMessage(data.message);
      cerrarFormulario();
      await refresh();
    } catch (tariffError) {
      setMessage(tariffError.message);
    }
  };

  return {
    showForm, editingId, yaRige, message, form, setForm, cambiarPrecio, edit, cerrarFormulario, submit,
    inicioCobro, setInicioCobro, guardarInicioCobro, puedeEditar: user?.rol === 'super_admin'
  };
}
