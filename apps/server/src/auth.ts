import bcrypt from 'bcryptjs';
import { AppError } from './errors.js';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from './types.js';
import { config } from './config.js';

// @ts-ignore
import { recordAudit, findUserByEmail, createDeviceSession, findActiveSessionByToken, revokeDeviceSession } from './db.js';

// config.ts valida al arrancar que JWT_SECRET exista (y su longitud en producción).
const jwtSecret = config.jwtSecret;

const emailAliases: Record<string, string> = {
  'super_admin@salcedo.gob.pe': 'admin@salcedo.gob.pe'
};

export interface DeviceInfo {
  deviceId?: string;
  deviceNombre?: string;
  ip?: string;
  userAgent?: string;
}

type SessionUser = { id: number; email: string; rol: string };

// Token de acceso corto (JWT_EXPIRES_IN); sid enlaza el token con la sesión del dispositivo.
function signAccessToken(user: SessionUser, sessionId?: number) {
  return jwt.sign(
    { id: Number(user.id), email: user.email, rol: user.rol, ...(sessionId ? { sid: Number(sessionId) } : {}) },
    jwtSecret,
    { expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'] }
  );
}

export async function loginUser({ email, password }: { email: string; password: string }, db: any, device: DeviceInfo = {}) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const lookupEmail = emailAliases[normalizedEmail] || normalizedEmail;
  const user = await findUserByEmail(db, lookupEmail);

  if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash)) {
    throw new Error('Credenciales inválidas');
  }

  // Cada inicio de sesión abre una sesión de dispositivo con su token de renovación (12 h, revocable).
  const session = await createDeviceSession(db, { usuarioId: Number(user.id), ...device });

  return {
    token: signAccessToken(user, session.id),
    refreshToken: session.refreshToken,
    refreshExpiresAt: session.expiraEn,
    deviceId: session.deviceId,
    user: { id: Number(user.id), nombre: user.nombre, email: user.email, rol: user.rol }
  };
}

export class SessionError extends AppError {
  constructor(message: string) { super(message, 401); }
}

// Canjea un token de renovación vigente por un token de acceso nuevo. El de renovación no cambia:
// así dos peticiones simultáneas del mismo celular no se invalidan entre sí.
export async function refreshAccessToken(refreshToken: string, db: any) {
  const session = await findActiveSessionByToken(db, String(refreshToken || '').trim());
  if (!session) throw new SessionError('La sesión del dispositivo venció o fue revocada. Ingrese de nuevo.');
  const user = { id: Number(session.usuario_id), email: session.email, rol: session.rol };
  return {
    token: signAccessToken(user, session.id),
    refreshExpiresAt: session.expira_en,
    user: { ...user, nombre: session.nombre }
  };
}

// Sesiones revocadas en este proceso: sus tokens de acceso dejan de valer al instante,
// sin consultar la base en cada petición. Tras un reinicio el token corto vence solo (≤ JWT_EXPIRES_IN).
const revokedSessions = new Map<number, number>();
const accessTokenMaxMs = 24 * 60 * 60 * 1000;

export function markSessionRevoked(sessionId: number) {
  const now = Date.now();
  for (const [id, until] of revokedSessions) if (until < now) revokedSessions.delete(id);
  revokedSessions.set(Number(sessionId), now + accessTokenMaxMs);
}

export async function logoutDevice(refreshToken: string, db: any) {
  const revoked = await revokeDeviceSession(db, { refreshToken, motivo: 'Cierre de sesión' });
  if (revoked) markSessionRevoked(revoked.id);
  return revoked;
}

export function hasRoleAccess(currentRole: string, requiredRole: string): boolean {
  const accessMap: Record<string, string[]> = {
    super_admin: ['super_admin', 'cobrador', 'auditor', 'comerciante'],
    cobrador: ['cobrador', 'comerciante'],
    auditor: ['auditor'],
    comerciante: ['comerciante']
  };

  const allowedRoles = accessMap[currentRole] || [];
  return allowedRoles.includes(requiredRole);
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Acceso denegado. Token no proporcionado.', message: 'Acceso denegado. Token no proporcionado.' });
  }

  const token = authHeader.replace('Bearer ', '').trim();

  try {
    const decoded = jwt.verify(token, jwtSecret);
    // jwt.verify puede devolver un string o un objeto según el token
    if (typeof decoded === 'object' && decoded !== null) {
      if (decoded.sid && revokedSessions.has(Number(decoded.sid))) {
        return res.status(401).json({ error: 'La sesión fue revocada.', message: 'La sesión fue revocada.' });
      }
      req.user = decoded as { id: number; email: string; rol: string; sid?: number };
    }
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido o expirado.', message: 'Token inválido o expirado.' });
  }
}

export function requireRoles(allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !allowedRoles.includes(req.user.rol)) {
      return res.status(403).json({ error: 'No tiene permisos para realizar esta acción.', message: 'No tiene permisos para realizar esta acción.' });
    }

    return next();
  };
}

export function auditMutation({
  db,
  accion,
  entidad,
  getPreviousState,
  serializeResponse = (body: any) => body,
  resourceIdResolver = (req: Request): string | number | null => {
    const id = req.params?.id;
    // Manejar el caso donde id es un array (múltiples valores para el mismo parámetro)
    if (Array.isArray(id)) {
      return id.length > 0 ? id[0] : null;
    }
    return id === null || id === undefined ? null : id;
  }
}: {
  db: any;
  accion: string;
  entidad: string;
  getPreviousState?: (req: Request, db: any) => Promise<any> | any;
  serializeResponse?: (body: any) => any;
  resourceIdResolver?: (req: Request) => string | number | null;
}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const method = String(req.method || 'POST').toUpperCase();
    if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      return next();
    }

    const usuarioId = Number(req.user?.id ?? 1);
    const usuarioRol = req.user?.rol ?? 'anonimo';
    const ipOrigen = req.ip || req.headers['x-forwarded-for']?.toString()?.split(',')[0]?.trim() || 'unknown';

    let payloadPrevio = null;
    if (typeof getPreviousState === 'function' && ['PUT', 'DELETE', 'PATCH'].includes(method)) {
      try {
        payloadPrevio = await getPreviousState(req, db);
      } catch (error) {
        payloadPrevio = null;
      }
    }

    const originalJson = res.json.bind(res);
    res.json = (body: any) => {
      // Solo se audita lo que realmente se ejecutó: las respuestas de error no son un cambio.
      if (res.statusCode < 400) {
        const payloadNuevo = serializeResponse(body);
        Promise.resolve(recordAudit(db, {
          usuarioId,
          usuarioRol,
          rolUsuario: req.user?.rol || usuarioRol,
          entidad,
          accion,
          detalle: `Operación ${accion} ejecutada sobre ${entidad}`,
          metodoHttp: method,
          ipOrigen,
          rutaEndpoint: req.originalUrl || req.url || req.path || 'unknown',
          recursoId: resourceIdResolver(req),
          payloadPrevio,
          payloadNuevo
        })).catch((error: unknown) => {
          console.error('Fallo crítico al persistir log de auditoría:', error);
        });
      }

      return originalJson(body);
    };

    return next();
  };
}