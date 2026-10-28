// Token de renovación del dispositivo en una cookie HttpOnly: el JavaScript de la página no puede
// leerla, así que un XSS no se lleva la sesión de 12 h. SameSite=Strict evita que otro sitio la use
// (CSRF) y Path la limita a /api/v1/auth: no viaja en el resto de las peticiones.
import type { Request, Response } from 'express';
import { config } from '../config.js';

export const REFRESH_COOKIE = 'sisrec_refresh';
const COOKIE_PATH = '/api/v1/auth';

const baseOptions = () => ({
  httpOnly: true,
  secure: config.isProduction, // en desarrollo la API va por http://localhost
  sameSite: 'strict' as const,
  path: COOKIE_PATH
});

export function setRefreshCookie(res: Response, refreshToken: string, expiresAt: string | Date) {
  res.cookie(REFRESH_COOKIE, refreshToken, { ...baseOptions(), expires: new Date(expiresAt) });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, baseOptions());
}

// Sin cookie-parser: solo hace falta esta cookie.
export function readRefreshCookie(req: Request): string {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === REFRESH_COOKIE) return decodeURIComponent(value.join('='));
  }
  return '';
}
