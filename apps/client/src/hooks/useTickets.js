import { useCallback, useEffect, useState } from 'react';
import { useSisrec } from '../app/SisrecContext';
import { apiBase, authFetch } from '../services/session';

const LOTE_VACIO = { serie: 'S3', numero_desde: '', numero_hasta: '', cobrador_id: '', observacion: '' };

async function pedir(url, options) {
  const response = await authFetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `No se pudo completar la operación (${response.status})`);
  return body;
}

const enviar = (url, payload) => pedir(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });

// Página Tickets: el administrador entrega rangos de tickets preimpresos (lotes) a los cobradores, los
// reasigna o los recibe de vuelta; el auditor solo consulta.
export function useTickets() {
  const { user } = useSisrec();
  const puedeEditar = user?.rol === 'super_admin';
  const [lotes, setLotes] = useState([]);
  const [cobradores, setCobradores] = useState([]);
  const [series, setSeries] = useState([]);
  const [nuevo, setNuevo] = useState(LOTE_VACIO);
  const [message, setMessage] = useState('');

  const cargar = useCallback(async () => {
    try {
      const [lotesBody, cobradoresBody, seriesBody] = await Promise.all([
        pedir(`${apiBase}/tickets/lotes`), pedir(`${apiBase}/tickets/cobradores`), pedir(`${apiBase}/tickets/series`)
      ]);
      setLotes(lotesBody.data || []);
      setCobradores(cobradoresBody.data || []);
      setSeries(seriesBody.data || []);
    } catch (error) {
      setMessage(error instanceof TypeError ? 'Sin conexión: los lotes de tickets necesitan señal.' : error.message);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const ejecutar = async (accion) => {
    setMessage('');
    try {
      const body = await accion();
      setMessage(body.message);
      await cargar();
      return true;
    } catch (error) {
      setMessage(error.message);
      return false;
    }
  };

  const asignar = async (event) => {
    event.preventDefault();
    if (await ejecutar(() => enviar(`${apiBase}/tickets/lotes`, {
      ...nuevo, numero_desde: Number(nuevo.numero_desde), numero_hasta: Number(nuevo.numero_hasta), cobrador_id: Number(nuevo.cobrador_id)
    }))) setNuevo({ ...LOTE_VACIO, serie: nuevo.serie });
  };

  // Tramo vacío = todos los disponibles del lote.
  const tramo = (lote) => {
    const texto = window.prompt(`Tramo del lote ${lote.id} (${lote.numero_desde}–${lote.numero_hasta}). Escriba "desde-hasta" o deje vacío para todo el lote:`, '');
    if (texto === null) return null;
    const [desde, hasta] = texto.split('-').map((valor) => valor.trim());
    return texto.trim() ? { numero_desde: Number(desde), numero_hasta: Number(hasta || desde) } : {};
  };

  const reasignar = async (lote, cobradorId) => {
    if (!cobradorId) return;
    const rango = tramo(lote);
    if (rango) await ejecutar(() => enviar(`${apiBase}/tickets/lotes/${lote.id}/reasignar`, { ...rango, cobrador_id: Number(cobradorId) }));
  };

  const devolver = async (lote) => {
    const rango = tramo(lote);
    if (!rango) return;
    const motivo = window.prompt('Motivo de la devolución (por ejemplo: fin de la feria, cobrador de baja):');
    if (motivo !== null) await ejecutar(() => enviar(`${apiBase}/tickets/lotes/${lote.id}/devolver`, { ...rango, motivo }));
  };

  return { puedeEditar, lotes, cobradores, series, nuevo, setNuevo, message, asignar, reasignar, devolver };
}
