/**
 * Textos y reglas de la Etapa 3 en el cliente (src/lib/deuda.js).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { numeroAviso, primerDiaReclamable, puedeResolverAnulacion, textoAviso } from '../src/lib/deuda.js';

test('el aviso de deuda lleva número, nombre, código, monto y desde cuándo; nunca el DNI', () => {
  const aviso = { id: 7, comerciante: 'Rosa Quispe', comerciante_codigo: 'COM-0004-123', deuda: 36, dia_impago: '2026-09-03', emitido_en: '2026-11-15 10:20:00' };
  assert.equal(numeroAviso(7), 'A-000007');
  const texto = textoAviso(aviso);
  assert.match(texto, /^Aviso de deuda A-000007\. Rosa Quispe \(COM-0004-123\): al 2026-11-15 debe S\/ 36\.00/);
  assert.match(texto, /desde el 2026-09-03/);
  assert.match(texto, /reclamo/);
});

test('la anulación la resuelve el otro super administrador, no quien la pidió', () => {
  assert.equal(puedeResolverAnulacion({ solicitado_por_id: 1 }, 1), false);
  assert.equal(puedeResolverAnulacion({ solicitado_por_id: 1 }, '5'), true);
});

test('se reclama hasta 7 días atrás, también cruzando el mes', () => {
  assert.equal(primerDiaReclamable('2026-11-15'), '2026-11-08');
  assert.equal(primerDiaReclamable('2026-11-03'), '2026-10-27');
});
