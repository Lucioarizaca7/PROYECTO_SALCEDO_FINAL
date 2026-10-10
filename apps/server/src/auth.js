import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from 'dotenv';
import { resolve } from 'node:path';

import { recordAudit } from './db.js';

// Cargar variables de entorno desde el directorio raíz del proyecto
// Desde apps/server:
//   .. = apps
//   .. = Proyecto_Final_Salcedo_Rentas (directorio raíz)
const envPath = resolve(process.cwd(), '..', '..', '.env');
config({ path: envPath });

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  throw new Error('JWT_SECRET no está definido en las variables de entorno');
}

const users = [
  {
    id: 1,
    nombre: 'Administrador',
    email: 'admin@salcedo.gob.pe',
    aliases: ['admin@salcedo.gob.pe', 'super_admin@salcedo.gob.pe'],
    demoCredentials: [{ email: 'admin@sisrec.demo', password: 'sisrec2026' }],
    password_hash: bcrypt.hashSync('admin123', 10),
    rol: 'super_admin'
  },
  {
    id: 2,
    nombre: 'Cobrador Principal',
    email: 'cobrador@salcedo.gob.pe',
    aliases: ['cobrador@salcedo.gob.pe'],
    password_hash: bcrypt.hashSync('cobro123', 10),
    rol: 'cobrador'
  },
  {
    id: 3,
    nombre: 'Auditor Municipal',
    email: 'auditor@salcedo.gob.pe',
    aliases: ['auditor@salcedo.gob.pe'],
    password_hash: bcrypt.hashSync('audit123', 10),
    rol: 'auditor'
  },
  {
    id: 4,
    nombre: 'Comerciante Demo',
    email: 'comerciante@salcedo.gob.pe',
    aliases: ['comerciante@salcedo.gob.pe'],
    password_hash: bcrypt.hashSync('comercio123', 10),
    rol: 'comerciante'
  }
];

function buildUserResponse(user) {
  return {
    id: user.id,
    nombre: user.nombre,
    email: user.email,
    rol: user.rol
  };
}

export function loginUser({ email, password }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const user = users.find((item) => {
    const aliases = [item.email, ...(item.aliases || [])].map((value) => String(value).trim().toLowerCase());
    const demoMatch = (item.demoCredentials || []).some((credential) => (
      String(credential.email).trim().toLowerCase() === normalizedEmail
      && String(password || '') === credential.password
    ));
    return aliases.includes(normalizedEmail) || demoMatch;
  });

  const isDemoCredential = user?.demoCredentials?.some((credential) => (
    String(credential.email).trim().toLowerCase() === normalizedEmail
    && String(password || '') === credential.password
  ));

  if (!user || (!isDemoCredential && !bcrypt.compareSync(String(password || ''), user.password_hash))) {
    throw new Error('Credenciales inválidas');
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, rol: user.rol },
    jwtSecret,
    { expiresIn: '15m' }
  );

  return {
    token,
    user: buildUserResponse(user)
  };
}

export function hasRoleAccess(currentRole, requiredRole) {
  const accessMap = {
    super_admin: ['super_admin', 'cobrador', 'auditor', 'comerciante'],
    cobrador: ['cobrador', 'comerciante'],
    auditor: ['auditor'],
    comerciante: ['comerciante']
  };

  const allowedRoles = accessMap[currentRole] || [];
  return allowedRoles.includes(requiredRole);
}

export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Acceso denegado. Token no proporcionado.' });
  }

  const token = authHeader.replace('Bearer ', '').trim();

  try {
    const decoded = jwt.verify(token, jwtSecret);
    req.user = decoded;
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido o expirado.' });
  }
}

export function requireRoles(allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.rol)) {
      return res.status(403).json({ error: 'No tiene permisos para realizar esta acción.' });
    }

    return next();
  };
}

export function auditMutation({ db, accion, entidad, getPreviousState, serializeResponse = (body) => body, resourceIdResolver = (req) => req.params?.id ?? null }) {
  return async (req, res, next) => {
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
    res.json = (body) => {
      const payloadNuevo = serializeResponse(body);

      try {
        recordAudit(db, {
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
        });
      } catch (error) {
        console.error('Fallo crítico al persistir log de auditoría:', error);
      }

      return originalJson(body);
    };

    return next();
  };
}

