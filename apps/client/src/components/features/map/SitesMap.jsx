import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Circle, CircleMarker, MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { filterSites, geolocationErrorMessage, mapPaymentStatus, paymentStatusText, PAYMENT_COLORS, PAYMENT_LABELS } from './sitesGeo';

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
  const color = PAYMENT_COLORS[site.estadoPago] || PAYMENT_COLORS['al-dia'];
  return L.divIcon({
    className: 'site-marker-wrapper',
    html: `<span class="site-marker" style="--marker-color:${color}">${site.codigo.replace('S-', '')}</span>`,
    iconSize: [42, 42],
    iconAnchor: [21, 38],
    popupAnchor: [0, -34]
  });
}

function categoryLabel(site) {
  if (!site.comerciante_id && !site.tipo_comerciante && !site.categoria) return 'sin titular';
  return String(site.tipo_comerciante || site.categoria || 'permanente').toLowerCase();
}

const merchantLabel = (merchant) => [merchant.nombre, merchant.dni_ruc, merchant.codigo].filter(Boolean).join(' · ');

// Titular elegido por nombre, DNI/RUC o código: busca en el servidor mientras se escribe
// (el padrón completo no está en memoria). value = { text, merchant }; vacío = sin titular.
function TitularPicker({ id, value, onChange, searchMerchants, placeholder }) {
  const [options, setOptions] = useState([]);

  useEffect(() => {
    const query = value.text.trim();
    if (!searchMerchants || query.length < 2 || value.merchant) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const found = await searchMerchants(query);
        if (!cancelled) setOptions(found);
      } catch {
        if (!cancelled) setOptions([]);
      }
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [value.text, value.merchant, searchMerchants]);

  return (
    <>
      <input
        list={id}
        value={value.text}
        onChange={(event) => {
          const text = event.target.value;
          onChange({ text, merchant: options.find((item) => merchantLabel(item) === text) || null });
        }}
        placeholder={placeholder}
        aria-label="Comerciante titular"
        autoComplete="off"
      />
      <datalist id={id}>
        {options.map((item) => <option key={item.id} value={merchantLabel(item)} />)}
      </datalist>
    </>
  );
}

const emptyTitular = { text: '', merchant: null };

