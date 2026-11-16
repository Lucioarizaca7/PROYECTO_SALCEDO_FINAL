// Textos y reglas de la Etapa 3 que el cliente necesita para guiar. El servidor decide siempre
// (db.js: deudaParaAviso, resolverAnulacion, registrarReclamo; migración 0035).

/** Días que tiene el comerciante para reclamar un día marcado (RN-27). */
export const DIAS_PARA_RECLAMAR = 7;

export const TIPOS_RECLAMO = { no_asistio: 'Ese día no asistió', ya_pago: 'Ya pagó ese día' };
export const ESTADOS_RECLAMO = { pendiente: 'Pendiente', procedente: 'Procedente', no_procedente: 'No procedente' };

/** Número de un aviso de deuda: A-000012. */
export const numeroAviso = (avisoId) => `A-${String(avisoId).padStart(6, '0')}`;

/** Texto del aviso de deuda (RN-53) para imprimir o enviar. Sin DNI: solo nombre, código, monto y fecha. */
export function textoAviso(aviso) {
  return `Aviso de deuda ${numeroAviso(aviso.id)}. ${aviso.comerciante} (${aviso.comerciante_codigo}): al ${String(aviso.emitido_en).slice(0, 10)} ` +
    `debe S/ ${Number(aviso.deuda).toFixed(2)} por días cobrados sin pagar desde el ${aviso.dia_impago}. ` +
    'Puede pagar al cobrador o en la oficina de Rentas. Si no está de acuerdo, puede presentar su reclamo.';
}

/** Nadie resuelve la anulación que él mismo pidió (RN-38): la aprueba o rechaza el otro super administrador. */
export const puedeResolverAnulacion = (solicitud, usuarioId) => Number(solicitud.solicitado_por_id) !== Number(usuarioId);

/** El primer día que todavía se puede reclamar, contando hacia atrás desde hoy (AAAA-MM-DD). */
export function primerDiaReclamable(hoy) {
  const fecha = new Date(`${hoy}T12:00:00Z`);
  fecha.setUTCDate(fecha.getUTCDate() - DIAS_PARA_RECLAMAR);
  return fecha.toISOString().slice(0, 10);
}
