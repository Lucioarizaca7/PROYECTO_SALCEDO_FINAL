// Inicio de sesión, renovación y sesiones por dispositivo.
import express from 'express';
import { recordAudit, getDeviceSessions, revokeDeviceSession } from '../db.js';
import { loginUser, hasRoleAccess, requireAuth, refreshAccessToken, logoutDevice, markSessionRevoked, SessionError } from '../auth.js';
import { validateLogin, handleValidationErrors } from '../validation.js';
import { loginLimiter, auditContext } from '../http/comunes.js';
import { pool as db } from '../pg.js';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from '../http/sesionCookie.js';

export const router = express.Router();

router.post('/api/v1/auth/login', loginLimiter, validateLogin, handleValidationErrors, async (req, res) => {
  let result;
  try {
    result = await loginUser(req.body, db, {
      deviceId: req.body?.device_id,
      deviceNombre: req.body?.device_nombre,
      ip: req.ip,
      userAgent: String(req.headers['user-agent'] || '')
    });
  } catch (error) {
    if (error?.code) throw error; // fallo de la base: lo atiende el manejador global (500)
    // Mensaje genérico para no revelar si el usuario existe o no
    return res.status(401).json({ message: 'Credenciales inválidas' });
  }
  // El token de renovación va solo en la cookie HttpOnly; el cuerpo lleva el token de acceso corto.
  const { refreshToken, ...body } = result;
  setRefreshCookie(res, refreshToken, result.refreshExpiresAt);
  return res.json(body);
});

// Canjea el token de renovación del dispositivo (cookie, 12 h) por un token de acceso nuevo, sin pedir la clave.
router.post('/api/v1/auth/refresh', loginLimiter, async (req, res) => {
  try {
    return res.json(await refreshAccessToken(readRefreshCookie(req), db));
  } catch (error) {
    if (error instanceof SessionError) {
      clearRefreshCookie(res);
      return res.status(401).json({ message: error.message, sessionExpired: true });
    }
    throw error;
  }
});

router.post('/api/v1/auth/logout', async (req, res) => {
  const refreshToken = readRefreshCookie(req).trim();
  if (refreshToken) await logoutDevice(refreshToken, db);
  clearRefreshCookie(res);
  return res.json({ message: 'Sesión cerrada' });
});

// Sesiones de dispositivo vigentes: el administrador ve todas; los demás, solo las suyas.
router.get('/api/v1/auth/sesiones', requireAuth, async (req, res) => {
  const isAdmin = req.user.rol === 'super_admin';
  const data = await getDeviceSessions(db, {
    usuarioId: isAdmin ? Number(req.query.usuario_id || 0) || null : req.user.id,
    soloActivas: req.query.todas !== 'true'
  });
  return res.json({ data: data.map((item) => ({ ...item, actual: Number(item.id) === Number(req.user.sid) })), total: data.length });
});

router.delete('/api/v1/auth/sesiones/:id', requireAuth, async (req, res) => {
  const isAdmin = req.user.rol === 'super_admin';
  const revoked = await revokeDeviceSession(db, {
    sessionId: Number(req.params.id),
    revocadoPor: req.user.id,
    motivo: String(req.body?.motivo || (isAdmin ? 'Revocada por el administrador' : 'Revocada por el usuario')),
    usuarioId: isAdmin ? null : req.user.id
  });
  if (!revoked) return res.status(404).json({ message: 'Sesión no encontrada o ya revocada' });
  markSessionRevoked(revoked.id);
  await recordAudit(db, {
    ...auditContext(req, 'REVOCAR_SESION_DISPOSITIVO'),
    entidad: 'sesiones_dispositivo',
    detalle: `Sesión ${revoked.id} del usuario ${revoked.usuario_id} (${revoked.device_nombre || revoked.device_id}) revocada`,
    recursoId: revoked.id,
    payloadNuevo: revoked
  });
  return res.json({ data: revoked, message: 'Sesión revocada: el dispositivo deberá ingresar de nuevo' });
});

router.get('/api/v1/auth/permissions/:role/:requiredRole', requireAuth, (req, res) => {
  const { role, requiredRole } = req.params;
  res.json({ allowed: hasRoleAccess(String(role), String(requiredRole)) });
});
