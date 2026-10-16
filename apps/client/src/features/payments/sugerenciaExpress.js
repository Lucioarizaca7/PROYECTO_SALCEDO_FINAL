// Sugerencia del modo express: el monto y el método que el comerciante suele usar.
// Si los 3 últimos cobros repiten monto (o método), se sugiere ese; si no, el del último cobro.

// Caché corta para no recalcular con cada render (1 minuto, 50 entradas como máximo).
const suggestionCache = new Map();
const SUGGESTION_CACHE_TTL = 60000;

function getSuggestionFromCache(key) {
  const item = suggestionCache.get(key);
  if (!item) return null;
  if (Date.now() - item.timestamp > SUGGESTION_CACHE_TTL) {
    suggestionCache.delete(key);
    return null;
  }
  return item.data;
}

function setSuggestionInCache(key, data) {
  suggestionCache.set(key, { data, timestamp: Date.now() });
  if (suggestionCache.size > 50) suggestionCache.delete(suggestionCache.keys().next().value);
}

function hashHistory(history) {
  if (!history || !Array.isArray(history) || history.length === 0) return 'empty';
  const first = history[0] || {};
  const last = history[history.length - 1] || {};
  return `${history.length}_${first.comercianteId || '0'}_${last.comercianteId || '0'}`;
}

export function buildExpressSuggestion(merchant, balance, history = []) {
  const balanceAmount = balance?.saldo || 0;
  const cacheKey = `${merchant?.id || 'unknown'}_${balanceAmount}_${hashHistory(history)}`;
  const cached = getSuggestionFromCache(cacheKey);
  if (cached) return cached;

  const recent = [...(Array.isArray(history) ? history : [])]
    .filter((item) => Number(item.comerciante_id ?? item.comercianteId ?? 0) === Number(merchant?.id ?? 0) || item.comerciante === merchant?.nombre)
    .sort((a, b) => new Date(b.fecha_cobro || b.fecha || 0) - new Date(a.fecha_cobro || a.fecha || 0));

  const latest = recent[0] || null;
  const baseAmount = Number(balance?.saldo ?? 0);
  if (!latest) {
    const result = {
      suggestedAmount: baseAmount > 0 ? Number(baseAmount.toFixed(2)) : 0,
      preferredMethod: 'efectivo',
      lastLabel: 'Sin historial previo: el sistema no tiene cobros anteriores para este comerciante.',
      lastPayment: null
    };
    setSuggestionInCache(cacheKey, result);
    return result;
  }

  let streakAmount = 1;
  let candidateAmount = Number(latest.monto ?? 0);
  for (let i = 1; i < recent.length; i += 1) {
    const current = Number(recent[i].monto ?? 0);
    const previous = Number(recent[i - 1].monto ?? 0);
    if (current === previous) {
      streakAmount += 1;
      if (streakAmount >= 3) candidateAmount = current;
    } else {
      streakAmount = 1;
      candidateAmount = current;
    }
  }

  const methodOf = (item) => String(item?.metodo_pago ?? item?.metodoPago ?? 'efectivo').toLowerCase();
  let streakMethod = 1;
  let candidateMethod = String(latest.metodo_pago ?? latest.metodoPago ?? 'efectivo');
  for (let i = 1; i < recent.length; i += 1) {
    const current = methodOf(recent[i]);
    if (current === methodOf(recent[i - 1])) {
      streakMethod += 1;
      if (streakMethod >= 3) candidateMethod = current;
    } else {
      streakMethod = 1;
      candidateMethod = current;
    }
  }

  const lastDate = new Date(latest.fecha_cobro || latest.fecha || Date.now());
  const diffDays = Math.max(0, Math.round((Date.now() - lastDate.getTime()) / 86400000));
  const methodLabel = String(candidateMethod || 'efectivo').toLowerCase();

  const result = {
    suggestedAmount: candidateAmount > 0 ? Number(candidateAmount.toFixed(2)) : Number((baseAmount || 0).toFixed(2)),
    preferredMethod: methodLabel || 'efectivo',
    lastLabel: `Último cobro: S/ ${Number(latest.monto || 0).toFixed(2)} con ${methodLabel.toUpperCase()} (${diffDays === 0 ? 'hoy' : diffDays === 1 ? 'ayer' : `hace ${diffDays} días`})`,
    lastPayment: latest
  };
  setSuggestionInCache(cacheKey, result);
  return result;
}
