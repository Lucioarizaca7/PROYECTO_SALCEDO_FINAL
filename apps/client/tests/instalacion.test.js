/**
 * Cómo se instala SISREC en el celular (src/pwa/instalacion.js): un toque cuando Chrome lo permite,
 * pasos a mano en iPhone o si el aviso ya se usó, y nada si ya abre como app.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { modoInstalacion } from '../src/pwa/instalacion.js';

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-A145M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

test('ya instalada no ofrece instalar, aunque Chrome mande el aviso', () => {
  assert.equal(modoInstalacion({ standalone: true, hayAviso: true, userAgent: ANDROID }), 'instalada');
  assert.equal(modoInstalacion({ standalone: true, hayAviso: false, userAgent: IPHONE }), 'instalada');
});

test('con el aviso de Chrome se instala con un toque', () => {
  assert.equal(modoInstalacion({ standalone: false, hayAviso: true, userAgent: ANDROID }), 'directa');
});

test('sin aviso: pasos de Safari en iPhone y del menú ⋮ en lo demás', () => {
  assert.equal(modoInstalacion({ standalone: false, hayAviso: false, userAgent: IPHONE }), 'ios');
  assert.equal(modoInstalacion({ standalone: false, hayAviso: false, userAgent: ANDROID }), 'manual');
  assert.equal(modoInstalacion({ standalone: false, hayAviso: false }), 'manual');
});
