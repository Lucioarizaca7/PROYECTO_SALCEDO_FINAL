import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// PWA: Workbox genera el Service Worker con la lista real de archivos del build (con hash),
// así la app abre sin señal y se actualiza cuando hay versión nueva.
// Los datos de la API nunca se guardan en la caché del Service Worker: el padrón y la cola
// de cobros viven en IndexedDB y los maneja la propia app.
const pwa = VitePWA({
  registerType: 'prompt',
  injectRegister: false, // se registra en src/pwa/PwaPrompt.jsx para avisar de versiones nuevas
  includeAssets: ['favicon.ico', 'icons/apple-touch-icon-180x180.png'],
  manifest: {
    id: '/',
    name: 'SISREC Salcedo — Recaudación municipal',
    short_name: 'SISREC',
    description: 'Cobro en campo, padrón de comerciantes y recaudación de la Municipalidad de Salcedo.',
    lang: 'es-PE',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#F4F8FC',
    theme_color: '#1D4ED8',
    categories: ['government', 'finance', 'business'],
    icons: [
      { src: '/icons/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  },
  workbox: {
    // Todo el código de la app (incluido mapbox-gl) se guarda para abrir sin señal.
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
    maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
    navigateFallback: '/index.html',
    navigateFallbackDenylist: [/^\/api\//],
    cleanupOutdatedCaches: true,
    runtimeCaching: [
      {
        // Fotos del landing (1–3 MB): solo se guardan cuando se ven.
        urlPattern: ({ request }) => request.destination === 'image',
        handler: 'CacheFirst',
        options: { cacheName: 'sisrec-imagenes', expiration: { maxEntries: 60, maxAgeSeconds: 30 * 24 * 60 * 60 } }
      },
      {
        // Plano municipal (GeoJSON): se usa la copia guardada y se actualiza en segundo plano.
        urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/data/'),
        handler: 'StaleWhileRevalidate',
        options: { cacheName: 'sisrec-datos-mapa', expiration: { maxEntries: 10 } }
      },
      {
        urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com',
        handler: 'StaleWhileRevalidate',
        options: { cacheName: 'sisrec-fuentes-css' }
      },
      {
        urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com',
        handler: 'CacheFirst',
        options: {
          cacheName: 'sisrec-fuentes',
          expiration: { maxEntries: 20, maxAgeSeconds: 365 * 24 * 60 * 60 },
          cacheableResponse: { statuses: [0, 200] }
        }
      }
    ]
  }
});

export default defineConfig({
  plugins: [react(), pwa],
  server: {
    port: 5173,
    host: '0.0.0.0'
  },
  preview: {
    port: 4173,
    host: '0.0.0.0'
  }
});
