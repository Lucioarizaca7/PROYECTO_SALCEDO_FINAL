/**
 * Lectura de la llave del carnet desde el QR del reverso (src/features/portal/llaveQr.js).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { llaveDelFragmento, llaveDesdeQr } from '../src/features/portal/llaveQr.js';

test('lee la llave del enlace del QR del reverso', () => {
  assert.equal(llaveDesdeQr('https://salcedo.gob.pe/portal#llave=K7QM-4XPR-9T'), 'K7QM-4XPR-9T');
  assert.equal(llaveDesdeQr('http://localhost:5173/portal#llave=k7qm4xpr9t'), 'K7QM-4XPR-9T');
});

test('acepta la llave sola, con o sin guiones', () => {
  assert.equal(llaveDesdeQr(' k7qm-4xpr-9t '), 'K7QM-4XPR-9T');
});

test('rechaza el QR del frente y textos que no son una llave', () => {
  assert.equal(llaveDesdeQr('SISREC://comerciante/CM-012'), '');
  assert.equal(llaveDesdeQr('https://salcedo.gob.pe/portal'), '');
  // 0, O, 1, I y L no existen en la llave: se imprimen sin ambigüedad.
  assert.equal(llaveDesdeQr('K7QM-4XPR-0O'), '');
  assert.equal(llaveDesdeQr(''), '');
});

test('el fragmento de la barra de direcciones trae la llave', () => {
  assert.equal(llaveDelFragmento('#llave=K7QM-4XPR-9T'), 'K7QM-4XPR-9T');
  assert.equal(llaveDelFragmento(''), '');
});
