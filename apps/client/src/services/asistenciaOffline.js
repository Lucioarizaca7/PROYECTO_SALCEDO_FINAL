/**
 * Asistencia del día en el celular: lista de quienes cobran por día cobrado (el ferial y el permanente con
 * tarifa por día) del padrón de la jornada, y marcas del día (asistió / faltó, con una observación opcional)
 * que esperan subir al servidor. Lógica pura; el almacenamiento lo pone el hook.
 *
 * Estado guardado: { clave: 'asistencias', fecha: 'AAAA-MM-DD',
 *                    marcas: { [puestoId]: { asistio, motivo, observacion, enviado, marcadoEn } } }
 */

export const CLAVE_ASISTENCIAS = 'asistencias';

/**
 * Observaciones del cobrador. "No salió" es una falta: no genera deuda. "No vendió" y "Se negó a pagar" son
 * asistencias: el comerciante estuvo y el día se debe. "Otro" va con la marca que elija el cobrador.
 */
export const MOTIVOS_OBSERVACION = [
  { value: 'no_salio', label: 'No salió', asistio: false },
  { value: 'no_vendio', label: 'Dice que no vendió', asistio: true },
  { value: 'se_nego_a_pagar', label: 'Se negó a pagar', asistio: true },
  { value: 'otro', label: 'Otro', asistio: null }
];

export const textoMotivo = (motivo) => MOTIVOS_OBSERVACION.find((item) => item.value === motivo)?.label || '';

/**
 * Al tocar Asistió / Faltó sobre una marca con observación, la observación se conserva si sigue siendo
 * coherente con la nueva marca ("no vendió" con asistió, "otro" con cualquiera); si no, se descarta.
 */
export function observacionQueSeConserva(marca, asistio) {
  if (!marca?.motivo && !marca?.observacion) return {};
  const implicada = MOTIVOS_OBSERVACION.find((item) => item.value === marca.motivo)?.asistio ?? null;
  if (implicada !== null && implicada !== Boolean(asistio)) return {};
  return { motivo: marca.motivo ?? null, observacion: marca.observacion ?? null };
}

/** Comerciantes del padrón con el puesto donde se marca su asistencia, ordenados por puesto y nombre. */
export function ferialesDelPadron(padron = []) {
  // El servidor solo entrega puesto_ferial_id a quien cobra por día cobrado.
  return padron
    .filter((item) => item.puestoFerialId)
    .sort((a, b) => String(a.codigoPuesto || '~').localeCompare(String(b.codigoPuesto || '~'))
      || String(a.nombresRazonSocial).localeCompare(String(b.nombresRazonSocial)));
}

/** Las marcas valen solo el día en que se hicieron: otro día empieza vacío. */
export function estadoDelDia(guardado, hoy) {
  return guardado && guardado.fecha === hoy ? guardado : { clave: CLAVE_ASISTENCIAS, fecha: hoy, marcas: {} };
}

export function aplicarMarca(estado, puestoId, asistio, ahora = new Date(), { motivo = null, observacion = null } = {}) {
  const nota = String(observacion || '').trim().slice(0, 300);
  return {
    ...estado,
    marcas: {
      ...estado.marcas,
      [String(puestoId)]: { asistio: Boolean(asistio), motivo: motivo || null, observacion: nota || null, enviado: false, marcadoEn: ahora.toISOString() }
    }
  };
}

/** Lo que falta subir, con la forma que espera POST /asistencias. */
export function marcasPendientes(estado) {
  return Object.entries(estado.marcas)
    .filter(([, marca]) => !marca.enviado)
    .map(([puestoId, marca]) => ({
      puesto_id: Number(puestoId),
      fecha: estado.fecha,
      asistio: marca.asistio,
      ...(marca.motivo ? { motivo: marca.motivo } : {}),
      ...(marca.observacion ? { observacion: marca.observacion } : {})
    }));
}

const mismaMarca = (actual, enviada) => actual.asistio === enviada.asistio
  && (actual.motivo ?? null) === (enviada.motivo ?? null)
  && (actual.observacion ?? null) === (enviada.observacion ?? null);

/** Tras subirlas: solo se marcan como enviadas las que no cambiaron mientras tanto. */
export function marcarEnviadas(estado, enviadas) {
  const marcas = { ...estado.marcas };
  for (const item of enviadas) {
    const actual = marcas[String(item.puesto_id)];
    if (actual && mismaMarca(actual, item)) marcas[String(item.puesto_id)] = { ...actual, enviado: true };
  }
  return { ...estado, marcas };
}
