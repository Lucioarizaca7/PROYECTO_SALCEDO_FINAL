// Lógica pura del Mapa 2.5D: sin dependencias de DOM ni de mapbox-gl, para poder probarla con node:test.

const money = (value) => `S/ ${(Number(value) || 0).toFixed(2)}`;

export const PAYMENT_COLORS = {
  'al-dia': '#159a68',
  deuda: '#d94841',
  'no-devengo': '#64748b',
  libre: '#2563eb',
  'sin-tarifa': '#b7791f'
};

export const PAYMENT_LABELS = {
  'al-dia': 'Cuenta al día',
  deuda: 'Con deuda',
  'no-devengo': 'No devenga',
  libre: 'Libre / disponible',
  'sin-tarifa': 'Sin tarifa vigente'
};

// estado_pago que calcula el servidor (GET /puestos) → estado que pinta el mapa.
const SERVER_TO_MAP = {
  pendiente: 'deuda',
  pagado: 'al-dia',
  incluido: 'al-dia',
  no_devenga: 'no-devengo',
  ausente: 'no-devengo',
  inactivo: 'no-devengo',
  libre: 'libre',
  reservado: 'libre',
  sin_tarifa: 'sin-tarifa'
};

// Nombre y estilo de cada estado_pago del servidor, para la tabla de Sitios de venta.
export const SERVER_PAYMENT_STATUS = {
  pendiente: { label: 'Pendiente', tone: 'pending' },
  pagado: { label: 'Pagado', tone: 'paid' },
  incluido: { label: 'Incluido', tone: 'neutral' },
  no_devenga: { label: 'No devenga', tone: 'neutral' },
  ausente: { label: 'Ausente', tone: 'neutral' },
  libre: { label: 'Libre', tone: 'neutral' },
  reservado: { label: 'Reservado', tone: 'neutral' },
  sin_tarifa: { label: 'Sin tarifa', tone: 'neutral' },
  inactivo: { label: 'Dado de baja', tone: 'neutral' }
};

/** Estado del mapa a partir del estado_pago del servidor (o del saldo, en instantáneas antiguas sin él). */
export function mapPaymentStatus(site) {
  if (SERVER_TO_MAP[site.estado_pago]) return SERVER_TO_MAP[site.estado_pago];
  if (!site.comerciante_id && site.estado === 'disponible') return 'libre';
  return Number(site.saldo_pendiente || 0) > 0 ? 'deuda' : 'al-dia';
}

const NO_DEVENGO_TEXT = {
  ferial_sin_asistencia: 'Ferial: no devenga por inasistencia',
  sin_asistencia: 'Cobro por día: sin días cobrados en el mes',
  eventual: 'Eventual: se cobra solo el día que vende'
};

/** Una línea legible del estado de cuenta del puesto en el mes. */
export function paymentStatusText(site) {
  const saldo = money(site.saldo_pendiente);
  switch (site.estado_pago) {
    case 'pendiente': return `${site.cobro_diario ? 'Saldo de hoy' : 'Saldo del mes'}: ${saldo}`;
    case 'pagado': return site.cobro_diario ? 'Pagado hoy' : 'Mes pagado';
    case 'incluido': return `Su deuda se cobra en el puesto ${site.puesto_principal}`;
    case 'no_devenga': return NO_DEVENGO_TEXT[site.motivo] || 'No devenga este mes';
    case 'ausente': return 'Ferial ausente: no devenga';
    case 'libre': return 'Puesto libre, sin titular';
    case 'reservado': return 'Puesto reservado';
    case 'sin_tarifa': return 'Sin tarifa vigente para su rubro';
    case 'inactivo': return 'Dado de baja';
    default:
      if (site.estadoPago === 'deuda') return `Saldo pendiente: ${saldo}`;
      if (site.estadoPago === 'no-devengo') return 'No devenga este mes';
      if (site.estadoPago === 'libre') return 'Puesto libre, sin titular';
      return 'Cuenta al día';
  }
}

const METERS_PER_DEGREE_LAT = 111320;

/** Rectángulo (anillo cerrado GeoJSON) centrado en lat/lng, de ancho x fondo en metros, rotado `bearing` grados. */
export function rectangleAround(lat, lng, widthM = 6, depthM = 8, bearing = 0) {
  const cosLat = Math.cos((lat * Math.PI) / 180) || 1;
  const rad = (bearing * Math.PI) / 180;
  const hw = widthM / 2;
  const hd = depthM / 2;
  const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, y]) => {
    const rx = x * Math.cos(rad) - y * Math.sin(rad);
    const ry = x * Math.sin(rad) + y * Math.cos(rad);
    return [lng + rx / (METERS_PER_DEGREE_LAT * cosLat), lat + ry / METERS_PER_DEGREE_LAT];
  });
  return [[...corners, corners[0]]];
}

