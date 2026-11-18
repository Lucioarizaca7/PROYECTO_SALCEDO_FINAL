/**
 * Rutas del personal (src/app/navegacion.js) y sugerencia del modo express (src/features/payments/sugerenciaExpress.js).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { canSee, HOME_PATH, navItemByPath, navItems, navItemsFor, pathOf } from '../src/app/navegacion.js';
import { buildExpressSuggestion } from '../src/features/payments/sugerenciaExpress.js';

test('cada página tiene una ruta propia y el panel la ven todos', () => {
  const paths = navItems.flatMap((item) => [item.path, ...(item.aliases ?? [])]);
  assert.equal(new Set(paths).size, paths.length);
  assert.equal(pathOf('dashboard'), HOME_PATH);
  assert.equal(navItemByPath('/pagos').key, 'pagos');
  assert.equal(pathOf('no-existe'), HOME_PATH);
});

test('el menú de cada rol solo muestra lo que su rol puede usar', () => {
  const keys = (rol) => navItemsFor(rol).map((item) => item.key);
  assert.ok(keys('cobrador').includes('pagos'));
  assert.ok(keys('cobrador').includes('mapa'));
  assert.ok(!keys('cobrador').includes('zonas'));
  assert.ok(!keys('auditor').includes('pagos'));
  assert.ok(keys('auditor').includes('revision'));
  // El auditor consulta zonas y tarifas (solo lectura).
  assert.ok(keys('auditor').includes('zonas'));
  assert.ok(!keys('auditor').includes('dispositivos'));
  // Solo el super_admin crea usuarios, los desactiva o les pone clave (decisión del 13/11/2026).
  assert.ok(keys('super_admin').includes('usuarios'));
  assert.ok(!keys('auditor').includes('usuarios'));
  assert.ok(!keys('cobrador').includes('usuarios'));
  // Cada persona del personal cambia su propia clave (13/11/2026).
  for (const rol of ['super_admin', 'cobrador', 'auditor']) assert.ok(keys(rol).includes('mi-clave'), rol);
  assert.deepEqual(keys('super_admin'), navItems.map((item) => item.key));
  assert.equal(canSee(navItems.find((item) => item.key === 'dispositivos'), 'cobrador'), false);
  // El servidor responde 403 al cobrador en /auditoria: el menú no debe ofrecerla.
  assert.ok(!keys('cobrador').includes('auditoria'));
  assert.ok(keys('auditor').includes('auditoria'));
});

test('Zonas y tarifas aparece una vez y conserva los permisos del enlace anterior', () => {
  const zona = navItemByPath('/zonas');
  const enlaceAnterior = navItemByPath('/tarifas');
  assert.equal(enlaceAnterior, zona);
  assert.equal(enlaceAnterior.path, '/zonas');
  assert.equal(zona.label, 'Zonas y tarifas');
  assert.equal(navItems.some((item) => item.path === '/tarifas' || item.key === 'tarifas'), false);
  for (const rol of ['super_admin', 'auditor']) {
    assert.equal(canSee(enlaceAnterior, rol), true);
    assert.equal(navItemsFor(rol).filter((item) => item === zona).length, 1);
  }
  assert.equal(canSee(enlaceAnterior, 'cobrador'), false);
});

test('sin historial, la sugerencia express es el saldo del mes en efectivo', () => {
  const suggestion = buildExpressSuggestion({ id: 901, nombre: 'Sin Historial' }, { saldo: 45.5 }, []);
  assert.equal(suggestion.suggestedAmount, 45.5);
  assert.equal(suggestion.preferredMethod, 'efectivo');
  assert.equal(suggestion.lastPayment, null);
});

test('tres cobros iguales seguidos fijan el monto sugerido; el medio sugerido es siempre efectivo (RN-34)', () => {
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
  assert.equal(suggestion.preferredMethod, 'efectivo', 'el historial fue por Yape, pero ya solo se cobra en efectivo');
  assert.equal(suggestion.lastPayment.fecha_cobro, day(3));
  assert.match(suggestion.lastLabel, /S\/ 20\.00 con YAPE/);
});

test('la sugerencia express toma el último cobro válido, no el más antiguo', () => {
  const merchant = { id: 903, nombre: 'Cliente Cambiante' };
  const history = [
    { comerciante_id: 903, monto: 6, metodo_pago: 'yape', estado: 'confirmado', fecha: '2026-11-02 10:00:00' },
    { comerciante_id: 903, monto: 3, metodo_pago: 'efectivo', estado: 'confirmado', fecha: '2026-11-09 09:30:00' },
    { comerciante_id: 903, monto: 9, metodo_pago: 'plin', estado: 'anulado', fecha: '2026-11-10 08:00:00' }
  ];
  const suggestion = buildExpressSuggestion(merchant, { saldo: 30 }, history);
  assert.equal(suggestion.suggestedAmount, 3);
  assert.equal(suggestion.preferredMethod, 'efectivo');
  assert.match(suggestion.lastLabel, /S\/ 3\.00 con EFECTIVO/);
});
