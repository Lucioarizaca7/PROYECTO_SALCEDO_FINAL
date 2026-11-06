/**
 * Veredicto de recaudación (src/veredictoRecaudacion.js): sube, baja, se mantiene o no se puede concluir,
 * con la causa por zona y la acción sugerida.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { veredictoRecaudacion } from '../src/veredictoRecaudacion.js';
import { initializeDatabase, insertComerciante, insertPuesto, insertTarifa, insertZona, registrarCobro, generateForecastProjection } from '../src/db.js';

const SERIE = [1000, 1000, 1000];

test('sube o baja solo si el cambio pasa de 5 %; justo 5 % se mantiene', () => {
  assert.equal(veredictoRecaudacion({ serie: SERIE, proyectado: 1051, mape: 1 }).estado, 'sube');
  assert.equal(veredictoRecaudacion({ serie: SERIE, proyectado: 949, mape: 1 }).estado, 'baja');
  assert.equal(veredictoRecaudacion({ serie: SERIE, proyectado: 1050, mape: 1 }).estado, 'estable');
  assert.equal(veredictoRecaudacion({ serie: SERIE, proyectado: 950, mape: 1 }).estado, 'estable');

  const sube = veredictoRecaudacion({ serie: [500, 1000, 1000, 1000], proyectado: 1100, mape: 2 });
  assert.equal(sube.base, 1000, 'la base son los últimos 3 meses');
  assert.equal(sube.cambio_pct, 10);
});

test('con menos de 3 meses, sin cobros o sin error medido no se concluye', () => {
  const unMes = veredictoRecaudacion({ serie: [800], proyectado: 800, mape: null });
  assert.equal(unMes.estado, 'no_concluye');
  assert.match(unMes.motivo, /Solo hay 1 mes con cobros/);
  assert.equal(veredictoRecaudacion({}).estado, 'no_concluye');
  assert.match(veredictoRecaudacion({ serie: [100, 0, 0, 0], proyectado: 10, mape: 1 }).motivo, /No hubo cobros/);
  assert.match(veredictoRecaudacion({ serie: SERIE, proyectado: 1100, mape: null }).motivo, /error del modelo/);
});

test('si el error del modelo es mayor que lo que se quiere afirmar, no se concluye', () => {
  const dudoso = veredictoRecaudacion({ serie: SERIE, proyectado: 1100, mape: 15 });
  assert.equal(dudoso.estado, 'no_concluye', 'un cambio de 10 % con 15 % de error no se puede afirmar');
  assert.equal(dudoso.cambio_pct, 10, 'igual informa el cambio calculado');
  assert.equal(veredictoRecaudacion({ serie: SERIE, proyectado: 1100, mape: 10 }).estado, 'sube', 'con error igual al cambio sí');

  assert.equal(veredictoRecaudacion({ serie: SERIE, proyectado: 1010, mape: 8 }).estado, 'no_concluye', 'estable tampoco se afirma si el error pasa del umbral');
  assert.equal(veredictoRecaudacion({ serie: SERIE, proyectado: 1010, mape: 4 }).estado, 'estable');
});

const baja = (zonas) => veredictoRecaudacion({ serie: SERIE, proyectado: 800, mape: 2, zonas });

test('baja la asistencia: sugiere ir al bloque', () => {
  const resultado = baja([{ zona: 'Bloque A', cobrado: [300, 300, 300, 200], dias: [100, 100, 100, 60] }]);
  assert.equal(resultado.causas[0].tipo, 'baja_asistencia');
  assert.match(resultado.causas[0].detalle, /la asistencia bajó 40 %/);
  assert.deepEqual(resultado.acciones.map((item) => item.tipo), ['baja_asistencia']);
  assert.match(resultado.acciones[0].texto, /Ir a Bloque A/);
});

test('asisten pero no pagan: sugiere reforzar la cobranza', () => {
  const resultado = baja([{ zona: 'Bloque B', cobrado: [300, 300, 300, 150], dias: [100, 100, 100, 100] }]);
  assert.equal(resultado.causas[0].tipo, 'no_pagan');
  assert.match(resultado.causas[0].detalle, /50 % menos por cada día marcado/);
  assert.match(resultado.acciones[0].texto, /Reforzar la cobranza en Bloque B/);
});

test('sin marcas de asistencia se dice que no se sabe el motivo, sin inventar una acción', () => {
  const resultado = baja([{ zona: 'Bloque C', cobrado: [300, 300, 300, 100], dias: [0, 0, 0, 0] }]);
  assert.equal(resultado.causas[0].tipo, 'sin_detalle');
  assert.deepEqual(resultado.acciones, []);
});

test('una zona que concentra la caída sugiere revisar al cobrador o la ruta', () => {
  const resultado = baja([
    { zona: 'Bloque D', cobrado: [500, 500, 500, 200], dias: [100, 100, 100, 95] },
    { zona: 'Bloque E', cobrado: [500, 500, 500, 480], dias: [100, 100, 100, 100] }
  ]);
  const zona = resultado.acciones.find((item) => item.tipo === 'una_zona');
  assert.equal(zona.zona, 'Bloque D');
  assert.match(zona.texto, /concentra 94 % de la caída/);

  const repartida = baja([
    { zona: 'Bloque D', cobrado: [500, 500, 500, 400], dias: [100, 100, 100, 100] },
    { zona: 'Bloque E', cobrado: [500, 500, 500, 400], dias: [100, 100, 100, 100] }
  ]);
  assert.equal(repartida.acciones.find((item) => item.tipo === 'una_zona'), undefined, 'una caída repartida no es de una sola zona');
});

test('si sube, sugiere prever tickets y cobradores en la zona que más crece', () => {
  const resultado = veredictoRecaudacion({
    serie: SERIE, proyectado: 1200, mape: 2,
    zonas: [
      { zona: 'Bloque F', cobrado: [300, 300, 300, 350], dias: [] },
      { zona: 'Bloque G', cobrado: [300, 300, 300, 500], dias: [] },
      { zona: 'Bloque H', cobrado: [300, 300, 300, 280], dias: [] }
    ]
  });
  assert.deepEqual(resultado.causas.map((item) => item.zona), ['Bloque G', 'Bloque F']);
  assert.deepEqual(resultado.acciones.map((item) => [item.tipo, item.zona]), [['prever_recursos', 'Bloque G']]);
});

test('la proyección trae el veredicto con los cobros y las marcas reales de cada zona', async () => {
  const db = await initializeDatabase();
  const sufijo = `${process.pid} ${Date.now()}`;
  const rubroId = (await db.query('INSERT INTO rubros (nombre) VALUES ($1) RETURNING id', [`rubro veredicto ${sufijo}`])).rows[0].id;
  const zona = await insertZona(db, { nombre: `Zona veredicto ${sufijo}` });
  await insertTarifa(db, { rubro_id: rubroId, tipo_tarifa: 'fija', monto_fijo: 5000, unidad_medida: 'mensual', vigencia_inicio: '2020-01-01' });
  const comerciante = await insertComerciante(db, {
    dni_ruc: '20666000001', nombre: 'Comerciante Veredicto', rubro_id: rubroId, zona_id: zona.id,
    tipo_comerciante: 'permanente', estado: 'activo', usuario_creador: 1
  });
  const puesto = await insertPuesto(db, { zona_id: zona.id, metros_cuadrados: 1, direccion: `Veredicto ${sufijo}`, comerciante_id: comerciante.id });

  // Ocho meses de 2031 que caen: cada mes hay menos días marcados y se cobra menos.
  const montos = [2000, 1900, 1800, 1700, 1600, 1500, 1400, 1300];
  for (const [i, monto] of montos.entries()) {
    const periodo = `2031-${String(i + 1).padStart(2, '0')}`;
    await registrarCobro(db, { comerciante_id: comerciante.id, cobrador_id: 2, monto, metodo_pago: 'efectivo', periodo, fecha_cobro: `${periodo}-15T15:00:00.000Z`, codigo_operacion: `VEREDICTO-${sufijo}-${i}` });
    const dias = i === montos.length - 1 ? 4 : 10;
    for (let dia = 1; dia <= dias; dia += 1) {
      await db.query(`INSERT INTO asistencias_feriales (puesto_id, fecha, sesion, marca, fuente) VALUES ($1, $2, '', 'P', 'app')`, [puesto.id, `${periodo}-${String(dia).padStart(2, '0')}`]);
    }
  }

  const { veredicto, proyeccion_mensual: proyeccion } = await generateForecastProjection(db, { period: '2031-09', horizonteDias: 90 });
  assert.equal(veredicto.estado, 'baja');
  assert.equal(veredicto.base, 1400);
  assert.equal(veredicto.proyectado, proyeccion[0]);
  assert.equal(veredicto.causas[0].tipo, 'baja_asistencia');
  assert.equal(veredicto.causas[0].zona, zona.nombre);
  assert.match(veredicto.causas[0].detalle, /la asistencia bajó 60 %/);
});
