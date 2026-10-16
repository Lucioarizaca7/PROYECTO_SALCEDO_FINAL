/**
 * Padrón de la jornada para trabajar sin señal: se descarga al iniciar el día
 * (GET /jornada/paquete) y se busca en el celular por DNI/RUC, código, puesto o nombre.
 * Funciones puras: el almacenamiento en IndexedDB vive en offlineStore.js.
 */

const limaDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Fecha AAAA-MM-DD en Salcedo (no en UTC: a las 19:30 de Lima ya es "mañana" en UTC). */
export const hoyEnLima = (date = new Date()) => limaDate.format(date);

/** Periodo AAAA-MM en Salcedo. toISOString().slice(0, 7) daría el mes siguiente desde las 19:00 del último día. */
export const periodoEnLima = (date = new Date()) => hoyEnLima(date).slice(0, 7);

const sinTildes = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function normalizarComerciante(item, descargadoEn = new Date().toISOString()) {
  return {
    id: String(item.id),
    codigo: item.codigo || null,
    correlativo: Number(item.correlativo ?? item.id),
    codigosAnteriores: Array.isArray(item.codigos_anteriores) ? item.codigos_anteriores : [],
    numeroDocumento: String(item.dni_ruc ?? '').trim(),
    nombresRazonSocial: String(item.nombre ?? '').trim(),
    codigoPuesto: item.codigo_puesto || null,
    rubro: item.rubro || null,
    zona: item.zona || null,
    tipo: item.tipo_comerciante || item.categoria || null,
    periodo: item.periodo || null,
    tarifaId: item.tarifa_id ?? null,
    tarifaMontoFijo: item.tarifa_monto_fijo ?? null,
    montoTotal: Number(item.monto_total || 0),
    montoPagado: Number(item.monto_pagado || 0),
    saldo: Number(item.saldo || 0),
    noDevengo: Boolean(item.no_devengo),
    cobroDiario: Boolean(item.cobro_diario),
    dia: item.dia || null,
    actualizadoEn: descargadoEn
  };
}

/**
 * Busca en el padrón local. Primero las coincidencias exactas (documento, código COM-0001-…, CM-001 o número,
 * código de puesto), luego los nombres que empiezan con la búsqueda y al final los que la contienen.
 */
export function buscarEnPadron(registros, consulta, limite = 10) {
  const q = sinTildes(consulta);
  if (!q) return [];
  // "CM-001", "COM-0001" o un número corto es el correlativo del comerciante; un número largo es DNI/RUC.
  const codigo = /^(cm|com)-?\d+$/.test(q) || /^\d{1,4}$/.test(q) ? Number(q.replace(/\D/g, '')) : null;
  const ranked = [];
  for (const registro of registros || []) {
    const documento = sinTildes(registro.numeroDocumento);
    const nombre = sinTildes(registro.nombresRazonSocial);
    const puesto = sinTildes(registro.codigoPuesto);
    const codigos = [registro.codigo, ...(registro.codigosAnteriores || [])].filter(Boolean).map(sinTildes);
    let rank = null;
    if (documento && documento === q) rank = 0;
    else if (codigos.includes(q)) rank = 0;
    else if (codigo !== null && Number(registro.correlativo ?? registro.id) === codigo) rank = 0;
    else if (codigos.some((value) => value.startsWith(q))) rank = 1;
    else if (puesto && puesto === q) rank = 0;
    else if (nombre.startsWith(q)) rank = 1;
    else if (documento.startsWith(q) || puesto.startsWith(q)) rank = 2;
    else if (nombre.includes(q) || sinTildes(registro.zona).includes(q)) rank = 3;
    if (rank !== null) ranked.push({ rank, registro });
  }
  return ranked
    .sort((a, b) => a.rank - b.rank || a.registro.nombresRazonSocial.localeCompare(b.registro.nombresRazonSocial, 'es'))
    .slice(0, limite)
    .map((entry) => entry.registro);
}

/** Descuenta un cobro offline del saldo local, para no volver a cobrar lo mismo antes de sincronizar. */
export function aplicarCobroLocal(registro, monto) {
  const value = Number(monto) || 0;
  return {
    ...registro,
    saldo: Number(Math.max(Number(registro.saldo || 0) - value, 0).toFixed(2)),
    montoPagado: Number((Number(registro.montoPagado || 0) + value).toFixed(2))
  };
}

/** ¿El padrón guardado es de hoy (en Salcedo) y del periodo vigente? */
export function jornadaVigente(meta, ahora = new Date()) {
  if (!meta?.descargadoEn) return false;
  const hoy = hoyEnLima(ahora);
  return hoyEnLima(new Date(meta.descargadoEn)) === hoy && (!meta.periodo || meta.periodo === hoy.slice(0, 7));
}

/** Convierte un registro local al formato que usa la pantalla de cobro. */
export function aComercianteDePantalla(registro) {
  return {
    id: Number(registro.id),
    nombre: registro.nombresRazonSocial,
    dni_ruc: registro.numeroDocumento,
    rubro: registro.rubro,
    zona: registro.zona,
    codigo: registro.codigoPuesto || registro.codigo,
    offline: true
  };
}

export function aSaldoDePantalla(registro, periodo) {
  return {
    periodo: registro.periodo || periodo,
    monto_total: registro.montoTotal,
    monto_pagado: registro.montoPagado,
    saldo: Number(registro.saldo || 0),
    tarifa: registro.tarifaMontoFijo === null || registro.tarifaMontoFijo === undefined ? null : { id: registro.tarifaId, monto_fijo: registro.tarifaMontoFijo },
    no_devengo: registro.noDevengo,
    cobro_diario: Boolean(registro.cobroDiario),
    dia: registro.dia || null,
    offline: true,
    actualizado_en: registro.actualizadoEn
  };
}
