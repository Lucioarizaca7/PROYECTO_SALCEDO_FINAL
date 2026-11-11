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
    puestoFerialId: item.puesto_ferial_id ?? null,
    diasAsistidos: item.dias_asistidos ?? null,
    // Series de ticket preimpreso con que se le cobra (un ticket por puesto y día); vacía = sin ticket.
    // Deuda de meses anteriores (sin esto, sin señal solo se veía y cobraba el mes en curso).
    deudaVencida: Number(item.deuda_vencida || 0),
    periodosImpagos: Array.isArray(item.periodos_impagos)
      ? item.periodos_impagos.map((fila) => ({ periodo: fila.periodo, saldo: Number(fila.saldo || 0) }))
      : (Array.isArray(item.meses_impagos) ? item.meses_impagos.map((periodo) => ({ periodo, saldo: null })) : []),
    seriesCobro: Array.isArray(item.series_cobro) ? item.series_cobro.map((serie) => ({ serie: serie.serie, valor: Number(serie.valor), puestos: Number(serie.puestos) || 1 })) : [],
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

const dos = (valor) => Number(Number(valor || 0).toFixed(2));

/** Meses atrasados con saldo (antes del periodo del padrón), del más antiguo al más reciente. */
export function mesesAtrasados(registro) {
  const actual = registro.periodo;
  return (registro.periodosImpagos || [])
    .filter((item) => (!actual || item.periodo < actual) && (item.saldo === null || item.saldo > 0))
    .sort((a, b) => a.periodo.localeCompare(b.periodo));
}

/**
 * Descuenta un cobro offline del saldo local, para no volver a cobrar lo mismo antes de sincronizar.
 * periodo: el mes al que se aplicó; si es un mes atrasado, se descuenta de ese mes y no del actual.
 */
export function aplicarCobroLocal(registro, monto, periodo = null) {
  const value = Number(monto) || 0;
  if (periodo && registro.periodo && periodo !== registro.periodo) {
    return {
      ...registro,
      deudaVencida: dos(Math.max(Number(registro.deudaVencida || 0) - value, 0)),
      periodosImpagos: (registro.periodosImpagos || []).map((item) => (
        item.periodo === periodo && item.saldo !== null ? { ...item, saldo: dos(Math.max(item.saldo - value, 0)) } : item
      ))
    };
  }
  return {
    ...registro,
    saldo: dos(Math.max(Number(registro.saldo || 0) - value, 0)),
    montoPagado: dos(Number(registro.montoPagado || 0) + value)
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
    codigo: registro.codigo || null,
    codigo_puesto: registro.codigoPuesto || null,
    offline: true
  };
}

/**
 * Saldo del comerciante en el formato de la pantalla de cobro, con su deuda atrasada (deuda_acumulada) como en
 * línea. Sin periodo pedido se toma el mes impago más antiguo (se cobra primero), igual que en línea.
 */
export function aSaldoDePantalla(registro, periodo = null) {
  const atrasados = mesesAtrasados(registro);
  const actual = registro.periodo || periodo;
  const elegido = atrasados.find((item) => item.periodo === (periodo || atrasados[0]?.periodo));
  const deudaAcumulada = atrasados.length ? {
    desde: atrasados[0].periodo,
    periodo_mas_antiguo: atrasados[0].periodo,
    deuda_vencida: dos(registro.deudaVencida),
    deuda_total: dos(Number(registro.deudaVencida || 0) + Number(registro.saldo || 0)),
    periodos: [
      ...atrasados.map((item) => ({ periodo: item.periodo, saldo: Number(item.saldo || 0), vencida: true })),
      ...(Number(registro.saldo || 0) > 0 ? [{ periodo: actual, saldo: Number(registro.saldo), vencida: false }] : [])
    ]
  } : null;
  if (elegido && elegido.saldo !== null) {
    // Mes atrasado: el padrón trae solo su saldo; la tarifa y los tickets del mes son los del comerciante.
    return {
      periodo: elegido.periodo,
      monto_total: elegido.saldo,
      monto_pagado: 0,
      saldo: elegido.saldo,
      tarifa: null,
      no_devengo: false,
      cobro_diario: false,
      dia: null,
      series_cobro: registro.seriesCobro || [],
      deuda_acumulada: deudaAcumulada,
      offline: true,
      actualizado_en: registro.actualizadoEn
    };
  }
  return {
    deuda_acumulada: deudaAcumulada,
    periodo: registro.periodo || periodo,
    monto_total: registro.montoTotal,
    monto_pagado: registro.montoPagado,
    saldo: Number(registro.saldo || 0),
    tarifa: registro.tarifaMontoFijo === null || registro.tarifaMontoFijo === undefined ? null : { id: registro.tarifaId, monto_fijo: registro.tarifaMontoFijo },
    no_devengo: registro.noDevengo,
    cobro_diario: Boolean(registro.cobroDiario),
    dia: registro.dia || null,
    series_cobro: registro.seriesCobro || [],
    offline: true,
    actualizado_en: registro.actualizadoEn
  };
}
