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

// Fecha y hora del cobro en Salcedo ("11/11/2026, 09:42"), sea un Date, un ISO o un "AAAA-MM-DD HH:MM:SS".
const fechaHora = new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const fechaHoraEnLima = (valor) => {
  const fecha = valor instanceof Date ? valor : fechaDeTexto(valor);
  return fecha && !Number.isNaN(fecha.getTime()) ? fechaHora.format(fecha) : '';
};

// "2026-11-11 09:42:00" (como lo devuelve la API) no lo entiende Safari del iPhone: sale "Invalid Date".
// Con la T en medio sí; sin zona se lee en la hora del celular, que en Salcedo es la de Lima.
export const fechaDeTexto = (valor) => {
  if (!valor) return null;
  const texto = String(valor).trim();
  return new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(texto) ? texto.replace(' ', 'T') : texto);
};

// Línea bajo el riesgo de morosidad: de cuándo es el puntaje y si se está recalculando por detrás
// (la primera carga del día muestra el del día anterior mientras tanto).
export const textoPuntajeRiesgo = ({ calculado_el: calculadoEl, actualizando } = {}) => {
  const fecha = fechaHoraEnLima(calculadoEl);
  if (!fecha) return actualizando ? 'Calculando el puntaje…' : '';
  return `Puntaje del ${fecha}${actualizando ? ' · actualizando…' : ''}`;
};

/** Texto del resultado de la verificación de la cadena de hashes de la auditoría (GET /auditoria/verificacion). */
export function textoVerificacion(resultado) {
  if (!resultado) return '';
  if (resultado.cargando) return 'Verificando…';
  if (resultado.error) return resultado.error;
  return resultado.valid
    ? `Cadena íntegra: ${resultado.total} registro(s) enlazados sin cambios.`
    : `La cadena se rompe en el registro ${resultado.broken_at}: alguien alteró la auditoría desde ahí.`;
}

const METODOS = { efectivo: 'Efectivo', yape: 'Yape', plin: 'Plin', pos: 'POS' };
export const textoMetodo = (metodo) => METODOS[String(metodo || '').toLowerCase()] || metodo || '';

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
  // Un puesto que cambió de zona en el mes trae una fila por zona: se cuentan puestos, no filas.
  const totalPuestos = new Set(puestos.map((item) => item.puesto_id)).size;
  const enPuestos = totalPuestos > 1 ? ` en ${totalPuestos} puestos` : '';
  if (balance.monto_dia === null && puestos.length) {
    return puestos.map((item) => `S/ ${item.monto_dia} × ${item.dias} (${item.codigo_puesto || `puesto ${item.puesto_id}`})`).join(' + ');
  }
  return `S/ ${balance.monto_dia ?? balance.tarifa?.monto_fijo ?? 0} × ${dias} ${dias === 1 ? 'día cobrado' : 'días cobrados'}${enPuestos}`;
}
