import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accountStatusText, buildAvenueSample, buildSiteFeatures, filterSites, geolocationErrorMessage, rectangleAround, siteFromFeature, siteProperties, PAYMENT_COLORS
} from '../src/components/features/map/sitesGeo.js';

const { sites, geojson } = buildAvenueSample(12);

test('genera un polígono cerrado de 5 vértices por puesto', () => {
  assert.equal(geojson.features.length, 12);
  for (const feature of geojson.features) {
    const ring = feature.geometry.coordinates[0];
    assert.equal(ring.length, 5);
    assert.deepEqual(ring[0], ring[4]);
    assert.ok(ring.flat().every(Number.isFinite));
  }
});

test('el rectángulo mide ~6 m x 8 m', () => {
  const ring = rectangleAround(-15.9, -70.58, 6, 8)[0];
  const widthM = (ring[1][0] - ring[0][0]) * 111320 * Math.cos((-15.9 * Math.PI) / 180);
  const depthM = (ring[2][1] - ring[1][1]) * 111320;
  assert.ok(Math.abs(widthM - 6) < 0.05);
  assert.ok(Math.abs(depthM - 8) < 0.05);
});

test('los puestos de la avenida son contiguos (se tocan sin solaparse)', () => {
  const [a, b] = geojson.features.map((f) => f.geometry.coordinates[0]);
  assert.ok(Math.abs(a[1][0] - b[0][0]) < 1e-9);
});

test('las propiedades nunca contienen undefined ni NaN', () => {
  const raw = [{ id: 1 }, { id: 2, comerciante: null, saldo_pendiente: 'abc', estadoPago: 'raro', latitud: -15.9, longitud: -70.5 }];
  for (const site of [...raw, ...sites]) {
    const props = siteProperties(site);
    for (const [key, value] of Object.entries(props)) {
      assert.notEqual(value, undefined, key);
      assert.ok(!(typeof value === 'number' && Number.isNaN(value)), key);
    }
    assert.ok(!accountStatusText(props).includes('NaN'));
    assert.ok(Object.values(PAYMENT_COLORS).includes(props.color));
  }
});

test('descarta puestos sin coordenadas válidas', () => {
  const out = buildSiteFeatures([{ id: 1, latitud: null, longitud: null }, { id: 2, latitud: 'x', longitud: 1 }, { id: 3, latitud: -15.9, longitud: -70.5 }]);
  assert.equal(out.features.length, 1);
});

test('color según estado de pago', () => {
  const byState = Object.fromEntries(geojson.features.map((f) => [f.properties.estadoPago, f.properties.color]));
  assert.equal(byState.deuda, '#d94841');
  assert.equal(byState['al-dia'], '#159a68');
  assert.equal(byState['no-devengo'], '#64748b');
});

test('filtros por categoría, estado y búsqueda se combinan', () => {
  assert.equal(filterSites(sites).length, 12);
  assert.equal(filterSites(sites, { paymentStatus: 'deuda' }).length, 4);
  assert.equal(filterSites(sites, { category: 'ferial' }).length, 4);
  assert.equal(filterSites(sites, { category: 'ferial', paymentStatus: 'deuda' }).length, 4 - filterSites(sites, { category: 'ferial', paymentStatus: 'al-dia' }).length - filterSites(sites, { category: 'ferial', paymentStatus: 'no-devengo' }).length);
  assert.equal(filterSites(sites, { query: 's-003' }).length, 1);
  assert.equal(filterSites(sites, { query: 'ZAPATILLAS 12' }).length, 1);
  assert.equal(filterSites(sites, { query: 'inexistente' }).length, 0);
});

test('los filtros actualizan los polígonos que se dibujan', () => {
  const visible = buildSiteFeatures(filterSites(sites, { paymentStatus: 'deuda' }));
  assert.equal(visible.features.length, 4);
  assert.ok(visible.features.every((f) => f.properties.estadoPago === 'deuda'));
});

test('seleccionar un feature devuelve el puesto original', () => {
  const feature = geojson.features[4];
  const site = siteFromFeature(feature, sites);
  assert.equal(site.codigo, 'S-005');
  assert.equal(siteFromFeature({ properties: {} }, sites), null);
  assert.equal(siteFromFeature({ properties: { id: '999' } }, sites), null);
});

test('geolocationErrorMessage explica cada código de error', () => {
  assert.match(geolocationErrorMessage({ code: 1 }), /Permiso/);
  assert.match(geolocationErrorMessage({ code: 2 }), /GPS/);
  assert.match(geolocationErrorMessage({ code: 3 }), /tardó/);
  assert.equal(geolocationErrorMessage({ message: 'x' }), 'x');
});
