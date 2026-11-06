/**
 * Configuración única del servidor: se lee y valida una sola vez al arrancar.
 * Ningún otro módulo debe leer process.env directamente.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

// El .env vive en la raíz del proyecto; se ubica respecto a este archivo (src/ o dist/),
// no respecto al directorio desde el que se lanzó node. ENV_FILE permite otra ruta.
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const envFile = process.env.ENV_FILE || resolve(projectRoot, '.env');
if (existsSync(envFile)) loadEnv({ path: envFile, quiet: true });

const env = process.env;
const nodeEnv = env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';
const errors: string[] = [];

function integer(name: string, fallback: number, min = 0): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    errors.push(`${name} debe ser un entero mayor o igual a ${min} (valor actual: "${raw}")`);
    return fallback;
  }
  return value;
}

// Un número solo se interpreta en minutos (así lo documenta el .env); "12h", "30m"… pasan tal cual a jsonwebtoken.
function jwtExpiresIn(raw: string | undefined): string {
  if (!raw) return '15m';
  return /^\d+$/.test(raw.trim()) ? `${raw.trim()}m` : raw.trim();
}

function trustProxy(raw: string | undefined): number | boolean | string {
  if (raw === undefined || raw === '') return isProduction ? 1 : false;
  if (/^\d+$/.test(raw)) return Number(raw);
  if (raw === 'true' || raw === 'false') return raw === 'true';
  return raw; // p. ej. "loopback" o una lista de IPs
}

const jwtSecret = env.JWT_SECRET || '';
if (!jwtSecret) errors.push('JWT_SECRET es obligatorio');
else if (isProduction && jwtSecret.length < 32) errors.push('JWT_SECRET debe tener al menos 32 caracteres en producción');

const databaseUrl = env.DATABASE_URL || (isProduction ? '' : 'postgresql://sisrec:sisrec_dev@127.0.0.1:5433/sisrec');
if (!databaseUrl) errors.push('DATABASE_URL es obligatorio en producción');

// FRONTEND_URL es el nombre oficial; APP_URL se acepta por compatibilidad con .env antiguos.
const frontendUrl = env.FRONTEND_URL || env.APP_URL || '';
if (isProduction && !frontendUrl) errors.push('FRONTEND_URL es obligatorio en producción (origen permitido por CORS)');

export const config = Object.freeze({
  nodeEnv,
  isProduction,
  port: integer('PORT', 3003, 1),
  databaseUrl,
  jwtSecret,
  jwtExpiresIn: jwtExpiresIn(env.JWT_EXPIRES_IN),
  // Token de renovación por dispositivo: dura una jornada de campo (12 h por defecto).
  refreshTokenTtlHours: integer('REFRESH_TOKEN_TTL_HOURS', 12, 1),
  bcryptSaltRounds: integer('BCRYPT_SALT_ROUNDS', 10, 4),
  frontendOrigins: frontendUrl.split(',').map((origin) => origin.trim().replace(/\/+$/, '')).filter(Boolean),
  trustProxy: trustProxy(env.TRUST_PROXY),
  rateLimit: Object.freeze({
    windowMs: integer('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000, 1000),
    max: integer('RATE_LIMIT_MAX_REQUESTS', 1000, 1),
    loginMax: integer('LOGIN_RATE_LIMIT_MAX', 20, 1)
  }),
  // Microservicio de analítica (FastAPI). Vacío = la API proyecta con su respaldo local (prediccion.js).
  analyticsUrl: String(env.ANALYTICS_URL || '').trim().replace(/\/+$/, ''),
  timeZone: 'America/Lima'
});

if (errors.length) {
  const message = `Configuración inválida:\n  - ${errors.join('\n  - ')}`;
  console.error(message);
  throw new Error(message);
}

export default config;
