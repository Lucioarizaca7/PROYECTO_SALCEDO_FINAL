// Consulta y verificación de la auditoría.
import express from 'express';
import { verifyAuditChain, getAuditTrail, contarAuditoria } from '../db.js';
import { requireAuth, requireRoles } from '../auth.js';
import { pool as db } from '../pg.js';

export const router = express.Router();

router.get('/api/v1/auditoria',
  requireAuth,
  requireRoles(['super_admin', 'auditor']),
  async (req, res) => {
    // Filtros: comerciante_id, entidad, usuario_id, desde, hasta (AAAA-MM-DD, días de Lima), buscar, page y limit.
    const q = req.query || {};
    const filtros = {
      comerciante_id: q.comerciante_id ? Number(q.comerciante_id) : undefined,
      entidad: q.entidad ? String(q.entidad) : undefined,
      usuario_id: q.usuario_id ? Number(q.usuario_id) : undefined,
      desde: q.desde ? String(q.desde) : undefined,
      hasta: q.hasta ? String(q.hasta) : undefined,
      buscar: q.buscar ? String(q.buscar) : undefined
    };
    const data = await getAuditTrail(db, { ...filtros, page: Number(q.page) || 1, limit: Number(q.limit) || undefined });
    res.json({ data, total: await contarAuditoria(db, filtros) });
  }
);

router.get('/api/v1/auditoria/verificacion',
  requireAuth,
  requireRoles(['super_admin', 'auditor']),
  async (_req, res) => {
    return res.json({ data: await verifyAuditChain(db) });
  }
);
