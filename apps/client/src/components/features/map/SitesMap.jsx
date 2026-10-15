import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Circle, CircleMarker, MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { filterSites, geolocationErrorMessage } from './sitesGeo';

const SitesMap25D = lazy(() => import('./SitesMap25D'));

const salcedoCenter = [-15.8740, -69.9966]; // centro del plano municipal (DWG)

function MapViewport({ selectedSite, userLocation }) {
  const map = useMap();

  useEffect(() => {
    const refreshMapSize = () => map.invalidateSize({ animate: false });
    refreshMapSize();
    const timer = window.setTimeout(refreshMapSize, 150);

    if (selectedSite) {
      map.flyTo([selectedSite.latitud, selectedSite.longitud], 17, { duration: 0.45 });
    }

    return () => window.clearTimeout(timer);
  }, [map, selectedSite]);

  useEffect(() => {
    if (userLocation) map.flyTo([userLocation.lat, userLocation.lng], 18, { duration: 0.6 });
  }, [map, userLocation]);

  return null;
}

function MapInteractions({ drawing, onLocation }) {
  useMapEvents({
    click: (event) => {
      if (drawing) onLocation(event.latlng);
    }
  });

  return null;
}

function markerIcon(site) {
  const color = site.estadoPago === 'deuda' ? '#d94841' : site.estadoPago === 'no-devengo' ? '#64748b' : '#159a68';
  return L.divIcon({
    className: 'site-marker-wrapper',
    html: `<span class="site-marker" style="--marker-color:${color}">${site.codigo.replace('S-', '')}</span>`,
    iconSize: [42, 42],
    iconAnchor: [21, 38],
    popupAnchor: [0, -34]
  });
}

function categoryLabel(site) {
  return String(site.tipo_comerciante || site.categoria || 'permanente').toLowerCase();
}

