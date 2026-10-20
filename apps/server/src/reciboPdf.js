/**
 * Recibo de ingreso municipal en PDF (pdfkit): tildes y ñ, código del comerciante enmascarado,
 * estado (anulado o no) y un QR de verificación.
 *
 * Dos firmas HMAC con JWT_SECRET (cada una con su propio prefijo, para que una no sirva como la otra):
 *   verificación  R-000123.<12 hex>        pública y permanente: cualquiera con el recibo comprueba que es
 *                                          auténtico (número, fecha, monto y estado; sin datos personales).
 *   descarga      <id>.<vence>.<16 hex>    la recibe solo quien entró al portal con DNI + PIN; vale 30 min
 *                                          y abre únicamente ese recibo.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

import { config } from './config.js';

const DESCARGA_MINUTOS = 30;

const firmar = (texto, largo) => createHmac('sha256', config.jwtSecret).update(texto).digest('hex').slice(0, largo);

function iguales(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export function tokenVerificacion(numero, monto) {
  return `${numero}.${firmar(`verificar|${numero}|${Number(monto).toFixed(2)}`, 12)}`;
}

export function tokenDescarga(transaccionId, ahora = Date.now()) {
  const vence = Math.floor(ahora / 1000) + DESCARGA_MINUTOS * 60;
  return `${Number(transaccionId)}.${vence}.${firmar(`descargar|${Number(transaccionId)}|${vence}`, 16)}`;
}

/** Devuelve el id de la transacción si el token de descarga es válido y no venció; si no, null. */
export function leerTokenDescarga(token, ahora = Date.now()) {
  const [id, vence, firma] = String(token || '').split('.');
  if (!/^\d+$/.test(id || '') || !/^\d+$/.test(vence || '') || !firma) return null;
  if (Number(vence) * 1000 < ahora) return null;
  return iguales(firma, firmar(`descargar|${Number(id)}|${vence}`, 16)) ? Number(id) : null;
}

const SELECT_RECIBO = `
  SELECT co.id, cp.numero_correlativo AS numero, co.monto, co.metodo_pago, co.concepto, co.codigo_operacion, co.estado,
         co.motivo_anulacion, co.periodo_aplicado, co.comerciante_id,
         to_char(co.fecha_cobro_cliente AT TIME ZONE '${config.timeZone}', 'DD/MM/YYYY HH24:MI') AS fecha,
         to_char(co.fecha_cobro_cliente AT TIME ZONE '${config.timeZone}', 'YYYY-MM-DD') AS dia,
         c.nombre AS comerciante, c.codigo AS comerciante_codigo, r.nombre AS rubro, z.nombre AS zona, u.nombre AS cobrador
  FROM transacciones co
  JOIN comprobantes cp ON cp.id = co.comprobante_id
  JOIN comerciantes c ON c.id = co.comerciante_id
  LEFT JOIN rubros r ON r.id = c.rubro_id
  LEFT JOIN zonas z ON z.id = c.zona_id
  JOIN usuarios u ON u.id = co.cobrador_id`;

/** Recibo por id de transacción o por número (R-000123). */
export async function buscarRecibo(db, referencia) {
  const valor = String(referencia || '').trim();
  const porId = /^\d+$/.test(valor);
  const { rows: [fila] } = await db.query(`${SELECT_RECIBO} WHERE ${porId ? 'co.id = $1' : 'cp.numero_correlativo = $1'}`, [porId ? Number(valor) : valor]);
  return fila ? { ...fila, id: Number(fila.id), comerciante_id: Number(fila.comerciante_id), monto: Number(fila.monto) } : null;
}

/** Verificación pública: solo número, fecha, monto y estado. null si el token no corresponde. */
export async function verificarRecibo(db, token) {
  const valor = String(token || '');
  const corte = valor.lastIndexOf('.');
  if (corte < 1) return null;
  const recibo = await buscarRecibo(db, valor.slice(0, corte));
  if (!recibo || !iguales(valor, tokenVerificacion(recibo.numero, recibo.monto))) return null;
  return { numero: recibo.numero, fecha: recibo.dia, monto: recibo.monto, estado: recibo.estado };
}

export function urlVerificacion(recibo) {
  const base = config.frontendOrigins[0] || 'http://localhost:5173';
  return `${base}/verificar/${encodeURIComponent(tokenVerificacion(recibo.numero, recibo.monto))}`;
}

const METODO = { efectivo: 'Efectivo', yape: 'Yape', plin: 'Plin', pos: 'POS' };

export async function generarReciboPdf(recibo) {
  const url = urlVerificacion(recibo);
  const qr = await QRCode.toBuffer(url, { margin: 1, width: 220 });

  return new Promise((resolve, reject) => {
    // A6 vertical: entra en una hoja pequeña y se lee bien en el celular.
    const doc = new PDFDocument({ size: 'A6', margin: 22, info: { Title: `Recibo ${recibo.numero}`, Author: 'Municipalidad de Salcedo' } });
    const partes = [];
    doc.on('data', (parte) => partes.push(parte));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);

    const ancho = doc.page.width - 44;
    doc.font('Helvetica-Bold').fontSize(11).text('MUNICIPALIDAD DE SALCEDO', { align: 'center' });
    doc.font('Helvetica').fontSize(8).text('Unidad de Rentas y Recaudación — SISREC', { align: 'center' });
    doc.moveDown(0.6);
    doc.font('Helvetica-Bold').fontSize(10).text('RECIBO DE INGRESO MUNICIPAL', { align: 'center' });
    doc.fontSize(13).text(recibo.numero, { align: 'center' });
    doc.moveDown(0.5);

    const linea = (etiqueta, valor) => {
      doc.font('Helvetica-Bold').fontSize(8).text(`${etiqueta}: `, { continued: true });
      doc.font('Helvetica').text(String(valor ?? '—'));
    };
    linea('Comerciante', recibo.comerciante);
    linea('Código', recibo.comerciante_codigo);
    linea('Rubro / zona', `${recibo.rubro || '—'} · ${recibo.zona || '—'}`);
    linea('Concepto', recibo.concepto);
    if (recibo.periodo_aplicado) linea('Mes pagado', recibo.periodo_aplicado);
    linea('Fecha', recibo.fecha);
    linea('Método', METODO[recibo.metodo_pago] || recibo.metodo_pago);
    if (recibo.codigo_operacion && recibo.metodo_pago !== 'efectivo') linea('Operación', recibo.codigo_operacion);
    linea('Cobrador', recibo.cobrador);
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(14).text(`Total: S/ ${recibo.monto.toFixed(2)}`, { align: 'center' });

    if (recibo.estado === 'anulado') {
      doc.moveDown(0.3);
      doc.fillColor('#b91c1c').font('Helvetica-Bold').fontSize(16).text('ANULADO', { align: 'center' });
      doc.font('Helvetica').fontSize(7).text(`Motivo: ${recibo.motivo_anulacion || '—'}`, { align: 'center' });
      doc.fillColor('black');
    }

    doc.moveDown(0.4);
    const lado = 92;
    doc.image(qr, (doc.page.width - lado) / 2, doc.y, { width: lado });
    doc.y += lado + 4;
    doc.font('Helvetica').fontSize(6.5).text('Escanee el código para verificar que este recibo es auténtico.', { align: 'center', width: ancho });
    doc.end();
  });
}
