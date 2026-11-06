/**
 * Asistencia ferial en el celular (src/services/asistenciaOffline.js).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { aplicarMarca, estadoDelDia, ferialesDelPadron, marcarEnviadas, marcasPendientes, observacionQueSeConserva } from '../src/services/asistenciaOffline.js';
import { normalizarComerciante } from '../src/services/jornadaOffline.js';

const padron = [
  { id: 1, nombre: 'Zoila Ferial', tipo_comerciante: 'ferial', codigo_puesto: 'ZAP-02', puesto_ferial_id: 12 },
  { id: 2, nombre: 'Ana Ferial', tipo_comerciante: 'ferial', codigo_puesto: 'ZAP-01', puesto_ferial_id: 11 },
  { id: 3, nombre: 'Sin Puesto', tipo_comerciante: 'ferial', puesto_ferial_id: null },
  { id: 4, nombre: 'Permanente', tipo_comerciante: 'permanente', codigo_puesto: 'S-01' },
  // Permanente con tarifa por día cobrado: el servidor le entrega el puesto donde se marca.
  { id: 5, nombre: 'Permanente Por Día', tipo_comerciante: 'permanente', codigo_puesto: 'ZAP-03', puesto_ferial_id: 13 }
].map((item) => normalizarComerciante(item));

test('lista a quienes cobran por día con puesto, ordenados por puesto', () => {
  assert.deepEqual(ferialesDelPadron(padron).map((item) => item.puestoFerialId), [11, 12, 13]);
});

test('las marcas valen solo el día en que se hicieron', () => {
  const ayer = aplicarMarca(estadoDelDia(null, '2026-11-09'), 11, true);
  assert.deepEqual(estadoDelDia(ayer, '2026-11-10').marcas, {});
  assert.equal(estadoDelDia(ayer, '2026-11-09'), ayer);
});

test('las pendientes se suben una vez y un cambio posterior vuelve a quedar pendiente', () => {
  let estado = estadoDelDia(null, '2026-11-10');
  estado = aplicarMarca(estado, 11, true);
  estado = aplicarMarca(estado, 12, false);
  const pendientes = marcasPendientes(estado);
  assert.deepEqual(pendientes, [
    { puesto_id: 11, fecha: '2026-11-10', asistio: true },
    { puesto_id: 12, fecha: '2026-11-10', asistio: false }
  ]);

  // Mientras se subía, el cobrador corrigió el puesto 12: esa marca sigue pendiente.
  const corregido = aplicarMarca(estado, 12, true);
  const tras = marcarEnviadas(corregido, pendientes);
  assert.equal(tras.marcas['11'].enviado, true);
  assert.deepEqual(marcasPendientes(tras), [{ puesto_id: 12, fecha: '2026-11-10', asistio: true }]);
});

test('la observación del cobrador viaja con la marca y un cambio de nota vuelve a quedar pendiente', () => {
  let estado = estadoDelDia(null, '2026-11-10');
  estado = aplicarMarca(estado, 11, true, new Date('2026-11-10T15:00:00Z'), { motivo: 'no_vendio', observacion: '  Dice que no vendió  ' });
  const pendientes = marcasPendientes(estado);
  assert.deepEqual(pendientes, [{ puesto_id: 11, fecha: '2026-11-10', asistio: true, motivo: 'no_vendio', observacion: 'Dice que no vendió' }]);

  const otraNota = aplicarMarca(estado, 11, true, new Date(), { motivo: 'no_vendio', observacion: 'Volver el domingo' });
  assert.equal(marcarEnviadas(otraNota, pendientes).marcas['11'].enviado, false);
  assert.equal(marcarEnviadas(estado, pendientes).marcas['11'].enviado, true);
});

test('volver a tocar Asistió o Faltó conserva la observación solo si sigue siendo coherente', () => {
  const noVendio = { asistio: true, motivo: 'no_vendio', observacion: 'Dice que no vendió' };
  assert.deepEqual(observacionQueSeConserva(noVendio, true), { motivo: 'no_vendio', observacion: 'Dice que no vendió' });
  assert.deepEqual(observacionQueSeConserva(noVendio, false), {}, '"no vendió" no puede ir con una falta');
  assert.deepEqual(observacionQueSeConserva({ asistio: false, motivo: 'no_salio' }, true), {});
  assert.deepEqual(observacionQueSeConserva({ asistio: true, motivo: 'otro', observacion: 'Llegó tarde' }, false), { motivo: 'otro', observacion: 'Llegó tarde' });
  assert.deepEqual(observacionQueSeConserva({ asistio: true }, false), {});
  assert.deepEqual(observacionQueSeConserva(undefined, true), {});
});
