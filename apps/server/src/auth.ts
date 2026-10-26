import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { Request, Response, NextFunction } from './types';

// @ts-ignore
import { recordAudit, findUserByEmail, isPortalSessionValid } from './db.js';

// Cargar variables de entorno desde el directorio raíz del proyecto
// Desde apps/server:
//   .. = apps
//   .. = Proyecto_Final_Salcedo_Rentas (directorio raíz)
const envPath = resolve(process.cwd(), '..', '..', '.env');
config({ path: envPath });

const jwtSecret = process.env.JWT_SECRET!; // Assertion que no es null/undefined (verificado arriba)

const emailAliases: Record<string, string> = {
  'super_admin@salcedo.gob.pe': 'admin@salcedo.gob.pe'
};

export async function loginUser({ email, password }: { email: string; password: string }, db: any) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const lookupEmail = emailAliases[normalizedEmail] || normalizedEmail;
  const user = await findUserByEmail(db, lookupEmail);

  if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash)) {
    throw new Error('Credenciales inválidas');
  }

  const token = jwt.sign(
    { id: Number(user.id), email: user.email, rol: user.rol },
    jwtSecret,
    { expiresIn: '15m' }
  );

  return {
    token,
    user: { id: Number(user.id), nombre: user.nombre, email: user.email, rol: user.rol }
  };
}

// Sesión del portal del comerciante: dura 30 días en su celular y se anula al emitirle otro carnet.
const PORTAL_TOKEN_TYPE = 'portal_comerciante';

export function signPortalToken({ id, llave_version }: { id: number; llave_version: number }) {
  return jwt.sign(
    { tipo: PORTAL_TOKEN_TYPE, rol: 'comerciante', comerciante_id: Number(id), llave_version: Number(llave_version) },
    jwtSecret,
    { expiresIn: '30d' }
  );
}

function bearerToken(req: Request) {
  const authHeader = req.headers.authorization;
  return authHeader && authHeader.startsWith('Bearer ') ? authHeader.replace('Bearer ', '').trim() : '';
}

// Acepta al personal municipal (req.user) o al comerciante con su sesión del portal (req.portal);
// cada ruta comprueba luego que el comerciante solo vea lo suyo. Recibe la base o una función que
// la entrega, porque en index.ts la conexión se abre después de declarar las rutas.
export function requirePortalOrStaff(dbOrGetter: any) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = bearerToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Acceso denegado. Token no proporcionado.', message: 'Acceso denegado. Token no proporcionado.' });
    }
    let decoded: any;
    try {
      decoded = jwt.verify(token, jwtSecret);
    } catch (error) {
      return res.status(401).json({ error: 'Token inválido o expirado.', message: 'Token inválido o expirado.' });
    }
    if (decoded?.tipo !== PORTAL_TOKEN_TYPE) {
      req.user = decoded as { id: number; email: string; rol: string };
      return next();
    }
    const db = typeof dbOrGetter === 'function' ? dbOrGetter() : dbOrGetter;
    if (!(await isPortalSessionValid(db, decoded.comerciante_id, decoded.llave_version))) {
      return res.status(401).json({ error: 'Sesión del portal vencida.', message: 'Su sesión ya no es válida: ingrese con la llave de su carnet vigente.' });
    }
    req.portal = { comercianteId: Number(decoded.comerciante_id) };
    return next();
  };
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
    // La sesión del portal del comerciante no abre las rutas del personal.
    if (typeof decoded === 'object' && decoded !== null && (decoded as any).tipo === PORTAL_TOKEN_TYPE) {
      return res.status(403).json({ error: 'No tiene permisos para realizar esta acción.', message: 'No tiene permisos para realizar esta acción.' });
    }
    // jwt.verify puede devolver un string o un objeto según el token
    if (typeof decoded === 'object' && decoded !== null) {
      req.user = decoded as { id: number; email: string; rol: string };
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