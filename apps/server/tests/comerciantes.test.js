import test from 'node:test';
import assert from 'node:assert/strict';

import {
  initializeDatabase,
  insertComerciante,
  getComerciantes,
  insertPuesto,
  calculateLiquidation,
  insertCobro,
  insertTarifa,
  updateTarifa
} from '../src/db.js';

test('insertComerciante crea un registro válido de comerciante', async () => {
  const db = await initializeDatabase();

  const inserted = insertComerciante(db, {
    dni_ruc: '20567890123',
    nombre: 'María López',
    rubro_id: 1,
    zona_id: 1,
    categoria: 'permanente',
    tipo_comerciante: 'permanente',
    estado: 'activo',
    usuario_creador: 1
  });

  assert.ok(inserted.id > 0);
  const list = getComerciantes(db);
  assert.ok(list.some((item) => item.dni_ruc === '20567890123' && item.nombre === 'María López'));
});

test('insertComerciante bloquea documentos duplicados en estado activo', async () => {
  const db = await initializeDatabase();

  insertComerciante(db, {
    dni_ruc: '20123456789',
    nombre: 'Juan Pérez',
    rubro_id: 1,
    zona_id: 1,
    categoria: 'permanente',
    tipo_comerciante: 'permanente',
    estado: 'activo',
    usuario_creador: 1
  });

  assert.throws(() => {
    insertComerciante(db, {
      dni_ruc: '20123456789',
      nombre: 'Juan Pérez Duplicado',
      rubro_id: 2,
      zona_id: 1,
      categoria: 'permanente',
      tipo_comerciante: 'permanente',
      estado: 'activo',
      usuario_creador: 1
    });
  }, /duplicado|ya existe/i);
});

test('insertPuesto evita la doble asignación del mismo puesto físico', async () => {
  const db = await initializeDatabase();

  const primer = insertComerciante(db, {
    dni_ruc: '20234567891',
    nombre: 'Ana García',
    rubro_id: 1,
    zona_id: 1,
    categoria: 'permanente',
    tipo_comerciante: 'permanente',
    estado: 'activo',
    usuario_creador: 1
  });

  const segundo = insertComerciante(db, {
    dni_ruc: '20345678912',
    nombre: 'Luis Castro',
    rubro_id: 2,
    zona_id: 1,
    categoria: 'permanente',
    tipo_comerciante: 'permanente',
    estado: 'activo',
    usuario_creador: 1
  });

  insertPuesto(db, {
    comerciante_id: primer.id,
    zona_id: 1,
    direccion: 'Puesto A-12',
    metros_cuadrados: 4,
    estado: 'ocupado'
  });

  assert.throws(() => {
    insertPuesto(db, {
      comerciante_id: segundo.id,
      zona_id: 1,
      direccion: 'Puesto A-12',
      metros_cuadrados: 3,
      estado: 'ocupado'
    });
  }, /puesto|asignaci[oó]n/i);
});

test('calculateLiquidation respeta la política de no devengo para ferial sin asistencia', async () => {
  const db = await initializeDatabase();

  const comerciante = insertComerciante(db, {
    dni_ruc: '20456789013',
    nombre: 'Jorge Ferial',
    rubro_id: 1,
    zona_id: 1,
    categoria: 'ferial',
    tipo_comerciante: 'ferial',
    estado: 'activo',
    usuario_creador: 1
  });

  const result = calculateLiquidation(db, comerciante.id, '2026-09');
  assert.equal(result.saldo, 0);
  assert.equal(result.estado, 'pagado');
  assert.equal(result.no_devengo, true);
});

test('insertCobro rechaza cobros duplicados por código de operación', async () => {
  const db = await initializeDatabase();

  const comerciante = insertComerciante(db, {
    dni_ruc: '20678901234',
    nombre: 'Cobrador Prueba',
    rubro_id: 1,
    zona_id: 1,
    categoria: 'permanente',
    tipo_comerciante: 'permanente',
    estado: 'activo',
    usuario_creador: 1
  });

  insertPuesto(db, {
    comerciante_id: comerciante.id,
    zona_id: 1,
    direccion: 'Puesto B-15',
    metros_cuadrados: 5,
    estado: 'ocupado'
  });

  insertCobro(db, {
    comerciante_id: comerciante.id,
    cobrador_id: 2,
    monto: 20,
    metodo_pago: 'yape',
    concepto: 'Cuota mensual',
    codigo_operacion: 'OP-123456',
    observaciones: 'Primer cobro',
    periodo: '2026-09'
  });

  assert.throws(() => {
    insertCobro(db, {
      comerciante_id: comerciante.id,
      cobrador_id: 2,
      monto: 10,
      metodo_pago: 'yape',
      concepto: 'Cuota mensual duplicado',
      codigo_operacion: 'OP-123456',
      observaciones: 'Cobro duplicado',
      periodo: '2026-09'
    });
  }, /duplicado|ya existe|código de operación/i);
});

test('updateTarifa rechaza actualizaciones con versión obsoleta', async () => {
  const db = await initializeDatabase();

  const tarifa = insertTarifa(db, {
    rubro_id: 1,
    tipo_tarifa: 'fija',
    monto_fijo: 20,
    monto_variable: 0,
    unidad_medida: 'diaria',
    vigencia_inicio: '2026-01-01',
    vigencia_fin: '2026-12-31',
    version: 1
  });

  assert.throws(() => {
    updateTarifa(db, tarifa.id, { monto_fijo: 25, version: 99 });
  }, /versi[oó]n|obsoleta|actualizaci[oó]n/i);
});
