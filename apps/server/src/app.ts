import express from 'express';
import type { Request } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { config } from './config.js';
import { errorHandler } from './http/errorHandler.js';
import { router as sistemaRouter } from './routes/sistema.js';
import { router as catalogosRouter } from './routes/catalogos.js';
import { router as portalRouter } from './routes/portal.js';
import { router as cobrosRouter } from './routes/cobros.js';
import { router as comerciantesRouter } from './routes/comerciantes.js';
import { router as puestosRouter } from './routes/puestos.js';
import { router as tarifasRouter } from './routes/tarifas.js';
import { router as auditoriaRouter } from './routes/auditoria.js';
import { router as sesionesRouter } from './routes/sesiones.js';

export const app = express();

// Detrás de Caddy/Nginx, req.ip debe ser la IP real del usuario y no la del proxy;
// si no, todos comparten el mismo contador del límite de peticiones.
app.set('trust proxy', config.trustProxy);

// Cabeceras de seguridad. HSTS solo en producción (en localhost no hay HTTPS).
app.use(helmet({
  strictTransportSecurity: config.isProduction ? { maxAge: 31536000, includeSubDomains: true } : false
}));

const devOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174'
];
const allowedOrigins = new Set([...(config.isProduction ? [] : devOrigins), ...config.frontendOrigins]);

app.use(cors({
  origin: (origin, callback) => {
    const localDev = !config.isProduction && /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin || '');
    // Un origen no permitido simplemente no recibe cabeceras CORS: el navegador bloquea la respuesta.
    callback(null, !origin || allowedOrigins.has(origin) || localDev);
  },
  credentials: true
}));

const isLocalRequest = (req: Request) => /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(req.ip || '');

// Límite general alto: protege la API sin bloquear a una oficina que comparte IP.
app.use(rateLimit({
  windowMs: config.rateLimit.windowMs,
  limit: config.rateLimit.max,
  skip: (req) => !config.isProduction && isLocalRequest(req),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Demasiadas peticiones desde esta IP. Intente de nuevo en unos minutos.' }
}));

app.use(express.json({ limit: '1mb' }));

// Un router por módulo; cada uno declara sus rutas completas (/api/v1/…).
app.use(sistemaRouter);
app.use(catalogosRouter);
app.use(portalRouter);
app.use(cobrosRouter);
app.use(comerciantesRouter);
app.use(puestosRouter);
app.use(tarifasRouter);
app.use(auditoriaRouter);
app.use(sesionesRouter);

// Rutas de la API que no existen.
app.use('/api', (_req, res) => {
  res.status(404).json({ message: 'Ruta no encontrada' });
});

app.use(errorHandler);
