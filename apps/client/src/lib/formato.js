// Formatos de pantalla compartidos por las páginas.

export const formatPEN = (value) => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN', minimumFractionDigits: 2 }).format(Number(value) || 0);

const roleLabels = { super_admin: 'Super administrador', cobrador: 'Cobrador', auditor: 'Auditor' };

export const formatRole = (rol) => {
  if (!rol) return 'Super administrador';
  if (roleLabels[rol]) return roleLabels[rol];
  const text = String(rol).replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export const getInitials = (nombre) => {
  const words = String(nombre || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'U';
  return words.slice(0, 2).map((word) => word.charAt(0)).join('').toUpperCase();
};
