/**
 * Tickets preimpresos (migrations/0014_tickets_preimpresos.sql): un ticket de papel por puesto y día cobrado,
 * serie S3 (S/ 3, vía asfaltada) o S2 (S/ 2, sin asfaltar), tomado de los lotes del cobrador.
 * Las pruebas de este archivo corren a la vez: cada una crea sus cobradores, zonas, comerciantes y rangos.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  initializeDatabase, createUser, insertComerciante, insertPuesto, insertZona, marcarAsistencias, registrarCobro,
  syncOfflineBatch, anularCobro, asignarLote, reasignarTickets, devolverTickets, anularTickets, ticketsDelCobrador,
  getLotes, resumenTickets, cerrarCaja, getAuditTrail, getJornadaPackage, todayInLima, currentPeriod
} from '../src/db.js';

let correlativo = 0;
const unico = () => `${process.pid}-${correlativo += 1}-${Date.now()}`;
let documento = 20888000000;
const AUDIT = { accion: 'PRUEBA_TICKETS' };

const nuevoCobrador = () => createUser({ nombre: `Cobrador tickets ${unico()}`, email: `tickets-${unico()}@prueba.pe`, password: 'clave-de-prueba-1', rol: 'cobrador' });
const rubroId = async (db) => (await db.query(`SELECT id FROM rubros WHERE nombre = 'ropa'`)).rows[0].id;

// Comerciante permanente con un puesto en una zona (con o sin tipo de vía). Con la zona asfaltada se le
// cobra S/ 3 por día cobrado (tarifa general de la migración 0013, vigente desde el mes actual).
async function comerciante(db, tipoVia = 'asfaltada') {
  const zona = await insertZona(db, { nombre: `Zona tickets ${unico()}`, tipo_via: tipoVia ?? undefined });
  const merchant = await insertComerciante(db, {
    dni_ruc: String(documento += 1), nombre: `Tickets ${documento}`, rubro_id: await rubroId(db), zona_id: zona.id,
    tipo_comerciante: 'permanente', estado: 'activo', usuario_creador: 1
  });
  const puesto = await insertPuesto(db, { zona_id: zona.id, metros_cuadrados: 4, direccion: `Tickets ${unico()}`, comerciante_id: merchant.id });
  return { zona, merchant, puesto };
}

const hoy = () => todayInLima();
// Otro día del mismo mes, para tener dos días cobrados.
const otroDia = () => `${currentPeriod()}-${hoy().endsWith('-01') ? '02' : '01'}`;
const marcarDia = (db, puestoId, fecha) => db.query(
  `INSERT INTO asistencias_feriales (puesto_id, fecha, sesion, marca, fuente) VALUES ($1, $2::date, '', 'P', 'app') ON CONFLICT DO NOTHING`, [puestoId, fecha]);
async function estadoTicket(db, serie, numero) {
  const fila = (await db.query('SELECT estado, transaccion_id, motivo FROM tickets WHERE serie = $1 AND numero = $2', [serie, numero])).rows[0];
  return { ...fila, transaccion_id: fila.transaccion_id === null ? null : Number(fila.transaccion_id) };
}
const cobro = (db, cobradorId, merchantId, monto, tickets, extra = {}) =>
  registrarCobro(db, { comerciante_id: merchantId, cobrador_id: cobradorId, monto, metodo_pago: 'efectivo', tickets, ...extra }, { audit: AUDIT });
const offline = (merchantId, monto, tickets) => ({
  comerciante_id: merchantId, monto, metodo_pago: 'efectivo', fecha_cobro: new Date().toISOString(),
  hash_transaccion: `hash-${unico()}`, tickets
});

test('asignar, cruzar, reasignar y devolver lotes', async () => {
  const db = await initializeDatabase();
  const ana = await nuevoCobrador();
  const beto = await nuevoCobrador();

  const lote = await asignarLote(db, { serie: 'S3', numero_desde: 1001, numero_hasta: 1050, cobrador_id: ana.id }, { usuarioId: 1, audit: AUDIT });
  assert.equal(lote.total, 50);
  assert.equal(lote.siguiente, 1001);
  await assert.rejects(asignarLote(db, { serie: 'S3', numero_desde: 1040, numero_hasta: 1060, cobrador_id: beto.id }), /se cruza con el lote/);
  // La otra serie tiene su propia numeración.
  await asignarLote(db, { serie: 'S2', numero_desde: 1001, numero_hasta: 1010, cobrador_id: beto.id });
  await assert.rejects(asignarLote(db, { serie: 'S3', numero_desde: 2001, numero_hasta: 2002, cobrador_id: 1 }), /rol cobrador/);
  await assert.rejects(asignarLote(db, { serie: 'S3', numero_desde: 1, numero_hasta: 9000, cobrador_id: ana.id }), /como máximo/);

  // Ana usa el 1001; se reasigna a Beto el tramo 1001-1020: solo pasan los disponibles.
  const { merchant } = await comerciante(db);
  await cobro(db, ana.id, merchant.id, 3, [{ serie: 'S3', numero: 1001 }]);
  const { nuevo, movidos, origen } = await reasignarTickets(db, lote.id, { cobrador_id: beto.id, numero_desde: 1001, numero_hasta: 1020 }, { usuarioId: 1, audit: AUDIT });
  assert.equal(movidos, 19);
  assert.equal(nuevo.cobrador_id, beto.id);
  assert.equal(nuevo.siguiente, 1002);
  assert.equal(origen.disponibles, 30);
  assert.equal((await estadoTicket(db, 'S3', 1001)).estado, 'usado', 'el usado se queda con Ana');

  await assert.rejects(devolverTickets(db, lote.id, { motivo: 'no' }), /motivo/);
  const devuelto = await devolverTickets(db, lote.id, { numero_desde: 1041, numero_hasta: 1050, motivo: 'Fin de la feria' }, { usuarioId: 1, audit: AUDIT });
  assert.equal(devuelto.devueltos, 10);
  assert.equal((await estadoTicket(db, 'S3', 1045)).estado, 'devuelto');

  const deAna = (await ticketsDelCobrador(db, ana.id)).series.find((item) => item.serie === 'S3');
  assert.equal(deAna.quedan, 20);
  assert.equal(deAna.disponibles[0], 1021);
  assert.equal(deAna.pocos, true, '20 tickets está en el umbral de aviso');
  assert.equal((await getLotes(db, { cobradorId: beto.id })).length, 2);

  const auditoria = await getAuditTrail(db, { entidad: 'ticket_lotes' });
  for (const texto of [`Lote ${lote.id}:`, `del lote ${lote.id} reasignados`, `del lote ${lote.id} devueltos`]) {
    assert.ok(auditoria.some((item) => item.detalle.includes(texto)), texto);
  }
});

test('en línea: un ticket por día cobrado y la suma es el monto', async () => {
  const db = await initializeDatabase();
  const cobrador = await nuevoCobrador();
  await asignarLote(db, { serie: 'S3', numero_desde: 3001, numero_hasta: 3020, cobrador_id: cobrador.id });
  await asignarLote(db, { serie: 'S2', numero_desde: 3001, numero_hasta: 3020, cobrador_id: cobrador.id });

  // Un día: S/ 3 con un ticket.
  const uno = await comerciante(db);
  const pago = await cobro(db, cobrador.id, uno.merchant.id, 3, [{ serie: 'S3', numero: 3001 }]);
  assert.equal(pago.estado, 'confirmado');
  assert.deepEqual(pago.tickets.map((item) => item.texto), ['S3 N° 003001']);
  assert.deepEqual(await estadoTicket(db, 'S3', 3001), { estado: 'usado', transaccion_id: pago.id, motivo: null });

  // Dos días adeudados: S/ 6 con dos tickets seguidos.
  const dos = await comerciante(db);
  await marcarDia(db, dos.puesto.id, otroDia());
  const doble = await cobro(db, cobrador.id, dos.merchant.id, 6, [{ serie: 'S3', numero: 3002 }, { serie: 'S3', numero: 3003 }]);
  assert.equal(doble.tickets.length, 2);

  // Dos puestos en vías distintas el mismo día: un ticket de cada serie.
  const mixto = await comerciante(db);
  const tierra = await insertZona(db, { nombre: `Zona tickets ${unico()}`, tipo_via: 'sin_asfaltar' });
  const segundo = await insertPuesto(db, { zona_id: tierra.id, metros_cuadrados: 4, direccion: `Tickets ${unico()}`, comerciante_id: mixto.merchant.id });
  await marcarAsistencias(db, [mixto.puesto.id, segundo.id].map((puesto_id) => ({ puesto_id, fecha: hoy(), asistio: true })), { usuarioId: cobrador.id });
  const paquete = (await getJornadaPackage(db)).comerciantes.find((item) => item.id === mixto.merchant.id);
  assert.deepEqual(paquete.series_cobro, [{ serie: 'S3', valor: 3, puestos: 1 }, { serie: 'S2', valor: 2, puestos: 1 }]);
  const ambos = await cobro(db, cobrador.id, mixto.merchant.id, 5, [{ serie: 'S3', numero: 3004 }, { serie: 'S2', numero: 3001 }]);
  assert.equal(ambos.estado, 'confirmado');

  const quedan = await ticketsDelCobrador(db, cobrador.id);
  assert.deepEqual(quedan.series.map((item) => [item.serie, item.disponibles[0]]), [['S3', 3005], ['S2', 3002]]);
});

test('en línea se rechaza lo que no cuadra, y quien no cobra por día no lleva ticket', async () => {
  const db = await initializeDatabase();
  const cobrador = await nuevoCobrador();
  const otro = await nuevoCobrador();
  await asignarLote(db, { serie: 'S3', numero_desde: 4001, numero_hasta: 4010, cobrador_id: cobrador.id });
  await asignarLote(db, { serie: 'S3', numero_desde: 4101, numero_hasta: 4110, cobrador_id: otro.id });
  const { merchant } = await comerciante(db);
  await marcarDia(db, (await comerciante(db)).puesto.id, hoy());

  await assert.rejects(cobro(db, cobrador.id, merchant.id, 3, []), /Falta el ticket/);
  await assert.rejects(cobro(db, cobrador.id, merchant.id, 3, [{ serie: 'S2', numero: 4001 }]), /no corresponde a los puestos/);
  await assert.rejects(cobro(db, cobrador.id, merchant.id, 3, [{ serie: 'S3', numero: 4101 }]), /no es del lote del cobrador/);
  await marcarDia(db, (await db.query('SELECT id FROM puestos WHERE comerciante_id = $1', [merchant.id])).rows[0].id, otroDia());
  await assert.rejects(cobro(db, cobrador.id, merchant.id, 6, [{ serie: 'S3', numero: 4001 }]), /suman S\/ 3.00 y el cobro es de S\/ 6.00/);
  await assert.rejects(cobro(db, cobrador.id, merchant.id, 3, [{ serie: 'S3', numero: 4001 }, { serie: 'S3', numero: 4001 }]), /repetido/);
  // Nada de lo rechazado dejó el ticket usado.
  assert.equal((await estadoTicket(db, 'S3', 4001)).estado, 'disponible');

  await cobro(db, cobrador.id, merchant.id, 3, [{ serie: 'S3', numero: 4001 }]);
  await assert.rejects(cobro(db, cobrador.id, merchant.id, 3, [{ serie: 'S3', numero: 4001 }]), /ya fue usado en el cobro/);

  // Zona sin tipo de vía: tarifa del rubro, sin ticket.
  const porRubro = await comerciante(db, null);
  const sinTicket = await cobro(db, cobrador.id, porRubro.merchant.id, 5, undefined);
  assert.deepEqual(sinTicket.tickets, []);
  await assert.rejects(cobro(db, cobrador.id, porRubro.merchant.id, 3, [{ serie: 'S3', numero: 4002 }]), /no lleva ticket/);

  // Un cobrador sin tickets asignados sigue cobrando sin ticket.
  const sinLotes = await nuevoCobrador();
  const libre = await comerciante(db);
  assert.equal((await cobro(db, sinLotes.id, libre.merchant.id, 3, undefined)).estado, 'confirmado');
});

test('sin señal: un ticket en conflicto deja el cobro observado; dos cobradores a la vez suben bien', async () => {
  const db = await initializeDatabase();
  const ana = await nuevoCobrador();
  const beto = await nuevoCobrador();
  await asignarLote(db, { serie: 'S3', numero_desde: 5001, numero_hasta: 5010, cobrador_id: ana.id });
  await asignarLote(db, { serie: 'S3', numero_desde: 5101, numero_hasta: 5110, cobrador_id: beto.id });
  const comerciantes = [];
  for (let i = 0; i < 5; i += 1) comerciantes.push(await comerciante(db));

  // Ana y Beto cobran sin señal, cada uno con sus números, y suben al mismo tiempo.
  const [deAna, deBeto] = await Promise.all([
    syncOfflineBatch(db, [offline(comerciantes[0].merchant.id, 3, [{ serie: 'S3', numero: 5001 }]),
      offline(comerciantes[1].merchant.id, 3, [{ serie: 'S3', numero: 5002 }])], { cobradorId: ana.id }),
    syncOfflineBatch(db, [offline(comerciantes[2].merchant.id, 3, [{ serie: 'S3', numero: 5101 }]),
      offline(comerciantes[3].merchant.id, 3, [{ serie: 'S3', numero: 5102 }])], { cobradorId: beto.id })
  ]);
  assert.equal(deAna.resumen.sincronizado, 2);
  assert.equal(deBeto.resumen.sincronizado, 2);
  assert.equal((await estadoTicket(db, 'S3', 5102)).estado, 'usado');

  // El mismo número desde dos celulares de Ana: el segundo cobro se registra, pero observado.
  const repetido = await syncOfflineBatch(db, [offline(comerciantes[4].merchant.id, 3, [{ serie: 'S3', numero: 5001 }])], { cobradorId: ana.id });
  assert.equal(repetido.resumen.observado, 1);
  assert.match(repetido.resultados[0].mensaje, /S3 N° 005001 ya fue usado/);
  // Un número del lote de Beto declarado por Ana.
  const ajeno = await syncOfflineBatch(db, [offline(comerciantes[0].merchant.id, 3, [{ serie: 'S3', numero: 5103 }])], { cobradorId: ana.id });
  assert.equal(ajeno.resumen.observado, 1);
  assert.equal((await estadoTicket(db, 'S3', 5103)).estado, 'disponible', 'el ticket ajeno no se toca');

  const resumen = await resumenTickets(db, ana.id, hoy());
  assert.equal(resumen.series[0].usados, 2);
  assert.equal(resumen.observados.length, 2);
  assert.equal(resumen.cobrado_con_ticket, 12);
  assert.equal(resumen.monto_tickets, 6);
  assert.equal(resumen.diferencia, 6, 'dos cobros sin ticket válido: S/ 6 cobrados sin ticket');
});

test('anular tickets: con motivo, del propio lote, y reenviar no falla', async () => {
  const db = await initializeDatabase();
  const cobrador = await nuevoCobrador();
  const otro = await nuevoCobrador();
  await asignarLote(db, { serie: 'S2', numero_desde: 6001, numero_hasta: 6005, cobrador_id: cobrador.id });

  const { resultados } = await anularTickets(db, [
    { serie: 'S2', numero: 6001, motivo: 'Mal cortado' },
    { serie: 'S2', numero: 6002, motivo: '' },
    { serie: 'S2', numero: 6003, motivo: 'Se mojó' }
  ], { usuarioId: cobrador.id, audit: AUDIT });
  assert.deepEqual(resultados.map((item) => item.estado), ['anulado', 'rechazado', 'anulado']);
  assert.deepEqual(await estadoTicket(db, 'S2', 6001), { estado: 'anulado', transaccion_id: null, motivo: 'Mal cortado' });

  const reenvio = await anularTickets(db, [{ serie: 'S2', numero: 6001, motivo: 'Mal cortado' }], { usuarioId: cobrador.id });
  assert.equal(reenvio.resultados[0].estado, 'ya_anulado');
  const ajeno = await anularTickets(db, [{ serie: 'S2', numero: 6004, motivo: 'Mal cortado' }], { usuarioId: otro.id });
  assert.equal(ajeno.resultados[0].estado, 'rechazado');

  const quedan = (await ticketsDelCobrador(db, cobrador.id)).series[0];
  assert.deepEqual(quedan.disponibles, [6002, 6004, 6005]);
  assert.ok((await getAuditTrail(db, { entidad: 'tickets' })).some((item) => item.detalle === 'Ticket S2 N° 006003 anulado: Se mojó'));
});

test('anular el cobro anula sus tickets; el cierre de caja guarda el resumen y marca los saltos', async () => {
  const db = await initializeDatabase();
  const cobrador = await nuevoCobrador();
  await asignarLote(db, { serie: 'S3', numero_desde: 7001, numero_hasta: 7010, cobrador_id: cobrador.id });
  const uno = await comerciante(db);
  const dos = await comerciante(db);

  const anulado = await cobro(db, cobrador.id, uno.merchant.id, 3, [{ serie: 'S3', numero: 7001 }]);
  const resultado = await anularCobro(db, anulado.id, { motivo: 'Cobro de prueba', usuarioId: 1 });
  assert.deepEqual(resultado.tickets_anulados, ['S3 N° 007001']);
  assert.match((await estadoTicket(db, 'S3', 7001)).motivo, /Cobro \d+ anulado: Cobro de prueba/);

  // Se entrega el 7003 sin haber usado el 7002: el 7002 aparece como salto.
  await cobro(db, cobrador.id, dos.merchant.id, 3, [{ serie: 'S3', numero: 7003 }]);
  const cierre = await cerrarCaja(db, cobrador.id, { declarado: { efectivo: 3 } }, { audit: AUDIT });
  assert.equal(cierre.diferencia, 0);
  assert.deepEqual(cierre.tickets.series[0].saltos, [7002]);
  assert.equal(cierre.tickets.series[0].usados, 1);
  assert.equal(cierre.tickets.series[0].anulados, 1);
  assert.equal(cierre.tickets.diferencia, 0);
  assert.equal(cierre.tickets.alertas, 1);
  assert.ok((await getAuditTrail(db, { entidad: 'cierres_caja' })).some((item) => Number(item.usuario_id) === cobrador.id && item.detalle.includes('tickets usados S3 1, alertas 1')));
});
