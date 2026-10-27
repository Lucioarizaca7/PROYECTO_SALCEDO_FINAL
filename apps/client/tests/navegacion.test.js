/**
 * Rutas del personal (src/app/navegacion.js) y sugerencia del modo express (src/features/payments/sugerenciaExpress.js).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { canSee, HOME_PATH, navItemByPath, navItems, navItemsFor, pathOf } from '../src/app/navegacion.js';
import { buildExpressSuggestion } from '../src/features/payments/sugerenciaExpress.js';

test('cada página tiene una ruta propia y el panel la ven todos', () => {
  const paths = navItems.map((item) => item.path);
  assert.equal(new Set(paths).size, paths.length);
  assert.equal(pathOf('dashboard'), HOME_PATH);
  assert.equal(navItemByPath('/pagos').key, 'pagos');
  assert.equal(pathOf('no-existe'), HOME_PATH);
});

test('el menú de cada rol solo muestra lo que su rol puede usar', () => {
  const keys = (rol) => navItemsFor(rol).map((item) => item.key);
  assert.ok(keys('cobrador').includes('pagos'));
  assert.ok(keys('cobrador').includes('mapa'));
  assert.ok(!keys('cobrador').includes('tarifas'));
  assert.ok(!keys('auditor').includes('pagos'));
  assert.ok(keys('auditor').includes('revision'));
  assert.deepEqual(keys('super_admin'), navItems.map((item) => item.key));
  assert.equal(canSee(navItems.find((item) => item.key === 'dispositivos'), 'cobrador'), false);
  // El servidor responde 403 al cobrador en /auditoria: el menú no debe ofrecerla.
  assert.ok(!keys('cobrador').includes('auditoria'));
  assert.ok(keys('auditor').includes('auditoria'));
});

test('sin historial, la sugerencia express es el saldo del mes en efectivo', () => {
  const suggestion = buildExpressSuggestion({ id: 901, nombre: 'Sin Historial' }, { saldo: 45.5 }, []);
  assert.equal(suggestion.suggestedAmount, 45.5);
  assert.equal(suggestion.preferredMethod, 'efectivo');
  assert.equal(suggestion.lastPayment, null);
});

test('tres cobros iguales seguidos fijan el monto y el método sugeridos', () => {
  const merchant = { id: 902, nombre: 'Cliente Fijo' };
  const day = (n) => `2026-10-0${n}T15:00:00.000Z`;
  const history = [
    { comerciante_id: 902, monto: 20, metodo_pago: 'yape', fecha_cobro: day(3) },
    { comerciante_id: 902, monto: 20, metodo_pago: 'yape', fecha_cobro: day(2) },
    { comerciante_id: 902, monto: 20, metodo_pago: 'yape', fecha_cobro: day(1) },
    { comerciante_id: 999, monto: 80, metodo_pago: 'pos', fecha_cobro: day(4) }
  ];
  const suggestion = buildExpressSuggestion(merchant, { saldo: 60 }, history);
  assert.equal(suggestion.suggestedAmount, 20);
  assert.equal(suggestion.preferredMethod, 'yape');
  assert.equal(suggestion.lastPayment.fecha_cobro, day(3));
  assert.match(suggestion.lastLabel, /S\/ 20\.00 con YAPE/);
});
