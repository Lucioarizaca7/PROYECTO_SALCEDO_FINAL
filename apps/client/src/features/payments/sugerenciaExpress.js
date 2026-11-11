// Sugerencia del modo express: el monto y el método del último cobro válido del comerciante.
// Antes un bucle recorría el historial del más nuevo al más viejo y se quedaba con el MÁS ANTIGUO (p. ej.
// sugería S/ 6 con Yape aunque el último fue S/ 3 en efectivo). Los cobros anulados u observados no cuentan.
import { fechaDeTexto } from '../../lib/formato.js';

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

  const cuando = (item) => fechaDeTexto(item.fecha_cobro || item.fecha)?.getTime() || 0;
  const recent = [...(Array.isArray(history) ? history : [])]
    .filter((item) => Number(item.comerciante_id ?? item.comercianteId ?? 0) === Number(merchant?.id ?? 0) || item.comerciante === merchant?.nombre)
    .filter((item) => !item.estado || item.estado === 'confirmado')
    .sort((a, b) => cuando(b) - cuando(a));

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

  const candidateAmount = Number(latest.monto ?? 0);
  const candidateMethod = String(latest.metodo_pago ?? latest.metodoPago ?? 'efectivo').toLowerCase();

  const lastDate = fechaDeTexto(latest.fecha_cobro || latest.fecha) || new Date();
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
