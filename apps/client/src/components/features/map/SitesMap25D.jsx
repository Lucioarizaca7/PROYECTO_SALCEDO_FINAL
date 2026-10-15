import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { accountStatusText, buildSiteFeatures, siteFromFeature } from './sitesGeo';

const SOURCE_ID = 'puestos';
const LAYER_ID = 'puestos-3d';
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

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
    const button = el('button', 'secondary-button compact', 'Inspeccionar');
    button.type = 'button';
    button.addEventListener('click', onInspect);
    root.append(button);
  }
  return root;
}

export default function SitesMap25D({ sites, selectedSite, baseLayer, drawing, draftLocation, onSelect, onCollect, onInspect, onPickLocation }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const draftMarkerRef = useRef(null);
  const sitesRef = useRef(sites);
  const handlersRef = useRef({});
  const dataRef = useRef({ type: 'FeatureCollection', features: [] });
  const readyRef = useRef(false);
  const centeredRef = useRef(false);

  sitesRef.current = sites;
  handlersRef.current = { onSelect, onCollect, onInspect, onPickLocation, drawing };
  dataRef.current = buildSiteFeatures(sites);

  const installLayers = (map) => {
    if (!map.getSource(SOURCE_ID)) map.addSource(SOURCE_ID, { type: 'geojson', data: dataRef.current });
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
    map.jumpTo({ center: [first.longitud, first.latitud] });
  };

  // Inicialización única.
  useEffect(() => {
    if (MAPBOX_TOKEN) mapboxgl.accessToken = MAPBOX_TOKEN;
    const first = dataRef.current.features[0]?.properties;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: styleFor(baseLayer),
      center: first ? [first.longitud, first.latitud] : [-70.5881, -15.8997],
      zoom: 17.5,
      pitch: 55,
      bearing: -20,
      maxPitch: 75,
      antialias: false
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true, showCompass: true }), 'top-right');

    map.on('style.load', () => {
      installLayers(map);
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
          onCollect: site && handlers.onCollect ? () => handlers.onCollect(site) : null,
          onInspect: site && handlers.onInspect ? () => handlers.onInspect(site) : null
        }))
        .addTo(map);
    });
    map.on('click', (event) => {
      if (!handlersRef.current.drawing) return;
      handlersRef.current.onPickLocation?.({ lat: event.lngLat.lat, lng: event.lngLat.lng });
    });
    map.on('mouseenter', LAYER_ID, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', LAYER_ID, () => { map.getCanvas().style.cursor = ''; });

    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      popupRef.current?.remove();
      draftMarkerRef.current?.remove();
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
  }, [sites]);

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

  // "Mi ubicación" o selección externa.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedSite) return;
    const lat = Number(selectedSite.latitud);
    const lng = Number(selectedSite.longitud);
    if (Number.isFinite(lat) && Number.isFinite(lng)) map.flyTo({ center: [lng, lat], zoom: 18, duration: 600 });
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
