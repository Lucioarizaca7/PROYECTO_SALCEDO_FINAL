/**
 * Línea "Tarifa" de Pagos (src/lib/formato.js).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { textoPuntajeRiesgo, textoTarifa } from '../src/lib/formato.js';

test('sin cobro por día muestra el monto de la tarifa', () => {
  assert.equal(textoTarifa({ tarifa: { monto_fijo: 90 } }), 'S/ 90');
  assert.equal(textoTarifa({ tarifa: null, no_devengo: true, dias_asistidos: 0 }), 'Sin días cobrados en el mes');
});

test('con cobro por día: monto de un día × días cobrados, y cada puesto cuenta', () => {
  assert.equal(textoTarifa({ tarifa: { monto_fijo: 3 }, monto_dia: 3, dias_asistidos: 1, puestos_cobrados: [{ puesto_id: 1, dias: 1, monto_dia: 3 }] }), 'S/ 3 × 1 día cobrado');
  assert.equal(textoTarifa({ tarifa: { monto_fijo: 3 }, monto_dia: 3, dias_asistidos: 2, puestos_cobrados: [{ puesto_id: 1, dias: 1, monto_dia: 3 }, { puesto_id: 2, dias: 1, monto_dia: 3 }] }), 'S/ 3 × 2 días cobrados en 2 puestos');
  assert.equal(textoTarifa({ tarifa: { monto_fijo: 3 }, monto_dia: 3, dias_asistidos: 2, puestos_cobrados: [{ puesto_id: 1, dias: 1, monto_dia: 3 }, { puesto_id: 1, dias: 1, monto_dia: 3 }] }), 'S/ 3 × 2 días cobrados', 'un puesto que cambió de zona sigue siendo un puesto');
});

test('puestos con montos distintos muestran el detalle', () => {
  assert.equal(textoTarifa({ monto_dia: null, dias_asistidos: 3, puestos_cobrados: [
    { puesto_id: 1, codigo_puesto: 'S-01', dias: 2, monto_dia: 3 },
    { puesto_id: 2, codigo_puesto: 'T-02', dias: 1, monto_dia: 2 }
  ] }), 'S/ 3 × 2 (S-01) + S/ 2 × 1 (T-02)');
});

test('el riesgo de morosidad dice de cuándo es el puntaje y si se está recalculando', () => {
  // 14:30 UTC = 09:30 en Lima.
  assert.match(textoPuntajeRiesgo({ calculado_el: '2026-11-10T14:30:00.000Z', actualizando: true }), /^Puntaje del 10\/11\/2026, 09:30 .* · actualizando…$/);
  assert.match(textoPuntajeRiesgo({ calculado_el: '2026-11-11T14:30:00.000Z', actualizando: false }), /^Puntaje del 11\/11\/2026, 09:30 [^·]*$/);
  assert.equal(textoPuntajeRiesgo({ calculado_el: null, actualizando: true }), 'Calculando el puntaje…');
  assert.equal(textoPuntajeRiesgo({}), '');
  assert.equal(textoPuntajeRiesgo(), '');
});
