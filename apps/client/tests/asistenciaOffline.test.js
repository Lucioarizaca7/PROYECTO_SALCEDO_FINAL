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

test('otro día empieza vacío, pero lo de ayer que no subió se sigue enviando con su fecha', () => {
  let ayer = aplicarMarca(estadoDelDia(null, '2026-11-09'), 11, true);
  ayer = aplicarMarca(ayer, 12, false, new Date(), { motivo: 'no_salio' });
  ayer = marcarEnviadas(ayer, [{ puesto_id: 12, fecha: '2026-11-09', asistio: false, motivo: 'no_salio' }]);
  const hoy = estadoDelDia(ayer, '2026-11-10');
  assert.deepEqual(hoy.marcas, {});
  // Antes se perdía: un día entero sin señal no generaba deuda.
  assert.deepEqual(marcasPendientes(hoy), [{ puesto_id: 11, fecha: '2026-11-09', asistio: true }]);
  assert.deepEqual(estadoDelDia(ayer, '2026-11-09').marcas, ayer.marcas);

  // Pasan dos días sin señal: sigue pendiente, y una vez subida ya no se reenvía.
  const pasado = estadoDelDia(aplicarMarca(hoy, 13, true), '2026-11-11');
  assert.deepEqual(marcasPendientes(pasado).map((item) => [item.puesto_id, item.fecha]), [[11, '2026-11-09'], [13, '2026-11-10']]);
  const subido = marcarEnviadas(pasado, marcasPendientes(pasado));
  assert.deepEqual(marcasPendientes(subido), []);
});

test('una marca rechazada por el servidor no se reintenta y queda con su motivo', () => {
  let estado = aplicarMarca(estadoDelDia(null, '2026-11-10'), 11, true);
  estado = aplicarMarca(estado, 12, true);
  estado = { ...estado, anteriores: [{ puesto_id: 14, fecha: '2026-11-01', asistio: true }] };
  const rechazadas = [
    { puesto_id: 12, fecha: '2026-11-10', error: 'Ana está dada de baja' },
    { puesto_id: 14, fecha: '2026-11-01', error: 'tiene más de 3 días' }
  ];
  const despues = marcarEnviadas(estado, [{ puesto_id: 11, fecha: '2026-11-10', asistio: true }], rechazadas);
  assert.deepEqual(marcasPendientes(despues), []);
  assert.equal(despues.marcas['12'].rechazo, 'Ana está dada de baja');
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
