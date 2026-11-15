// Web para probar SISREC en el celular con un túnel de Cloudflare (docs/manual-web-tunel.md).
// El teléfono entra por https://<algo>.trycloudflare.com -> cloudflared -> http://127.0.0.1:5176 (esta web).
// Cloudflare pone el HTTPS con certificado válido: la cámara, la ubicación y la instalación como app funcionan.
//
// - La API va por el mismo origen (/api -> http://localhost:3003). Así la dirección del túnel puede cambiar
//   sin recompilar y la cookie de sesión no cruza dominios.
// - Solo escucha en 127.0.0.1: nadie de la red local entra directo, solo el túnel.
// - Sirve igual para `vite` (desarrollo, se actualiza solo) y para `vite build` + `vite preview`
//   (versión instalable, con manifiesto y Service Worker).
import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config.js';

// La variable que ya existe en el entorno manda sobre los .env, así no se toca el .env de desarrollo.
process.env.VITE_API_URL = '/';

const PUERTO_TUNEL = 5176;
const API_LOCAL = 'http://localhost:3003';
const comun = {
  port: PUERTO_TUNEL,
  strictPort: true,
  host: '127.0.0.1',
  allowedHosts: ['.trycloudflare.com'],
  proxy: { '/api': { target: API_LOCAL, changeOrigin: true } }
};

export default mergeConfig(base, defineConfig({
  server: {
    ...comun,
    hmr: { clientPort: 443 } // el teléfono habla con Cloudflare por 443, no con 5176
  },
  preview: comun,
  // Carpeta propia para no pisar el build normal (apps/*/dist ya está en .gitignore).
  build: { outDir: 'dist/tunel', emptyOutDir: true }
}));
