/**
 * Reglas de caja del cliente (src/lib/caja.js): cuándo se pide justificación y el texto de la constancia.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { mediosDeCaja, numeroConstancia, pideJustificacion, textoConstancia } from '../src/lib/caja.js';

test('la caja muestra solo efectivo; Yape, Plin y POS salen si ese día tienen algún monto (RN-34)', () => {
  const metodos = [{ key: 'efectivo' }, { key: 'yape' }, { key: 'plin' }, { key: 'pos' }];
  const claves = (esperado, declarado = {}) => mediosDeCaja(metodos, (key) => [esperado[key], declarado[key]]).map(({ key }) => key);
  assert.deepEqual(claves({ efectivo: 0, yape: 0, plin: 0, pos: 0 }), ['efectivo']);
  assert.deepEqual(claves({ efectivo: 5, yape: 1.5, plin: 0, pos: 0 }), ['efectivo', 'yape'], 'un Yape sin señal que entró observado');
  assert.deepEqual(claves({ efectivo: 5 }, { pos: '2' }), ['efectivo', 'pos'], 'un cierre anterior que declaró POS');
});

test('se justifica cualquier faltante y un sobrante desde S/ 5', () => {
  assert.equal(pideJustificacion(0), false);
  assert.equal(pideJustificacion(4.99), false);
  assert.equal(pideJustificacion(5), true);
  assert.equal(pideJustificacion(-0.1), true);
});

test('la constancia dice quién recibió, de quién, cuánto y por qué caja', () => {
  const cierre = { cobrador: 'Cobrador Principal', fecha: '2026-11-15' };
  const entrega = { id: 12, tipo: 'cierre', monto: 6, recibido_por: 'Administrador', recibido_en: '2026-11-15 18:30:00' };
  assert.equal(numeroConstancia(12), 'E-000012');
  assert.equal(textoConstancia(cierre, entrega),
    'Constancia E-000012: Administrador recibió de Cobrador Principal S/ 6.00 en efectivo, por la caja del 2026-11-15 (entrega del cierre). Registrado el 2026-11-15 18:30:00.');
  assert.match(textoConstancia(cierre, { ...entrega, tipo: 'complementaria' }), /entrega complementaria/);
});
