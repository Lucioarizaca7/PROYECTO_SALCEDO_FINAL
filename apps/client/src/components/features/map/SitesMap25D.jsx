import { useEffect, useMemo, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { accountStatusText, buildSiteFeatures, siteFromFeature } from './sitesGeo';

const SOURCE_ID = 'puestos';
const LAYER_ID = 'puestos-3d';
const DOT_LAYER_ID = 'puestos-puntos';
const BASE_SOURCE_ID = 'salcedo-base';
const BASE_URL = '/data/salcedo-base.geojson';
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const DEFAULT_PITCH = 55;
const DEFAULT_BEARING = -20;
// Ultima posicion de la camara: al volver desde la vista 2D el mapa reaparece donde estaba, siempre con 55 grados.
let lastView = null;

// Sin token de Mapbox el mapa sigue funcionando con teselas raster de OpenStreetMap.
const FALLBACK_STYLE = {
  version: 8,
  sources: {
    osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '&copy; OpenStreetMap contributors' }
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
};

const styleFor = (baseLayer) => {
  if (!MAPBOX_TOKEN) return FALLBACK_STYLE;
  return baseLayer === 'hybrid' ? 'mapbox://styles/mapbox/satellite-streets-v12' : 'mapbox://styles/mapbox/light-v11';
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// DOM construido con textContent: los datos del comerciante nunca se interpretan como HTML.
function buildPopup(props, { onCollect, onInspect }) {
  const root = el('div', 'site-popup');
  root.append(el('span', 'eyebrow', `${props.codigo} · ${props.zona}`));
  root.append(el('strong', '', props.titular));
  root.append(el('span', '', `${props.direccion} · ${props.categoria}`));
  root.append(el('span', props.estadoPago === 'deuda' ? 'popup-debt' : 'popup-ok', accountStatusText(props)));
  if (onCollect) {
    const button = el('button', 'primary-button compact', 'Cobrar aquí');
    button.type = 'button';
    button.addEventListener('click', onCollect);
    root.append(button);
  }
  if (onInspect) {
    const button = el('button', 'secondary-button compact', 'Gestionar puesto');
    button.type = 'button';
    button.addEventListener('click', onInspect);
    root.append(button);
  }
  return root;
}

export default function SitesMap25D({ sites, selectedSite, baseLayer, drawing, draftLocation, userLocation, onSelect, onCollect, onInspect, onPickLocation }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const draftMarkerRef = useRef(null);
  const userMarkerRef = useRef(null);
  const sitesRef = useRef(sites);
  const handlersRef = useRef({});
  const dataRef = useRef({ type: 'FeatureCollection', features: [] });
  const readyRef = useRef(false);
  const centeredRef = useRef(false);

  sitesRef.current = sites;
  handlersRef.current = { onSelect, onCollect, onInspect, onPickLocation, drawing };

  // El padre entrega un array nuevo en cada render; solo se vuelve a dibujar si cambia el contenido.
  const signature = sites.map((s) => `${s.id}|${s.latitud}|${s.longitud}|${s.estadoPago}|${s.comerciante}`).join(';');
  const data = useMemo(() => buildSiteFeatures(sites), [signature]); // eslint-disable-line react-hooks/exhaustive-deps
  dataRef.current = data;

  // Plano municipal (DWG convertido): solo se agrega si el GeoJSON generado existe.
  const installBasePlan = (map) => {
    fetch(BASE_URL, { method: 'HEAD' })
      .then((res) => {
        const type = res.headers.get('content-type') || '';
        if (!res.ok || type.includes('text/html') || !map.getStyle() || map.getSource(BASE_SOURCE_ID)) return;
        map.addSource(BASE_SOURCE_ID, { type: 'geojson', data: BASE_URL });
        const before = map.getLayer(DOT_LAYER_ID) ? DOT_LAYER_ID : undefined;
        const isLote = ['==', ['get', 'capa'], 'Lote_Comercial'];
        map.addLayer({ id: 'base-manzanas', type: 'fill', source: BASE_SOURCE_ID,
          filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['!=', ['get', 'capa'], 'Lote_Comercial']],
          paint: { 'fill-color': '#e7ecf3', 'fill-opacity': 0.85, 'fill-outline-color': '#8c9bb0' } }, before);
        map.addLayer({ id: 'base-lotes', type: 'line', source: BASE_SOURCE_ID, minzoom: 16.5,
          filter: isLote, paint: { 'line-color': '#9aa8bb', 'line-width': 0.6 } }, before);
        map.addLayer({ id: 'base-vias', type: 'line', source: BASE_SOURCE_ID,
          filter: ['==', ['geometry-type'], 'LineString'],
          paint: { 'line-color': '#6b7a90', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.5, 19, 2.5] } }, before);
      })
      .catch(() => {});
  };

  const installLayers = (map) => {
    if (!map.getSource(SOURCE_ID)) map.addSource(SOURCE_ID, { type: 'geojson', data: dataRef.current });
    installBasePlan(map);
    if (!map.getLayer(DOT_LAYER_ID)) {
      // Marcadores planos visibles de lejos; los bloques 3D toman el relevo al acercar.
      map.addLayer({
        id: DOT_LAYER_ID,
        type: 'circle',
        source: SOURCE_ID,
        paint: {
          'circle-color': ['coalesce', ['get', 'color'], '#64748b'],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 5, 18, 9],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2
        }
      });
    }
    if (!map.getLayer(LAYER_ID)) {
      map.addLayer({
        id: LAYER_ID,
        type: 'fill-extrusion',
        source: SOURCE_ID,
        paint: {
          'fill-extrusion-color': ['coalesce', ['get', 'color'], '#64748b'],
          'fill-extrusion-height': ['coalesce', ['get', 'height'], 5],
          'fill-extrusion-base': ['coalesce', ['get', 'base'], 0],
          'fill-extrusion-opacity': 0.9
        }
      });
    }
  };

  // Los puestos suelen llegar después de montar el mapa: se centra en ellos la primera vez.
  const recenterOnce = (map) => {
    const first = dataRef.current.features[0]?.properties;
    if (centeredRef.current || !first) return;
    centeredRef.current = true;
    if (!lastView) map.jumpTo({ center: [first.longitud, first.latitud], pitch: DEFAULT_PITCH, bearing: DEFAULT_BEARING });
    else map.setPitch(DEFAULT_PITCH);
  };

  // Inicialización única.
  useEffect(() => {
    if (MAPBOX_TOKEN) mapboxgl.accessToken = MAPBOX_TOKEN;
    const first = dataRef.current.features[0]?.properties;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: styleFor(baseLayer),
      center: lastView?.center ?? (first ? [first.longitud, first.latitud] : [-69.9966, -15.8740]),
      zoom: lastView?.zoom ?? 17.5,
      pitch: DEFAULT_PITCH,
      bearing: lastView?.bearing ?? DEFAULT_BEARING,
      maxPitch: 60,
      antialias: false
    });
    mapRef.current = map;
    if (import.meta.env.DEV) window.__sisrecMap = map;
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true, showCompass: true }), 'top-right');

    map.on('moveend', () => {
      const center = map.getCenter();
      lastView = { center: [center.lng, center.lat], zoom: map.getZoom(), bearing: map.getBearing() };
    });

    map.on('style.load', () => {
      installLayers(map);
      if (map.getPitch() !== DEFAULT_PITCH) map.setPitch(DEFAULT_PITCH);
      readyRef.current = true;
      recenterOnce(map);
    });

    map.on('click', LAYER_ID, (event) => {
      const feature = event.features && event.features[0];
      if (!feature || handlersRef.current.drawing) return;
      const props = feature.properties;
      const site = siteFromFeature(feature, sitesRef.current);
      const handlers = handlersRef.current;
      handlers.onSelect?.(site);
      popupRef.current?.remove();
      popupRef.current = new mapboxgl.Popup({ closeButton: true, maxWidth: '280px', offset: 12 })
        .setLngLat([Number(props.longitud), Number(props.latitud)])
        .setDOMContent(buildPopup(props, {
          // Solo se ofrece cobrar donde hay saldo; lo demás (asignar, liberar, baja) va en "Gestionar puesto".
          onCollect: site && handlers.onCollect && props.estadoPago === 'deuda' ? () => handlers.onCollect(site) : null,
          onInspect: site && handlers.onInspect ? () => handlers.onInspect(site) : null
        }))
        .addTo(map);
    });
    map.on('click', (event) => {
      if (!handlersRef.current.drawing) return;
      handlersRef.current.onPickLocation?.({ lat: event.lngLat.lat, lng: event.lngLat.lng });
    });
    map.on('click', DOT_LAYER_ID, (event) => {
      const feature = event.features && event.features[0];
      if (!feature || handlersRef.current.drawing || feature === undefined) return;
      const site = siteFromFeature(feature, sitesRef.current);
      handlersRef.current.onSelect?.(site);
    });
    map.on('mouseenter', LAYER_ID, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', LAYER_ID, () => { map.getCanvas().style.cursor = ''; });

    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      popupRef.current?.remove();
      draftMarkerRef.current?.remove();
      userMarkerRef.current?.remove();
      readyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filtros / datos: actualiza la fuente sin recrear el mapa.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.getSource(SOURCE_ID)?.setData(dataRef.current);
    popupRef.current?.remove();
    recenterOnce(map);
  }, [data]);

  // Capa base: al cambiar de estilo hay que reinstalar la capa 3D.
  const lastBase = useRef(baseLayer);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || lastBase.current === baseLayer) return;
    lastBase.current = baseLayer;
    if (!MAPBOX_TOKEN) return;
    map.setStyle(styleFor(baseLayer));
    map.once('style.load', () => installLayers(map));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseLayer]);

  // "Mi ubicación": punto azul y vuelo hasta la posición del usuario.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !userLocation) return;
    const lngLat = [userLocation.lng, userLocation.lat];
    if (!userMarkerRef.current) {
      userMarkerRef.current = new mapboxgl.Marker({ element: el('div', 'user-location-dot') })
        .setPopup(new mapboxgl.Popup({ offset: 14, closeButton: false }));
    }
    userMarkerRef.current.setLngLat(lngLat).addTo(map);
    userMarkerRef.current.getPopup().setText(userLocation.manual ? "Estás aquí (fijado a mano)" : `Estás aquí (precisión ±${Math.round(userLocation.accuracy)} m)`);
    map.flyTo({ center: lngLat, zoom: 18, pitch: DEFAULT_PITCH, duration: 800 });
  }, [userLocation]);

  // Selección externa de un puesto.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedSite) return;
    const lat = Number(selectedSite.latitud);
    const lng = Number(selectedSite.longitud);
    if (Number.isFinite(lat) && Number.isFinite(lng)) map.flyTo({ center: [lng, lat], zoom: 18, pitch: DEFAULT_PITCH, duration: 600 });
  }, [selectedSite]);

  // Pin del nuevo puesto.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    draftMarkerRef.current?.remove();
    draftMarkerRef.current = null;
    if (draftLocation) {
      draftMarkerRef.current = new mapboxgl.Marker({ color: '#0b5ed7' }).setLngLat([draftLocation.lng, draftLocation.lat]).addTo(map);
    }
  }, [draftLocation]);

  return <div ref={containerRef} className="mapbox-25d" data-testid="mapbox-25d" aria-label="Mapa 2.5D de puestos" />;
}
