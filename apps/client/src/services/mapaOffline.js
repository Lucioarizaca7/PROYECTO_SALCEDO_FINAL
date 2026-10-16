import { openOfflineDatabase } from './offlineStore';
import { apiBase, authFetch } from './session';

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

export async function syncPendingMapMutations() {
  if (!navigator.onLine) return;

  const db = await openOfflineDatabase();
  const readTx = db.transaction('mapa_pendientes', 'readonly');
  const request = readTx.objectStore('mapa_pendientes').getAll();
  const pending = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });

  for (const mutation of pending) {
    const { operation, payload } = mutation;
    const endpoint = operation === 'create'
      ? `${apiBase}/puestos-mapa`
      : `${apiBase}/puestos-mapa/${payload.id}`;
    const response = await authFetch(endpoint, {
      method: operation === 'create' ? 'POST' : operation === 'update' ? 'PUT' : 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: operation === 'delete' ? undefined : JSON.stringify(payload)
    });

    if (!response.ok) break;

    const deleteTx = db.transaction('mapa_pendientes', 'readwrite');
    deleteTx.objectStore('mapa_pendientes').delete(mutation.id);
    await new Promise((resolve, reject) => {
      deleteTx.oncomplete = resolve;
      deleteTx.onerror = () => reject(deleteTx.error);
    });
  }
}
