import { useEffect, useState } from 'react';
import { useSisrec } from '../app/SisrecContext';
import { hoyEnLima } from '../services/jornadaOffline';
import { apiBase, authFetch, leerJson } from '../services/session';

// Una tarifa nueva empieza hoy por omisión: con una fecha pasada (antes venía 2026-01-01) cambiaba la deuda de
// los meses anteriores.
const nuevaTarifa = () => ({ rubro_id: '1', aplica_a: '', tipo_tarifa: 'fija', monto_fijo: '18', monto_variable: '0', unidad_medida: 'diaria', vigencia_inicio: hoyEnLima(), vigencia_fin: '' });

/** Una tarifa que ya empezó a regir no cambia lo que cobra: solo se puede cerrar (decisión del 11/11/2026). */
export const tarifaYaRige = (tarifa, hoy = hoyEnLima()) => Boolean(tarifa?.vigencia_inicio) && tarifa.vigencia_inicio <= hoy;

// Rubro vacío: la tarifa es para todos los rubros.
// "Aplica a" en un solo selector: todas las zonas (''), un tipo de vía ('via:asfaltada') o una zona ('zona:3').
const aplicaA = (item) => (item.zona_id ? `zona:${item.zona_id}` : item.tipo_via ? `via:${item.tipo_via}` : '');
function conAlcance({ aplica_a: alcance = '', ...form }) {
  const [tipo, valor] = String(alcance).split(':');
  return { ...form, zona_id: tipo === 'zona' ? Number(valor) : null, tipo_via: tipo === 'via' ? valor : null };
}

// Página Tarifas: crear y editar tarifas (el servidor rechaza la edición si otro usuario la cambió antes).
export function useTarifas() {
  const { refresh, user } = useSisrec();
  const [showForm, setShowForm] = useState(false);
  // Primer mes desde el que se suma la deuda acumulada (lo cambia solo el administrador).
  const [inicioCobro, setInicioCobro] = useState('');

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
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState(nuevaTarifa);

  // Sin vaciar el formulario, "Nueva tarifa" tras editar mostraba esa tarifa y guardaba un duplicado.
  const toggleNew = () => {
    setEditingId(null);
    setYaRige(false);
    setForm(nuevaTarifa());
    setMessage('');
    setShowForm((current) => !current);
  };

  const [yaRige, setYaRige] = useState(false);

  const edit = (item) => {
    setEditingId(item.id);
    setYaRige(tarifaYaRige(item));
    setForm({ rubro_id: item.rubro_id === null ? '' : String(item.rubro_id), aplica_a: aplicaA(item), tipo_tarifa: item.tipo_tarifa, monto_fijo: String(item.monto_fijo), monto_variable: String(item.monto_variable), unidad_medida: item.unidad_medida, vigencia_inicio: item.vigencia_inicio, vigencia_fin: item.vigencia_fin || '' });
    setShowForm(true);
  };

  const submit = async (event) => {
    event.preventDefault();
    setMessage('');
    try {
      const response = await authFetch(`${apiBase}/tarifas${editingId ? `/${editingId}` : ''}`, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(conAlcance(form))
      });
      const data = await leerJson(response);
      if (!response.ok) throw new Error(data.message || 'No se pudo guardar la tarifa');
      setMessage(data.message);
      setShowForm(false);
      setEditingId(null);
      await refresh();
    } catch (tariffError) {
      setMessage(tariffError.message);
    }
  };

  return { showForm, editingId, yaRige, message, form, setForm, toggleNew, edit, submit, inicioCobro, setInicioCobro, guardarInicioCobro, puedeEditar: user?.rol === 'super_admin' };
}