export function SitesMap({ sites = [], onCollect, onCreate, onUpdate, onDelete }) {
  const [category, setCategory] = useState('todos');
  const [paymentStatus, setPaymentStatus] = useState('todos');
  const [selectedSite, setSelectedSite] = useState(null);
  const [drawing, setDrawing] = useState(false);
  const [baseLayer, setBaseLayer] = useState('hybrid');
  const [draftLocation, setDraftLocation] = useState(null);
  const [isLocating, setIsLocating] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [locateError, setLocateError] = useState('');
  const [correctingLocation, setCorrectingLocation] = useState(false);
  const watchRef = useRef(null);

  const stopWatching = () => {
    if (watchRef.current) {
      navigator.geolocation.clearWatch(watchRef.current.id);
      window.clearTimeout(watchRef.current.timer);
      watchRef.current = null;
    }
    setIsLocating(false);
  };
  useEffect(() => stopWatching, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [viewMode, setViewMode] = useState('3d');
  const [query, setQuery] = useState('');
  const [draftError, setDraftError] = useState('');
  const [savingDraft, setSavingDraft] = useState(false);

  const normalizedSites = useMemo(() => sites.map((site, index) => {
    const categoriaMapa = categoryLabel(site);
    return {
      ...site,
      latitud: Number(site.latitud ?? salcedoCenter[0] + ((index % 4) - 1.5) * 0.0011),
      longitud: Number(site.longitud ?? salcedoCenter[1] + ((Math.floor(index / 4) % 4) - 1.5) * 0.0012),
      categoriaMapa,
      estadoPago: Number(site.saldo_pendiente || 0) > 0 ? 'deuda' : categoriaMapa === 'ferial' ? 'no-devengo' : 'al-dia'
    };
  }), [sites]);

  const filteredSites = useMemo(
    () => filterSites(normalizedSites, { category, paymentStatus, query }),
    [normalizedSites, category, paymentStatus, query]
  );

  const locateUser = () => {
    if (isLocating) return stopWatching();
    setLocateError('');
    setCorrectingLocation(false);
    if (!window.isSecureContext) {
      setLocateError('El navegador solo permite la ubicación en HTTPS o en localhost.');
      return;
    }
    if (!navigator.geolocation) {
      setLocateError('Este navegador no permite obtener la ubicación.');
      return;
    }
    setIsLocating(true);
    let best = null;
    // Lecturas frescas durante unos segundos: la primera suele ser aproximada (Wi-Fi/IP) y luego mejora.
    const id = navigator.geolocation.watchPosition((position) => {
      const { latitude, longitude, accuracy } = position.coords;
      if (best && accuracy >= best.accuracy) return;
      best = { lat: latitude, lng: longitude, accuracy, at: Date.now() };
      setUserLocation(best);
      if (accuracy <= 20) stopWatching();
    }, (error) => {
      if (error.code === 3 && best) return; // ya hay una posición; se sigue esperando una mejor
      setLocateError(geolocationErrorMessage(error));
      stopWatching();
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    watchRef.current = { id, timer: window.setTimeout(stopWatching, 20000) };
  };

  // Corrección manual: el siguiente clic en el mapa fija tu posición exacta.
  const pickLocation = (latlng) => {
    if (!correctingLocation) return setDraftLocation(latlng);
    stopWatching();
    setUserLocation({ lat: latlng.lat, lng: latlng.lng, accuracy: 0, manual: true, at: Date.now() });
    setCorrectingLocation(false);
  };

  const submitDraft = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setDraftError('');
    setSavingDraft(true);
    try {
      await onCreate?.({
        codigoPuesto: form.get('codigoPuesto'),
        zona_id: form.get('zona_id'),
        comerciante_id: form.get('comerciante_id'),
        direccion: form.get('direccion'),
        metros_cuadrados: form.get('metros_cuadrados'),
        tipo_comerciante: form.get('categoria'),
        latitud: draftLocation.lat,
        longitud: draftLocation.lng
      });
      setDraftLocation(null);
      setDrawing(false);
    } catch (error) {
      // El formulario queda abierto para reintentar sin perder lo escrito.
      setDraftError(error.message || 'No se pudo guardar el puesto');
    } finally {
      setSavingDraft(false);
    }
  };

  return (
    <div className="sites-map-module">
      <div className="map-toolbar">
        <div>
          <strong>Padrón geolocalizado</strong>
          <span>{filteredSites.length} puestos visibles · {navigator.onLine ? 'datos sincronizados' : 'instantánea local'}</span>
        </div>
        <div className="map-filters" aria-label="Filtros del mapa">
          <button type="button" className={`secondary-button compact ${drawing ? 'map-tool-active' : ''}`} onClick={() => { setCorrectingLocation(false); setDrawing((value) => !value); }}>{drawing ? 'Cancelar pin' : 'Nuevo puesto'}</button>
          <button type="button" className="secondary-button compact" onClick={locateUser} title={isLocating ? 'Detener la búsqueda' : 'Centrar el mapa en tu posición'}>{isLocating ? `Localizando…${userLocation ? ` ±${Math.round(userLocation.accuracy)} m` : ''}` : 'Mi ubicación'}</button>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar titular o código" aria-label="Buscar puesto" />
          <select value={viewMode} onChange={(event) => setViewMode(event.target.value)} aria-label="Modo de vista">
            <option value="3d">Vista 2.5D</option>
            <option value="2d">Vista 2D</option>
          </select>
          <select value={baseLayer} onChange={(event) => setBaseLayer(event.target.value)} aria-label="Seleccionar capa base">
            <option value="streets">Mapa de calles</option>
            <option value="hybrid">Vista híbrida</option>
          </select>
          <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filtrar por categoría">
            <option value="todos">Todas las categorías</option>
            <option value="permanente">Permanentes</option>
            <option value="ferial">Feriales</option>
            <option value="eventual">Eventuales</option>
          </select>
          <select value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value)} aria-label="Filtrar por estado de pago">
            <option value="todos">Todos los estados</option>
            <option value="al-dia">Al día</option>
            <option value="deuda">Con deuda</option>
            <option value="no-devengo">No devengo</option>
          </select>
        </div>
      </div>

      {locateError && <p className="form-error" role="alert">{locateError}</p>}
      {correctingLocation ? (
        <p className="map-location-note" role="status">Haz clic en el mapa en el punto exacto donde estás. <button type="button" className="table-action" onClick={() => setCorrectingLocation(false)}>Cancelar</button></p>
      ) : userLocation && !userLocation.manual && !isLocating && userLocation.accuracy > 100 && (
        <p className="map-location-note" role="status">
          Ubicación aproximada (±{userLocation.accuracy >= 1000 ? `${(userLocation.accuracy / 1000).toFixed(1)} km` : `${Math.round(userLocation.accuracy)} m`}): este equipo no tiene GPS y el navegador la estima por Wi-Fi o IP.
          {' '}<button type="button" className="table-action" onClick={() => { setDrawing(false); setCorrectingLocation(true); }}>Corregir en el mapa</button>
        </p>
      )}

      <div className="map-legend" aria-label="Leyenda del mapa">
        <span><i className="legend-dot permanent" /> Permanente</span>
        <span><i className="legend-dot ferial" /> Ferial</span>
        <span><i className="legend-dot eventual" /> Eventual</span>
        <span><i className="legend-dot debt" /> Con deuda</span>
        {userLocation && <span><i className="legend-dot user-location" /> {userLocation.manual ? 'Tu ubicación (fijada a mano)' : `Tu ubicación (±${Math.round(userLocation.accuracy)} m)`}</span>}
      </div>

      <div className="sites-map-canvas">
        {viewMode === '3d' ? (
          <Suspense fallback={<div className="map-loading">Cargando mapa 2.5D…</div>}>
            <SitesMap25D
              sites={filteredSites}
              selectedSite={selectedSite}
              baseLayer={baseLayer}
              drawing={drawing || correctingLocation}
              draftLocation={draftLocation}
              userLocation={userLocation}
              onSelect={setSelectedSite}
              onCollect={onCollect}
              onPickLocation={pickLocation}
            />
          </Suspense>
        ) : (
        <MapContainer center={salcedoCenter} zoom={18} scrollWheelZoom className="leaflet-map">
          <TileLayer
            attribution={baseLayer === 'hybrid' ? '&copy; Google Maps' : '&copy; OpenStreetMap contributors'}
            url={baseLayer === 'hybrid' ? 'https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}' : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'}
            subdomains={baseLayer === 'hybrid' ? ['mt0', 'mt1', 'mt2', 'mt3'] : ['a', 'b', 'c']}
            maxZoom={baseLayer === 'hybrid' ? 20 : 19}
          />
          <MapInteractions drawing={drawing || correctingLocation} onLocation={pickLocation} />
          <MapViewport selectedSite={selectedSite} userLocation={userLocation} />
          {userLocation && (
            <>
              <Circle center={[userLocation.lat, userLocation.lng]} radius={userLocation.accuracy} pathOptions={{ color: '#1a73e8', weight: 1, fillOpacity: 0.12 }} interactive={false} />
              <CircleMarker center={[userLocation.lat, userLocation.lng]} radius={8} pathOptions={{ color: '#ffffff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1 }}>
                <Popup>{userLocation.manual ? "Estás aquí (fijado a mano)" : `Estás aquí (precisión ±${Math.round(userLocation.accuracy)} m)`}</Popup>
              </CircleMarker>
            </>
          )}
          {draftLocation && <Marker position={[draftLocation.lat, draftLocation.lng]} icon={L.divIcon({ className: 'draft-marker', html: '<span>+</span>' })} />}
          {filteredSites.map((site) => (
            <Marker key={site.id} position={[site.latitud, site.longitud]} icon={markerIcon(site)} draggable={Boolean(onUpdate)} eventHandlers={{ click: () => setSelectedSite(site), dragend: (event) => onUpdate?.(site.id, { latitud: event.target.getLatLng().lat, longitud: event.target.getLatLng().lng }) }}>
              <Popup>
                <div className="site-popup">
                  <span className="eyebrow">{site.codigo} · {site.zona}</span>
                  <strong>{site.comerciante}</strong>
                  <span>{site.direccion || 'Ubicación registrada'} · {site.categoriaMapa}</span>
                  <span className={site.estadoPago === 'deuda' ? 'popup-debt' : 'popup-ok'}>
                    {site.estadoPago === 'deuda' ? `Saldo pendiente: S/ ${Number(site.saldo_pendiente).toFixed(2)}` : site.estadoPago === 'no-devengo' ? 'Ferial: no devengo por inasistencia' : 'Cuenta al día'}
                  </span>
                  <button type="button" className="secondary-button compact" onClick={() => onUpdate?.(site.id, { latitud: site.latitud, longitud: site.longitud })}>Guardar posición</button>
                  <button type="button" className="table-action" onClick={() => onDelete?.(site)}>Eliminar puesto</button>
                  <button type="button" className="primary-button compact" onClick={() => onCollect(site)}>Cobrar aquí</button>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
        )}
      </div>
      {draftLocation && (
        <form className="map-edit-form panel" onSubmit={submitDraft}>
          <div className="panel-heading"><div><div className="panel-title">Nuevo puesto</div><div className="panel-subtitle">Pin colocado en {draftLocation.lat.toFixed(5)}, {draftLocation.lng.toFixed(5)}</div></div></div>
          <div className="map-edit-grid">
            <input name="codigoPuesto" required placeholder="Código de puesto" />
            <input name="direccion" required placeholder="Sector o dirección" />
            <input name="zona_id" required defaultValue="1" placeholder="ID de zona" />
            <input name="comerciante_id" required defaultValue="1" placeholder="ID de comerciante" />
            <select name="categoria" defaultValue="permanente"><option value="permanente">Permanente</option><option value="ferial">Ferial</option><option value="eventual">Eventual</option></select>
            <input name="metros_cuadrados" required defaultValue="1" type="number" min="0.1" step="0.1" placeholder="m2" />
            <button type="submit" className="primary-button" disabled={savingDraft}>{savingDraft ? 'Guardando…' : 'Guardar puesto'}</button>
          </div>
          {draftError && <p className="form-error" role="alert">{draftError}</p>}
        </form>
      )}
    </div>
  );
}