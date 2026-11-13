import { useEffect, useState } from 'react';
import { useSisrec } from '../app/SisrecContext';
import { periodoEnLima } from '../services/jornadaOffline';
import { apiBase, authFetch } from '../services/session';

// Página Reportes: cobros filtrados por periodo, zona y rubro (los filtros que acepta GET /reportes).
export function useReportes() {
  const [filtro, setFiltro] = useState({ periodo: periodoEnLima(), zona_id: '', rubro_id: '' });
  const [filas, setFilas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [mensaje, setMensaje] = useState('');
  const [recarga, setRecarga] = useState(0);
  const { user, refresh } = useSisrec();

  const parametros = (extra = {}) => {
    const params = new URLSearchParams(extra);
    for (const [clave, valor] of Object.entries(filtro)) if (valor) params.set(clave, valor);
    return params;
  };

  useEffect(() => {
    const controller = new AbortController();
    setCargando(true);
    authFetch(`${apiBase}/reportes?${parametros()}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.message || 'No se pudo cargar el reporte');
        setMensaje('');
        setFilas(body.data || []);
      })
      .catch((error) => { if (!controller.signal.aborted) setMensaje(error.message); })
      .finally(() => { if (!controller.signal.aborted) setCargando(false); });
    return () => controller.abort();
  }, [filtro.periodo, filtro.zona_id, filtro.rubro_id, recarga]);

  // El token de acceso vive en memoria: un <a href> a la API llegaba sin él (401). Se descarga con
  // authFetch y los mismos filtros de la pantalla.
  const exportarCsv = async () => {
    try {
      const response = await authFetch(`${apiBase}/reportes?${parametros({ formato: 'csv' })}`);
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || 'No se pudo exportar el reporte');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `reporte-cobros-${filtro.periodo || 'todo'}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setMensaje(error.message || 'No se pudo exportar el reporte');
    }
  };

  // Anular desde el reporte: antes solo se podía desde "Cobros recientes", que muestra los 6 últimos del sistema.
  const anular = async (cobro) => {
    const motivo = window.prompt(`Motivo para anular ${cobro.comprobante || `el cobro #${cobro.id}`} (S/ ${Number(cobro.monto || 0).toFixed(2)}):`);
    if (motivo === null) return;
    try {
      const response = await authFetch(`${apiBase}/cobros/${cobro.id}/anular`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ motivo })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || 'No se pudo anular el cobro');
      setMensaje(body.message || 'Cobro anulado');
      setRecarga((valor) => valor + 1);
      await refresh?.();
    } catch (error) {
      setMensaje(error.message);
    }
  };

  // El total y las operaciones cuentan solo lo cobrado de verdad: un anulado no es recaudación.
  const confirmadas = filas.filter((item) => item.estado === 'confirmado');
  const total = confirmadas.reduce((suma, item) => suma + Number(item.monto || 0), 0);

  return { filtro, setFiltro, filas, cargando, mensaje, exportarCsv, anular, puedeAnular: user?.rol === 'super_admin', total, confirmadas };
}
