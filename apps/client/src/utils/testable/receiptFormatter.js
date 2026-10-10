/**
 * Funciones de formato para recibos y documentos
 * Extraídas de App.jsx para hacerlas testeables
 */

/**
 * Construye el contenido ESC/POS para una impresora térmica
 * @param {Object} receipt - Objeto de recibo con los datos necesarios
 * @returns {string} Contenido ESC/POS listo para enviar a la impresora
 */
export function buildEscPosReceipt(receipt) {
  const fecha = new Date(receipt.fecha || Date.now()).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' });
  const lines = [
    '\x1B\x40',
    '\x1B\x61\x01',
    'MUNI C.P. SALCEDO\n',
    '\x1B\x61\x00',
    'RECIBO DE PAGO\n',
    `Nro: ${receipt.comprobante || 'N/A'}\n`,
    `Fecha: ${fecha}\n`,
    `Comerciante: ${receipt.comerciante || '-'}\n`,
    `Concepto: ${receipt.concepto || 'Liquidación de deuda'}\n`,
    `Método: ${receipt.metodo_pago || 'efectivo'}\n`,
    `Monto: S/ ${Number(receipt.monto || 0).toFixed(2)}\n`,
    `Hash: ${receipt.hash_idempotencia || 'N/A'}\n`,
    '-------------------------------\n',
    'Gracias por su contribución\n',
    '\x1D\x56\x00'
  ];
  return lines.join('');
}

/**
 * Normaliza un objeto de comerciante para almacenamiento en IndexedDB
 * @param {Object} item - Objeto de comerciante proveniente de API o formulario
 * @returns {Object} Objeto normalizado listo para almacenamiento
 */
export function normalizeLocalMerchant(item) {
  const id = String(item.id ?? item.comercianteId ?? item.comerciante_id ?? '');
  return {
    id,
    numeroDocumento: String(item.dni_ruc ?? item.numeroDocumento ?? '').trim(),
    nombresRazonSocial: String(item.nombre ?? item.nombresRazonSocial ?? '').trim(),
    puestoId: String(item.puesto_id ?? item.puestoId ?? item.id ?? '').trim(),
    codigoPuesto: String(item.codigo_puesto ?? item.codigoPuesto ?? `S-${String(item.id ?? '').padStart(3, '0')}`),
    categoriaRubro: String(item.rubro ?? item.categoriaRubro ?? 'general').trim(),
    montoTasaDiaria: Number(item.monto_tasa_diaria ?? item.montoTasaDiaria ?? item.monto ?? 0),
    estadoPagoHoy: Boolean(item.estado_pago_hoy ?? item.estadoPagoHoy ?? false),
    updatedAt: new Date().toISOString(),
    zona: item.zona ?? item.zona_id ?? null,
    estado: item.estado ?? 'activo'
  };
}

/**
 * Construye una sugerencia express basada en el historial de pagos
 * @param {Object} merchant - Objeto de comerciante
 * @param {Object|number} balance - Saldo o objeto con propiedad saldo
 * @param {Array} history - Historial de pagos previos
 * @returns {Object} Sugerencia con monto, método y etiqueta
 */
export function buildExpressSuggestion(merchant, balance, history = []) {
  // Filtrar historial por comerciante (compatibilidad con diferentes formatos de ID)
  const merchantId = Number(merchant?.id ?? 0);
  const merchantName = String(merchant?.nombre ?? '');

  const recent = [...(Array.isArray(history) ? history : [])]
    .filter((item) => {
      // Soportar tanto formatos de ID numérico como nombre
      const itemMerchantId = Number(item.comerciante_id ?? item.comercianteId ?? 0);
      const itemMerchantName = String(item.comerciante ?? '');
      return merchantId > 0 ? itemMerchantId === merchantId :
             merchantName.length > 0 ? itemMerchantName === merchantName : false;
    })
    .sort((a, b) => new Date(b.fecha_cobro || b.fecha || 0) - new Date(a.fecha_cobro || a.fecha || 0));

  const latest = recent[0] || null;
  const baseAmount = Number(balance?.saldo ?? 0);
  if (!latest && !recent.length) {
    return {
      suggestedAmount: baseAmount > 0 ? Number(baseAmount.toFixed(2)) : 0,
      preferredMethod: 'efectivo',
      lastLabel: 'Sin historial previo: el sistema no tiene cobros anteriores para este comerciante.',
      lastPayment: null
    };
  }

  let streakAmount = 1;
  let candidateAmount = Number(latest?.monto ?? 0);
  for (let i = 1; i < recent.length; i += 1) {
    const current = Number(recent[i].monto ?? 0);
    const previous = Number(recent[i - 1].monto ?? 0);
    if (current === previous) {
      streakAmount += 1;
      if (streakAmount >= 3) {
        candidateAmount = current;
      }
    } else {
      streakAmount = 1;
      candidateAmount = Number(recent[i].monto ?? 0);
    }
  }

  let streakMethod = 1;
  let candidateMethod = String(latest?.metodo_pago ?? latest?.metodoPago ?? 'efectivo');
  for (let i = 1; i < recent.length; i += 1) {
    const current = String(recent[i]?.metodo_pago ?? recent[i]?.metodoPago ?? 'efectivo').toLowerCase();
    const previous = String(recent[i - 1]?.metodo_pago ?? recent[i - 1]?.metodoPago ?? 'efectivo').toLowerCase();
    if (current === previous) {
      streakMethod += 1;
      if (streakMethod >= 3) {
        candidateMethod = current;
      }
    } else {
      streakMethod = 1;
      candidateMethod = current;
    }
  }

  const finalSuggestedAmount = candidateAmount > 0 ? Number(candidateAmount.toFixed(2)) : Number((baseAmount || 0).toFixed(2));
  const lastDate = latest ? new Date(latest.fecha_cobro || latest.fecha || Date.now()) : null;
  const diffDays = lastDate ? Math.max(0, Math.round((Date.now() - lastDate.getTime()) / 86400000)) : 0;
  const methodLabel = String(candidateMethod || 'efectivo').toLowerCase();
  const lastLabel = latest
    ? `Último cobro: S/ ${Number(latest.monto || 0).toFixed(2)} con ${methodLabel.toUpperCase()} (${diffDays === 0 ? 'hoy' : diffDays === 1 ? 'ayer' : `hace ${diffDays} días`})`
    : 'Sin historial previo: el sistema no tiene cobros anteriores para este comerciante.';

  return {
    suggestedAmount: finalSuggestedAmount,
    preferredMethod: methodLabel || 'efectivo',
    lastLabel,
    lastPayment: latest
  };
}