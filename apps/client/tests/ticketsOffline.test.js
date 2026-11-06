/**
 * Tickets preimpresos en el celular (src/services/ticketsOffline.js).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  anularLocal, anulacionesPendientes, consumir, desdeServidor, marcarAnulacionesEnviadas, montoDeRequeridos,
  proximosTickets, quedan, requeridosPorDefecto, seriesConPocos, textoTicket
} from '../src/services/ticketsOffline.js';
import { aPayloadServidor } from '../src/services/offlineQueue.js';
import { normalizarComerciante } from '../src/services/jornadaOffline.js';

const servidor = {
  umbral: 3,
  series: [
    { serie: 'S3', valor: 3, disponibles: [103, 101, 102, 104, 105] },
    { serie: 'S2', valor: 2, disponibles: [201, 202] }
  ]
};

test('el próximo número sale en orden y con dos series sale uno de cada una', () => {
  const estado = desdeServidor(null, servidor);
  assert.deepEqual(proximosTickets(estado, [{ serie: 'S3', cantidad: 2 }]).tickets, [{ serie: 'S3', numero: 101 }, { serie: 'S3', numero: 102 }]);

  const requeridos = requeridosPorDefecto([{ serie: 'S3', valor: 3, puestos: 1 }, { serie: 'S2', valor: 2, puestos: 1 }]);
  assert.equal(montoDeRequeridos(requeridos), 5);
  assert.deepEqual(proximosTickets(estado, requeridos), { tickets: [{ serie: 'S3', numero: 101 }, { serie: 'S2', numero: 201 }], faltan: [] });
  assert.deepEqual(proximosTickets(estado, [{ serie: 'S2', cantidad: 3 }]).faltan, [{ serie: 'S2', faltan: 1 }]);
  assert.equal(textoTicket('S3', 101), 'S3 N° 000101');
});

test('consumir avanza la numeración y el aviso sale con pocos tickets', () => {
  let estado = desdeServidor(null, servidor);
  assert.deepEqual(seriesConPocos(estado), [{ serie: 'S2', valor: 2, quedan: 2 }]);
  estado = consumir(estado, [{ serie: 'S3', numero: 101 }, { serie: 'S3', numero: 102 }]);
  assert.equal(quedan(estado, 'S3'), 3);
  assert.equal(proximosTickets(estado, [{ serie: 'S3', cantidad: 1 }]).tickets[0].numero, 103);
  assert.deepEqual(seriesConPocos(estado).map((item) => item.serie), ['S3', 'S2']);
});

test('anular avanza al siguiente y deja la anulación pendiente hasta que el servidor la resuelve', () => {
  let estado = desdeServidor(null, servidor);
  assert.throws(() => anularLocal(estado, 'S3', 101, 'no'), /motivo/);
  assert.throws(() => anularLocal(estado, 'S3', 999, 'Mal cortado'), /no está disponible/);
  estado = anularLocal(estado, 'S3', 101, 'Mal cortado', new Date('2026-10-20T15:00:00Z'));
  assert.equal(proximosTickets(estado, [{ serie: 'S3', cantidad: 1 }]).tickets[0].numero, 102);
  assert.deepEqual(anulacionesPendientes(estado), [{ serie: 'S3', numero: 101, motivo: 'Mal cortado', fecha: '2026-10-20T15:00:00.000Z' }]);

  // Un error temporal se reintenta; una anulación resuelta sale de la lista.
  assert.equal(anulacionesPendientes(marcarAnulacionesEnviadas(estado, [{ serie: 'S3', numero: 101, estado: 'error' }])).length, 1);
  assert.equal(anulacionesPendientes(marcarAnulacionesEnviadas(estado, [{ serie: 'S3', numero: 101, estado: 'anulado' }])).length, 0);
});

test('al refrescar con el servidor no vuelven los usados ni anulados que aún no subieron', () => {
  let estado = desdeServidor(null, servidor);
  estado = consumir(estado, [{ serie: 'S3', numero: 101 }]);
  estado = anularLocal(estado, 'S3', 102, 'Se mojó');
  // El servidor todavía no recibió el cobro ni la anulación: los sigue listando disponibles.
  const refrescado = desdeServidor(estado, servidor);
  assert.deepEqual(refrescado.series.S3.disponibles, [103, 104, 105]);
  assert.equal(refrescado.consumidos.length, 1);
  // Cuando el cobro llega, el servidor ya no lista el 101: el celular lo olvida.
  const sincronizado = desdeServidor(refrescado, { ...servidor, series: [{ serie: 'S3', valor: 3, disponibles: [102, 103, 104, 105] }] });
  assert.deepEqual(sincronizado.consumidos, []);
  assert.deepEqual(sincronizado.series.S3.disponibles, [103, 104, 105]);
});

test('el padrón trae las series del comerciante y la cola sube los tickets del cobro', () => {
  const registro = normalizarComerciante({ id: 7, nombre: 'Con ticket', series_cobro: [{ serie: 'S3', valor: 3, puestos: 2 }] });
  assert.deepEqual(registro.seriesCobro, [{ serie: 'S3', valor: 3, puestos: 2 }]);
  assert.deepEqual(normalizarComerciante({ id: 8, nombre: 'Sin ticket' }).seriesCobro, []);

  const payload = aPayloadServidor({ hashTransaccion: 'h', comercianteId: 7, monto: 6, fechaCobro: '2026-10-20T15:00:00Z', tickets: [{ serie: 'S3', numero: 101 }, { serie: 'S3', numero: 102 }] });
  assert.deepEqual(payload.tickets, [{ serie: 'S3', numero: 101 }, { serie: 'S3', numero: 102 }]);
  assert.equal(aPayloadServidor({ hashTransaccion: 'h', comercianteId: 8, monto: 5 }).tickets, undefined);
});
