/**
 * Almacenamiento local del celular (IndexedDB "sisrec-offline-db").
 *
 *   padron        comerciantes de la jornada con su saldo (clave: id)
 *   cobros_cola   cola de cobros offline (clave: hashTransaccion, índice: estado)
 *   jornada       metadatos y tarifas del paquete descargado (clave: clave)
 *   mapa, mapa_pendientes   copia del mapa y cambios del mapa sin enviar
 *   cobros        cola antigua (v4); al actualizar se copian sus pendientes a cobros_cola
 */

const DB_NAME = 'sisrec-offline-db';
const DB_VERSION = 5;

let dbPromise = null;

export function openOfflineDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Este navegador no permite guardar datos sin conexión'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;

      if (!db.objectStoreNames.contains('padron')) {
        const padron = db.createObjectStore('padron', { keyPath: 'id' });
        padron.createIndex('numeroDocumento', 'numeroDocumento', { unique: false });
        padron.createIndex('codigoPuesto', 'codigoPuesto', { unique: false });
        padron.createIndex('nombresRazonSocial', 'nombresRazonSocial', { unique: false });
      }
      if (!db.objectStoreNames.contains('mapa')) db.createObjectStore('mapa', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('mapa_pendientes')) db.createObjectStore('mapa_pendientes', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('jornada')) db.createObjectStore('jornada', { keyPath: 'clave' });
      if (!db.objectStoreNames.contains('cobros_cola')) {
        const cola = db.createObjectStore('cobros_cola', { keyPath: 'hashTransaccion' });
        cola.createIndex('estado', 'estado', { unique: false });
      }

      // Migración desde la cola v4: los cobros que no se habían subido pasan a la cola nueva.
      if (event.oldVersion > 0 && event.oldVersion < 5 && db.objectStoreNames.contains('cobros')) {
        const legacy = tx.objectStore('cobros').getAll();
        legacy.onsuccess = () => {
          const cola = tx.objectStore('cobros_cola');
          for (const old of legacy.result || []) {
            if (old.sincronizado !== 0 || !old.hashTransaccion) continue;
            const fechaCobro = old.fecha_cobro || old.fechaCobro || old.createdAt || new Date().toISOString();
            cola.put({
              hashTransaccion: old.hashTransaccion,
              estado: 'pendiente',
              intentos: 0,
              ultimoError: null,
              cobradorId: Number(old.cobrador_id ?? old.cobradorId) || null,
              comercianteId: Number(old.comerciante_id ?? old.comercianteId),
              comerciante: old.search || null,
              monto: Number(old.monto),
              metodoPago: old.metodo_pago || 'efectivo',
              codigoOperacion: old.codigo_operacion || null,
              observaciones: old.observaciones || null,
              periodo: old.periodo || String(fechaCobro).slice(0, 7),
              fechaCobro,
              creadoEn: old.createdAt || fechaCobro,
              actualizadoEn: new Date().toISOString()
            });
          }
          tx.objectStore('cobros').clear();
        };
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      // Si otra pestaña abre una versión nueva, esta cierra la conexión para no bloquearla.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    request.onerror = () => { dbPromise = null; reject(request.error); };
    request.onblocked = () => console.warn('IndexedDB bloqueada por otra pestaña de SISREC abierta');
  });
  return dbPromise;
}

const promisify = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
});

/** Acceso sencillo a un almacén: getAll, get, put, delete, clear y replaceAll (borra y escribe en una transacción). */
export function storeFor(name) {
  const run = async (mode, fn) => {
    const db = await openOfflineDatabase();
    const tx = db.transaction(name, mode);
    const completion = done(tx);
    const result = fn(tx.objectStore(name));
    const value = result instanceof IDBRequest ? await promisify(result) : result;
    await completion;
    return value;
  };
  return {
    getAll: () => run('readonly', (store) => store.getAll()),
    get: (key) => run('readonly', (store) => store.get(key)),
    put: (value) => run('readwrite', (store) => store.put(value)),
    delete: (key) => run('readwrite', (store) => store.delete(key)),
    clear: () => run('readwrite', (store) => store.clear()),
    replaceAll: (values) => run('readwrite', (store) => {
      store.clear();
      for (const value of values) store.put(value);
    })
  };
}
