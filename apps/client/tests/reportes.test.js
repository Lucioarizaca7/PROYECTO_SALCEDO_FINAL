import test from 'node:test';
import assert from 'node:assert/strict';
import { periodoDelFiltro, textoDelPeriodo } from '../src/lib/reportes.js';

test('el reporte pide el mes o el día según el alcance elegido', () => {
  assert.equal(periodoDelFiltro({ alcance: 'mes', periodo: '2026-11', dia: '2026-11-23' }), '2026-11');
  assert.equal(periodoDelFiltro({ alcance: 'dia', periodo: '2026-11', dia: '2026-11-23' }), '2026-11-23');
  assert.equal(periodoDelFiltro({ alcance: 'todo', periodo: '2026-11', dia: '2026-11-23' }), '', '«Todo» no manda periodo');
});

test('el título dice el día o el mes del reporte', () => {
  assert.equal(textoDelPeriodo('2026-11-23'), 'del día 23/11/2026');
  assert.equal(textoDelPeriodo('2026-11'), 'de noviembre de 2026');
  assert.equal(textoDelPeriodo(''), 'de todo el registro');
});
