// Cargar variables de entorno desde el directorio raíz del proyecto
import { config } from 'dotenv';
import { resolve } from 'node:path';

console.log('process.cwd():', process.cwd());

// Resolver la ruta al archivo .env en el directorio raíz del proyecto
// Desde apps/server:
//   .. = apps
//   .. = Proyecto_Final_Salcedo_Rentas (directorio raíz)
const envPath = resolve(process.cwd(), '..', '..', '.env');
console.log('Intentando cargar .env desde:', envPath);
const result = config({ path: envPath });
console.log('Resultado de dotenv config:', result);

import { app } from './index.js';
import { initializeDatabase, persistDatabase } from './db.js';

const PORT = process.env.PORT || 3000;
console.log('PORT desde process.env:', process.env.PORT);
console.log('PORT final:', PORT);

// Rutas de prueba
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Inicializar la base de datos
initializeDatabase();

// Iniciar el servidor
const server = app.listen(PORT, () => {
  console.log(`Servidor ejecutándose en http://localhost:${PORT}`);
});

// Para permitir un cierre graceful
process.on('SIGTERM', () => {
  console.log('Recibida señal SIGTERM. Cerrando servidor...');
  persistDatabase();
  server.close(() => {
    console.log('Servidor cerrado.');
    process.exit(0);
  });
});

export { app as default };