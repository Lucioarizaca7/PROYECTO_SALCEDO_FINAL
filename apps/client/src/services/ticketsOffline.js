/**
 * Tickets preimpresos en el celular del cobrador: los números disponibles de sus lotes, por serie
 * (S3 = S/ 3 vía asfaltada, S2 = S/ 2 sin asfaltar). Un ticket por puesto y día cobrado; el celular
 * indica qué números entregar y avanza la numeración sin señal. Lógica pura; el almacenamiento lo pone
 * el hook.
 *
 * Estado guardado: { clave: 'tickets', umbral, actualizadoEn,
 *                    series: { [serie]: { valor, disponibles: [números en orden] } },
 *                    consumidos: [{ serie, numero }]            usados en cobros que el servidor aún no ve,
 *                    anulacionesPendientes: [{ serie, numero, motivo, fecha }] }
 */

export const CLAVE_TICKETS = 'tickets';

export const textoTicket = (serie, numero) => `${serie} N° ${String(numero).padStart(6, '0')}`;

const clave = (serie, numero) => `${serie}-${Number(numero)}`;

export function estadoVacio() {
  return { clave: CLAVE_TICKETS, umbral: 20, actualizadoEn: null, series: {}, consumidos: [], anulacionesPendientes: [] };
}

export const estadoGuardado = (guardado) => ({ ...estadoVacio(), ...(guardado || {}) });

/**
 * Reemplaza los números con lo que dice el servidor (GET /tickets/mios o el paquete de jornada), sin
 * devolver al celular los que usó o anuló sin señal y todavía no subieron. Un consumido que el servidor ya
 * no lista como disponible ya llegó: se olvida.
 */
export function desdeServidor(guardado, data, ahora = new Date()) {
  const actual = estadoGuardado(guardado);
  const disponiblesServidor = new Set();
  for (const serie of data?.series || []) for (const numero of serie.disponibles || []) disponiblesServidor.add(clave(serie.serie, numero));
  const consumidos = actual.consumidos.filter((item) => disponiblesServidor.has(clave(item.serie, item.numero)));
  const bloqueados = new Set([...consumidos, ...actual.anulacionesPendientes].map((item) => clave(item.serie, item.numero)));
  const series = {};
  for (const serie of data?.series || []) {
    series[serie.serie] = {
      valor: Number(serie.valor),
      disponibles: (serie.disponibles || []).map(Number).filter((numero) => !bloqueados.has(clave(serie.serie, numero))).sort((a, b) => a - b)
    };
  }
  return {
    ...actual,
    umbral: Number.isInteger(Number(data?.umbral)) ? Number(data.umbral) : actual.umbral,
    actualizadoEn: ahora.toISOString(),
    series,
    consumidos
  };
}

export const tieneTickets = (estado) => Object.keys(estadoGuardado(estado).series).length > 0;

export const quedan = (estado, serie) => estadoGuardado(estado).series[serie]?.disponibles.length ?? 0;

/** Series en las que al cobrador le quedan pocos tickets (en el umbral o menos). */
export function seriesConPocos(estado) {
  const actual = estadoGuardado(estado);
  return Object.entries(actual.series)
    .filter(([, serie]) => serie.disponibles.length <= actual.umbral)
    .map(([serie, datos]) => ({ serie, valor: datos.valor, quedan: datos.disponibles.length }));
}

/** Lo que se cobra por defecto: un ticket por puesto de cada serie del comerciante (series_cobro). */
export const requeridosPorDefecto = (seriesCobro = []) => seriesCobro.map((item) => ({ serie: item.serie, valor: Number(item.valor), cantidad: Number(item.puestos) || 1 }));

export const montoDeRequeridos = (requeridos = []) => Number(requeridos.reduce((total, item) => total + item.valor * item.cantidad, 0).toFixed(2));

/**
 * Los siguientes números a entregar, en orden, para cada serie pedida ([{ serie, cantidad }]).
 * faltan: las series sin números suficientes en los lotes del cobrador.
 */
export function proximosTickets(estado, requeridos = []) {
  const actual = estadoGuardado(estado);
  const tickets = [];
  const faltan = [];
  for (const { serie, cantidad } of requeridos) {
    const disponibles = actual.series[serie]?.disponibles || [];
    tickets.push(...disponibles.slice(0, cantidad).map((numero) => ({ serie, numero })));
    if (disponibles.length < cantidad) faltan.push({ serie, faltan: cantidad - disponibles.length });
  }
  return { tickets, faltan };
}

/** Al confirmar el cobro: los números entregados dejan de estar disponibles en el celular. */
export function consumir(estado, tickets = []) {
  const actual = estadoGuardado(estado);
  const usados = new Set(tickets.map((item) => clave(item.serie, item.numero)));
  const series = Object.fromEntries(Object.entries(actual.series).map(([serie, datos]) => [
    serie, { ...datos, disponibles: datos.disponibles.filter((numero) => !usados.has(clave(serie, numero))) }
  ]));
  return { ...actual, series, consumidos: [...actual.consumidos, ...tickets.map(({ serie, numero }) => ({ serie, numero: Number(numero) }))] };
}

/** Ticket dañado o mal cortado: sale de los disponibles y la anulación queda por subir. */
export function anularLocal(estado, serie, numero, motivo, ahora = new Date()) {
  const texto = String(motivo || '').trim().slice(0, 300);
  if (texto.length < 5) throw new Error('Indique el motivo de la anulación (al menos 5 caracteres)');
  const actual = estadoGuardado(estado);
  if (!actual.series[serie]?.disponibles.includes(Number(numero))) throw new Error(`El ticket ${textoTicket(serie, numero)} no está disponible en el celular`);
  return {
    ...actual,
    series: { ...actual.series, [serie]: { ...actual.series[serie], disponibles: actual.series[serie].disponibles.filter((item) => item !== Number(numero)) } },
    anulacionesPendientes: [...actual.anulacionesPendientes, { serie, numero: Number(numero), motivo: texto, fecha: ahora.toISOString() }]
  };
}

export const anulacionesPendientes = (estado) => estadoGuardado(estado).anulacionesPendientes;

/** Tras subirlas: se quitan las que el servidor resolvió (anulada, ya anulada o rechazada); las de error temporal se reintentan. */
export function marcarAnulacionesEnviadas(estado, resultados = []) {
  const actual = estadoGuardado(estado);
  const resueltas = new Set(resultados.filter((item) => item.estado !== 'error').map((item) => clave(item.serie, item.numero)));
  return { ...actual, anulacionesPendientes: actual.anulacionesPendientes.filter((item) => !resueltas.has(clave(item.serie, item.numero))) };
}
