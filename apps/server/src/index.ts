import type { Server } from 'node:http';
import { pathToFileURL } from 'node:url';

import { app } from './app.js';
import { config } from './config.js';
import { initializeDatabase, closeDatabase } from './db.js';

export { app };

async function startServer(listenPort: number = config.port) {
  await initializeDatabase();

  const server = await new Promise<Server>((resolve) => {
    const instance = app.listen(listenPort, () => resolve(instance));
  });
  const address = server.address();
  console.log(`SISREC API (${config.nodeEnv}) escuchando en el puerto ${typeof address === 'object' && address ? address.port : listenPort}`);

  const shutdown = (signal: string) => {
    console.log(`Recibida ${signal}. Cerrando servidor...`);
    server.close(async () => {
      await closeDatabase();
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  return server;
}

// Último recurso: registrar en el log en vez de morir en silencio.
process.on('unhandledRejection', (reason) => {
  console.error('Promesa rechazada sin manejar:', reason);
});

// Exportar startServer para uso externo
export { startServer };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch((error) => {
    console.error('No se pudo iniciar SISREC API:', error);
    process.exit(1);
  });
}
