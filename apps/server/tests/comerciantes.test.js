import test from 'node:test';
import assert from 'node:assert/strict';

import {
  initializeDatabase,
  insertComerciante,
  getComerciantes,
  insertPuesto,
  calcularLiquidacion,
  registrarCobro,
  insertTarifa,
  updateTarifa
} from '../src/db.js';
import { marcarDias, zonaConPrecio } from './_deuda.js';

test('insertComerciante crea un registro válido de comerciante', async () => {
  const db = await initializeDatabase();

  const inserted = await insertComerciante(db, {
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
  const list = await getComerciantes(db);
  assert.ok(list.some((item) => item.dni_ruc === '20567890123' && item.nombre === 'María López'));
});

test('insertComerciante bloquea documentos duplicados en estado activo', async () => {
  const db = await initializeDatabase();

  await insertComerciante(db, {
    dni_ruc: '20123456789',
    nombre: 'Juan Pérez',
    rubro_id: 1,
    zona_id: 1,
    categoria: 'permanente',
    tipo_comerciante: 'permanente',
    estado: 'activo',
    usuario_creador: 1
  });

  await assert.rejects(async () => {
    await insertComerciante(db, {
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

  const primer = await insertComerciante(db, {
    dni_ruc: '20234567891',
    nombre: 'Ana García',
    rubro_id: 1,
    zona_id: 1,
    categoria: 'permanente',
    tipo_comerciante: 'permanente',
    estado: 'activo',
    usuario_creador: 1
  });

  const segundo = await insertComerciante(db, {
    dni_ruc: '20345678912',
    nombre: 'Luis Castro',
    rubro_id: 2,
    zona_id: 1,
    categoria: 'permanente',
    tipo_comerciante: 'permanente',
    estado: 'activo',
    usuario_creador: 1
  });

  await insertPuesto(db, {
    comerciante_id: primer.id,
    zona_id: 1,
    direccion: 'Puesto A-12',
    metros_cuadrados: 4,
    estado: 'ocupado'
  });

  await assert.rejects(async () => {
    await insertPuesto(db, {
      comerciante_id: segundo.id,
      zona_id: 1,
      direccion: 'Puesto A-12',
      metros_cuadrados: 3,
      estado: 'ocupado'
    });
  }, /puesto|asignaci[oó]n/i);
});

test('calcularLiquidacion respeta la política de no devengo para ferial sin asistencia', async () => {
  const db = await initializeDatabase();

  const comerciante = await insertComerciante(db, {
    dni_ruc: '20456789013',
    nombre: 'Jorge Ferial',
    rubro_id: 1,
    zona_id: 1,
    categoria: 'ferial',
    tipo_comerciante: 'ferial',
    estado: 'activo',
    usuario_creador: 1
  });

  const result = await calcularLiquidacion(db, comerciante.id, '2026-09');
  assert.equal(result.saldo, 0);
  assert.equal(result.estado, 'pagado');
  assert.equal(result.no_devengo, true);
});

// Un solo tipo de comerciante (decisión del usuario, 23/11/2026; 0039). Antes el eventual pagaba el día en que se
// le encontraba, sin marca, y lo que no pagaba no quedaba como deuda (RN-52).
test('a todos se les cobra el día que están presentes, y un día presente sin pagar queda como deuda', async () => {
  const db = await initializeDatabase();
  // Zona de S/ 6 por día (lo fija el super_admin).
  const zona = await zonaConPrecio(db, 6);
  const comerciante = await insertComerciante(db, {
    dni_ruc: '75163744', nombre: 'Antes Eventual', rubro_id: 3, zona_id: zona.id,
    categoria: 'eventual', tipo_comerciante: 'eventual', estado: 'activo', usuario_creador: 1
  });
  assert.equal(comerciante.tipo_comerciante, 'ferial', 'el tipo pedido se ignora: hay uno solo');
  const puesto = await insertPuesto(db, { comerciante_id: comerciante.id, zona_id: zona.id, direccion: 'Antes eventual, puesto 1' });

  // Sin un día presente no debe nada: ya no hay cobro del día sin marca.
  const sinDias = await calcularLiquidacion(db, comerciante.id, '2026-09');
  assert.equal(sinDias.no_devengo, true);
  assert.equal(sinDias.cobro_diario, undefined);

  // Dos días presentes en septiembre; paga uno: el otro queda como deuda.
  await marcarDias(db, puesto.id, '2026-09', 2, { desde: 14 });
  const presente = await calcularLiquidacion(db, comerciante.id, '2026-09');
  assert.equal(presente.monto_total, 12);
  assert.equal(presente.saldo, 12);
  await registrarCobro(db, {
    comerciante_id: comerciante.id, cobrador_id: 2, monto: 6, metodo_pago: 'efectivo', concepto: 'Un día', periodo: '2026-09'
  });
  const debe = await calcularLiquidacion(db, comerciante.id, '2026-09');
  assert.equal(debe.saldo, 6, 'el día presente sin pagar se debe');
  assert.equal(debe.vencida, true);
});

test('registrarCobro rechaza cobros duplicados por código de operación', async () => {
  const db = await initializeDatabase();

  const comerciante = await insertComerciante(db, {
    dni_ruc: '20678901234',
    nombre: 'Cobrador Prueba',
    rubro_id: 1,
    zona_id: 1,
    categoria: 'permanente',
    tipo_comerciante: 'permanente',
    estado: 'activo',
    usuario_creador: 1
  });

  const puesto = await insertPuesto(db, {
    comerciante_id: comerciante.id,
    zona_id: 1,
    direccion: 'Puesto B-15',
    metros_cuadrados: 5,
    estado: 'ocupado'
  });
  // 7 días cobrados en septiembre a S/ 3 (Mercado Central): debe S/ 21.
  await marcarDias(db, puesto.id, '2026-09', 7);

  await registrarCobro(db, {
    comerciante_id: comerciante.id,
    cobrador_id: 2,
    monto: 20,
    metodo_pago: 'yape',
    concepto: 'Cuota mensual',
    codigo_operacion: 'OP-123456',
    observaciones: 'Primer cobro',
    periodo: '2026-09'
  }, { allowExcess: true });   // digital: solo entra sin señal, y queda observado (RN-34)

  await assert.rejects(async () => {
    await registrarCobro(db, {
      comerciante_id: comerciante.id,
      cobrador_id: 2,
      monto: 10,
      metodo_pago: 'yape',
      concepto: 'Cuota mensual duplicado',
      codigo_operacion: 'OP-123456',
      observaciones: 'Cobro duplicado',
      periodo: '2026-09'
    }, { allowExcess: true });
  }, /duplicado|ya existe|código de operación/i);
});

test('updateTarifa rechaza actualizaciones con versión obsoleta', async () => {
  const db = await initializeDatabase();

  const zona = await zonaConPrecio(db, null);
  const tarifa = await insertTarifa(db, {
    zona_id: zona.id,
    monto_fijo: 20,
    norma: 'OM 001-2026 (prueba)',
    vigencia_inicio: '2026-01-01',
    vigencia_fin: '2026-12-31',
    version: 1
  }, { permitirInicioPasado: true });

  await assert.rejects(async () => {
    await updateTarifa(db, tarifa.id, { monto_fijo: 25, version: 99 });
  }, /versi[oó]n|obsoleta|actualizaci[oó]n/i);
});
