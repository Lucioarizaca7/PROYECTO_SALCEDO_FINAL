// Páginas del personal: ruta, título del menú y roles que la ven (sin roles = todos).
// El servidor vuelve a comprobar el rol en cada petición; esto solo ordena el menú y las rutas.
export const navItems = [
  { key: 'dashboard', path: '/panel', label: 'Dashboard' },
  { key: 'comerciantes', path: '/comerciantes', label: 'Comerciantes', roles: ['super_admin', 'auditor'] },
  { key: 'sitios', path: '/sitios', label: 'Sitios de venta' },
  { key: 'pagos', path: '/pagos', label: 'Pagos y cobros', roles: ['super_admin', 'cobrador'] },
  { key: 'caja', path: '/caja', label: 'Cierre de caja', roles: ['super_admin', 'cobrador', 'auditor'] },
  { key: 'tickets', path: '/tickets', label: 'Tickets', roles: ['super_admin', 'auditor'] },
  { key: 'zonas', path: '/zonas', label: 'Zonas y calles', roles: ['super_admin', 'auditor'] },
  { key: 'mapa', path: '/mapa', label: 'Mapa de sitios', roles: ['super_admin', 'cobrador'] },
  { key: 'reportes', path: '/reportes', label: 'Reportes' },
  { key: 'auditoria', path: '/auditoria', label: 'Auditoría' },
  { key: 'revision', path: '/revision', label: 'Revisión de cobros', roles: ['super_admin', 'auditor'] },
  { key: 'dispositivos', path: '/dispositivos', label: 'Dispositivos', roles: ['super_admin'] },
  { key: 'ia', path: '/analitica', label: 'Analítica de recaudación' },
  { key: 'tarifas', path: '/tarifas', label: 'Tarifas', roles: ['super_admin'] }
];

export const HOME_PATH = '/panel';

export const pathOf = (key) => navItems.find((item) => item.key === key)?.path || HOME_PATH;

export const canSee = (item, rol) => !item.roles || item.roles.includes(rol);

export const navItemsFor = (rol) => navItems.filter((item) => canSee(item, rol));

export const navItemByPath = (pathname) => navItems.find((item) => item.path === pathname);
