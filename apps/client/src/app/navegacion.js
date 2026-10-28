// Páginas del personal: ruta, título del menú, grupo del menú lateral y roles que la ven (sin roles = todos).
// El servidor vuelve a comprobar el rol en cada petición; esto solo ordena el menú y las rutas.
export const navItems = [
  { key: 'dashboard', path: '/panel', label: 'Dashboard', grupo: 'gestion' },
  { key: 'comerciantes', path: '/comerciantes', label: 'Comerciantes', grupo: 'gestion', roles: ['super_admin', 'auditor'] },
  { key: 'pagos', path: '/pagos', label: 'Pagos y cobros', grupo: 'gestion', roles: ['super_admin', 'cobrador'] },
  { key: 'sitios', path: '/sitios', label: 'Sitios de venta', grupo: 'gestion' },
  { key: 'mapa', path: '/mapa', label: 'Mapa de sitios', grupo: 'gestion', roles: ['super_admin', 'cobrador'] },
  { key: 'caja', path: '/caja', label: 'Cierre de caja', grupo: 'gestion', roles: ['super_admin', 'cobrador', 'auditor'] },
  { key: 'tickets', path: '/tickets', label: 'Tickets', grupo: 'gestion', roles: ['super_admin', 'auditor'] },
  { key: 'zonas', path: '/zonas', label: 'Zonas y calles', grupo: 'configuracion', roles: ['super_admin', 'auditor'] },
  { key: 'tarifas', path: '/tarifas', label: 'Tarifas', grupo: 'configuracion', roles: ['super_admin'] },
  { key: 'dispositivos', path: '/dispositivos', label: 'Dispositivos', grupo: 'configuracion', roles: ['super_admin'] },
  { key: 'reportes', path: '/reportes', label: 'Reportes', grupo: 'control' },
  { key: 'auditoria', path: '/auditoria', label: 'Auditoría', grupo: 'control', roles: ['super_admin', 'auditor'] },
  { key: 'revision', path: '/revision', label: 'Revisión de cobros', grupo: 'control', roles: ['super_admin', 'auditor'] },
  { key: 'ia', path: '/analitica', label: 'Analítica de recaudación', grupo: 'control' }
];

export const gruposMenu = [
  { key: 'gestion', label: 'Gestión' },
  { key: 'configuracion', label: 'Configuración' },
  { key: 'control', label: 'Control' }
];

export const HOME_PATH = '/panel';

export const pathOf = (key) => navItems.find((item) => item.key === key)?.path || HOME_PATH;

export const canSee = (item, rol) => !item.roles || item.roles.includes(rol);

export const navItemsFor = (rol) => navItems.filter((item) => canSee(item, rol));

export const navItemByPath = (pathname) => navItems.find((item) => item.path === pathname);
