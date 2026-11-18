import { useEffect, useState } from 'react';
import { useSisrec } from '../app/SisrecContext';
import { apiBase, authFetch, leerJson } from '../services/session';

// Página Deuda y reclamos (super_admin escribe; el auditor solo consulta): anulaciones por aprobar (RN-38),
// avisos de deuda (RN-53), baja de deuda con resolución (RN-54) y reclamos de un día marcado (RN-27).
// El servidor vuelve a comprobar el rol y cada regla.
export function useDeuda() {
  const { user, refresh } = useSisrec();
  const [anulaciones, setAnulaciones] = useState([]);
  // Anuladas por un único super_admin activo, para la revisión mensual (migración 0038).
  const [sinSegunda, setSinSegunda] = useState([]);
  const [avisos, setAvisos] = useState({ por_emitir: [], emitidos: [], dias_para_aviso: 30 });
  const [bajas, setBajas] = useState([]);
  const [reclamos, setReclamos] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [cargando, setCargando] = useState(true);

  const leer = async (ruta) => {
    const response = await authFetch(`${apiBase}${ruta}`);
    const body = await leerJson(response);
    if (!response.ok) throw new Error(body.message || 'No se pudo cargar la información');
    return body.data;
  };

  const cargar = async () => {
    try {
      const [listaAnulaciones, listaSinSegunda, listaAvisos, listaBajas, listaReclamos] = await Promise.all([
        leer('/cobros/anulaciones'), leer('/cobros/anulaciones?estado=sin_segunda_aprobacion'), leer('/deuda/avisos'), leer('/deuda/bajas'), leer('/reclamos')
      ]);
      setAnulaciones(listaAnulaciones);
      setSinSegunda(listaSinSegunda);
      setAvisos(listaAvisos);
      setBajas(listaBajas);
      setReclamos(listaReclamos);
    } catch (err) {
      setError(err instanceof TypeError ? 'Sin conexión: esta página necesita señal.' : err.message);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargar();
  }, []);

  // Llama al servidor y recarga las listas. Devuelve lo que respondió (data) o null si falló.
  const enviar = async (ruta, cuerpo, mensajeError) => {
    setMessage('');
    setError('');
    setOcupado(true);
    try {
      const response = await authFetch(`${apiBase}${ruta}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
      const body = await leerJson(response);
      if (!response.ok) throw new Error(body.message || mensajeError);
      setMessage(body.message);
      await cargar();
      return body.data;
    } catch (err) {
      setError(err instanceof TypeError ? 'Sin conexión: esta operación necesita señal.' : err.message);
      return null;
    } finally {
      setOcupado(false);
    }
  };

  // Busca al comerciante por código, correlativo o DNI y trae su deuda por mes (la misma liquidación de Pagos).
  const buscarComerciante = async (texto) => {
    setError('');
    const valor = String(texto || '').trim();
    if (!valor) return null;
    try {
      const data = await leer(`/liquidaciones/${encodeURIComponent(valor)}`);
      return { id: Number(data.comerciante.id), nombre: data.comerciante.nombre, codigo: data.comerciante.codigo, deuda: data.deuda_acumulada };
    } catch (err) {
      setError(err.message);
      return null;
    }
  };

  const resolverAnulacion = async (solicitud, decision, resolucion) => {
    const data = await enviar(`/cobros/anulaciones/${solicitud.id}/resolver`, { decision, resolucion }, 'No se pudo resolver la anulación');
    if (data) await refresh?.();
    return data;
  };
  const revisarAnulacion = (solicitud, revision) => enviar(`/cobros/anulaciones/${solicitud.id}/revisar`, { revision }, 'No se pudo marcar la revisión');
  const emitirAviso = (comercianteId, observaciones) => enviar('/deuda/avisos', { comerciante_id: comercianteId, observaciones }, 'No se pudo registrar el aviso');
  const darDeBaja = async (cuerpo) => {
    const data = await enviar('/deuda/bajas', cuerpo, 'No se pudo dar de baja la deuda');
    if (data) await refresh?.();
    return data;
  };
  const registrarReclamo = (cuerpo) => enviar('/reclamos', cuerpo, 'No se pudo registrar el reclamo');
  const resolverReclamo = (reclamo, decision, resolucion) => enviar(`/reclamos/${reclamo.id}/resolver`, { decision, resolucion }, 'No se pudo resolver el reclamo');

  return {
    anulaciones, sinSegunda, avisos, bajas, reclamos, message, error, ocupado, cargando,
    puedeEscribir: user?.rol === 'super_admin', usuarioId: Number(user?.id),
    buscarComerciante, resolverAnulacion, revisarAnulacion, emitirAviso, darDeBaja, registrarReclamo, resolverReclamo
  };
}
