// Consulta y verificación de la auditoría.
import express from 'express';
import { verifyAuditChain, getAuditTrail } from '../db.js';
import { requireAuth, requireRoles } from '../auth.js';
import { pool as db } from '../pg.js';

export const router = express.Router();

router.get('/api/v1/auditoria',
  requireAuth,
  requireRoles(['super_admin', 'auditor']),
  async (req, res) => {
    const { comerciante_id, entidad } = req.query || {};
    const data = await getAuditTrail(db, {
      comerciante_id: comerciante_id ? Number(comerciante_id) : undefined,
      entidad: entidad || undefined
    });
    res.json({ data, total: data.length });
  }
);

router.get('/api/v1/auditoria/verificacion',
  requireAuth,
  requireRoles(['super_admin', 'auditor']),
  async (_req, res) => {
    return res.json({ data: await verifyAuditChain(db) });
  }
);
