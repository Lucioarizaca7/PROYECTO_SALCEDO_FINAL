// El recibo oficial de un cobro ya registrado, para volver a mandarlo por WhatsApp (12/11/2026): después de
// sincronizar un cobro sin señal (que entregó un recibo provisional sin QR) o si se perdió el mensaje. Trae el QR
// de verificación. El servidor solo le da al cobrador sus propios recibos.
import { apiBase, authFetch } from '../../services/session';
import { shareViaWhatsApp } from './recibo';

export async function enviarReciboOficial(comprobante) {
  if (!navigator.onLine) throw new Error('Necesita señal para traer el recibo oficial.');
  const response = await authFetch(`${apiBase}/comprobantes/${encodeURIComponent(comprobante)}/recibo`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || 'No se pudo traer el recibo oficial.');
  await shareViaWhatsApp(body.data);
  return body.data;
}
