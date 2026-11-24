import test from 'node:test';
import assert from 'node:assert/strict';
import { estadoDeTarifa, primerDiaDePrecioNuevo, sumarDias, zonaQuedaSinPrecio } from '../src/lib/tarifasPorZona.js';

const hoy = '2026-11-18';
const tarifa = { estado: 1, vigencia_inicio: '2026-11-01', vigencia_fin: null };

test('una tarifa es vigente en ambos extremos de sus fechas', () => {
  assert.equal(estadoDeTarifa({ ...tarifa, vigencia_inicio: hoy }, hoy), 'Vigente');
  assert.equal(estadoDeTarifa({ ...tarifa, vigencia_fin: hoy }, hoy), 'Vigente');
});

test('una tarifa habilitada puede estar programada o finalizada', () => {
  assert.equal(estadoDeTarifa({ ...tarifa, vigencia_inicio: '2026-11-19' }, hoy), 'Programada');
  assert.equal(estadoDeTarifa({ ...tarifa, vigencia_fin: '2026-11-17' }, hoy), 'Finalizada');
  assert.equal(estadoDeTarifa(tarifa, hoy), 'Vigente');
});

test('una tarifa desactivada permanece inactiva aunque sus fechas incluyan hoy', () => {
  assert.equal(estadoDeTarifa({ ...tarifa, estado: 0 }, hoy), 'Inactiva');
});

const precio = (id, zona_id, vigencia_inicio, vigencia_fin = null, estado = 1) => ({ id, zona_id, vigencia_inicio, vigencia_fin, estado, unidad_medida: 'dia' });

test('sumarDias cruza fin de mes y de año sin correrse por la hora local', () => {
  assert.equal(sumarDias('2026-11-30', 1), '2026-12-01');
  assert.equal(sumarDias('2026-12-31', 1), '2027-01-01');
  assert.equal(sumarDias('2028-02-28', 1), '2028-02-29');
});

test('un precio nuevo se propone desde hoy si la zona no tiene uno que empiece hoy o después', () => {
  assert.equal(primerDiaDePrecioNuevo([], 7, hoy), hoy);
  assert.equal(primerDiaDePrecioNuevo([precio(1, 7, '2026-10-01')], 7, hoy), hoy);
  // Otra zona o un precio desactivado no cuentan.
  assert.equal(primerDiaDePrecioNuevo([precio(1, 8, hoy), precio(2, 7, '2026-11-25', null, 0)], 7, hoy), hoy);
});

test('si el precio de la zona empezó hoy o está programado, el nuevo empieza al día siguiente (antes chocaba)', () => {
  assert.equal(primerDiaDePrecioNuevo([precio(1, 7, '2026-10-01', '2026-11-17'), precio(2, 7, hoy)], '7', hoy), '2026-11-19');
  assert.equal(primerDiaDePrecioNuevo([precio(1, 7, '2026-10-01', '2026-11-24'), precio(2, 7, '2026-11-25')], 7, hoy), '2026-11-26');
});

test('cerrar un precio sin otro que lo siga deja la zona sin precio desde el día siguiente', () => {
  const actual = precio(1, 7, '2026-10-01');
  assert.equal(zonaQuedaSinPrecio([actual], actual, '2026-11-30'), true);
  assert.equal(zonaQuedaSinPrecio([actual, precio(2, 7, '2026-12-01')], actual, '2026-11-30'), false);
  // Un precio que empieza más tarde deja días sin precio en medio.
  assert.equal(zonaQuedaSinPrecio([actual, precio(2, 7, '2026-12-05')], actual, '2026-11-30'), true);
  assert.equal(zonaQuedaSinPrecio([actual, precio(2, 7, '2026-12-01', null, 0)], actual, '2026-11-30'), true);
  assert.equal(zonaQuedaSinPrecio([actual], actual, ''), false);
});
