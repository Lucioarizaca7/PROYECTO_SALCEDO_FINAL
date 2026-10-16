/**
 * Padrón de la jornada para buscar y cobrar sin señal (src/services/jornadaOffline.js).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { aplicarCobroLocal, aSaldoDePantalla, buscarEnPadron, hoyEnLima, jornadaVigente, normalizarComerciante, periodoEnLima } from '../src/services/jornadaOffline.js';

const paquete = [
  { id: 1, codigo: 'CM-001', dni_ruc: '40123456', nombre: 'María Quispe Mamani', rubro: 'Abarrotes', zona: 'Mercado Central', codigo_puesto: 'S-001', periodo: '2026-11', tarifa_id: 4, tarifa_monto_fijo: 1, monto_total: 30, monto_pagado: 10, saldo: 20 },
  { id: 2, codigo: 'CM-002', dni_ruc: '20601234567', nombre: 'Comercial Ñuñoa SAC', rubro: 'Ropa', zona: 'Feria', codigo_puesto: 'F-010', periodo: '2026-11', monto_total: 15, monto_pagado: 0, saldo: 15 },
  { id: 12, codigo: 'CM-012', dni_ruc: '41000012', nombre: 'José Ramos', rubro: 'Comidas', zona: 'Avenida Sesquicentenario', codigo_puesto: null, periodo: '2026-11', monto_total: 0, monto_pagado: 0, saldo: 0, no_devengo: true }
].map((item) => normalizarComerciante(item, '2026-11-10T12:00:00.000Z'));

test('normaliza el comerciante del paquete con su saldo', () => {
  const [maria] = paquete;
  assert.equal(maria.id, '1');
  assert.equal(maria.numeroDocumento, '40123456');
  assert.equal(maria.saldo, 20);
  assert.equal(maria.codigoPuesto, 'S-001');
  assert.equal(paquete[2].noDevengo, true);
});

test('el saldo de pantalla sin señal muestra la tarifa y lo pagado del padrón', () => {
  const balance = aSaldoDePantalla(paquete[0], '2026-11');
  assert.deepEqual(balance.tarifa, { id: 4, monto_fijo: 1 });
  assert.equal(balance.monto_pagado, 10);
  assert.equal(balance.saldo, 20);
  assert.equal(balance.offline, true);
  assert.equal(aSaldoDePantalla(paquete[2], '2026-11').tarifa, null);
});

test('el eventual se descarga con su cobro del día y la pantalla lo muestra como tal', () => {
  const [eventual] = [{ id: 4, dni_ruc: '75163744', nombre: 'Lucio Eventual', periodo: '2026-11', tarifa_id: 1, tarifa_monto_fijo: 18, monto_total: 18, monto_pagado: 0, saldo: 18, cobro_diario: true, dia: '2026-11-10' }]
    .map((item) => normalizarComerciante(item));
  const balance = aSaldoDePantalla(eventual, '2026-11');
  assert.equal(balance.cobro_diario, true);
  assert.equal(balance.dia, '2026-11-10');
  assert.equal(balance.saldo, 18);
  assert.equal(aplicarCobroLocal(eventual, 18).saldo, 0);
  assert.equal(aSaldoDePantalla(paquete[0], '2026-11').cobro_diario, false);
});

test('busca por DNI/RUC exacto, código CM, número corto y código de puesto', () => {
  assert.equal(buscarEnPadron(paquete, '40123456')[0].id, '1');
  assert.equal(buscarEnPadron(paquete, '20601234567')[0].id, '2');
  assert.equal(buscarEnPadron(paquete, 'CM-012')[0].id, '12');
  assert.equal(buscarEnPadron(paquete, 'cm12')[0].id, '12');
  assert.equal(buscarEnPadron(paquete, '2')[0].id, '2');
  assert.equal(buscarEnPadron(paquete, 'f-010')[0].id, '2');
});

test('busca por el código de negocio actual, por uno anterior y por el correlativo', () => {
  const [lucio] = [{
    id: 4, correlativo: 4, codigo: 'COM-0004-LAC-COMI-***744-MCEN-ACT-20261016', codigos_anteriores: ['CM-004', 'COM-0004-LAC-COMI-75163744-MCEN-ACT-20261016'],
    dni_ruc: '75163744', nombre: 'Lucio Arizaca Carrion', periodo: '2026-11', saldo: 2
  }].map((item) => normalizarComerciante(item));
  const padron = [...paquete, lucio];
  assert.equal(buscarEnPadron(padron, 'COM-0004-LAC-COMI-***744-MCEN-ACT-20261016')[0].id, '4');
  assert.equal(buscarEnPadron(padron, 'com-0004-lac')[0].id, '4', 'el inicio del código basta');
  assert.equal(buscarEnPadron(padron, 'COM-0004-LAC-COMI-75163744-MCEN-ACT-20261016')[0].id, '4', 'código de un QR viejo con el DNI completo');
  assert.equal(buscarEnPadron(padron, 'CM-004')[0].id, '4');
  assert.equal(buscarEnPadron(padron, '0004')[0].id, '4');
});

test('busca por nombre sin importar tildes ni mayúsculas, primero los que empiezan así', () => {
  assert.equal(buscarEnPadron(paquete, 'jose')[0].id, '12');
  assert.equal(buscarEnPadron(paquete, 'NUNOA')[0].id, '2');
  assert.deepEqual(buscarEnPadron(paquete, 'ma').map((item) => item.id)[0], '1');
  assert.equal(buscarEnPadron(paquete, 'mercado')[0].id, '1', 'también por zona');
});

test('una búsqueda vacía o sin coincidencias no devuelve nada', () => {
  assert.deepEqual(buscarEnPadron(paquete, ''), []);
  assert.deepEqual(buscarEnPadron(paquete, 'zzz'), []);
  assert.deepEqual(buscarEnPadron(undefined, 'maria'), []);
});

test('un cobro offline descuenta el saldo local y nunca lo deja negativo', () => {
  const maria = paquete[0];
  const after = aplicarCobroLocal(maria, 5.5);
  assert.equal(after.saldo, 14.5);
  assert.equal(after.montoPagado, 15.5);
  assert.equal(aplicarCobroLocal(after, 100).saldo, 0);
  assert.equal(maria.saldo, 20, 'no modifica el registro original');
});

test('el padrón vale solo el día (de Lima) en que se descargó', () => {
  // 19:30 del 10/11 en Lima = 00:30 del 11/11 en UTC: sigue siendo el mismo día de jornada.
  const meta = { descargadoEn: '2026-11-10T12:00:00.000Z', periodo: '2026-11' };
  assert.equal(hoyEnLima(new Date('2026-11-11T00:30:00Z')), '2026-11-10');
  assert.equal(jornadaVigente(meta, new Date('2026-11-11T00:30:00Z')), true);
  assert.equal(jornadaVigente(meta, new Date('2026-11-11T13:00:00Z')), false);
  assert.equal(jornadaVigente(null), false);
});

test('el periodo es el mes de Lima, no el de UTC', () => {
  // 19:30 del 31/10 en Lima = 00:30 del 01/11 en UTC: el cobro es de octubre.
  const finDeMes = new Date('2026-11-01T00:30:00Z');
  assert.equal(finDeMes.toISOString().slice(0, 7), '2026-11');
  assert.equal(periodoEnLima(finDeMes), '2026-10');
  assert.equal(periodoEnLima(new Date('2026-11-01T05:00:00Z')), '2026-11');
});
