const CACHE_NAME = 'sisrec-salcedo-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/favicon.ico',
  '/manifest.json',
  '/src/main.jsx',
  '/styles.css',
  // Agrega aquí otros assets críticos según tu estructura
];

// Al instalar, cacheamos los assets esenciales
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

// Al activar, limpiamos caches antiguos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
    .then(() => self.clients.claim())
  );
});

// Estrategia de caching inteligente para diferentes tipos de requests
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // No manejar peticiones no GET
  if (request.method !== 'GET') {
    return;
  }

  // No cachear peticiones a la API (las manejamos con React Query y estado de servidor)
  if (request.url.includes('/api/')) {
    // Para API, intentamos red de primera, luego cache si falla
    event.respondWith(
      fetch(request)
        .catch(() => caches.match(request))
        .then((response) => response || new Response(JSON.stringify({ error: 'Sin conexión' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        }))
    );
    return;
  }

  // Para assets estáticos, usamos cache primero, luego red
  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        // Si está en cache, lo servimos inmediatamente
        if (cachedResponse) {
          return cachedResponse;
        }

        // Si no está en cache, vamos a la red y cacheamos el resultado
        return fetch(request)
          .then((networkResponse) => {
            // No cacheamos respuestas de error
            if (!networkResponse || networkResponse.status !== 200) {
              return networkResponse;
            }

            // Clonamos la respuesta para poder usarla dos veces
            const responseToCache = networkResponse.clone();

            caches.open(CACHE_NAME)
              .then((cache) => cache.put(request, responseToCache));

            return networkResponse;
          })
          .catch(() => {
            // Si falla la red y no hay cached response, devolvemos error
            return caches.match(request);
          })
          .then((response) => response || Response.error());
      })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  // Mensaje para forzar una actualización de cache
  if (event.data && event.data.type === 'UPDATE_CACHE') {
    event.waitUntil(
      caches.open(CACHE_NAME)
        .then((cache) => cache.keys())
        .then((keys) => Promise.all(
          keys.map(key => cache.delete(key))
        ))
        .then(() => self.clients.matchAll({ includeUncontrolled: true }))
        .then((clients) => {
          clients.forEach(client => client.postMessage({ type: 'CACHE_UPDATED' }));
        })
    );
  }
});
