import test from 'node:test';
import assert from 'node:assert/strict';
import { diasDelPeriodo, marcasEje, mesCorto, mesesDeProyeccion, puestosPorEstado, riesgoPorNivel, ORDEN_ESTADOS_PUESTO } from '../src/lib/graficos.js';

test('el eje usa números redondos y cubre el máximo', () => {
  assert.deepEqual(marcasEje(57), [0, 20, 40, 60]);
  assert.deepEqual(marcasEje(8), [0, 2, 4, 6, 8]);
  assert.deepEqual(marcasEje(0), [0, 1]);
  const marcas = marcasEje(1234);
  assert.ok(marcas[marcas.length - 1] >= 1234);
});

test('el mes trae todos sus días, con cero los días sin cobros', () => {
  const dias = diasDelPeriodo('2026-11', [{ dia: '2026-11-03', recaudado: '12.00', pagos: 4 }]);
  assert.equal(dias.length, 30);
  assert.deepEqual(dias[2], { dia: '2026-11-03', numero: 3, valor: 12, pagos: 4 });
  assert.equal(dias[0].valor, 0);
  assert.equal(diasDelPeriodo('2028-02').length, 29);
  assert.deepEqual(diasDelPeriodo(''), []);
});

test('los puestos se cuentan por estado como en el mapa, sin los dados de baja', () => {
  const filas = puestosPorEstado([
    { comerciante_id: null, estado: 'disponible' },
    { comerciante_id: 1, estado: 'ocupado', estado_pago: 'pendiente', saldo_pendiente: 3 },
    { comerciante_id: 2, estado: 'ocupado', estado_pago: 'pagado' },
    { comerciante_id: 3, estado: 'inactivo', estado_pago: 'pendiente', saldo_pendiente: 3 }
  ]);
  assert.deepEqual(filas.map((f) => f.clave), ORDEN_ESTADOS_PUESTO);
  assert.equal(filas.find((f) => f.clave === 'libre').valor, 1);
  assert.equal(filas.reduce((s, f) => s + f.valor, 0), 3);
});

test('la proyección sigue al último mes cobrado, con su margen de error y lo cobrado del mes en curso', () => {
  const meses = mesesDeProyeccion({
    serie: [{ periodo: '2026-09', monto: 100 }, { periodo: '2026-10', monto: 120 }],
    proyeccion: [130, 140, 150], periodo: '2026-11', mape: 10, cobradoEnCurso: 42
  });
  assert.deepEqual(meses.map((m) => [m.periodo, m.tipo]), [
    ['2026-09', 'cobrado'], ['2026-10', 'cobrado'], ['2026-11', 'proyectado'], ['2026-12', 'proyectado'], ['2027-01', 'proyectado']
  ]);
  assert.equal(meses[2].minimo, 117);
  assert.equal(meses[2].maximo, 143);
  assert.equal(meses[2].enCurso, 42, 'el mes en curso muestra lo cobrado hasta hoy');
  assert.equal(meses[3].enCurso, null);
  assert.equal(mesCorto('2027-01'), 'ene 27');
});

test('sin error medido no hay margen, y sin historia la proyección empieza en el periodo', () => {
  const meses = mesesDeProyeccion({ serie: [], proyeccion: [0, 0], periodo: '2026-11', mape: null });
  assert.deepEqual(meses.map((m) => m.periodo), ['2026-11', '2026-12']);
  assert.equal(meses[0].minimo, null);
});

test('el riesgo se reparte en los cuatro niveles, en orden de menor a mayor', () => {
  const niveles = riesgoPorNivel({ bajo: 40, medio: 8, alto: 3, critico: 1 });
  assert.deepEqual(niveles.map((n) => [n.clave, n.valor]), [['bajo', 40], ['medio', 8], ['alto', 3], ['critico', 1]]);
  assert.deepEqual(riesgoPorNivel(undefined).map((n) => n.valor), [0, 0, 0, 0]);
});
