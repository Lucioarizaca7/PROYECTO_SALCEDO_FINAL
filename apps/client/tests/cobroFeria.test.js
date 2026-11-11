/**
 * Calculadora pública de la página de inicio (src/lib/cobroFeria.js): la regla vigente de S/ 3 o S/ 2 por
 * puesto y día cobrado, no los metros cuadrados de antes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { calcularCobroFeria } from '../src/lib/cobroFeria.js';

test('S/ 3 por puesto y día en vía asfaltada, S/ 2 sin asfaltar', () => {
  assert.equal(calcularCobroFeria({ via: 'asfaltada', puestos: 1, dias: 4 }).total, 12);
  assert.equal(calcularCobroFeria({ via: 'sin_asfaltar', puestos: 2, dias: 3 }).total, 12);
  assert.equal(calcularCobroFeria({ via: 'sin_asfaltar', puestos: 2, dias: 3 }).tickets, 6);
});

test('sin día cobrado no hay deuda', () => {
  assert.equal(calcularCobroFeria({ via: 'asfaltada', puestos: 3, dias: 0 }).total, 0);
});
