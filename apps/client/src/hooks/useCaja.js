import { useCallback, useEffect, useState } from 'react';
import { useSisrec } from '../app/SisrecContext';
import { pideJustificacion } from '../lib/caja';
import { puestosSinMarcar } from '../services/asistenciaOffline';
import { hoyEnLima } from '../services/jornadaOffline';
import { apiBase, authFetch, leerJson } from '../services/session';

export const METODOS_CAJA = [
  { key: 'efectivo', label: 'Efectivo' },
  { key: 'yape', label: 'Yape' },
  { key: 'plin', label: 'Plin' },
  { key: 'pos', label: 'POS' }
];

const VACIO = { efectivo: '', yape: '', plin: '', pos: '' };

/** declarado − esperado; positivo = sobra, negativo = falta. */
export function diferenciaCaja(esperado = {}, declarado = {}) {
  const total = (montos) => METODOS_CAJA.reduce((suma, { key }) => suma + Number(montos[key] || 0), 0);
  return Number((total(declarado) - total(esperado)).toFixed(2));
}

// Página Caja: el cobrador declara lo que tiene por método y cierra su día; el administrador y el
// auditor ven los cierres de todos. Lo esperado siempre viene del servidor.
export function useCaja() {
  const { user } = useSisrec();
  const esCobrador = ['cobrador', 'super_admin'].includes(user?.rol);
  const veTodos = ['super_admin', 'auditor'].includes(user?.rol);
  const [fecha, setFecha] = useState(hoyEnLima());
  const [resumen, setResumen] = useState(null);
  const [declarado, setDeclarado] = useState(VACIO);
  const [observaciones, setObservaciones] = useState('');
  const [justificacion, setJustificacion] = useState('');
  const [cierres, setCierres] = useState([]);
  // Puestos sin marcar del día, por zona (RN-26): un aviso antes de cerrar; no bloquea el cierre.
  const [sinMarcar, setSinMarcar] = useState([]);
  const [message, setMessage] = useState('');

  const cargar = useCallback(async () => {
    setMessage('');
    try {
      if (esCobrador) {
        const response = await authFetch(`${apiBase}/caja/resumen?fecha=${fecha}`);
        const body = await leerJson(response);
        if (!response.ok) throw new Error(body.message || 'No se pudo cargar la caja');
        setResumen(body.data);
        // Si falla, la caja se cierra igual: es solo un aviso.
        const asistencia = await authFetch(`${apiBase}/asistencias?fecha=${fecha}`);
        const marcas = await leerJson(asistencia);
        setSinMarcar(asistencia.ok ? puestosSinMarcar(marcas.data?.puestos) : []);
      }
      if (veTodos) {
        const response = await authFetch(`${apiBase}/caja/cierres?desde=${fecha.slice(0, 7)}-01&hasta=${fecha}`);
        const body = await leerJson(response);
        if (response.ok) setCierres(body.data || []);
      }
    } catch (error) {
      setMessage(error instanceof TypeError ? 'Sin conexión: el cierre de caja necesita señal.' : error.message);
    }
  }, [fecha, esCobrador, veTodos]);

  useEffect(() => { cargar(); }, [cargar]);

  const cerrar = async (event) => {
    event.preventDefault();
    setMessage('');
    try {
      const response = await authFetch(`${apiBase}/caja/cierre`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fecha, declarado: Object.fromEntries(METODOS_CAJA.map(({ key }) => [key, Number(declarado[key] || 0)])), observaciones, justificacion })
      });
      const body = await leerJson(response);
      if (!response.ok) throw new Error(body.message || 'No se pudo cerrar la caja');
      setMessage(body.message);
      setDeclarado(VACIO);
      setObservaciones('');
      setJustificacion('');
      await cargar();
    } catch (error) {
      setMessage(error.message);
    }
  };

  // Entrega y rectificación de un cierre: solo el super_admin (el servidor lo vuelve a comprobar).
  const gestionar = async (ruta, body, porDefecto) => {
    setMessage('');
    try {
      const response = await authFetch(`${apiBase}/caja/cierres/${ruta}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const respuesta = await leerJson(response);
      if (!response.ok) throw new Error(respuesta.message || porDefecto);
      setMessage(respuesta.message);
      await cargar();
      return true;
    } catch (error) {
      setMessage(error instanceof TypeError ? 'Sin conexión: esta operación necesita señal.' : error.message);
      return false;
    }
  };
  const entregar = (cierreId, body) => gestionar(`${cierreId}/entrega`, body, 'No se pudo registrar la entrega');
  const rectificar = (cierreId, body) => gestionar(`${cierreId}/rectificacion`, body, 'No se pudo rectificar el cierre');
  const diferencia = diferenciaCaja(resumen?.esperado, declarado);

  return {
    hoy: hoyEnLima(), esCobrador, veTodos, fecha, setFecha, resumen, declarado, setDeclarado, observaciones, setObservaciones,
    cierres, sinMarcar, message, cerrar, recargar: cargar, diferencia, justificacion, setJustificacion,
    necesitaJustificacion: pideJustificacion(diferencia), puedeGestionar: user?.rol === 'super_admin', usuarioId: Number(user?.id),
    entregar, rectificar
  };
}
