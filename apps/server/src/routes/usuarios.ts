// Usuarios del personal (pantalla Usuarios): solo el super_admin los ve, crea, desactiva o les pone clave nueva.
// La clave nunca vuelve en la respuesta, así que tampoco llega a la auditoría (que guarda la respuesta).
import express from 'express';
import { getUsuarios, getUsuario, createUser, cambiarEstadoUsuario, cambiarClaveUsuario, cambiarMiClave, asignarZonasCobrador } from '../db.js';
import { requireAuth, requireRoles, auditMutation, markSessionRevoked } from '../auth.js';
import { loginLimiter, auditContext } from '../http/comunes.js';
import { pool as db } from '../pg.js';

export const router = express.Router();

const soloSuperAdmin = [requireAuth, requireRoles(['super_admin'])];
const estadoPrevio = async (req: express.Request) => getUsuario(db, Number(req.params.id));

router.get('/api/v1/usuarios', ...soloSuperAdmin, async (_req, res) => {
  const data = await getUsuarios(db);
  res.json({ data, total: data.length });
});

router.post('/api/v1/usuarios',
  ...soloSuperAdmin,
  auditMutation({ db, accion: 'CREAR_USUARIO', entidad: 'usuarios', serializeResponse: (body) => body?.data ?? body }),
  async (req, res) => {
    const { nombre, email, password, rol } = req.body || {};
    const creado = await createUser({ nombre, email, password, rol }, db);
    res.status(201).json({ data: await getUsuario(db, creado.id), message: `Usuario ${creado.email} creado` });
  }
);

// Zonas asignadas a un cobrador (RN-64). Sin zonas cobra en todas; fuera de las suyas, la marca queda señalada.
router.put('/api/v1/usuarios/:id/zonas', ...soloSuperAdmin, async (req, res) => {
  const data = await asignarZonasCobrador(db, Number(req.params.id), req.body?.zonas, { asignadoPor: req.user.id, audit: auditContext(req, 'ASIGNAR_ZONAS_COBRADOR') });
  res.json({ data, message: data.zonas_asignadas.length ? `Zonas de ${data.nombre} actualizadas` : `${data.nombre} queda sin zonas asignadas: cobra en todas` });
});

router.patch('/api/v1/usuarios/:id/estado',
  ...soloSuperAdmin,
  auditMutation({ db, accion: 'CAMBIAR_ESTADO_USUARIO', entidad: 'usuarios', getPreviousState: estadoPrevio, serializeResponse: (body) => body?.data ?? body }),
  async (req, res) => {
    const { usuario, sesionesCerradas, sinCambio } = await cambiarEstadoUsuario(db, req.params.id, req.body?.activo, { actorId: req.user.id });
    sesionesCerradas.forEach(markSessionRevoked);
    const message = sinCambio ? 'La cuenta ya estaba así' : usuario.activo ? `Cuenta de ${usuario.nombre} activada` : `Cuenta de ${usuario.nombre} desactivada`;
    res.json({ data: usuario, message });
  }
);

router.put('/api/v1/usuarios/:id/clave',
  ...soloSuperAdmin,
  auditMutation({
    db, accion: 'CAMBIAR_CLAVE_USUARIO', entidad: 'usuarios', getPreviousState: estadoPrevio,
    serializeResponse: (body) => body?.data ? { ...body.data, clave_cambiada: true } : body
  }),
  async (req, res) => {
    const { usuario, sesionesCerradas } = await cambiarClaveUsuario(db, req.params.id, req.body?.password, { actorId: req.user.id, sesionActual: req.user.sid });
    sesionesCerradas.forEach(markSessionRevoked);
    res.json({ data: usuario, message: `Clave de ${usuario.nombre} cambiada; se cerraron sus otras sesiones` });
  }
);

// Cada persona del personal cambia su propia clave (pantalla Mi clave). Pide la actual; el limitador del login
// frena a quien intente adivinarla con la sesión de otro abierta.
router.put('/api/v1/auth/mi-clave',
  loginLimiter,
  requireAuth,
  requireRoles(['super_admin', 'cobrador', 'auditor']),
  auditMutation({
    db, accion: 'CAMBIAR_MI_CLAVE', entidad: 'usuarios',
    resourceIdResolver: (req) => req.user?.id ?? null,
    serializeResponse: (body) => body?.data ? { ...body.data, clave_cambiada: true } : body
  }),
  async (req, res) => {
    const { actual, nueva } = req.body || {};
    const { usuario, sesionesCerradas } = await cambiarMiClave(db, req.user.id, { actual, nueva, sesionActual: req.user.sid });
    sesionesCerradas.forEach(markSessionRevoked);
    res.json({ data: usuario, message: 'Su clave se cambió. Las sesiones abiertas en otros dispositivos se cerraron.' });
  }
);
