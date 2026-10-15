// Lógica pura del Mapa 2.5D: sin dependencias de DOM ni de mapbox-gl, para poder probarla con node:test.

export const PAYMENT_COLORS = {
  'al-dia': '#159a68',
  deuda: '#d94841',
  'no-devengo': '#64748b'
};

export const PAYMENT_LABELS = {
  'al-dia': 'Cuenta al día',
  deuda: 'Con deuda',
  'no-devengo': 'Libre / no devengo'
};

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

const money = (value) => `S/ ${Number(value || 0).toFixed(2)}`;

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
    saldo: Number.isFinite(Number(site.saldo_pendiente)) ? Number(site.saldo_pendiente) : 0,
    color: PAYMENT_COLORS[estadoPago]
  };
}

/** Descripción corta del estado de cuenta para el popup. */
export function accountStatusText(props) {
  if (props.estadoPago === 'deuda') return `Saldo pendiente: ${money(props.saldo)}`;
  if (props.estadoPago === 'no-devengo') return 'Libre: no devengo por inasistencia';
  return 'Cuenta al día';
}

/** FeatureCollection de polígonos extruibles; descarta puestos sin coordenadas válidas. */
export function buildSiteFeatures(sites, { widthM = 6, depthM = 8, bearing = 0, height = 5 } = {}) {
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
export function buildAvenueSample(count = 12, origin = { lat: -15.8997, lng: -70.5881 }) {
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
