import { openOfflineDatabase } from './offlineStore';
import { apiBase, authFetch } from './session';
import { subirCambiosMapa } from './colaMapa';

// Copia del mapa en IndexedDB para verlo sin señal, y cola de cambios del mapa hechos sin señal.

export async function saveMapSnapshot(puestos = []) {
  if (!puestos.length || !('indexedDB' in window)) return;

  const db = await openOfflineDatabase();
  const tx = db.transaction('mapa', 'readwrite');
  const store = tx.objectStore('mapa');
  puestos.forEach((puesto) => store.put(puesto));

  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function readMapSnapshot() {
  if (!('indexedDB' in window)) return [];

  const db = await openOfflineDatabase();
  const tx = db.transaction('mapa', 'readonly');
  const request = tx.objectStore('mapa').getAll();

  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function queueMapMutation(operation, payload) {
  const db = await openOfflineDatabase();
  const tx = db.transaction('mapa_pendientes', 'readwrite');
  tx.objectStore('mapa_pendientes').add({ operation, payload, createdAt: new Date().toISOString() });

  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// fetch del mapa: si el servidor no responde, fetch lanza un TypeError ("Failed to fetch");
// se cambia por un mensaje que el cobrador entienda.
export async function mapFetch(url, options) {
  try {
    return await authFetch(url, options);
  } catch (error) {
    if (error instanceof TypeError) throw new Error('No se pudo conectar con el servidor. Revisa tu conexión o intenta más tarde.');
    throw error;
  }
}

// Pide una operación sobre "mapa_pendientes" y espera a que termine la transacción.
async function enPendientes(modo, operar) {
  const db = await openOfflineDatabase();
  const tx = db.transaction('mapa_pendientes', modo);
  const request = operar(tx.objectStore('mapa_pendientes'));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error);
  });
}

const leerPendientes = async () => (await enPendientes('readonly', (store) => store.getAll())) || [];

// El mapa y Sitios escuchan este evento para mostrar o quitar el aviso de cambios rechazados.
export const EVENTO_RECHAZOS_MAPA = 'sisrec:mapa-rechazados';
const avisarRechazos = () => window.dispatchEvent(new Event(EVENTO_RECHAZOS_MAPA));

// Devuelve cuántos cambios se enviaron: con 0 no hace falta recargar los datos.
// Un cambio rechazado queda guardado y marcado (colaMapa.js) y no detiene a los que vienen detrás.
export async function syncPendingMapMutations() {
  if (!navigator.onLine) return 0;
  const resumen = await subirCambiosMapa({
    pendientes: await leerPendientes(),
    enviar: ({ operation, payload }) => authFetch(
      operation === 'create' ? `${apiBase}/puestos-mapa` : `${apiBase}/puestos-mapa/${payload.id}`,
      {
        method: operation === 'create' ? 'POST' : operation === 'update' ? 'PUT' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: operation === 'delete' ? undefined : JSON.stringify(payload)
      }
    ),
    quitar: (cambio) => enPendientes('readwrite', (store) => store.delete(cambio.id)),
    marcarRechazado: (cambio, mensaje, status) => enPendientes('readwrite', (store) => store.put({
      ...cambio, rechazado: true, mensaje, status, rechazadoEn: new Date().toISOString()
    }))
  });
  if (resumen.rechazados) avisarRechazos();
  return resumen.enviados;
}

export async function readRejectedMapMutations() {
  if (typeof indexedDB === 'undefined') return [];
  return (await leerPendientes()).filter((cambio) => cambio.rechazado);
}

// "Reintentar": vuelve a la cola (por si ya se corrigió, p. ej. otro usuario liberó el lugar) y la sube.
export async function retryMapMutation(cambio) {
  const { rechazado: _r, mensaje: _m, status: _s, rechazadoEn: _e, ...pendiente } = cambio;
  await enPendientes('readwrite', (store) => store.put(pendiente));
  const enviados = await syncPendingMapMutations();
  avisarRechazos();
  return enviados;
}

// "Descartar": lo decide el usuario; nunca se borra solo.
export async function discardMapMutation(cambio) {
  await enPendientes('readwrite', (store) => store.delete(cambio.id));
  avisarRechazos();
}
