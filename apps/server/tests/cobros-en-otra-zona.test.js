/**
 * Reporte «cobros en otra zona» por cobrador (RN-63, plan de reglas del 15/11/2026): cuánto usa cada cobrador
 * la zona del día y cuánto dinero mueve frente a la zona del puesto. Solo consulta; no cambia montos.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { closeDatabase, createUser, getCobrosEnOtraZona, initializeDatabase, insertComerciante, insertPuesto, registrarCobro, todayInLima } from '../src/db.js';
import { pool } from '../src/pg.js';
import { zonaConPrecio } from './_deuda.js';

before(async () => { await initializeDatabase(); });
after(async () => { await closeDatabase(); });

let correlativo = 0;
const unico = () => `${process.pid}-${correlativo += 1}`;
let documento = 20888000000;
const zona = (nombre, precio) => zonaConPrecio(pool, precio, { nombre: `${nombre} ${unico()}` });

async function comercianteEn(zonaId) {
  const rubro = (await pool.query('INSERT INTO rubros (nombre) VALUES ($1) RETURNING id', [`rubro otra zona ${unico()}`])).rows[0].id;
  const merchant = await insertComerciante(pool, {
    dni_ruc: String(documento += 1), nombre: `Otra zona ${documento}`, rubro_id: rubro, zona_id: zonaId,
    tipo_comerciante: 'ferial', estado: 'activo', usuario_creador: 1
  });
  await insertPuesto(pool, { zona_id: zonaId, direccion: `Otra zona ${unico()}`, comerciante_id: merchant.id });
  return merchant;
}
const cobradorNuevo = () => createUser({ nombre: `Cobrador otra zona ${unico()}`, email: `otra-zona-${unico()}@prueba.pe`, password: 'clave-de-prueba-1', rol: 'cobrador' });

test('el reporte cuenta por cobrador los días cobrados en otra zona y la diferencia de precio', async () => {
  const [asfaltada, sinAsfaltar] = [await zona('Asfaltada', 3), await zona('Sin asfaltar', 2)];
  const [cobrador, otroCobrador] = [await cobradorNuevo(), await cobradorNuevo()];
  const [a, b, c, d] = [await comercianteEn(asfaltada.id), await comercianteEn(asfaltada.id), await comercianteEn(sinAsfaltar.id), await comercianteEn(asfaltada.id)];

  // El cobrador marca a dos de la zona de S/ 3 en la de S/ 2, a uno de la de S/ 2 en la de S/ 3 y a uno en su zona.
  await registrarCobro(pool, { comerciante_id: a.id, cobrador_id: cobrador.id, monto: 2, metodo_pago: 'efectivo', zona_dia: sinAsfaltar.id });
  await registrarCobro(pool, { comerciante_id: b.id, cobrador_id: cobrador.id, monto: 2, metodo_pago: 'efectivo', zona_dia: sinAsfaltar.id });
  await registrarCobro(pool, { comerciante_id: c.id, cobrador_id: cobrador.id, monto: 3, metodo_pago: 'efectivo', zona_dia: asfaltada.id });
  // El otro cobrador cobra en la zona del puesto: no sale en el reporte.
  await registrarCobro(pool, { comerciante_id: d.id, cobrador_id: otroCobrador.id, monto: 3, metodo_pago: 'efectivo' });

  const hoy = todayInLima();
  const reporte = await getCobrosEnOtraZona(pool, { desde: hoy, hasta: hoy });
  const fila = reporte.cobradores.find((item) => item.cobrador_id === Number(cobrador.id));
  assert.ok(fila, 'el cobrador que cobró en otra zona sale en el reporte');
  assert.equal(fila.dias_marcados, 3);
  assert.equal(fila.dias_otra_zona, 3);
  assert.equal(fila.a_zona_mas_barata, 2);
  assert.equal(fila.a_zona_mas_cara, 1);
  assert.equal(fila.sin_precio, 0);
  assert.equal(fila.diferencia, 1, 'dos días a S/ 1 menos y uno a S/ 1 más');
  assert.equal(fila.porcentaje, 100);
  const baja = fila.detalle.find((item) => item.zona_puesto === asfaltada.nombre && item.zona_dia === sinAsfaltar.nombre);
  assert.deepEqual([baja.dias, baja.precio_puesto, baja.precio_dia, baja.diferencia], [2, 3, 2, 2]);
  assert.ok(!reporte.cobradores.some((item) => item.cobrador_id === Number(otroCobrador.id)), 'quien cobra en la zona del puesto no sale');
});

test('una zona sin precio cuenta aparte y no entra en la diferencia; las fechas se validan', async () => {
  const conPrecio = await zona('Con precio', 3);
  const sinPrecio = (await pool.query('INSERT INTO zonas (nombre) VALUES ($1) RETURNING id, nombre', [`Zona sin precio ${unico()}`])).rows[0];
  const cobrador = await cobradorNuevo();
  const merchant = await comercianteEn(conPrecio.id);
  // La marca se escribe directo: con una zona sin precio no hay nada que cobrar.
  await pool.query(`
    INSERT INTO asistencias_feriales (puesto_id, fecha, sesion, marca, fuente, registrado_por, comerciante_id, zona_id)
    SELECT p.id, $2::date, '', 'P', 'app', $3, $1, $4 FROM puestos p WHERE p.comerciante_id = $1`, [merchant.id, todayInLima(), cobrador.id, sinPrecio.id]);

  const hoy = todayInLima();
  const fila = (await getCobrosEnOtraZona(pool, { desde: hoy, hasta: hoy })).cobradores.find((item) => item.cobrador_id === Number(cobrador.id));
  assert.equal(fila.dias_otra_zona, 1);
  assert.equal(fila.sin_precio, 1);
  assert.equal(fila.diferencia, 0, 'no se inventa un monto para la zona sin precio');
  assert.equal(fila.detalle[0].precio_dia, null);

  await assert.rejects(() => getCobrosEnOtraZona(pool, { desde: '2026-13-40', hasta: hoy }), /formato AAAA-MM-DD/);
  await assert.rejects(() => getCobrosEnOtraZona(pool, { desde: '2026-12-02', hasta: '2026-12-01' }), /posterior/);
});
