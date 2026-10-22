import { useCallback, useEffect, useState } from 'react';
import { useSisrec } from '../app/SisrecContext';
import { hoyEnLima } from '../services/jornadaOffline';
import { apiBase, authFetch } from '../services/session';

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
  const [cierres, setCierres] = useState([]);
  const [message, setMessage] = useState('');

  const cargar = useCallback(async () => {
    setMessage('');
    try {
      if (esCobrador) {
        const response = await authFetch(`${apiBase}/caja/resumen?fecha=${fecha}`);
        const body = await response.json();
        if (!response.ok) throw new Error(body.message || 'No se pudo cargar la caja');
        setResumen(body.data);
      }
      if (veTodos) {
        const response = await authFetch(`${apiBase}/caja/cierres?desde=${fecha.slice(0, 7)}-01&hasta=${fecha}`);
        const body = await response.json();
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
        body: JSON.stringify({ fecha, declarado: Object.fromEntries(METODOS_CAJA.map(({ key }) => [key, Number(declarado[key] || 0)])), observaciones })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'No se pudo cerrar la caja');
      setMessage(body.message);
      setDeclarado(VACIO);
      setObservaciones('');
      await cargar();
    } catch (error) {
      setMessage(error.message);
    }
  };

  return {
    hoy: hoyEnLima(), esCobrador, veTodos, fecha, setFecha, resumen, declarado, setDeclarado, observaciones, setObservaciones,
    cierres, message, cerrar, recargar: cargar, diferencia: diferenciaCaja(resumen?.esperado, declarado)
  };
}
