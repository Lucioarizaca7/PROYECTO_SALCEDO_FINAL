/**
 * Decisiones del usuario del 12/11/2026, del lado del celular:
 * - Zona del día: la marca de asistencia y el cobro llevan la zona donde vende hoy; los tickets de hoy son los de
 *   esa zona (S2 sin asfaltar, S3 asfaltada) y, sin tickets, el monto del día es el de su tipo de vía.
 * - Cuota por puesto: la línea de tarifa dice "× N puestos".
 * - Recibo por WhatsApp: las filas del recibo (las mismas de la pantalla y de la imagen) y su texto, sin DNI.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { lineasRecibo, textoRecibo } from '../src/features/payments/recibo.js';
import { textoTarifa } from '../src/lib/formato.js';
import { aplicarMarca, estadoDelDia, marcarEnviadas, marcasPendientes } from '../src/services/asistenciaOffline.js';
import { aSaldoDePantalla, montoDiaEnZona, normalizarComerciante } from '../src/services/jornadaOffline.js';
import { aPayloadServidor } from '../src/services/offlineQueue.js';
import { desdeServidor, requeridosEnZona, requeridosPorDefecto, serieDeTipoVia } from '../src/services/ticketsOffline.js';

const hoy = '2026-11-12';

test('la marca lleva la zona del día y una marca cambiada de zona se vuelve a subir', () => {
  let estado = estadoDelDia(null, hoy);
  estado = aplicarMarca(estado, 7, true, new Date(), { zonaId: 3 });
  assert.deepEqual(marcasPendientes(estado), [{ puesto_id: 7, fecha: hoy, asistio: true, zona_id: 3 }]);
  // Marcar otra vez sin zona conserva la elegida.
  estado = aplicarMarca(estado, 7, true, new Date());
  assert.equal(marcasPendientes(estado)[0].zona_id, 3);
  // Se subió en la zona 3, pero mientras tanto el cobrador la cambió a la 4: sigue pendiente.
  const enviada = marcasPendientes(estado);
  estado = aplicarMarca(estado, 7, true, new Date(), { zonaId: 4 });
  assert.equal(marcasPendientes(marcarEnviadas(estado, enviada)).length, 1);
  // Volver a la zona del puesto (null) no manda zona.
  estado = aplicarMarca(estado, 7, true, new Date(), { zonaId: null });
  assert.equal(marcasPendientes(estado)[0].zona_id, undefined);
});

test('el cobro sin señal lleva la zona del día', () => {
  assert.equal(aPayloadServidor({ hashTransaccion: 'h', comercianteId: 1, monto: 2, zonaDia: 5 }).zona_dia, 5);
  assert.equal(aPayloadServidor({ hashTransaccion: 'h', comercianteId: 1, monto: 2 }).zona_dia, undefined);
});

test('tickets de hoy: puestos_hoy manda y la zona del día pasa todo a su serie', () => {
  const series = [{ serie: 'S3', valor: 3, puestos: 1, puestos_hoy: 0 }, { serie: 'S2', valor: 2, puestos: 1, puestos_hoy: 1 }];
  assert.deepEqual(requeridosPorDefecto(series).map((item) => [item.serie, item.cantidad]), [['S3', 0], ['S2', 1]],
    'antes pedía S3 + S2 (S/ 5) a quien hoy está solo en la zona sin asfaltar');
  // Marcado "faltó" hoy: no se sugiere ticket (antes volvía a uno por puesto).
  assert.deepEqual(requeridosPorDefecto([{ serie: 'S3', valor: 3, puestos: 1, puestos_hoy: 0 }]).map((item) => item.cantidad), [0]);
  // Sin puestos_hoy (un mes atrasado), uno por puesto como antes.
  assert.deepEqual(requeridosPorDefecto([{ serie: 'S3', valor: 3, puestos: 2 }]).map((item) => item.cantidad), [2]);

  const estado = desdeServidor(null, { series: [{ serie: 'S3', valor: 3, tipo_via: 'asfaltada', disponibles: [1] }, { serie: 'S2', valor: 2, tipo_via: 'sin_asfaltar', disponibles: [1] }] });
  const s2 = serieDeTipoVia(estado, 'sin_asfaltar');
  assert.deepEqual(s2, { serie: 'S2', valor: 2 });
  const enZona = requeridosEnZona([{ serie: 'S3', valor: 3, puestos: 1, puestos_hoy: 1 }], s2);
  assert.deepEqual(enZona.map((item) => [item.serie, item.cantidad]), [['S2', 1], ['S3', 0]]);
});

test('sin tickets, el día en otra zona vale lo de su tipo de vía', () => {
  const tarifas = [
    { estado: 1, unidad_medida: 'semanal', tipo_via: 'asfaltada', rubro_id: null, zona_id: null, monto_fijo: 3, vigencia_inicio: '2026-01-01', vigencia_fin: null },
    { estado: 1, unidad_medida: 'semanal', tipo_via: 'sin_asfaltar', rubro_id: null, zona_id: null, monto_fijo: 2, vigencia_inicio: '2026-01-01', vigencia_fin: null }
  ];
  assert.equal(montoDiaEnZona(tarifas, 'sin_asfaltar', hoy), 2);
  assert.equal(montoDiaEnZona(tarifas, 'asfaltada', hoy), 3);
  assert.equal(montoDiaEnZona(tarifas, null, hoy), null);
});

test('la cuota por puesto se ve en la línea de tarifa, también sin señal', () => {
  assert.equal(textoTarifa({ tarifa: { monto_fijo: 30 }, cantidad_puestos: 2 }), 'S/ 30 × 2 puestos');
  const registro = normalizarComerciante({ id: 9, nombre: 'Dos puestos', periodo: '2026-11', tarifa_id: 1, tarifa_monto_fijo: 90, monto_total: 180, saldo: 180, cantidad_puestos: 2 });
  assert.equal(textoTarifa(aSaldoDePantalla(registro)), 'S/ 90 × 2 puestos', 'antes el celular decía S/ 90 con saldo de S/ 180');
  assert.equal(textoTarifa({ tarifa: { monto_fijo: 30 }, cantidad_puestos: 1 }), 'S/ 30');
});

test('el recibo para WhatsApp: mismas filas que la pantalla, con tickets y total, sin DNI', () => {
  const receipt = {
    comprobante: 'R-000123', monto: 2, metodo_pago: 'efectivo', codigo_operacion: 'COB-interno', comerciante: 'María Quispe',
    concepto: 'Liquidación de deuda', cobrador: 'Juan Cobrador', hash_idempotencia: 'ABCD1234', fecha_cobro: '2026-11-12T15:00:00.000Z',
    tickets: [{ serie: 'S2', numero: 12 }], dni_ruc: '40123456'
  };
  const recibo = lineasRecibo(receipt);
  assert.equal(recibo.numero, 'R-000123');
  assert.equal(recibo.total, 'S/ 2.00');
  const filas = Object.fromEntries(recibo.filas);
  assert.equal(filas.Operación, 'No aplica', 'en efectivo no se muestra el código interno');
  assert.equal(filas.Tickets, 'S2 N° 000012');
  const texto = textoRecibo(receipt);
  assert.match(texto, /RECIBO DE PAGO \*R-000123\*/);
  assert.match(texto, /Total pagado: S\/ 2\.00/);
  assert.ok(!texto.includes('40123456'), 'Ley 29733: el recibo no lleva el DNI');
  assert.match(textoRecibo({ ...receipt, provisional: true, comprobante: 'PROV-1' }), /Recibo provisional/);

  // Se puede verificar (12/11/2026): el enlace va en el texto y el QR en la imagen; el provisional no los lleva.
  const verificable = { ...receipt, url_verificacion: 'https://sisrec.example/verificar/R-000123.abc', qr_verificacion: 'data:image/png;base64,AAAA' };
  assert.match(textoRecibo(verificable), /Verifique este recibo: https:\/\/sisrec\.example\/verificar\/R-000123\.abc/);
  assert.equal(lineasRecibo(verificable).qr, 'data:image/png;base64,AAAA');
  const provisional = { ...verificable, provisional: true };
  assert.doesNotMatch(textoRecibo(provisional), /Verifique/);
  assert.equal(lineasRecibo(provisional).qr, null);
});

test('el recibo oficial reenviado: dice si está anulado, sin huella vacía y con la fecha del cobro', () => {
  const oficial = {
    comprobante: 'R-000200', monto: 3, metodo_pago: 'efectivo', comerciante: 'Elena Choque', concepto: 'Liquidación de deuda',
    cobrador: 'Cobrador demo', fecha_cobro: '2026-11-10T15:00:00Z', estado: 'anulado', motivo_anulacion: 'Comerciante equivocado'
  };
  const recibo = lineasRecibo(oficial);
  assert.equal(recibo.aviso, 'RECIBO ANULADO: Comerciante equivocado');
  assert.ok(!recibo.filas.some(([etiqueta]) => etiqueta === 'Huella'), 'antes salía "Huella: N/A"');
  assert.match(Object.fromEntries(recibo.filas).Fecha, /10\/11\/2026/, 'la fecha del cobro, no la de hoy');
  assert.equal(lineasRecibo({ ...oficial, estado: 'confirmado' }).aviso, null);
});