/** Propiedades planas (todas definidas) que viajan dentro de cada feature y alimentan el popup. */
export function siteProperties(site) {
  const estadoPago = PAYMENT_COLORS[site.estadoPago] ? site.estadoPago : 'al-dia';
  return {
    id: String(site.id ?? site.codigo ?? ''),
    codigo: String(site.codigo ?? 'S/N'),
    titular: String(site.comerciante || site.titular || 'Sin titular'),
    zona: String(site.zona || 'Sin zona'),
    categoria: String(site.categoriaMapa || site.tipo_comerciante || site.categoria || 'permanente').toLowerCase(),
    direccion: String(site.direccion || 'Ubicación registrada'),
    estadoPago,
    estadoLabel: PAYMENT_LABELS[estadoPago],
    estadoTexto: paymentStatusText({ ...site, estadoPago }),
    saldo: Number.isFinite(Number(site.saldo_pendiente)) ? Number(site.saldo_pendiente) : 0,
    color: PAYMENT_COLORS[estadoPago]
  };
}

/** Descripción corta del estado de cuenta para el popup. */
export function accountStatusText(props) {
  return props.estadoTexto || paymentStatusText(props);
}

/** FeatureCollection de polígonos extruibles; descarta puestos sin coordenadas válidas. */
export function buildSiteFeatures(sites, { widthM = 4, depthM = 5, bearing = 0, height = 4 } = {}) {
  const features = [];
  for (const site of sites) {
    if (site.latitud === null || site.latitud === undefined || site.latitud === '') continue;
    if (site.longitud === null || site.longitud === undefined || site.longitud === '') continue;
    const lat = Number(site.latitud);
    const lng = Number(site.longitud);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    features.push({
      type: 'Feature',
      id: features.length + 1,
      properties: { ...siteProperties(site), height, base: 0, latitud: lat, longitud: lng },
      geometry: { type: 'Polygon', coordinates: rectangleAround(lat, lng, widthM, depthM, bearing) }
    });
  }
  return { type: 'FeatureCollection', features };
}

/** Búsqueda libre por código, titular o dirección (sin distinguir mayúsculas ni tildes). */
export function matchesSearch(site, query) {
  const fold = (text) => String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const q = fold(query).trim();
  if (!q) return true;
  return [site.codigo, site.comerciante, site.direccion, site.zona].some((field) => fold(field).includes(q));
}

/** Filtro combinado categoría + estado de pago + búsqueda. */
export function filterSites(sites, { category = 'todos', paymentStatus = 'todos', query = '' } = {}) {
  return sites.filter((site) => (
    (category === 'todos' || site.categoriaMapa === category)
    && (paymentStatus === 'todos' || site.estadoPago === paymentStatus)
    && matchesSearch(site, query)
  ));
}

/** Ejemplo: `count` puestos contiguos a lo largo de una avenida (para demos y pruebas). */
export function buildAvenueSample(count = 12, origin = { lat: -15.8740, lng: -69.9966 }) {
  const estados = ['al-dia', 'deuda', 'no-devengo'];
  const categorias = ['permanente', 'ferial', 'eventual'];
  const stepLng = 6 / (METERS_PER_DEGREE_LAT * Math.cos((origin.lat * Math.PI) / 180));
  const sites = Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    codigo: `S-${String(index + 1).padStart(3, '0')}`,
    comerciante: `Comerciante de zapatillas ${index + 1}`,
    zona: 'Av. Comercial',
    direccion: `Av. Comercial, puesto ${index + 1}`,
    categoriaMapa: categorias[index % 3],
    estadoPago: estados[index % 3],
    saldo_pendiente: index % 3 === 1 ? 20 + index : 0,
    latitud: origin.lat,
    longitud: origin.lng + index * stepLng
  }));
  return { sites, geojson: buildSiteFeatures(sites, { widthM: 6, depthM: 8 }) };
}

/** Resuelve el puesto original a partir del feature clicado (mapbox serializa las props a primitivos). */
export function siteFromFeature(feature, sites) {
  const id = feature?.properties?.id;
  if (id === undefined || id === null) return null;
  return sites.find((site) => String(site.id ?? site.codigo) === String(id)) ?? null;
}

/** Mensaje legible para un error de `navigator.geolocation` (code 1 = permiso, 2 = sin señal, 3 = tiempo agotado). */
export function geolocationErrorMessage(error) {
  if (error?.code === 1) return 'Permiso de ubicación denegado. Actívalo en el candado de la barra de direcciones y vuelve a intentar.';
  if (error?.code === 2) return 'No se pudo determinar tu ubicación. Revisa que el GPS o el Wi-Fi estén activos.';
  if (error?.code === 3) return 'La ubicación tardó demasiado en llegar. Vuelve a intentar.';
  return error?.message || 'No se pudo obtener tu ubicación.';
}
