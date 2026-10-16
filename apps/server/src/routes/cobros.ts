// Cobros, sincronización offline, revisión de observados, jornada y comprobantes.
import express from 'express';
import { currentPeriod, getComerciantes, getCobros, registrarCobro, syncOfflineCobro, syncOfflineBatch, getCobrosObservados, resolveCobroObservado, getSyncErrors, getJornadaPackage } from '../db.js';
import { requireAuth, requireRoles } from '../auth.js';
import { handleValidationErrors, validateCobro } from '../validation.js';
import { staffOnly, auditContext } from '../http/comunes.js';
import { pool as db } from '../pg.js';

export const router = express.Router();

router.get('/api/v1/comprobantes/:id/pdf', ...staffOnly, async (req, res) => {
  const payment = (await getCobros(db)).find((item) => item.id === Number(req.params.id) || String(item.comprobante) === String(req.params.id) || String(item.codigo_operacion) === String(req.params.id));
  if (!payment) {
    return res.status(404).json({ message: 'Comprobante no encontrado' });
  }

  const merchant = (await getComerciantes(db, { includeInactive: true, limit: 1000 })).find((item) => item.id === Number(payment.comerciante_id));
  const textLines = [
    `Comerciante: ${merchant?.nombre || 'N/D'}`,
    `Comprobante: ${payment.comprobante || payment.codigo_operacion || `COBRO-${payment.id}`}`,
    `Concepto: ${payment.concepto || 'Liquidación de deuda'}`,
    `Monto: S/ ${Number(payment.monto || 0).toFixed(2)}`,
    `Método: ${payment.metodo_pago || 'efectivo'}`,
    `Fecha: ${payment.fecha_cobro || 'N/D'}`,
    `Hash: ${payment.hash_transaccion || 'sha256:local'}`
  ];

  const content = [
    'BT',
    '/F1 16 Tf',
    '72 760 Td',
    '(SISREC SALCEDO) Tj',
    '0 -28 Td',
    '(COMPROBANTE DE PAGO) Tj',
    '0 -28 Td',
    `(${textLines.join(' | ')}) Tj`,
    'ET'
  ].join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f\n`;
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n\n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="comprobante-${req.params.id}.pdf"`);
  return res.send(Buffer.from(pdf, 'latin1'));
});

router.get('/api/v1/cobros', ...staffOnly, async (_req, res) => {
  const data = await getCobros(db);
  res.json({ data, total: data.length });
});

router.post('/api/v1/cobros/sincronizar',
  requireAuth,
  requireRoles(['super_admin', 'cobrador']),
  async (req, res) => {
    const idempotencyKey = String(req.headers['x-idempotency-key'] || req.body.hash_transaccion || req.body.hashTransaccion || '').trim();
    const payload = {
      ...req.body,
      comerciante_id: req.body.comerciante_id ?? req.body.comercianteId,
      // El cobrador es siempre quien inició sesión; el navegador no puede elegirlo.
      cobrador_id: req.user.id,
      metodo_pago: req.body.metodo_pago ?? req.body.metodoPago ?? 'efectivo',
      hash_transaccion: idempotencyKey || req.body.hash_transaccion || req.body.hashTransaccion || undefined,
      codigo_operacion: req.body.codigo_operacion ?? req.body.codigoOperacion ?? (idempotencyKey || undefined),
      fecha_cobro: req.body.fecha_cobro || req.body.fechaCobro || new Date().toISOString(),
      periodo: req.body.periodo || currentPeriod()
    };

    try {
      const result = await syncOfflineCobro(db, payload, { audit: auditContext(req, 'SINCRONIZAR_COBRO_OFFLINE') });
      if (result.status === 'IGNORED') {
        return res.status(200).json(result);
      }
      return res.status(201).json(result);
    } catch (error) {
      // 400: dato inválido (no sirve reintentar); 503: fallo temporal, el celular debe reintentar.
      const status = error.permanent === false ? 503 : 400;
      return res.status(status).json({ message: error.message || 'No se pudo sincronizar el cobro offline' });
    }
  }
);

// Sube hasta 100 cobros offline en una petición. Responde 200 con el resultado de cada uno
// (sincronizado, duplicado, observado, rechazado o error temporal); uno que falla no detiene al resto.
router.post('/api/v1/cobros/sincronizar-lote',
  requireAuth,
  requireRoles(['super_admin', 'cobrador']),
  async (req, res) => {
    const cobros = req.body?.cobros;
    const deviceId = String(req.body?.device_id || req.headers['x-device-id'] || '').trim().slice(0, 100) || null;
    const data = await syncOfflineBatch(db, cobros, {
      cobradorId: req.user.id,
      deviceId,
      audit: auditContext(req, 'SINCRONIZAR_COBRO_OFFLINE')
    });
    return res.json({ data, message: `Lote procesado: ${data.resumen.sincronizado} sincronizados, ${data.resumen.observado} observados, ${data.resumen.duplicado} duplicados, ${data.resumen.rechazado} rechazados` });
  }
);

// Panel de revisión manual: cobros offline observados y cobros rechazados por el servidor.
router.get('/api/v1/cobros/observados', requireAuth, requireRoles(['super_admin', 'auditor']), async (req, res) => {
  const data = await getCobrosObservados(db, { estado: String(req.query.estado || 'pendiente') });
  return res.json({ data, total: data.length });
});

router.post('/api/v1/cobros/observados/:id/resolver', requireAuth, requireRoles(['super_admin']), async (req, res) => {
  const data = await resolveCobroObservado(db, Number(req.params.id), {
    decision: String(req.body?.decision || ''),
    resolucion: req.body?.resolucion,
    usuarioId: req.user.id,
    audit: auditContext(req, 'REVISAR_COBRO_OBSERVADO')
  });
  return res.json({ data, message: data.estado === 'anulado' ? 'Cobro anulado; registre la devolución al comerciante' : 'Cobro aceptado' });
});

router.get('/api/v1/cobros/sincronizacion/errores', requireAuth, requireRoles(['super_admin', 'auditor']), async (_req, res) => {
  const data = await getSyncErrors(db);
  return res.json({ data, total: data.length });
});

// Paquete de inicio de jornada: padrón activo con saldos del periodo y tarifas, para buscar sin señal.
router.get('/api/v1/jornada/paquete', requireAuth, requireRoles(['super_admin', 'cobrador']), async (req, res) => {
  const periodo = /^\d{4}-\d{2}$/.test(String(req.query.periodo || '')) ? String(req.query.periodo) : currentPeriod();
  const data = await getJornadaPackage(db, { periodo });
  return res.json({ data, total: data.comerciantes.length });
});

router.post('/api/v1/cobros',
  requireAuth,
  requireRoles(['super_admin', 'cobrador']),
  validateCobro,
  handleValidationErrors,
  async (req, res) => {
    // cobrador_id sale del token; comprobante, cobro y auditoría se graban en una sola transacción.
    const data = await registrarCobro(db, { ...(req.body || {}), cobrador_id: req.user.id }, { audit: auditContext(req, 'REGISTRAR_COBRO') });
    return res.status(201).json({ data, message: 'Cobro registrado correctamente' });
  }
);
