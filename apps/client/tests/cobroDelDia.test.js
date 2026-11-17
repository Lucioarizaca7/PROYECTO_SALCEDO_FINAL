/**
 * Puestos del día al cobrar (RN-22) y zona del día en un puesto sin zona confirmada (RN-05): src/lib/cobroDelDia.js.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { faltaZonaDelDia, montoDePuestos, puestosParaElegir, requeridosConPuestos } from '../src/lib/cobroDelDia.js';

const puestos = [
  { id: 1, codigo: 'A-01', zona_id: 10, zona_por_confirmar: false },
  { id: 2, codigo: 'A-02', zona_id: 10, zona_por_confirmar: false },
  { id: 3, codigo: 'B-07', zona_id: 20, zona_por_confirmar: true }
];
const S3 = { serie: 'S3', valor: 3 };
const S2 = { serie: 'S2', valor: 2 };
const serieDePuesto = (puesto) => (puesto.zona_id === 10 ? S3 : S2);

test('se elige entre los puestos solo con dos o más y sin marca de hoy', () => {
  assert.deepEqual(puestosParaElegir({ puestos, marcado_hoy: false }, true), puestos);
  assert.deepEqual(puestosParaElegir({ puestos, marcado_hoy: true }, true), [], 'con marca mandan las marcas');
  assert.deepEqual(puestosParaElegir({ puestos: puestos.slice(0, 1), marcado_hoy: false }, true), []);
  assert.deepEqual(puestosParaElegir({ puestos, marcado_hoy: false }, false), [], 'un mes atrasado no marca el día');
  assert.deepEqual(puestosParaElegir(null, true), []);
});

test('cada puesto elegido suma un ticket de la serie de su zona; el principal ya venía contado', () => {
  const base = [{ serie: 'S3', valor: 3, cantidad: 1 }];
  assert.deepEqual(requeridosConPuestos(base, { puestos, elegidos: [1, 2, 3], serieDePuesto }),
    [{ serie: 'S3', valor: 3, cantidad: 2 }, { serie: 'S2', valor: 2, cantidad: 1 }]);
  assert.deepEqual(requeridosConPuestos(base, { puestos, elegidos: [1], serieDePuesto }), base);
  assert.deepEqual(requeridosConPuestos(base, { puestos, elegidos: [3], serieDePuesto }),
    [{ serie: 'S3', valor: 3, cantidad: 0 }, { serie: 'S2', valor: 2, cantidad: 1 }], 'el principal no abrió');
  assert.deepEqual(base, [{ serie: 'S3', valor: 3, cantidad: 1 }], 'no cambia la lista recibida');
});

test('con zona del día todos los puestos elegidos van a la serie de esa zona', () => {
  const base = [{ serie: 'S2', valor: 2, cantidad: 1 }, { serie: 'S3', valor: 3, cantidad: 0 }];
  assert.deepEqual(requeridosConPuestos(base, { puestos, elegidos: [1, 2, 3], serieDePuesto, serieZona: S2 }),
    [{ serie: 'S2', valor: 2, cantidad: 3 }, { serie: 'S3', valor: 3, cantidad: 0 }]);
});

test('sin tickets, el monto de hoy es la suma del precio de cada puesto elegido', () => {
  const precioDePuesto = (puesto) => (puesto.zona_id === 10 ? 3 : 2);
  assert.equal(montoDePuestos({ puestos, elegidos: [1, 3], precioDePuesto }), 5);
  assert.equal(montoDePuestos({ puestos, elegidos: [1, 2, 3], precioDePuesto, precioZona: 2 }), 6);
  assert.equal(montoDePuestos({ puestos, elegidos: [3], precioDePuesto: () => null }), null, 'una zona sin precio no se suma a ciegas');
});

test('un puesto sin zona confirmada pide la zona de hoy, salvo que ya esté marcado', () => {
  const delDia = { puestos, marcado_hoy: false };
  assert.equal(faltaZonaDelDia(delDia, { elegidos: [1, 2] }), false);
  assert.equal(faltaZonaDelDia(delDia, { elegidos: [1, 3] }), true);
  assert.equal(faltaZonaDelDia(delDia, { elegidos: [1, 3], zonaDia: '20' }), false);
  assert.equal(faltaZonaDelDia({ puestos, marcado_hoy: true }, { elegidos: [3] }), false);
  // Sin selector, el cobro marca el puesto principal.
  assert.equal(faltaZonaDelDia({ puestos: [puestos[2]], marcado_hoy: false }), true);
  assert.equal(faltaZonaDelDia({ puestos: [puestos[0]], marcado_hoy: false }), false);
  assert.equal(faltaZonaDelDia(delDia, { elegidos: [3], cobraHoy: false }), false);
});
