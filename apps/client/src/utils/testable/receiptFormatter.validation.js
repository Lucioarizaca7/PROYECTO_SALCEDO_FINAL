/**
 * Validación manual de las funciones de formato de recibos
 * Esto sirve como prueba funcional mientras resolvemos los problemas con Vitest
 */

import { buildEscPosReceipt, normalizeLocalMerchant, buildExpressSuggestion } from './receiptFormatter.js';

console.log('=== Validación de Funciones de Formato de Recibos ===\n');

// Pruebas para buildEscPosReceipt
console.log('1. Probando buildEscPosReceipt:');
console.log('------------------------');

const testReceipt = {
  comprobante: 'B-0001',
  fecha: '2026-08-24T10:30:00',
  comerciante: 'María Quispe',
  concepto: 'Ocupación diaria',
  metodo_pago: 'Yape',
  monto: 5.00,
  hash_idempotencia: 'sha256:abc123def456'
};

const result = buildEscPosReceipt(testReceipt);
console.log('Resultado para recibo completo:');
console.log(result);
console.log();

const emptyReceipt = {};
const emptyResult = buildEscPosReceipt(emptyReceipt);
console.log('Resultado para recibo vacío:');
console.log(emptyResult);
console.log();

// Pruebas para normalizeLocalMerchant
console.log('2. Probando normalizeLocalMerchant:');
console.log('------------------------');

const testMerchant = {
  id: 123,
  nombre: 'Juan Pérez',
  dni_ruc: '12345678',
  rubro_id: 1,
  zona_id: 2,
  categoria: 'permanente',
  tipo_comerciante: 'permanente',
  estado: 'activo',
  fecha_registro: '2026-01-15',
  monto_tasa_diaria: 15.50,
  estado_pago_hoy: true
};

const normalized = normalizeLocalMerchant(testMerchant);
console.log('Comerciante normalizado:');
console.log(JSON.stringify(normalized, null, 2));
console.log();

const emptyMerchant = {
  id: null,
  nombre: '',
  dni_ruc: null,
  rubro_id: null,
  zona_id: null
};

const emptyNormalized = normalizeLocalMerchant(emptyMerchant);
console.log('Comerciante vacío normalizado:');
console.log(JSON.stringify(emptyNormalized, null, 2));
console.log();

// Pruebas para buildExpressSuggestion
console.log('3. Probando buildExpressSuggestion:');
console.log('------------------------');

const baseMerchant = {
  id: 1,
  nombre: 'Test Merchant',
  categoria: 'permanente'
};

const noHistoryResult = buildExpressSuggestion(baseMerchant, { saldo: 0 }, []);
console.log('Sin historial:');
console.log(JSON.stringify(noHistoryResult, null, 2));
console.log();

const withHistoryResult = buildExpressSuggestion(baseMerchant, { saldo: 45.50 }, [
  { monto: 10, fecha_cobro: '2026-08-20', comerciante_id: 1 },
  { monto: 20, fecha_cobro: '2026-08-22', comerciante_id: 1 },
  { monto: 15, fecha_cobro: '2026-08-23', comerciante_id: 1 }
]);
console.log('Con historial (debería sugerir 15):');
console.log(JSON.stringify(withHistoryResult, null, 2));
console.log();

const streakAmountResult = buildExpressSuggestion(baseMerchant, { saldo: 0 }, [
  { monto: 10, fecha_cobro: '2026-08-18', comerciante_id: 1, metodo_pago: 'efectivo' },
  { monto: 10, fecha_cobro: '2026-08-20', comerciante_id: 1, metodo_pago: 'Yape' },
  { monto: 10, fecha_cobro: '2026-08-22', comerciante_id: 1, metodo_pago: 'efectivo' },
  { monto: 10, fecha_cobro: '2026-08-24', comerciante_id: 1, metodo_pago: 'efectivo' }
]);
console.log('Con racha de montos (debería sugerir 10):');
console.log(JSON.stringify(streakAmountResult, null, 2));
console.log();

const streakMethodResult = buildExpressSuggestion(baseMerchant, { saldo: 0 }, [
  { monto: 15, fecha_cobro: '2026-08-18', comerciante_id: 1, metodo_pago: 'efectivo' },
  { monto: 20, fecha_cobro: '2026-08-20', comerciante_id: 1, metodo_pago: 'efectivo' },
  { monto: 25, fecha_cobro: '2026-08-22', comerciante_id: 1, metodo_pago: 'efectivo' },
  { monto: 30, fecha_cobro: '2026-08-24', comerciante_id: 1, metodo_pago: 'Yape' }
]);
console.log('Con racha de métodos (debería sugerir efectivo):');
console.log(JSON.stringify(streakMethodResult, null, 2));
console.log();

console.log('=== Validación completada ===');