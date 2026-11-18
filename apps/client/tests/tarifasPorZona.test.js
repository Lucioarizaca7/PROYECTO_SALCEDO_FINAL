import test from 'node:test';
import assert from 'node:assert/strict';
import { estadoDeTarifa } from '../src/lib/tarifasPorZona.js';

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
