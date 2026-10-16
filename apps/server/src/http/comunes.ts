// Piezas compartidas por los routers: roles del personal, límite de accesos, subida del padrón,
// contexto de auditoría y búsquedas por id.
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import type { Request } from 'express';
import { buscarComerciantePorCodigo } from '../db.js';
import { requireAuth, requireRoles } from '../auth.js';
import { config } from '../config.js';
import { pool as db } from '../pg.js';

// Límite estricto solo para los accesos: frena la adivinación de claves y de DNI.
export const loginLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  limit: config.rateLimit.loginMax,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Demasiados intentos de acceso. Espere 15 minutos e intente de nuevo.' }
});

// Roles internos que pueden ver datos personales del padrón y de los cobros (Ley 29733).
export const STAFF = ['super_admin', 'cobrador', 'auditor'];
export const staffOnly = [requireAuth, requireRoles(STAFF)];

// Contexto de auditoría tomado del token, nunca del cuerpo de la petición.
export function auditContext(req: Request, accion: string) {
  return {
    usuarioId: Number(req.user?.id),
    usuarioRol: req.user?.rol,
    rolUsuario: req.user?.rol,
    accion,
    metodoHttp: req.method,
    ipOrigen: req.ip || 'unknown',
    rutaEndpoint: req.originalUrl
  };
}

const padronUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const allowed = /\.xlsx$/i.test(file.originalname) || file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (allowed) callback(null, true);
    else callback(new Error('Solo se aceptan libros Excel .xlsx'));
  }
});

export function receivePadronWorkbook(req, res, next) {
  padronUpload.single('file')(req, res, (error) => {
    if (error) return res.status(400).json({ message: error.message || 'No se pudo recibir el archivo' });
    return next();
  });
}

export const roles = ['super_admin', 'cobrador', 'auditor', 'comerciante'];


export async function rowById(table: string, id: number) {
  const result = await db.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

// Un número es el id interno (lo que manda la app); cualquier otra cosa es el código de negocio (COM-0004-…, CM-004).
export async function resolveComercianteParam(value: string) {
  return /^\d+$/.test(value) ? Number(value) : await buscarComerciantePorCodigo(db, value);
}
