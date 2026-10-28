// Formatos de pantalla compartidos por las páginas.

export const formatPEN = (value) => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN', minimumFractionDigits: 2 }).format(Number(value) || 0);

const roleLabels = { super_admin: 'Super administrador', cobrador: 'Cobrador', auditor: 'Auditor' };

export const formatRole = (rol) => {
  if (!rol) return 'Super administrador';
  if (roleLabels[rol]) return roleLabels[rol];
  const text = String(rol).replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

// "martes 28 de octubre" en Salcedo, no en la zona del navegador (un celular con otra hora mostraría otro día).
const fechaLarga = new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', weekday: 'long', day: 'numeric', month: 'long' });
export const fechaLargaEnLima = (date = new Date()) => {
  const texto = fechaLarga.format(date).replace(',', '');
  return texto.charAt(0).toUpperCase() + texto.slice(1);
};

export const getInitials = (nombre) => {
  const words = String(nombre || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'U';
  return words.slice(0, 2).map((word) => word.charAt(0)).join('').toUpperCase();
};

// Línea "Tarifa" de Pagos. Con cobro por día: monto de un día × días cobrados; cada puesto marcado un día
// es un día cobrado, y si los puestos pagan montos distintos (vía asfaltada y sin asfaltar) va el detalle.
export function textoTarifa(balance = {}) {
  const puestos = balance.puestos_cobrados || [];
  const dias = Number(balance.dias_asistidos || 0);
  // Sin días cobrados no hay tarifa que aplicar: "S/ 0" parecía una tarifa gratis.
  if (!dias && balance.no_devengo) return 'Sin días cobrados en el mes';
  if (!dias) return `S/ ${balance.tarifa?.monto_fijo ?? 0}`;
  const enPuestos = puestos.length > 1 ? ` en ${puestos.length} puestos` : '';
  if (balance.monto_dia === null && puestos.length) {
    return puestos.map((item) => `S/ ${item.monto_dia} × ${item.dias} (${item.codigo_puesto || `puesto ${item.puesto_id}`})`).join(' + ');
  }
  return `S/ ${balance.monto_dia ?? balance.tarifa?.monto_fijo ?? 0} × ${dias} ${dias === 1 ? 'día cobrado' : 'días cobrados'}${enPuestos}`;
}
