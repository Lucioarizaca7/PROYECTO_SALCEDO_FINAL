/**
 * Etapa 4 del plan de reglas (migrations/0036_norma_del_precio_zonas_del_cobrador_y_zona_unica.sql):
 * norma del precio (RN-15), zonas del cobrador (RN-64), talonario perdido (RN-33), puestos del día al cobrar
 * (RN-22), puesto sin zona confirmada (RN-05) y zona única del comerciante (RN-06).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';

import {
  anularDisponiblesDelLote, asignarLote, asignarZonasCobrador, calcularLiquidacion, closeDatabase, createUser, findComerciante,
  getMarcasFueraDeAsignacion, getTarifas, getUsuario, initializeDatabase, insertComerciante, insertPuesto, insertTarifa, insertZona,
  marcarAsistencias, puestosDelDia, registrarCobro, todayInLima, updateComerciante, updatePuesto, updateTarifa
} from '../src/db.js';
import { NORMA_DE_PRUEBA, dniDePrueba, zonaConPrecio } from './_deuda.js';

let secuencia = 0;
const unico = () => `${process.pid}-${++secuencia}`;
const db = await initializeDatabase();
const rubro = Number((await db.query('SELECT id FROM rubros WHERE activo ORDER BY id LIMIT 1')).rows[0].id);
const hoy = todayInLima();

after(() => closeDatabase());

const nuevoCobrador = () => createUser({ nombre: `Cobrador modelo ${unico()}`, email: `modelo-${unico()}@prueba.pe`, password: 'clave-de-prueba-1', rol: 'cobrador' });
async function comerciante(zona, tipo = 'ferial') {
  return insertComerciante(db, { dni_ruc: dniDePrueba(), nombre: `Comerciante modelo ${unico()}`, rubro_id: rubro, zona_id: zona.id, tipo_comerciante: tipo, estado: 'activo', usuario_creador: 1 });
}
const puestoDe = (titular, zona) => insertPuesto(db, { zona_id: zona.id, direccion: `Puesto modelo ${unico()}`, comerciante_id: titular.id });
const marcasDeHoy = async (comercianteId) => (await db.query(
  `SELECT puesto_id, zona_id, fuente, fuera_de_asignacion FROM asistencias_feriales WHERE comerciante_id = $1 AND fecha = $2::date AND sesion = '' ORDER BY puesto_id`,
  [comercianteId, hoy])).rows;

test('RN-15: un precio nuevo lleva su norma; la de un precio anterior se puede escribir después', async () => {
  const zona = await insertZona(db, { nombre: `Zona norma ${unico()}` });
  await assert.rejects(() => insertTarifa(db, { zona_id: zona.id, monto_fijo: 3, vigencia_inicio: hoy }), /ordenanza o resolución/);
  await assert.rejects(() => insertTarifa(db, { zona_id: zona.id, monto_fijo: 3, vigencia_inicio: hoy, norma: 'x' }), /ordenanza o resolución/);
  const tarifa = await insertTarifa(db, { zona_id: zona.id, monto_fijo: 3, vigencia_inicio: hoy, norma: '  OM 012-2026-MDS ' });
  assert.equal(tarifa.norma, 'OM 012-2026-MDS');
  assert.equal((await getTarifas(db, { zona_id: zona.id }))[0].norma, 'OM 012-2026-MDS');

  await assert.rejects(() => insertZona(db, { nombre: `Zona con precio sin norma ${unico()}`, precio_dia: '2' }), /ordenanza o resolución/);
  const conPrecio = await insertZona(db, { nombre: `Zona con precio y norma ${unico()}`, precio_dia: '2', norma: NORMA_DE_PRUEBA });
  assert.equal((await getTarifas(db, { zona_id: conPrecio.id }))[0].norma, NORMA_DE_PRUEBA);

  // Corregir la norma no cambia lo que se cobra: se permite aunque el precio ya rija.
  const corregida = await updateTarifa(db, tarifa.id, { norma: 'OM 013-2026-MDS', version: tarifa.version });
  assert.equal(corregida.norma, 'OM 013-2026-MDS');
  assert.equal(Number(corregida.monto_fijo), 3);
});

test('RN-64: una marca fuera de las zonas asignadas al cobrador se guarda y queda señalada', async () => {
  const [suya, ajena] = [await zonaConPrecio(db, 3), await zonaConPrecio(db, 2)];
  const cobrador = await nuevoCobrador();
  const libre = await nuevoCobrador();
  const titular = await comerciante(suya);
  const puesto = await puestoDe(titular, suya);
  const otro = await comerciante(ajena);
  const puestoAjeno = await puestoDe(otro, ajena);

  await assert.rejects(() => asignarZonasCobrador(db, 1, [suya.id], { asignadoPor: 1 }), /Solo a un cobrador/);
  await assert.rejects(() => asignarZonasCobrador(db, cobrador.id, [999999], { asignadoPor: 1 }), /no existe/);
  const asignado = await asignarZonasCobrador(db, cobrador.id, [suya.id], { asignadoPor: 1 });
  assert.deepEqual(asignado.zonas_asignadas, [Number(suya.id)]);

  const [enSuZona] = await marcarAsistencias(db, [{ puesto_id: puesto.id, asistio: true }], { usuarioId: cobrador.id, rol: 'cobrador' });
  assert.equal(enSuZona.fuera_de_asignacion, false);
  const [fuera] = await marcarAsistencias(db, [{ puesto_id: puestoAjeno.id, asistio: true }], { usuarioId: cobrador.id, rol: 'cobrador' });
  assert.equal(fuera.fuera_de_asignacion, true, 'no se impide: queda señalada');
  // Quien no tiene zonas asignadas cobra en todas.
  const tercero = await comerciante(ajena);
  const [sinAsignacion] = await marcarAsistencias(db, [{ puesto_id: (await puestoDe(tercero, ajena)).id, asistio: true }], { usuarioId: libre.id, rol: 'cobrador' });
  assert.equal(sinAsignacion.fuera_de_asignacion, false);

  // El cobro que marca el día también se señala.
  const cuarto = await comerciante(ajena);
  await puestoDe(cuarto, ajena);
  await registrarCobro(db, { comerciante_id: cuarto.id, cobrador_id: cobrador.id, monto: 2, metodo_pago: 'efectivo' });
  assert.equal((await marcasDeHoy(cuarto.id))[0].fuera_de_asignacion, true);

  const reporte = await getMarcasFueraDeAsignacion(db, { desde: hoy, hasta: hoy });
  const fila = reporte.cobradores.find((item) => item.cobrador_id === Number(cobrador.id));
  assert.equal(fila.marcas, 3);
  assert.equal(fila.fuera, 2);
  assert.equal(fila.detalle.length, 2);
  assert.ok(!reporte.cobradores.some((item) => item.cobrador_id === Number(libre.id)));

  // Cambiar la asignación después no cambia lo ya marcado.
  await asignarZonasCobrador(db, cobrador.id, [], { asignadoPor: 1 });
  assert.deepEqual((await getUsuario(db, cobrador.id)).zonas_asignadas, []);
  assert.equal((await getMarcasFueraDeAsignacion(db, { desde: hoy, hasta: hoy })).cobradores.find((item) => item.cobrador_id === Number(cobrador.id)).fuera, 2);
});

test('RN-33: talonario perdido, se anulan de una vez los tickets disponibles del lote', async () => {
  const cobrador = await nuevoCobrador();
  const desde = 700000 + (process.pid % 1000) * 100;
  const lote = await asignarLote(db, { serie: 'S3', numero_desde: desde, numero_hasta: desde + 9, cobrador_id: cobrador.id }, { usuarioId: 1 });
  await assert.rejects(() => anularDisponiblesDelLote(db, lote.id, { motivo: 'no' }, { usuarioId: 1 }), /motivo/);
  const resultado = await anularDisponiblesDelLote(db, lote.id, { motivo: 'Talonario robado, denuncia 123' }, { usuarioId: 1 });
  assert.equal(resultado.anulados, 10);
  assert.deepEqual([resultado.desde, resultado.hasta], [desde, desde + 9]);
  const estados = await db.query('SELECT DISTINCT estado, motivo FROM tickets WHERE lote_id = $1', [lote.id]);
  assert.deepEqual(estados.rows, [{ estado: 'anulado', motivo: 'Talonario robado, denuncia 123' }]);
  assert.equal((await db.query('SELECT estado FROM ticket_lotes WHERE id = $1', [lote.id])).rows[0].estado, 'cerrado');
  await assert.rejects(() => anularDisponiblesDelLote(db, lote.id, { motivo: 'Segunda vez' }, { usuarioId: 1 }), /no tiene tickets disponibles/);
});

test('RN-22: al cobrar se marcan los puestos que abrieron hoy y cada uno paga su día', async () => {
  const zona = await zonaConPrecio(db, 5);
  const cobrador = await nuevoCobrador();
  const titular = await comerciante(zona);
  const [uno, dos, tres] = [await puestoDe(titular, zona), await puestoDe(titular, zona), await puestoDe(titular, zona)];
  const ajeno = await puestoDe(await comerciante(zona), zona);

  const antes = await puestosDelDia(db, titular.id);
  assert.equal(antes.marcado_hoy, false);
  assert.deepEqual(antes.puestos.map((puesto) => puesto.id), [uno.id, dos.id, tres.id].map(Number));

  const cobro = { comerciante_id: titular.id, cobrador_id: cobrador.id, metodo_pago: 'efectivo' };
  await assert.rejects(() => registrarCobro(db, { ...cobro, monto: 10, puestos_dia: [uno.id, ajeno.id] }), /no es de ese comerciante/);
  assert.equal((await marcasDeHoy(titular.id)).length, 0, 'el cobro rechazado no deja marcas');

  await registrarCobro(db, { ...cobro, monto: 10, puestos_dia: [uno.id, tres.id] });
  assert.deepEqual((await marcasDeHoy(titular.id)).map((marca) => Number(marca.puesto_id)), [uno.id, tres.id].map(Number));
  const liquidacion = await calcularLiquidacion(db, titular.id);
  assert.equal(liquidacion.monto_total, 10);
  assert.equal(liquidacion.saldo, 0);
  assert.equal((await puestosDelDia(db, titular.id)).marcado_hoy, true);

  // Sin la lista, como antes: solo el puesto principal.
  const otro = await comerciante(zona);
  const principal = await puestoDe(otro, zona);
  await puestoDe(otro, zona);
  await assert.rejects(() => registrarCobro(db, { ...cobro, comerciante_id: otro.id, monto: 10 }), /excede el saldo/);
  await registrarCobro(db, { ...cobro, comerciante_id: otro.id, monto: 5 });
  assert.deepEqual((await marcasDeHoy(otro.id)).map((marca) => Number(marca.puesto_id)), [Number(principal.id)]);
});

test('RN-05: un puesto sin zona confirmada pide la zona del día para marcarlo o cobrarlo', async () => {
  const [provisional, real] = [await zonaConPrecio(db, 3), await zonaConPrecio(db, 2)];
  const cobrador = await nuevoCobrador();
  const titular = await comerciante(provisional);
  const puesto = await puestoDe(titular, provisional);
  await db.query(`UPDATE puestos SET zona_por_regularizar = '' WHERE id = $1`, [puesto.id]);
  assert.equal((await puestosDelDia(db, titular.id)).puestos[0].zona_por_confirmar, true);

  const marca = { puesto_id: puesto.id, fecha: hoy };
  await assert.rejects(() => marcarAsistencias(db, [{ ...marca, asistio: true }], { usuarioId: cobrador.id }), /no tiene zona confirmada/);
  // Una falta no necesita precio.
  await marcarAsistencias(db, [{ ...marca, motivo: 'no_salio' }], { usuarioId: cobrador.id });
  const [conZona] = await marcarAsistencias(db, [{ ...marca, asistio: true, zona_id: real.id }], { usuarioId: cobrador.id });
  assert.equal(conZona.zona_id, Number(real.id));
  assert.equal((await calcularLiquidacion(db, titular.id)).monto_total, 2, 'se cobra el precio de la zona del día');

  // Al cobrar sin marca previa: en línea se rechaza; sin señal el cobro entra y queda observado.
  const segundo = await comerciante(provisional);
  const puestoDos = await puestoDe(segundo, provisional);
  await db.query(`UPDATE puestos SET zona_por_regularizar = 'Zona del padrón' WHERE id = $1`, [puestoDos.id]);
  const cobro = { comerciante_id: segundo.id, cobrador_id: cobrador.id, metodo_pago: 'efectivo' };
  await assert.rejects(() => registrarCobro(db, { ...cobro, monto: 3 }), /elija la zona donde vende hoy/);
  assert.equal((await marcasDeHoy(segundo.id)).length, 0);
  const offline = await registrarCobro(db, { ...cobro, monto: 3 }, { allowExcess: true });
  const observado = await db.query('SELECT motivo FROM cobros_observados WHERE transaccion_id = $1', [offline.id]);
  assert.match(observado.rows[0].motivo, /sin zona confirmada/);

  const tercero = await comerciante(provisional);
  const puestoTres = await puestoDe(tercero, provisional);
  await db.query(`UPDATE puestos SET zona_por_regularizar = '' WHERE id = $1`, [puestoTres.id]);
  await registrarCobro(db, { ...cobro, comerciante_id: tercero.id, monto: 2, zona_dia: real.id });
  assert.equal(Number((await marcasDeHoy(tercero.id))[0].zona_id), Number(real.id));
});

test('RN-06: la zona del comerciante es la de su puesto principal y la base la sigue sola', async () => {
  const [a, b, c] = [await zonaConPrecio(db, 3), await zonaConPrecio(db, 2), await zonaConPrecio(db, 4)];
  const titular = await comerciante(a);
  const principal = await puestoDe(titular, b);
  assert.equal(Number((await findComerciante(db, titular.id)).zona_id), Number(b.id), 'al recibir su puesto pasa a la zona del puesto');

  // Un segundo puesto en otra zona no lo mueve: manda el principal.
  await puestoDe(titular, c);
  assert.equal(Number((await findComerciante(db, titular.id)).zona_id), Number(b.id));

  await updatePuesto(db, principal.id, { zona_id: c.id });
  assert.equal(Number((await findComerciante(db, titular.id)).zona_id), Number(c.id));

  // Desde la pantalla se avisa; por otro camino (el padrón) la base conserva la zona del puesto.
  await assert.rejects(() => updateComerciante(db, titular.id, { zona_id: a.id }, { zonaDelPuesto: true }), /es la de su puesto principal/);
  await updateComerciante(db, titular.id, { zona_id: a.id });
  assert.equal(Number((await findComerciante(db, titular.id)).zona_id), Number(c.id));
  // Guardar sin cambiar la zona sigue funcionando.
  await updateComerciante(db, titular.id, { nombre: 'Nombre corregido', zona_id: c.id }, { zonaDelPuesto: true });

  // Quien no tiene puesto (el eventual) conserva una zona que sí se edita.
  const eventual = await comerciante(a, 'eventual');
  await updateComerciante(db, eventual.id, { zona_id: b.id }, { zonaDelPuesto: true });
  assert.equal(Number((await findComerciante(db, eventual.id)).zona_id), Number(b.id));
});
