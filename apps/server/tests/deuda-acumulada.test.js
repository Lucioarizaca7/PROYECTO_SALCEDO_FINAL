/**
 * Deuda acumulada de permanentes (migrations/0011_deuda_acumulada.sql): meses impagos desde el alta,
 * nunca antes de inicio_cobro, y pagos aplicados a un mes anterior.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  initializeDatabase, insertComerciante, insertPuesto, insertTarifa, calcularDeudaAcumulada, calcularLiquidacion,
  registrarCobro, setInicioCobro, getInicioCobro, currentPeriod
} from '../src/db.js';

let documento = 20666000000;

const restarMeses = (periodo, n) => {
  const [anio, mes] = periodo.split('-').map(Number);
  const total = anio * 12 + (mes - 1) - n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
};

async function permanenteDesde(db, altaPeriodo, montoMensual = 30) {
  const nombre = `rubro deuda ${process.pid} ${Date.now()} ${Math.random().toString(16).slice(2, 6)}`;
  const rubroId = (await db.query('INSERT INTO rubros (nombre) VALUES ($1) RETURNING id', [nombre])).rows[0].id;
  await insertTarifa(db, { rubro_id: rubroId, tipo_tarifa: 'fija', monto_fijo: montoMensual, unidad_medida: 'mensual', vigencia_inicio: '2020-01-01' });
  const comerciante = await insertComerciante(db, {
    dni_ruc: String(documento += 1), nombre: `Permanente Deuda ${documento}`, rubro_id: rubroId, zona_id: 1,
    tipo_comerciante: 'permanente', estado: 'activo', usuario_creador: 1
  });
  await insertPuesto(db, { zona_id: 1, metros_cuadrados: 1, direccion: `Deuda ${documento}`, comerciante_id: comerciante.id });
  await db.query(`UPDATE comerciantes SET creado_en = ($2 || '-10 12:00')::timestamp AT TIME ZONE 'America/Lima' WHERE id = $1`, [comerciante.id, altaPeriodo]);
  return comerciante;
}

test('suma los meses impagos desde el inicio de cobro y un pago puede cancelar el mes más antiguo', async () => {
  const db = await initializeDatabase();
  const actual = currentPeriod();
  const inicio = restarMeses(actual, 3);
  await setInicioCobro(db, inicio, { usuarioId: 1 });
  assert.equal(await getInicioCobro(db), inicio);

  // Dado de alta hace un año: la deuda empieza en inicio_cobro, no en su alta.
  const antiguo = await permanenteDesde(db, restarMeses(actual, 12));
  const deuda = await calcularDeudaAcumulada(db, antiguo.id);
  assert.deepEqual(deuda.periodos.map((item) => item.periodo), [inicio, restarMeses(actual, 2), restarMeses(actual, 1), actual]);
  assert.equal(deuda.deuda_vencida, 90);
  assert.equal(deuda.deuda_mes, 30);
  assert.equal(deuda.deuda_total, 120);
  assert.equal(deuda.periodo_mas_antiguo, inicio);

  // Pago hoy aplicado al mes más antiguo: cancela ese mes y no toca el actual.
  const cobro = await registrarCobro(db, { comerciante_id: antiguo.id, cobrador_id: 2, monto: 30, metodo_pago: 'efectivo', periodo: inicio });
  assert.equal(cobro.periodo_aplicado, inicio);
  assert.equal((await calcularLiquidacion(db, antiguo.id, inicio)).saldo, 0);
  assert.equal((await calcularLiquidacion(db, antiguo.id, actual)).saldo, 30, 'el mes actual sigue debiendo');
  const despues = await calcularDeudaAcumulada(db, antiguo.id);
  assert.equal(despues.deuda_total, 90);
  assert.equal(despues.periodo_mas_antiguo, restarMeses(actual, 2));
  assert.deepEqual(despues.meses_impagos, [restarMeses(actual, 2), restarMeses(actual, 1), actual]);

  // Dado de alta el mes pasado: solo debe desde su alta.
  const nuevo = await permanenteDesde(db, restarMeses(actual, 1));
  assert.equal((await calcularDeudaAcumulada(db, nuevo.id)).deuda_total, 60);
});

test('el eventual no acumula deuda y el inicio de cobro se valida', async () => {
  const db = await initializeDatabase();
  const eventual = await insertComerciante(db, {
    dni_ruc: String(documento += 1), nombre: `Eventual Deuda ${documento}`, rubro_id: 1, zona_id: 1,
    tipo_comerciante: 'eventual', estado: 'activo', usuario_creador: 1
  });
  const deuda = await calcularDeudaAcumulada(db, eventual.id);
  assert.deepEqual(deuda.periodos, []);
  assert.equal(deuda.deuda_total, 0);

  await assert.rejects(() => setInicioCobro(db, '2026-13'), /AAAA-MM/);
  await assert.rejects(() => setInicioCobro(db, '2999-01'), /futuro/);
  await assert.rejects(() => registrarCobro(db, { comerciante_id: eventual.id, cobrador_id: 2, monto: 1, metodo_pago: 'efectivo', periodo: 'mayo' }), /AAAA-MM/);
});