export function SitesMap({ sites = [], zonas = [], searchMerchants, onCollect, onCreate, onUpdate, onDelete, onAssign, onRelease }) {
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
  const [draftTitular, setDraftTitular] = useState(emptyTitular);
  const [assignTitular, setAssignTitular] = useState(emptyTitular);
  const [detailError, setDetailError] = useState('');
  const [detailBusy, setDetailBusy] = useState(false);
  const detailRef = useRef(null);

  const normalizedSites = useMemo(() => sites.map((site, index) => ({
    ...site,
    latitud: Number(site.latitud ?? salcedoCenter[0] + ((index % 4) - 1.5) * 0.0011),
    longitud: Number(site.longitud ?? salcedoCenter[1] + ((Math.floor(index / 4) % 4) - 1.5) * 0.0012),
    categoriaMapa: categoryLabel(site),
    estadoPago: mapPaymentStatus(site)
  })), [sites]);

  // El puesto seleccionado se lee de la lista vigente: tras asignar, liberar o cobrar se ve el dato nuevo.
  const currentSite = selectedSite ? normalizedSites.find((site) => String(site.id) === String(selectedSite.id)) || null : null;

  useEffect(() => {
    setAssignTitular(emptyTitular);
    setDetailError('');
  }, [selectedSite?.id]);

  const inspectSite = (site) => {
    setSelectedSite(site);
    window.setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
  };

  const runDetailAction = async (action) => {
    setDetailError('');
    setDetailBusy(true);
    try {
      await action();
    } catch (error) {
      setDetailError(error.message || 'No se pudo completar la acción');
    } finally {
      setDetailBusy(false);
    }
  };

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
    if (draftTitular.text.trim() && !draftTitular.merchant) {
      setDraftError('Elige el titular de la lista, o deja el campo vacío para registrar un puesto libre.');
      return;
    }
    setSavingDraft(true);
    try {
      await onCreate?.({
        codigoPuesto: form.get('codigoPuesto'),
        zona_id: form.get('zona_id'),
        comerciante_id: draftTitular.merchant?.id ?? null,
        direccion: form.get('direccion'),
        metros_cuadrados: form.get('metros_cuadrados'),
        latitud: draftLocation.lat,
        longitud: draftLocation.lng
      });
      setDraftLocation(null);
      setDraftTitular(emptyTitular);
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
          <span>{filteredSites.length} {filteredSites.length === 1 ? 'puesto visible' : 'puestos visibles'} · {navigator.onLine ? 'datos sincronizados' : 'instantánea local'}</span>
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
            {Object.entries(PAYMENT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
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
        {Object.entries(PAYMENT_LABELS).map(([key, label]) => (
          <span key={key}><i className="legend-dot" style={{ background: PAYMENT_COLORS[key] }} /> {label}</span>
        ))}
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
              onInspect={inspectSite}
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
                  <strong>{site.comerciante || 'Sin titular'}</strong>
                  <span>{site.direccion || 'Ubicación registrada'} · {site.categoriaMapa}</span>
                  <span className={site.estadoPago === 'deuda' ? 'popup-debt' : 'popup-ok'}>{paymentStatusText(site)}</span>
                  {site.estadoPago === 'deuda' && <button type="button" className="primary-button compact" onClick={() => onCollect(site)}>Cobrar aquí</button>}
                  <button type="button" className="secondary-button compact" onClick={() => inspectSite(site)}>Gestionar puesto</button>
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
            <input name="codigoPuesto" placeholder="Código (vacío = se genera)" aria-label="Código de puesto" />
            <input name="direccion" required placeholder="Sector o dirección" aria-label="Sector o dirección" />
            <select name="zona_id" required defaultValue={zonas[0]?.id ?? ''} aria-label="Zona">
              {!zonas.length && <option value="">Sin zonas registradas</option>}
              {zonas.map((zona) => <option key={zona.id} value={zona.id}>{zona.nombre}</option>)}
            </select>
            <TitularPicker id="titular-nuevo-puesto" value={draftTitular} onChange={setDraftTitular} searchMerchants={searchMerchants} placeholder="Titular: nombre, DNI o código (vacío = libre)" />
            <input name="metros_cuadrados" required defaultValue="1" type="number" min="0.1" step="0.1" placeholder="m²" aria-label="Metros cuadrados" />
            <button type="submit" className="primary-button" disabled={savingDraft}>{savingDraft ? 'Guardando…' : 'Guardar puesto'}</button>
          </div>
          <p className="map-form-hint">
            {draftTitular.merchant
              ? `Categoría: ${draftTitular.merchant.tipo_comerciante || draftTitular.merchant.categoria || 'permanente'} (la define el comerciante).`
              : 'Sin titular el puesto queda libre; luego se le puede asignar un comerciante.'}
          </p>
          {draftError && <p className="form-error" role="alert">{draftError}</p>}
        </form>
      )}
      {currentSite && !draftLocation && (
        <section className="map-edit-form panel" ref={detailRef} aria-label={`Puesto ${currentSite.codigo}`}>
          <div className="panel-heading">
            <div>
              <div className="panel-title">Puesto {currentSite.codigo} · {currentSite.zona}</div>
              <div className="panel-subtitle">
                {currentSite.comerciante ? `${currentSite.comerciante} · ${currentSite.categoriaMapa}` : 'Libre, sin titular'} · {currentSite.direccion || 'Sin dirección'}
              </div>
            </div>
            <button type="button" className="table-action" onClick={() => setSelectedSite(null)}>Cerrar</button>
          </div>
          <p className={currentSite.estadoPago === 'deuda' ? 'popup-debt' : 'popup-ok'}>
            {paymentStatusText(currentSite)}
            {currentSite.monto_total > 0 && ` · Cuota: S/ ${Number(currentSite.monto_total).toFixed(2)} · Pagado: S/ ${Number(currentSite.monto_pagado).toFixed(2)}`}
          </p>
          <div className="map-edit-grid">
            {currentSite.estadoPago === 'deuda' && (
              <button type="button" className="primary-button" onClick={() => onCollect?.(currentSite)}>Cobrar aquí</button>
            )}
            {currentSite.comerciante_id ? (
              <button type="button" className="secondary-button" disabled={detailBusy} onClick={() => runDetailAction(() => onRelease?.(currentSite))}>Liberar puesto</button>
            ) : (
              <>
                <TitularPicker id="titular-asignar" value={assignTitular} onChange={setAssignTitular} searchMerchants={searchMerchants} placeholder="Buscar comerciante para asignar" />
                <button
                  type="button"
                  className="primary-button"
                  disabled={detailBusy || !assignTitular.merchant}
                  onClick={() => runDetailAction(async () => {
                    await onAssign?.(currentSite, assignTitular.merchant.id);
                    setAssignTitular(emptyTitular);
                  })}
                >
                  Asignar comerciante
                </button>
              </>
            )}
            <button type="button" className="table-action peligro" disabled={detailBusy} onClick={() => runDetailAction(() => onDelete?.(currentSite))}>Dar de baja</button>
          </div>
          {detailError && <p className="form-error" role="alert">{detailError}</p>}
        </section>
      )}
    </div>
  );
}