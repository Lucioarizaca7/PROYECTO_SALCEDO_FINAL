import { useEffect, useState } from 'react';
import { useBluetoothPrint } from './utils/bluetoothPrint';

import { KpiCard } from './components/ui/KpiCard';
import { DashboardSkeleton } from './components/ui/DashboardSkeleton';
import { ScrollSnapContainer, ScrollSnapSection } from './components/layout/ScrollSnapContainer';
import { MerchantDirectory } from './features/merchants/MerchantDirectory';
import { QrScanner } from './features/payments/QrScanner';
import { SitesMap } from './components/features/map/SitesMap';
import { SyncStatusBadge } from './components/ui/SyncStatusBadge';
import { TariffCalculator } from './components/landing/TariffCalculator';
import { TransparencySection, LandingFooter } from './components/landing/TransparencySection';
import { useNetworkStatus } from './hooks/useNetworkStatus';

const configuredApiBase = import.meta.env.VITE_API_URL || 'http://localhost:3003/api/v1';
const apiBase = `${configuredApiBase.replace(/\/+$/, '').replace(/\/api(?:\/v1)?$/, '')}/api/v1`;
const formatPEN = (value) => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN', minimumFractionDigits: 2 }).format(Number(value) || 0);

const navItems = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'comerciantes', label: 'Comerciantes', roles: ['super_admin', 'auditor'] },
  { key: 'sitios', label: 'Sitios de venta' },
  { key: 'pagos', label: 'Pagos y cobros', roles: ['super_admin', 'cobrador'] },
  { key: 'zonas', label: 'Zonas y calles', roles: ['super_admin', 'auditor'] },
  { key: 'mapa', label: 'Mapa de sitios', roles: ['super_admin', 'cobrador'] },
  { key: 'reportes', label: 'Reportes' },
  { key: 'auditoria', label: 'Auditoría' },
  { key: 'ia', label: 'Analítica de recaudación' },
  { key: 'tarifas', label: 'Tarifas', roles: ['super_admin'] }
];

// Memoization cache for buildExpressSuggestion to avoid recalculations
const suggestionCache = new Map();
const SUGGESTION_CACHE_TTL = 60000; // 1 minute

function getSuggestionFromCache(merchantId, balanceAmount, historyHash) {
  const key = `${merchantId}_${balanceAmount}_${historyHash}`;
  const item = suggestionCache.get(key);
  if (!item) return null;
  if (Date.now() - item.timestamp > SUGGESTION_CACHE_TTL) {
    suggestionCache.delete(key);
    return null;
  }
  return item.data;
}

function setSuggestionInCache(merchantId, balanceAmount, historyHash, data) {
  const key = `${merchantId}_${balanceAmount}_${historyHash}`;
  suggestionCache.set(key, { data, timestamp: Date.now() });
  // Clean old entries occasionally
  if (suggestionCache.size > 50) {
    const keys = Array.from(suggestionCache.keys());
    const oldestKey = keys[0];
    suggestionCache.delete(oldestKey);
  }
}

// Simple hash function for history array
function hashHistory(history) {
  if (!history || !Array.isArray(history) || history.length === 0) return 'empty';
  // Use first and last elements plus length for a reasonable hash
  const first = history[0] || {};
  const last = history[history.length - 1] || {};
  return `${history.length}_${first.comercianteId || first.comercianteId || '0'}_${last.comercianteId || last.comercianteId || '0'}`;
}
const getStoredToken = () => localStorage.getItem('sisrec-token');

// Sesión del portal del comerciante (carnet): el celular la recuerda 30 días. El almacenamiento
// puede estar bloqueado, así que el portal funciona igual sin él.
const PORTAL_TOKEN_KEY = 'sisrec-portal-token';
const readPortalToken = () => {
  try { return localStorage.getItem(PORTAL_TOKEN_KEY) || ''; } catch { return ''; }
};
const writePortalToken = (token) => {
  try {
    if (token) localStorage.setItem(PORTAL_TOKEN_KEY, token);
    else localStorage.removeItem(PORTAL_TOKEN_KEY);
  } catch {
    // Sin almacenamiento, la sesión dura mientras la página esté abierta.
  }
};
// "#portal?llave=XXXX" del QR del reverso del carnet.
const portalHashKey = () => {
  const match = window.location.hash.match(/^#portal(?:\?(.*))?$/);
  return match ? { open: true, llave: new URLSearchParams(match[1] || '').get('llave') || '' } : { open: false, llave: '' };
};

const getAuthHeaders = (extraHeaders = {}) => {
  const token = getStoredToken();
  return {
    ...extraHeaders,
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
};

async function createOfflineHash(payload) {
  const encoder = new TextEncoder();
  const source = `${payload.cobradorId}|${payload.comercianteId}|${payload.puestoId || ''}|${payload.fechaCobro}|${payload.monto}|${payload.salt || Date.now()}`;
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(source));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function createReceiptHash(payload) {
  const encoder = new TextEncoder();
  const source = `${payload.cobradorId}|${payload.comercianteId}|${payload.puestoId || ''}|${payload.fechaCobro}|${payload.monto}|${payload.codigoComprobante}|${payload.salt || Date.now()}`;
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(source));
  return Array.from(new Uint8Array(digest)).slice(0, 8).map((byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function buildEscPosReceipt(receipt) {
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

// Enhanced printThermalReceipt function with offline queuing
async function printThermalReceipt(receipt) {
  if (!receipt) return;

  if (!('bluetooth' in navigator)) {
    window.print();
    return;
  }

  // Set printing status
  setPrintStatus({ isPrinting: true, error: null });

  try {
    // Use the optimized Bluetooth printing utility
    const { getBluetoothPrinter } = await import('./utils/bluetoothPrint');
    const printer = getBluetoothPrinter();

    // Try to initialize with cached device
    const isInitialized = await printer.initialize();

    if (isInitialized) {
      // Try to print with offline queuing fallback
      await printer.printReceiptWithQueue(receipt);
    } else {
      // Fallback to requesting device if no cached device
      await printer.requestDevice();
      await printer.printReceiptWithQueue(receipt);
    }

    // Success - clear printing status after a short delay
    setTimeout(() => setPrintStatus({ isPrinting: false, error: null }), 1500);
  } catch (error) {
    console.warn('Bluetooth printing failed:', error);
    // Set error status
    setPrintStatus({ isPrinting: false, error: error.message });
    window.print();
  }
}

// Share via WhatsApp with Web Share API fallback
function shareViaWhatsApp(receipt) {
  if (!receipt) return;

  // Pre-generate the message text to avoid delay
  const mensaje = `Recibo ${receipt.comprobante} SISREC Salcedo - S/ ${receipt.monto.toFixed(2)}`;

  // Try Web Share API first if available
  if (navigator.share) {
    navigator.share({
      title: `Recibo ${receipt.comprobante}`,
      text: mensaje
    }).catch(() => {
      // Fallback to wa.me/ if Web Share fails
      window.open(`https://wa.me/?text=${encodeURIComponent(mensaje)}`, '_blank');
    });
  } else {
    // Fallback to wa.me/ if Web Share API is not available
    window.open(`https://wa.me/?text=${encodeURIComponent(mensaje)}`, '_blank');
  }
}

// Share debt reminder via WhatsApp with Web Share API fallback
function shareViaWhatsAppDebtReminder(portalData) {
  if (!portalData || !portalData.comerciante) return;

  // Pre-generate the message text to avoid delay
  const mensaje = `Recordatorio SISREC: saldo pendiente S/ ${portalData.deuda.saldo.toFixed(2)}`;

  // Try Web Share API first if available
  if (navigator.share) {
    navigator.share({
      title: `Recordatorio SISREC`,
      text: mensaje
    }).catch(() => {
      // Fallback to wa.me/ if Web Share fails
      window.open(`https://wa.me/?text=${encodeURIComponent(mensaje)}`, '_blank');
    });
  } else {
    // Fallback to wa.me/ if Web Share API is not available
    window.open(`https://wa.me/?text=${encodeURIComponent(mensaje)}`, '_blank');
  }
}

async function openOfflineDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('sisrec-offline-db', 4);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains('padron')) {
        const padronStore = db.createObjectStore('padron', { keyPath: 'id' });
        padronStore.createIndex('numeroDocumento', 'numeroDocumento', { unique: false });
        padronStore.createIndex('codigoPuesto', 'codigoPuesto', { unique: false });
        padronStore.createIndex('nombresRazonSocial', 'nombresRazonSocial', { unique: false });
        padronStore.createIndex('estadoPagoHoy', 'estadoPagoHoy', { unique: false });
      }

      if (!db.objectStoreNames.contains('cobros')) {
        const cobrosStore = db.createObjectStore('cobros', { keyPath: 'id', autoIncrement: true });
        cobrosStore.createIndex('hashTransaccion', 'hashTransaccion', { unique: true });
        cobrosStore.createIndex('sincronizado', 'sincronizado', { unique: false });
        cobrosStore.createIndex('fechaCobro', 'fechaCobro', { unique: false });
      }

      if (!db.objectStoreNames.contains('mapa')) {
        db.createObjectStore('mapa', { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains('mapa_pendientes')) {
        db.createObjectStore('mapa_pendientes', { keyPath: 'id', autoIncrement: true });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function normalizeLocalMerchant(item) {
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

async function savePadronSnapshot(merchantList = []) {
function buildExpressSuggestion(merchant, balance, history = []) {
  // Create cache key from inputs
  const merchantId = merchant?.id || 'unknown';
  const balanceAmount = balance?.saldo || 0;
  const historyHash = hashHistory(history);
  
  // Check cache first
  const cached = getSuggestionFromCache(merchantId, balanceAmount, historyHash);
  if (cached) return cached;

  const recent = [...(Array.isArray(history) ? history : [])]
    .filter((item) => Number(item.comerciante_id ?? item.comercianteId ?? 0) === Number(merchant?.id ?? 0) || item.comerciante === merchant?.nombre)
    .sort((a, b) => new Date(b.fecha_cobro || b.fecha || 0) - new Date(a.fecha_cobro || a.fecha || 0));

  const latest = recent[0] || null;
  const baseAmount = Number(balance?.saldo ?? 0);
  if (!latest && !recent.length) {
    const result = {
      suggestedAmount: baseAmount > 0 ? Number(baseAmount.toFixed(2)) : 0,
      preferredMethod: 'efectivo',
      lastLabel: 'Sin historial previo: el sistema no tiene cobros anteriores para este comerciante.',
      lastPayment: null
    };
    setSuggestionInCache(merchantId, balanceAmount, historyHash, result);
    return result;
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

  const result = {
    suggestedAmount: finalSuggestedAmount,
    preferredMethod: methodLabel || 'efectivo',
    lastLabel,
    lastPayment: latest
  };
  
  // Cache the result for future use
  setSuggestionInCache(merchantId, balanceAmount, historyHash, result);
  return result;
}
  if (!merchantList.length || !('indexedDB' in window)) return;

  const db = await openOfflineDatabase();
  const tx = db.transaction('padron', 'readwrite');
  const store = tx.objectStore('padron');

  for (const item of merchantList) {
    const payload = normalizeLocalMerchant(item);
    if (payload.id) {
      store.put(payload);
    }
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function searchLocalMerchant(query) {
  if (!('indexedDB' in window)) return null;

  const db = await openOfflineDatabase();
  const tx = db.transaction('padron', 'readonly');
  const store = tx.objectStore('padron');
  const records = await new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });

  const normalizedQuery = String(query || '').trim().toLowerCase();
  if (!normalizedQuery) return null;

  return records.find((item) => {
    const hayCoincidencia = [
      item.numeroDocumento,
      item.nombresRazonSocial,
      item.codigoPuesto,
      item.puestoId,
      item.zona,
      item.id
    ].some((value) => String(value || '').toLowerCase().includes(normalizedQuery));

    return hayCoincidencia;
  }) || null;
}

async function saveMapSnapshot(puestos = []) {
  if (!puestos.length || !('indexedDB' in window)) return;

  const db = await openOfflineDatabase();
  const tx = db.transaction('mapa', 'readwrite');
  const store = tx.objectStore('mapa');
  puestos.forEach((puesto) => store.put(puesto));

  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function readMapSnapshot() {
  if (!('indexedDB' in window)) return [];

  const db = await openOfflineDatabase();
  const tx = db.transaction('mapa', 'readonly');
  const request = tx.objectStore('mapa').getAll();

  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function queueMapMutation(operation, payload) {
  const db = await openOfflineDatabase();
  const tx = db.transaction('mapa_pendientes', 'readwrite');
  tx.objectStore('mapa_pendientes').add({ operation, payload, createdAt: new Date().toISOString() });

  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function syncPendingMapMutations() {
  if (!navigator.onLine || !getStoredToken()) return;

  const db = await openOfflineDatabase();
  const readTx = db.transaction('mapa_pendientes', 'readonly');
  const request = readTx.objectStore('mapa_pendientes').getAll();
  const pending = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });

  for (const mutation of pending) {
    const { operation, payload } = mutation;
    const endpoint = operation === 'create'
      ? `${apiBase}/puestos-mapa`
      : `${apiBase}/puestos-mapa/${payload.id}`;
    const response = await fetch(endpoint, {
      method: operation === 'create' ? 'POST' : operation === 'update' ? 'PUT' : 'DELETE',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: operation === 'delete' ? undefined : JSON.stringify(payload)
    });

    if (!response.ok) break;

    const deleteTx = db.transaction('mapa_pendientes', 'readwrite');
    deleteTx.objectStore('mapa_pendientes').delete(mutation.id);
    await new Promise((resolve, reject) => {
      deleteTx.oncomplete = resolve;
      deleteTx.onerror = () => reject(deleteTx.error);
    });
  }
}

async function queueOfflinePayment(payload) {
  const db = await openOfflineDatabase();
  const hashTransaccion = await createOfflineHash({
    cobradorId: payload.cobrador_id || payload.cobradorId,
    comercianteId: payload.comerciante_id || payload.comercianteId,
    puestoId: payload.puesto_id || payload.puestoId || 'offline',
    fechaCobro: payload.fecha_cobro || payload.fechaCobro || new Date().toISOString(),
    monto: payload.monto,
    salt: payload.codigo_operacion || payload.codigoOperacion || Date.now()
  });

  return new Promise((resolve, reject) => {
    const tx = db.transaction('cobros', 'readwrite');
    const store = tx.objectStore('cobros');
    const request = store.put({
      ...payload,
      hashTransaccion,
      sincronizado: 0,
      intentos: 0,
      createdAt: new Date().toISOString()
    });
    request.onsuccess = () => resolve({ ok: true, hashTransaccion });
    request.onerror = () => reject(request.error);
  });
}

async function syncPendingOfflinePayments() {
  if (!navigator.onLine || !getStoredToken()) return;

  const db = await openOfflineDatabase();
  const tx = db.transaction('cobros', 'readonly');
  const store = tx.objectStore('cobros');
  const request = store.getAll();

  return new Promise((resolve, reject) => {
    request.onsuccess = async () => {
      const pendings = (request.result || []).filter((item) => item.sincronizado === 0);
      try {
        for (const cobro of pendings) {
          const response = await fetch(`${apiBase}/cobros/sincronizar`, {
            method: 'POST',
            headers: getAuthHeaders({
              'Content-Type': 'application/json',
              'X-Idempotency-Key': cobro.hashTransaccion
            }),
            body: JSON.stringify({
              ...cobro,
              comerciante_id: cobro.comerciante_id ?? cobro.comercianteId,
              cobrador_id: cobro.cobrador_id ?? cobro.cobradorId,
              metodo_pago: cobro.metodo_pago ?? cobro.metodoPago ?? 'efectivo',
              fecha_cobro: cobro.fecha_cobro || cobro.fechaCobro || new Date().toISOString(),
              hash_transaccion: cobro.hashTransaccion
            })
          });

          if (response.ok || response.status === 409) {
            const deleteTx = db.transaction('cobros', 'readwrite');
            deleteTx.objectStore('cobros').delete(cobro.id);
            await new Promise((done, fail) => {
              deleteTx.oncomplete = done;
              deleteTx.onerror = () => fail(deleteTx.error);
            });
          } else {
            const updateTx = db.transaction('cobros', 'readwrite');
            const updateRequest = updateTx.objectStore('cobros').put({ ...cobro, intentos: Number(cobro.intentos || 0) + 1, sincronizado: 0 });
            await new Promise((done, fail) => {
              updateRequest.onsuccess = done;
              updateRequest.onerror = () => fail(updateRequest.error);
            });
            break;
          }
        }
        resolve();
      } catch (error) {
        reject(error);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

const merchants = [];
const sites = [];
const payments = [];
const inspectors = [];
const zones = [];
const tariffs = [];
const FRECUENCIA_LABELS = { por_feria: 'Por feria', semanal: 'Semanal (2 ferias)', mensual: 'Mensual' };
const auditTrail = [];
const users = [];

function App() {
  const isOnline = useNetworkStatus();
  const [user, setUser] = useState(() => {
    try {
      const savedUser = localStorage.getItem('sisrec-user');
      const parsedUser = savedUser ? JSON.parse(savedUser) : null;
      return parsedUser && typeof parsedUser === 'object' ? parsedUser : null;
    } catch (storageError) {
      try {
        localStorage.removeItem('sisrec-user');
        localStorage.removeItem('sisrec-token');
      } catch {
        // The landing page should still render when browser storage is disabled.
      }
      return null;
    }
  });
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [apiConnected, setApiConnected] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [printStatus, setPrintStatus] = useState({ isPrinting: false, error: null });
  const [loginForm, setLoginForm] = useState({
    email: '',
    password: ''
  });
  const [dashboardStats, setDashboardStats] = useState({
    recaudacion: 'S/ 0.00',
    pagos: 0,
    sitios: '0',
    pendientes: 0,
    morosidad: '0%',
    comerciantes: 0
  });
  const [operational, setOperational] = useState({ porZona: [], porRubro: [], porCobrador: [] });
  const [comerciantes, setComerciantes] = useState([]);
  const [tarifas, setTarifas] = useState([]);
  const [tariffRecords, setTariffRecords] = useState([]);
  const [cobros, setCobros] = useState([]);
  const [mapPuestos, setMapPuestos] = useState([]);
  const [mapMessage, setMapMessage] = useState('');
  const [reportRows, setReportRows] = useState([]);
  const [auditRecords, setAuditRecords] = useState([]);
  const [catalogos, setCatalogos] = useState({ rubros: [], zonas: [] });
  const [zoneRecords, setZoneRecords] = useState([]);
  const [calleRecords, setCalleRecords] = useState([]);
  const [zoneForm, setZoneForm] = useState({ nombre: '', descripcion: '' });
  const [calleForm, setCalleForm] = useState({ zona_id: '', nombre: '', descripcion: '', estado: 'activo' });
  const [editingZoneId, setEditingZoneId] = useState(null);
  const [editingCalleId, setEditingCalleId] = useState(null);
  const [zoneMessage, setZoneMessage] = useState('');
  const [predictiveData, setPredictiveData] = useState({ totalProyectado: 0, promedioDiario: 0, porZona: [], porRubro: [] });
  const [riskData, setRiskData] = useState({ summary: { total: 0, bajo: 0, medio: 0, alto: 0, critico: 0 }, records: [] });
  const [loading, setLoading] = useState(true);
  const [showMerchantForm, setShowMerchantForm] = useState(false);
  const [merchantMessage, setMerchantMessage] = useState('');
  const [padronFile, setPadronFile] = useState(null);
  const [padronPreview, setPadronPreview] = useState(null);
  const [padronImportMessage, setPadronImportMessage] = useState('');
  const [padronImportLoading, setPadronImportLoading] = useState(false);
  const [padronFeriaDate, setPadronFeriaDate] = useState('');
  const [editingMerchantId, setEditingMerchantId] = useState(null);
  const [merchantForm, setMerchantForm] = useState({
    dni_ruc: '',
    nombre: '',
    rubro_id: '1',
    zona_id: '1',
    categoria: 'permanente',
    tipo_comerciante: 'permanente',
    estado: 'activo',
    frecuencia_pago: 'semanal'
  });
  const [editingTariffId, setEditingTariffId] = useState(null);
  const [tariffMessage, setTariffMessage] = useState('');
  const [tariffForm, setTariffForm] = useState({ monto_por_feria: '', vigencia_inicio: '' });
  const [newTariffForm, setNewTariffForm] = useState(null);
  const [showPortal, setShowPortal] = useState(() => portalHashKey().open);
  const [portalIdentifier, setPortalIdentifier] = useState('');
  const [portalKey, setPortalKey] = useState('');
  const [portalToken, setPortalToken] = useState('');
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalData, setPortalData] = useState(null);
  const [portalError, setPortalError] = useState('');
  const [paymentForm, setPaymentForm] = useState({ search: '', comercianteId: '', periodo: new Date().toISOString().slice(0, 7), monto: '', metodo_pago: 'efectivo', codigo_operacion: '', observaciones: '' });
  const [paymentMerchant, setPaymentMerchant] = useState(null);
  const [paymentBalance, setPaymentBalance] = useState(null);
  const [expressSuggestion, setExpressSuggestion] = useState({ suggestedAmount: 0, preferredMethod: 'efectivo', lastLabel: 'Sin historial previo', lastPayment: null });
  const [paymentMessage, setPaymentMessage] = useState('');
  const [showQrScanner, setShowQrScanner] = useState(false);
  const [receipt, setReceipt] = useState(null);

  // Process the offline print queue while the app is open.
  useEffect(() => {
    const handleFocus = async () => {
      try {
        const offlineQueue = await import('./utils/offlinePrintQueue');
        const queue = offlineQueue.getOfflinePrintQueue();
        if (!(await queue.hasPendingJobs())) return;

        const { getBluetoothPrinter } = await import('./utils/bluetoothPrint');
        const printer = getBluetoothPrinter();
        if (await printer.initialize()) {
          await queue.processQueue((queuedReceipt) => printer.printReceipt(queuedReceipt));
        }
      } catch (error) {
        console.error('Error processing offline print queue:', error);
      }
    };
    const handleVisibilityChange = () => {
      if (!document.hidden) handleFocus();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    const intervalId = setInterval(handleFocus, 30000);
    handleFocus();
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const loadPublicDashboard = async () => {
      try {
        const [dashboardResponse, postsResponse] = await Promise.all([
          fetch(`${apiBase}/dashboard`, { signal: controller.signal }),
          fetch(`${apiBase}/puestos`, { signal: controller.signal })
        ]);
        if (!dashboardResponse.ok || !postsResponse.ok) throw new Error('API no disponible');
        const dashboard = await dashboardResponse.json();
        const posts = await postsResponse.json();
        setDashboardStats((current) => ({
          ...current,
          recaudacion: formatPEN(dashboard.stats?.recaudacion ?? 0),
          pagos: dashboard.stats?.pagos ?? 0,
          sitios: String(posts.total ?? (posts.data || []).length),
          pendientes: dashboard.stats?.deudaPendiente ?? 0,
          morosidad: `${dashboard.stats?.morosidad ?? 0}%`,
          comerciantes: dashboard.stats?.totalComerciantes ?? 0
        }));
        setOperational(dashboard.operational || { porZona: [], porRubro: [], porCobrador: [] });
        setApiConnected(true);
      } catch (error) {
        if (!controller.signal.aborted) setApiConnected(false);
      }
    };
    loadPublicDashboard();
    return () => controller.abort();
  }, []);

  const saveMerchantPreferences = async (merchantId, payload) => {
    if (!merchantId) return null;
    try {
      const response = await fetch(`${apiBase}/comerciantes/${merchantId}/preferencias`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo guardar la preferencia');
      const preferences = Array.isArray(data.data)
        ? Object.fromEntries(data.data.map((item) => [item.clave, item.valor]))
        : (data.data || {});
      const lastDate = preferences.ultimo_cobro_fecha;
      const lastAmount = Number(preferences.ultimo_monto || 0);
      const lastMethod = String(preferences.ultimo_metodo_pago || 'efectivo');
      setExpressSuggestion({
        suggestedAmount: Number(preferences.monto_sugerido || lastAmount),
        preferredMethod: String(preferences.metodo_pago_preferido || lastMethod),
        lastLabel: lastDate ? `Último cobro: ${formatPEN(lastAmount)} con ${lastMethod.toUpperCase()} (${new Date(lastDate).toLocaleDateString('es-PE', { day: 'numeric', month: 'short' })})` : 'Sin historial previo',
        lastPayment: { monto: lastAmount, metodo_pago: lastMethod, fecha_cobro: lastDate }
      });
      return preferences;
    } catch (error) {
      console.warn('No se pudo guardar preferencias del comerciante.', error);
      return null;
    }
  };

  const fetchData = async () => {
    try {
      const period = new Date().toISOString().slice(0, 7);
      const request = async (path) => {
        const response = await fetch(path, { headers: getAuthHeaders() });
        const body = await response.json();
        if (!response.ok) throw new Error(body.message || `Error ${response.status}`);
        return body;
      };
      const canReadAudit = ['super_admin', 'auditor'].includes(user?.rol);
      const [dashboard, comerciantes, tarifas, catalogos, cobros, puestos, report, audit, forecast, risk] = await Promise.all([
        request(`${apiBase}/dashboard?periodo=${encodeURIComponent(period)}`),
        request(`${apiBase}/comerciantes?limit=100&includeInactive=true`),
        request(`${apiBase}/tarifas-zona`),
        request(`${apiBase}/catalogos`),
        request(`${apiBase}/cobros`),
        request(`${apiBase}/puestos`),
        request(`${apiBase}/reportes?periodo=${encodeURIComponent(period)}`),
        canReadAudit ? request(`${apiBase}/auditoria`) : Promise.resolve({ data: [] }),
        request(`${apiBase}/analitica/prediccion?periodo=${encodeURIComponent(period)}&horizonte_dias=90`),
        request(`${apiBase}/analitica/riesgo?limit=5`)
      ]);

      setApiConnected(true);
      setDashboardStats({
        recaudacion: formatPEN(dashboard.stats?.recaudacion ?? dashboard.stats?.totalRecaudado ?? 0),
        pagos: dashboard.stats?.pagos ?? dashboard.stats?.totalCobros ?? 0,
        sitios: String(puestos.total ?? (puestos.data || []).length),
        pendientes: dashboard.stats?.deudaPendiente ?? 0,
        morosidad: `${dashboard.stats?.morosidad ?? 0}%`,
        comerciantes: dashboard.stats?.totalComerciantes ?? 0
      });
      setOperational(dashboard.operational || { porZona: [], porRubro: [], porCobrador: [] });

      setComerciantes((comerciantes.data || []).map((item) => [item.id, item.nombre, item.rubro, item.dni_ruc, item.zona, item.estado, new Date(item.fecha_registro).toLocaleDateString('es-PE'), item.tipo_comerciante || item.categoria, item.frecuencia_pago || 'semanal', Boolean(item.tiene_llave), item.llave_emitida_en || null]))
      setTarifas((tarifas.data || []).flatMap((zona) => zona.tarifas.map((item) => [`${zona.zona} · ${item.nombre}`, item.monto_por_feria === null ? 'Sin monto' : `S/ ${Number(item.monto_por_feria).toFixed(2)} por feria`, item.monto_por_feria === null ? 'Inactivo' : 'Activo'])))
      setTariffRecords(tarifas.data || []);
      setCobros(cobros.data || []);
      setMapPuestos(puestos.data || []);
      setReportRows(report.data || []);
      setAuditRecords(audit.data || []);
      setCatalogos({
        rubros: catalogos.rubros || [],
        zonas: catalogos.zonas || []
      });
      setPredictiveData(forecast.data || { totalProyectado: 0, promedioDiario: 0, porZona: [], porRubro: [] });
      setRiskData(risk.data || { summary: { total: 0, bajo: 0, medio: 0, alto: 0, critico: 0 }, records: [] });

      if (Array.isArray(comerciantes.data)) {
        await savePadronSnapshot(comerciantes.data);
      }
      await saveMapSnapshot(puestos.data || []);
    } catch (err) {
      setApiConnected(false);
      console.error('No se pudo cargar la información del servidor SISREC.', err);
      setComerciantes([]);
      setTarifas([]);
      setTariffRecords([]);
      setCobros([]);
      setMapPuestos(await readMapSnapshot().catch(() => []));
      setReportRows([]);
      setAuditRecords([]);
      setOperational({ porZona: [], porRubro: [], porCobrador: [] });
      setCatalogos({ rubros: [], zonas: [] });
      setApiConnected(false);
    } finally {
      setLoading(false);
    }
  };

  const refreshZoneCatalog = async () => {
    try {
      const response = await fetch(`${apiBase}/zonas`, { headers: getAuthHeaders() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudieron cargar las zonas');
      const zonas = Array.isArray(data.data) ? data.data : [];
      const calles = Array.isArray(data.calles) ? data.calles : [];

      setZoneRecords(zonas);
      setCalleRecords(calles);

      if (!calleForm.zona_id && zonas[0]?.id) {
        setCalleForm((current) => ({ ...current, zona_id: String(zonas[0].id) }));
      }
    } catch (error) {
      console.warn('No se pudo recargar la zona/calle:', error);
    }
  };

  useEffect(() => {
    if (user) {
      localStorage.setItem('sisrec-user', JSON.stringify(user));
      localStorage.setItem('sisrec-token', user.token || getStoredToken() || '');
      fetchData();
      const syncAllPending = () => {
        syncPendingOfflinePayments().catch(() => undefined);
        syncPendingMapMutations().then(() => fetchData()).catch(() => undefined);
      };
      syncAllPending();
      window.addEventListener('online', syncAllPending);
      return () => window.removeEventListener('online', syncAllPending);
    } else {
      localStorage.removeItem('sisrec-user');
      localStorage.removeItem('sisrec-token');
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    if (isOnline) {
      setPendingSyncCount(0);
      return undefined;
    }
    const loadQueueCount = async () => {
      try {
        const db = await openOfflineDatabase();
        const count = (storeName, isPending = () => true) => new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, 'readonly');
          const request = tx.objectStore(storeName).getAll();
          request.onsuccess = () => resolve((request.result || []).filter(isPending).length);
          request.onerror = () => reject(request.error);
        });
        const [paymentsCount, mapCount] = await Promise.all([
          count('cobros', (item) => item.sincronizado === 0),
          count('mapa_pendientes')
        ]);
        if (!cancelled) setPendingSyncCount(paymentsCount + mapCount);
      } catch {
        if (!cancelled) setPendingSyncCount(0);
      }
    };
    loadQueueCount();
    return () => { cancelled = true; };
  }, [isOnline]);

  const handleLogin = async (event) => {
    event.preventDefault();
    setError('');

    try {
      const apiResponse = await fetch(`${apiBase}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm)
      });

      const data = await apiResponse.json();
      if (!apiResponse.ok) {
        throw new Error(data.message || 'Credenciales inválidas');
      }

      setUser({ ...data.user, token: data.token });
    } catch (loginError) {
      setError(loginError.message || 'No se pudo iniciar sesión');
    }
  };

  const handleLogout = () => {
    setUser(null);
    setShowLogin(false);
    setError('');
    setCurrentPage('dashboard');
    localStorage.removeItem('sisrec-token');
  };

  const startPortalSession = (token, data) => {
    writePortalToken(token);
    setPortalToken(token);
    setPortalData(data);
    setPortalKey('');
  };

  const closePortalSession = (message = '') => {
    writePortalToken('');
    setPortalToken('');
    setPortalData(null);
    setPortalError(message);
  };

  const portalLogin = async (credentials) => {
    setPortalError('');
    setPortalLoading(true);
    try {
      const response = await fetch(`${apiBase}/portal/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo consultar el portal');
      startPortalSession(data.token, data.data);
    } catch (error) {
      setPortalData(null);
      setPortalError(error.message);
    } finally {
      setPortalLoading(false);
    }
  };

  const handlePortalLogin = (event) => {
    event.preventDefault();
    portalLogin({ identifier: portalIdentifier, llave: portalKey });
  };

  // Al abrir el QR del carnet entra solo y quita la llave de la barra de direcciones;
  // si no, retoma la sesión guardada en el celular.
  useEffect(() => {
    const { open, llave } = portalHashKey();
    if (open && llave) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#portal`);
      setShowPortal(true);
      portalLogin({ llave });
      return;
    }
    const saved = readPortalToken();
    if (!saved) return;
    fetch(`${apiBase}/portal/me`, { headers: { Authorization: `Bearer ${saved}` } })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Ingrese con la llave de su carnet');
        startPortalSession(saved, data.data);
        if (open) setShowPortal(true);
      })
      .catch((error) => closePortalSession(open ? error.message : ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const downloadPortalReceipt = async (payment) => {
    try {
      const response = await fetch(`${apiBase}/comprobantes/${payment.id}/pdf`, { headers: { Authorization: `Bearer ${portalToken}` } });
      if (response.status === 401) {
        const data = await response.json().catch(() => ({}));
        closePortalSession(data.message || 'Su sesión venció: ingrese otra vez con la llave de su carnet.');
        return;
      }
      if (!response.ok) throw new Error('No se pudo descargar el comprobante');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `comprobante-${payment.comprobante || payment.id}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setPortalError(error.message);
    }
  };

  const handleMerchantSubmit = async (event) => {
    event.preventDefault();
    setMerchantMessage('');

    try {
      const response = await fetch(`${apiBase}/comerciantes${editingMerchantId ? `/${editingMerchantId}` : ''}`, {
        method: editingMerchantId ? 'PUT' : 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ ...merchantForm, usuario_creador: user?.id || 1 })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo registrar el comerciante');

      setMerchantForm({ dni_ruc: '', nombre: '', rubro_id: '1', zona_id: '1', categoria: 'permanente', tipo_comerciante: 'permanente', estado: 'activo', frecuencia_pago: 'semanal' });
      setEditingMerchantId(null);
      setMerchantMessage(data.message);
      setShowMerchantForm(false);
      await fetchData();
    } catch (submitError) {
      setMerchantMessage(submitError.message);
    }
  };

  const handleMerchantEdit = (row) => {
    const [id, name, category, document, zone] = row;
    const rubro = catalogos.rubros.find((item) => item.nombre.toLowerCase() === String(category).toLowerCase());
    const zona = catalogos.zonas.find((item) => item.nombre.toLowerCase() === String(zone).toLowerCase());
    setEditingMerchantId(id);
    const merchant = comerciantes.find((item) => Number(item[0]) === Number(id));
    const tipoComerciante = merchant?.[7] || 'permanente';
    setMerchantForm({ dni_ruc: document, nombre: name, rubro_id: String(rubro?.id || 1), zona_id: String(zona?.id || 1), categoria: tipoComerciante, tipo_comerciante: tipoComerciante, estado: String(merchant?.[5] || 'activo').toLowerCase(), frecuencia_pago: merchant?.[8] || 'semanal' });
    setShowMerchantForm(true);
    setMerchantMessage('');
  };

  const handleMerchantDeactivate = async (id) => {
    try {
      const response = await fetch(`${apiBase}/comerciantes/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo dar de baja');
      setMerchantMessage(data.message);
      await fetchData();
    } catch (deactivateError) {
      setMerchantMessage(deactivateError.message);
    }
  };

  // Emite el carnet (uno o en lote): la respuesta trae la llave en claro una sola vez.
  const handleIssueCards = async (ids) => {
    const single = ids.length === 1;
    const response = await fetch(`${apiBase}/comerciantes/${single ? `${ids[0]}/llave` : 'llaves'}`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: single ? undefined : JSON.stringify({ comerciante_ids: ids })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'No se pudo emitir el carnet');
    setMerchantMessage(data.message);
    fetchData();
    return data.data;
  };

  const handlePadronPreview = async (file, feriaDate = padronFeriaDate) => {
    setPadronFile(file);
    setPadronPreview(null);
    setPadronImportMessage('');
    if (!file) return;
    setPadronImportLoading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('dryRun', 'true');
      if (feriaDate) body.append('fechaFeria', feriaDate);
      const response = await fetch(`${apiBase}/comerciantes/importar-padron`, { method: 'POST', headers: getAuthHeaders(), body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo leer el padrón');
      setPadronPreview(data.data);
      setPadronImportMessage(data.message || 'Previsualización lista.');
    } catch (importError) {
      setPadronImportMessage(importError.message || 'No se pudo leer el padrón');
    } finally {
      setPadronImportLoading(false);
    }
  };

  const sendPadronImport = async (fields) => {
    const body = new FormData();
    Object.entries(fields).forEach(([key, value]) => body.append(key, value));
    body.append('dryRun', 'false');
    const response = await fetch(`${apiBase}/comerciantes/importar-padron`, { method: 'POST', headers: getAuthHeaders(), body });
    return { response, data: await response.json() };
  };

  const handlePadronImport = async () => {
    if (!padronFile) return;
    setPadronImportLoading(true);
    setPadronImportMessage('');
    try {
      // Con el token el servidor reutiliza el libro ya leído; si expiró, se vuelve a enviar el archivo.
      let { response, data } = padronPreview?.previewToken
        ? await sendPadronImport({ previewToken: padronPreview.previewToken })
        : await sendPadronImport({ file: padronFile, fechaFeria: padronFeriaDate });
      if (response.status === 410) ({ response, data } = await sendPadronImport({ file: padronFile, fechaFeria: padronFeriaDate }));
      if (!response.ok) throw new Error(data.message || 'No se pudo importar el padrón');
      setPadronPreview(data.data);
      setPadronImportMessage(`${data.message} Nuevos: ${data.data.result.createdMerchants} comerciantes y ${data.data.result.createdPosts} puestos; asistencias: ${data.data.result.attendanceMarks} (${data.data.result.absentPosts} faltas); omitidos: ${data.data.result.skippedRows}.`);
      setPadronFile(null);
      await fetchData();
    } catch (importError) {
      setPadronImportMessage(importError.message || 'No se pudo importar el padrón');
    } finally {
      setPadronImportLoading(false);
    }
  };

  // Cambiar la fecha de la feria vuelve a previsualizar: las faltas dependen de esa fecha.
  const handlePadronFeriaDate = (value) => {
    setPadronFeriaDate(value);
    if (padronFile) handlePadronPreview(padronFile, value);
  };

  const handlePadronTemplate = async () => {
    try {
      const response = await fetch(`${apiBase}/comerciantes/plantilla-padron`, { headers: getAuthHeaders() });
      if (!response.ok) throw new Error((await response.json()).message || 'No se pudo descargar la plantilla');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'plantilla-padron-sisrec.xlsx';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (templateError) {
      setPadronImportMessage(templateError.message || 'No se pudo descargar la plantilla');
    }
  };

  const sendTariffRequest = async (path, method, body) => {
    setTariffMessage('');
    try {
      const response = await fetch(`${apiBase}/tarifas-zona${path}`, {
        method,
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: body ? JSON.stringify(body) : undefined
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo guardar la tarifa');
      setTariffMessage(data.message);
      await fetchData();
      return true;
    } catch (tariffError) {
      setTariffMessage(tariffError.message);
      return false;
    }
  };

  // Cambiar el monto de una tarifa (editingTariffId es el id de la tarifa dentro de su zona).
  const handleTariffSubmit = async (event) => {
    event.preventDefault();
    if (await sendTariffRequest(`/${editingTariffId}`, 'PUT', tariffForm)) setEditingTariffId(null);
  };

  const handleTariffCreate = async (event) => {
    event.preventDefault();
    if (await sendTariffRequest('', 'POST', newTariffForm)) setNewTariffForm(null);
  };

  const handleTariffDefault = (categoriaId) => sendTariffRequest(`/${categoriaId}/predeterminada`, 'PUT');

  const handleZoneSubmit = async (event) => {
    event.preventDefault();
    setZoneMessage('');

    try {
      const endpoint = editingZoneId ? `${apiBase}/zonas/${editingZoneId}` : `${apiBase}/zonas`;
      const method = editingZoneId ? 'PUT' : 'POST';
      const response = await fetch(endpoint, {
        method,
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(zoneForm)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo guardar la zona');
      setZoneMessage(data.message);
      setZoneForm({ nombre: '', descripcion: '' });
      setEditingZoneId(null);
      await refreshZoneCatalog();
      await fetchData();
    } catch (error) {
      setZoneMessage(error.message);
    }
  };

  const handleCalleSubmit = async (event) => {
    event.preventDefault();
    setZoneMessage('');

    try {
      const endpoint = editingCalleId ? `${apiBase}/calles/${editingCalleId}` : `${apiBase}/calles`;
      const method = editingCalleId ? 'PUT' : 'POST';
      const response = await fetch(endpoint, {
        method,
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(calleForm)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo guardar la calle');
      setZoneMessage(data.message);
      setCalleForm({ zona_id: String(zoneRecords[0]?.id || ''), nombre: '', descripcion: '', estado: 'activo' });
      setEditingCalleId(null);
      await refreshZoneCatalog();
      await fetchData();
    } catch (error) {
      setZoneMessage(error.message);
    }
  };

  const handleDeleteZone = async (id) => {
    try {
      const response = await fetch(`${apiBase}/zonas/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo eliminar la zona');
      setZoneMessage(data.message);
      await refreshZoneCatalog();
      await fetchData();
    } catch (error) {
      setZoneMessage(error.message);
    }
  };

  const handleDeleteCalle = async (id) => {
    try {
      const response = await fetch(`${apiBase}/calles/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo eliminar la calle');
      setZoneMessage(data.message);
      await refreshZoneCatalog();
      await fetchData();
    } catch (error) {
      setZoneMessage(error.message);
    }
  };

  const findPaymentMerchant = async (queryOverride) => {
    setPaymentMessage('');
    const query = String(typeof queryOverride === 'string' ? queryOverride : paymentForm.search).trim();
    if (!query) return setPaymentMessage('Ingresa DNI, RUC, nombre, puesto o código.');

    if (!navigator.onLine) {
      const localMerchant = await searchLocalMerchant(query)
        || (/^CM-\d+$/i.test(query) ? await searchLocalMerchant(query.replace(/^CM-/i, '')) : null);
      if (!localMerchant) return setPaymentMessage('No se encontró un comerciante en la caché local del dispositivo.');

      setPaymentMerchant(localMerchant);
      setPaymentBalance({ saldo: Number(localMerchant.montoTasaDiaria || 0), periodo: paymentForm.periodo });
      const suggestion = buildExpressSuggestion(localMerchant, { saldo: Number(localMerchant.montoTasaDiaria || 0) }, []);
      setExpressSuggestion(suggestion);
      setPaymentForm((current) => ({ ...current, comercianteId: String(localMerchant.id), monto: String(suggestion.suggestedAmount || localMerchant.montoTasaDiaria || 0), metodo_pago: suggestion.preferredMethod || current.metodo_pago }));
      return;
    }

    let merchant = null;
    const merchantCodeMatch = query.match(/^CM-(\d+)$/i);
    if (merchantCodeMatch) {
      const merchantResponse = await fetch(`${apiBase}/comerciantes/${Number(merchantCodeMatch[1])}`, { headers: getAuthHeaders() });
      const merchantData = await merchantResponse.json();
      if (merchantResponse.ok) merchant = merchantData.data;
    }
    if (!merchant) {
      const response = await fetch(`${apiBase}/comerciantes?search=${encodeURIComponent(query)}&limit=10`, { headers: getAuthHeaders() });
      const data = await response.json();
      merchant = data.data?.[0] || null;
    }
    if (!merchant) {
      const puestosResponse = await fetch(`${apiBase}/puestos`, { headers: getAuthHeaders() });
      const puestosData = await puestosResponse.json();
      const puesto = puestosData.data?.find((item) => String(item.codigo || item.codigo_puesto || '').trim().toLowerCase() === query.toLowerCase());
      if (puesto) {
        const merchantResponse = await fetch(`${apiBase}/comerciantes/${puesto.comerciante_id}`, { headers: getAuthHeaders() });
        const merchantData = await merchantResponse.json();
        if (merchantResponse.ok) merchant = merchantData.data;
      }
    }
    if (!merchant) return setPaymentMessage('No se encontró un comerciante con ese dato.');
    const balanceResponse = await fetch(`${apiBase}/comerciantes/${merchant.id}/saldo?periodo=${paymentForm.periodo}`, { headers: getAuthHeaders() });
    const balanceData = await balanceResponse.json();
    if (!balanceResponse.ok) return setPaymentMessage(balanceData.message || 'No se pudo calcular el saldo.');

    const historyResponse = await fetch(`${apiBase}/reportes?periodo=${paymentForm.periodo}`, { headers: getAuthHeaders() });
    const historyData = await historyResponse.json();
    const history = (historyData.data || []).filter((item) => Number(item.comerciante_id ?? item.comercianteId ?? 0) === Number(merchant.id) || String(item.comerciante || '').toLowerCase() === String(merchant.nombre || '').toLowerCase());
    const suggestion = buildExpressSuggestion(merchant, balanceData.data, history.length ? history : cobros.filter((item) => Number(item.comerciante_id || item.comercianteId || 0) === Number(merchant.id) || String(item.comerciante || '').toLowerCase() === String(merchant.nombre || '').toLowerCase()));

    setPaymentMerchant(merchant);
    setPaymentBalance(balanceData.data);
    setExpressSuggestion(suggestion);
    setPaymentForm((current) => ({ ...current, comercianteId: String(merchant.id), monto: String(suggestion.suggestedAmount || balanceData.data.saldo), metodo_pago: suggestion.preferredMethod || current.metodo_pago }));
  };

  const handleQrScan = async (rawValue) => {
    const scannedValue = String(rawValue || '').trim();
    const merchantMatch = scannedValue.match(/^(?:SISREC:\/\/comerciante\/|CM-)(\d+)$/i);
    const query = merchantMatch
      ? `CM-${String(Number(merchantMatch[1])).padStart(3, '0')}`
      : scannedValue;

    setShowQrScanner(false);
    setPaymentForm((current) => ({ ...current, search: query }));
    await findPaymentMerchant(query);
  };

  const handlePaymentSubmit = async (event) => {
    event.preventDefault();
    setPaymentMessage('');

    const payload = {
      ...paymentForm,
      comerciante_id: paymentForm.comercianteId,
      cobrador_id: user?.id || 2,
      metodo_pago: paymentForm.metodo_pago,
      fecha_cobro: new Date().toISOString(),
      periodo: paymentForm.periodo || new Date().toISOString().slice(0, 7)
    };

    try {
      if (!navigator.onLine) {
        await queueOfflinePayment(payload);
        setPaymentMessage('Cobro guardado en cola offline y pendiente de sincronización.');
        setPaymentForm((current) => ({ ...current, monto: '' }));
        return;
      }

      const response = await fetch(`${apiBase}/cobros`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo registrar el cobro');

      await saveMerchantPreferences(String(paymentForm.comercianteId), {
        monto_sugerido: Number(paymentForm.monto || 0),
        metodo_pago_preferido: paymentForm.metodo_pago,
        ultimo_monto: Number(paymentForm.monto || 0),
        ultimo_metodo_pago: paymentForm.metodo_pago,
        ultimo_cobro_fecha: new Date().toISOString(),
        total_cobros: (cobros.filter((item) => Number(item.comerciante_id ?? item.comercianteId ?? 0) === Number(paymentForm.comercianteId)).length || 0) + 1
      });

      setPaymentMessage(`${data.message}. Comprobante ${data.data.comprobante}. Saldo restante: S/ ${Number(data.data.saldo_restante || 0).toFixed(2)}`);
      const hashIdempotencia = await createReceiptHash({
        cobradorId: user?.id || 2,
        comercianteId: paymentForm.comercianteId,
        puestoId: paymentMerchant?.codigo || 'offline',
        fechaCobro: new Date().toISOString(),
        monto: Number(data.data.monto || 0),
        codigoComprobante: data.data.comprobante,
        salt: data.data.hash_transaccion || data.data.codigo_operacion || Date.now()
      });
      setReceipt({
        ...data.data,
        comerciante: paymentMerchant?.nombre || paymentMerchant?.comerciante || 'Comerciante',
        concepto: 'Liquidación de deuda',
        cobrador: user?.nombre || 'Cobrador',
        hash_idempotencia: hashIdempotencia
      });
      setPaymentBalance((current) => current ? { ...current, saldo: data.data.saldo_restante } : current);
      setPaymentForm((current) => ({ ...current, monto: '' }));
      await fetchData();
    } catch (paymentError) {
      setPaymentMessage(paymentError.message);
    }
  };

  const saveMapSite = async (payload) => {
    setMapMessage('');
    if (!navigator.onLine) {
      await queueMapMutation('create', payload);
      setMapMessage('Puesto guardado localmente; quedará pendiente de sincronización.');
      return;
    }

    const response = await fetch(`${apiBase}/puestos-mapa`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'No se pudo guardar el puesto');
    setMapMessage(data.message);
    await fetchData();
  };

  const updateMapSite = async (id, payload) => {
    setMapMessage('');
    if (!navigator.onLine) {
      await queueMapMutation('update', { id, ...payload });
      setMapMessage('Nueva posición guardada localmente; pendiente de sincronización.');
      return;
    }

    const response = await fetch(`${apiBase}/puestos-mapa/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'No se pudo actualizar el puesto');
    setMapMessage(data.message);
    await fetchData();
  };

  const deleteMapSite = async (site) => {
    if (!window.confirm(`¿Dar de baja el puesto ${site.codigo}?`)) return;
    setMapMessage('');
    if (!navigator.onLine) {
      await queueMapMutation('delete', { id: site.id });
      setMapMessage('Baja guardada localmente; pendiente de sincronización.');
      return;
    }

    const response = await fetch(`${apiBase}/puestos-mapa/${site.id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'No se pudo dar de baja el puesto');
    setMapMessage(data.message);
    await fetchData();
  };

  const mapPage = () => (
    <section className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">MAPA / DISTRIBUCIÓN</div>
          <h1>Mapa de sitios</h1>
          <p>Distribución por zona y estado de pago.</p>
        </div>
      </div>
      {mapMessage && <div className="form-message">{mapMessage}</div>}
      <SitesMap sites={mapPuestos.filter((site) => site.estado !== 'inactivo')} onCreate={saveMapSite} onUpdate={updateMapSite} onDelete={deleteMapSite} onCollect={(site) => {
        setPaymentMerchant({ id: site.comerciante_id, nombre: site.comerciante, codigo: site.codigo, rubro: site.categoria, zona: site.zona });
        setPaymentForm((current) => ({ ...current, search: site.comerciante, comercianteId: String(site.comerciante_id), monto: String(site.saldo_pendiente || '') }));
        setCurrentPage('pagos');
      }} />
    </section>
  );

  const intelligencePage = () => (
    <section className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">IA / PREDICCIÓN</div>
          <h1>Centro de inteligencia</h1>
          <p>Predicción de recaudación y riesgo de morosidad con modelado operativo del padrón.</p>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-top"><span>Proyección 90 días</span><span className="stat-icon green">↗</span></div>
          <div className="stat-value">S/ {Number(predictiveData.totalProyectado || 0).toFixed(2)}</div>
          <div className="stat-change"><span className="up">{Number(predictiveData.promedioDiario || 0).toFixed(2)}</span> por día promedio</div>
        </div>
        <div className="stat-card">
          <div className="stat-top"><span>Riesgo alto</span><span className="stat-icon red">!</span></div>
          <div className="stat-value">{riskData.summary?.alto || 0}</div>
          <div className="stat-change"><span className="downchange">{riskData.summary?.critico || 0}</span> críticos</div>
        </div>
      </div>

      <div className="page-grid two-grid">
        <div className="panel detail-card">
          <h3>Predicción de recaudación</h3>
          {(predictiveData.porZona || []).slice(0, 4).map((item) => (
            <div className="metric-line" key={item.zona || item.zona_id}>
              <span>{item.zona}</span>
              <strong>S/ {Number(item.proyectado || 0).toFixed(2)}</strong>
            </div>
          ))}
          {!(predictiveData.porZona || []).length && <div className="empty-state">No hay datos predictivos aún.</div>}
        </div>
        <div className="panel detail-card">
          <h3>Scoring de morosidad</h3>
          {(riskData.records || []).slice(0, 4).map((item) => (
            <div className="metric-line" key={item.comerciante_id}>
              <span>{item.nombre}</span>
              <strong>{item.nivel || item.nivel_riesgo}</strong>
            </div>
          ))}
          {!(riskData.records || []).length && <div className="empty-state">Sin alertas de morosidad para esta ventana.</div>}
        </div>
      </div>
    </section>
  );

  const simplePage = (type) => {
    const configs = {
      cobradores: ['Cobradores', 'Supervisa el rendimiento y las rutas de cobranza.', inspectors.map((item) => item[0]), inspectors.map((item) => item[1])],
      zonas: ['Zonas y calles', 'Administra la distribución territorial de los sitios autorizados.', zones.map((item) => item[0]), zones.map((item) => item[1])],
      tarifas: ['Tarifas', 'Configura conceptos y montos de cobro según las necesidades institucionales.', tariffs.map((item) => item[0]), tariffs.map((item) => item[1])],
      reportes: ['Reportes', 'Genera información operativa para el seguimiento de la recaudación.', ['Reporte diario de recaudación', 'Recaudación por zona', 'Rendimiento de cobradores', 'Estado de sitios'], ['Disponible', 'Disponible', 'Disponible', 'Disponible']],
      auditoria: ['Auditoría', 'Historial de acciones realizadas en SISREC.', auditTrail.map((item) => item[0]), auditTrail.map((item) => item[1])],
      usuarios: ['Usuarios y roles', 'Administra el acceso de los equipos según su responsabilidad.', users.map((item) => item[0]), users.map((item) => item[1])]
    };

    const config = configs[type] || configs.cobradores;
    const [title, subtitle, names, details] = config;

    return (
      <section className="page">
        <div className="page-heading">
          <div>
            <div className="eyebrow">GESTIÓN / {title.toUpperCase()}</div>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          <button className="primary-button" type="button">＋ Nuevo registro</button>
        </div>
        <div className="page-grid">
          {names.map((item, i) => (
            <div className="panel detail-card" key={`${item}-${i}`}>
              <div className="stat-top">
                <span>REGISTRO</span>
                <span className={`stat-icon ${i % 3 === 0 ? 'green' : i % 3 === 1 ? 'blue' : 'amber'}`}>◇</span>
              </div>
              <h3>{item}</h3>
              <div className="metric-line"><span>Detalle</span><strong>{details[i]}</strong></div>
              <div className="metric-line"><span>Estado</span><span className="status ${i === 2 ? 'pending' : 'paid'}">{i === 2 ? 'Revisión' : 'Activo'}</span></div>
              <button className="view-all" type="button">Ver detalle →</button>
            </div>
          ))}
        </div>
      </section>
    );
  };

  const renderPage = () => {
    if (loading && currentPage === 'dashboard') {
      return <DashboardSkeleton />;
    }

    switch (currentPage) {
      case 'dashboard':
        return (
          <section className="page">
            <div className="page-heading">
              <div>
                <div className="eyebrow">RESUMEN OPERATIVO | {new Date().toLocaleDateString('es-PE', { dateStyle: 'long' })}</div>
                <h1>Bienvenido, {user?.nombre?.split(' ')[0] || 'equipo'}</h1>
                <p>Este es el estado de la recaudación en Salcedo.</p>
              </div>
              <span className="date-chip">{new Date().toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'short' })}</span>
            </div>

            <div className="stats-grid">
              <KpiCard label="Recaudacion del periodo" value={dashboardStats.recaudacion} change="Acumulado del mes" icon="R" accent="green" />
              <KpiCard label="Pagos registrados" value={dashboardStats.pagos} change="Operaciones confirmadas" icon="P" accent="blue" />
              <KpiCard label="Puestos registrados" value={dashboardStats.sitios} change={`${dashboardStats.comerciantes} comerciantes activos`} icon="S" accent="amber" />
              <KpiCard label="Deuda pendiente" value={formatPEN(dashboardStats.pendientes)} change={`Morosidad ${dashboardStats.morosidad}`} icon="!" accent="red" />
            </div>

            <div className="dashboard-grid">
              <div className="panel">
                <div className="panel-heading">
                  <div>
                    <div className="panel-title">Recaudacion por rubro</div>
                    <div className="panel-subtitle">Importes acumulados en el periodo actual</div>
                  </div>
                  <select className="select-small"><option>Esta semana</option></select>
                </div>
                <div className="activity-list">
                    {operational.porRubro.length ? operational.porRubro.map((row) => (
                      <div className="metric-line" key={row.rubro}><span>{row.rubro}</span><strong>{formatPEN(row.recaudado)}</strong></div>
                    )) : <div className="empty-state">Sin recaudacion registrada en este periodo.</div>}
                </div>
              </div>

              <div className="panel">
                <div className="panel-heading">
                  <div>
                    <div className="panel-title">Mapa de sitios</div>
                    <div className="panel-subtitle">Distribución por estado de pago</div>
                  </div>
                  <button type="button" className="view-all" onClick={() => setCurrentPage('mapa')}>Ver mapa →</button>
                </div>
                <div className="activity-list dashboard-site-stats">
                    <div className="metric-line"><span>Puestos registrados</span><strong>{mapPuestos.length}</strong></div>
                    <div className="metric-line"><span>Ocupados</span><strong>{mapPuestos.filter((site) => site.estado !== 'disponible').length}</strong></div>
                </div>
              </div>
            </div>

            <div className="lower-grid">
              <div className="panel">
                <div className="panel-heading">
                  <div>
                    <div className="panel-title">Actividad reciente</div>
                    <div className="panel-subtitle">Últimos movimientos registrados</div>
                  </div>
                  <button type="button" className="view-all" onClick={() => setCurrentPage('auditoria')}>Ver todo →</button>
                </div>
                <div className="activity-list">
                  {auditRecords.slice(0, 5).map((item) => (
                    <div className="activity-item" key={item.id}>
                      <span className="activity-bullet"></span>
                      <div><strong>{item.accion} ? {item.entidad}</strong><small>{item.usuario || `Usuario ${item.usuario_id}`} ? {new Date(item.fecha).toLocaleString('es-PE')}</small></div>
                    </div>
                  ))}
                  {!auditRecords.length && <div className="empty-state">Todavia no hay actividad de auditoria para mostrar.</div>}
                </div>
              </div>

              <div className="panel">
                <div className="panel-heading">
                  <div>
                    <div className="panel-title">Alertas importantes</div>
                    <div className="panel-subtitle">Requieren atención del equipo</div>
                  </div>
                  <span className="status pending">{riskData.records?.length || 0} alertas</span>
                </div>
                <div className="alerts-list">
                  {(riskData.records || []).slice(0, 4).map((item) => (
                    <div className="alert-item" key={item.comerciante_id}>{item.nombre} ? Riesgo {item.nivel}: {item.motivo_principal}</div>
                  ))}
                  {!riskData.records?.length && <div className="empty-state">No hay alertas de morosidad calculadas.</div>}
                </div>
              </div>
            </div>

            <div className="dashboard-grid">
              {[['Deuda y cobros por zona', operational.porZona, 'zona'], ['Pagos por rubro', operational.porRubro, 'rubro']].map(([title, rows, label]) => (
                <div className="panel" key={title}>
                  <div className="panel-heading"><div><div className="panel-title">{title}</div><div className="panel-subtitle">Periodo operativo actual</div></div></div>
                  <div className="activity-list">{rows.length ? rows.map((row) => <div className="metric-line" key={row[label]}><span>{row[label]}</span><strong>S/ {Number(row.recaudado || 0).toFixed(2)}</strong></div>) : <div className="empty-state">Aún no hay movimientos registrados.</div>}</div>
                </div>
              ))}
            </div>
          </section>
        );
      case 'comerciantes':
        return <MerchantDirectory
          merchants={comerciantes.length ? comerciantes : merchants}
          catalogos={catalogos}
          loading={loading}
          message={merchantMessage}
          form={merchantForm}
          setForm={setMerchantForm}
          isFormOpen={showMerchantForm}
          setIsFormOpen={setShowMerchantForm}
          editingId={editingMerchantId}
          importPreview={padronPreview}
          importMessage={padronImportMessage}
          importLoading={padronImportLoading}
          onPreviewFile={handlePadronPreview}
          onImport={handlePadronImport}
          onDownloadTemplate={handlePadronTemplate}
          feriaDate={padronFeriaDate}
          onFeriaDateChange={handlePadronFeriaDate}
          onSubmit={handleMerchantSubmit}
          onEdit={handleMerchantEdit}
          onDeactivate={handleMerchantDeactivate}
          onIssueCards={['super_admin', 'cobrador'].includes(user?.rol) ? handleIssueCards : undefined}
          canIssueBatch={user?.rol === 'super_admin'}
        />;
      case 'sitios':
        return (
          <section className="page">
            <div className="page-heading">
              <div>
                <div className="eyebrow">GESTIÓN / SITIOS</div>
                <h1>Sitios de venta</h1>
                <p>Control de ubicaciones, disponibilidad y pagos.</p>
              </div>
            </div>
            <div className="table-card">
              <table>
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Dirección</th>
                    <th>Zona</th>
                    <th>Responsable</th>
                    <th>Cuota</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {mapPuestos.map((site) => (
                    <tr key={site.id}>
                      <td>{site.codigo || `P-${site.id}`}</td>
                      <td>{site.direccion || 'Sin dirección registrada'}</td>
                      <td>{site.zona || 'Sin zona'}</td>
                      <td>{site.comerciante || 'Sin asignar'}</td>
                      <td>{formatPEN(site.saldo_pendiente)}</td>
                      <td><span className={`status ${site.estado === 'disponible' ? 'neutral' : site.saldo_pendiente > 0 ? 'pending' : 'paid'}`}>{site.estado || 'sin estado'}</span></td>
                    </tr>
                  ))}
                  {!mapPuestos.length && <tr><td colSpan="6">No hay puestos registrados todavía.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        );
      case 'pagos':
        return (
          <section className="page">
            <div className="page-heading">
              <div>
                <div className="eyebrow">COBRO / CAMPO Y VENTANILLA</div>
                <h1>Cobro rápido</h1>
                <p>Localiza al comerciante, revisa su saldo y confirma el pago.</p>
              </div>
            </div>
            <div className="payment-workspace">
              <form className="panel payment-form" onSubmit={handlePaymentSubmit}>
                <div className="step-label">01 · Localizar comerciante</div>
                <div className="payment-search"><input required aria-label="Buscar comerciante por documento, nombre, puesto o QR" placeholder="DNI, RUC, nombre, puesto o QR" value={paymentForm.search} onChange={(event) => setPaymentForm({ ...paymentForm, search: event.target.value })} /><button className="primary-button" type="button" onClick={findPaymentMerchant}>Buscar</button><button className="secondary-button qr-open-button" type="button" onClick={() => setShowQrScanner(true)} aria-label="Escanear código QR">▦ <span>Escanear QR</span></button></div>
                {paymentMerchant && <div className="merchant-summary"><strong>{paymentMerchant.nombre}</strong><span>{paymentMerchant.dni_ruc} · {paymentMerchant.rubro} · {paymentMerchant.zona}</span><span>Puesto: {paymentMerchant.codigo}</span></div>}
                {paymentMerchant && paymentBalance && (
                  <div className="panel express-card" style={{ background: 'linear-gradient(135deg, rgba(39,174,96,0.12), rgba(15,23,42,0.08))', border: '1px solid rgba(39,174,96,0.3)', padding: '16px', borderRadius: '14px', marginTop: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                      <div>
                        <div className="eyebrow" style={{ color: '#1f9d63' }}>MODO EXPRESS</div>
                        <strong>{paymentMerchant.nombre}</strong>
                      </div>
                      <button className="primary-button" type="button" onClick={() => setPaymentForm((current) => ({ ...current, monto: String(paymentBalance.cuota_sugerida || expressSuggestion.suggestedAmount || paymentBalance.saldo || 0), metodo_pago: expressSuggestion.preferredMethod || current.metodo_pago }))}>Cobrar sugerido</button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginTop: '14px' }}>
                      <div><span style={{ display: 'block', fontSize: '12px', color: '#64748b' }}>Saldo pendiente</span><strong>S/ {Number(paymentBalance.saldo || 0).toFixed(2)}</strong></div>
                      <div><span style={{ display: 'block', fontSize: '12px', color: '#64748b' }}>Cuota {FRECUENCIA_LABELS[paymentBalance.frecuencia_pago]?.toLowerCase() || ''}</span><strong>S/ {Number(paymentBalance.cuota_sugerida || 0).toFixed(2)}</strong></div>
                      <div><span style={{ display: 'block', fontSize: '12px', color: '#64748b' }}>Método preferido</span><strong>{String(expressSuggestion.preferredMethod || 'efectivo').toUpperCase()}</strong></div>
                    </div>
                    <div style={{ marginTop: '12px', fontWeight: 600, color: '#0f172a' }}>{expressSuggestion.lastLabel}</div>
                  </div>
                )}
                <div className="step-label">02 · Revisar deuda</div>
                {paymentBalance ? <div className="debt-breakdown"><div><span>Por día de feria</span><strong>S/ {Number(paymentBalance.monto_por_feria || 0).toFixed(2)}</strong></div><div><span>Periodo</span><strong>{paymentBalance.periodo}</strong></div><div><span>Ferias cobrables</span><strong>{paymentBalance.dias_cobrables ?? 0} de {paymentBalance.dias_feria ?? 0}{paymentBalance.dias_ausente ? ` (${paymentBalance.dias_ausente} faltas)` : ''}</strong></div>{paymentBalance.credito_anterior > 0 && <div><span>A cuenta del mes anterior</span><strong>S/ {Number(paymentBalance.credito_anterior).toFixed(2)}</strong></div>}{paymentBalance.puestos?.filter((post) => post.codigo).map((post) => <div key={post.puesto_id}><span>Puesto {post.codigo} · {post.zona} · {post.tarifa}{post.asignado_desde ? ` (desde ${post.asignado_desde})` : ''}</span><strong>S/ {Number(post.monto_por_feria).toFixed(2)} por feria</strong></div>)}<div><span>Pagado</span><strong>S/ {Number(paymentBalance.monto_pagado || 0).toFixed(2)}</strong></div><div className="debt-total"><span>Saldo pendiente</span><strong>S/ {paymentBalance.saldo.toFixed(2)}</strong></div></div> : <div className="empty-state">Busca un comerciante para mostrar su liquidación.</div>}
                <div className="step-label">03 · Confirmar cobro</div>
                <div className="payment-fields"><input required min="0.01" max={paymentBalance?.saldo || undefined} step="0.01" type="number" placeholder="Monto a cobrar" value={paymentForm.monto} onChange={(event) => setPaymentForm({ ...paymentForm, monto: event.target.value })} /><select value={paymentForm.metodo_pago} onChange={(event) => setPaymentForm({ ...paymentForm, metodo_pago: event.target.value })}><option value="efectivo">Efectivo</option><option value="yape">Yape</option><option value="plin">Plin</option><option value="pos">POS</option></select></div>
                {paymentForm.metodo_pago !== 'efectivo' && <input required placeholder="Código de operación digital" value={paymentForm.codigo_operacion} onChange={(event) => setPaymentForm({ ...paymentForm, codigo_operacion: event.target.value })} />}
                <input placeholder="Observaciones (opcional)" value={paymentForm.observaciones} onChange={(event) => setPaymentForm({ ...paymentForm, observaciones: event.target.value })} />
                {paymentMessage && <div className="form-message">{paymentMessage}</div>}
                <button className="primary-button payment-submit" disabled={!paymentMerchant || !paymentBalance || paymentBalance.saldo <= 0} type="submit">Confirmar y emitir comprobante</button>
                {receipt && <div className="receipt-card" id="receiptCard"><div className="receipt-header"><strong>SISREC SALCEDO</strong><span>RECIBO DE PAGO</span></div><div className="receipt-number">{receipt.comprobante}</div><div className="receipt-lines"><div><span>Comerciante</span><strong>{receipt.comerciante}</strong></div><div><span>Fecha</span><strong>{new Date().toLocaleString('es-PE')}</strong></div><div><span>Concepto</span><strong>{receipt.concepto}</strong></div><div><span>Método</span><strong>{receipt.metodo_pago}</strong></div><div><span>Cobrador</span><strong>{receipt.cobrador}</strong></div><div><span>Operación</span><strong>{receipt.codigo_operacion || 'No aplica'}</strong></div><div><span>Hash</span><strong>{receipt.hash_idempotencia || 'N/A'}</strong></div><div className="receipt-total"><span>Total pagado</span><strong>S/ {receipt.monto.toFixed(2)}</strong></div></div><div className="receipt-actions"><button className="secondary-button" type="button" onClick={() => printThermalReceipt(receipt)}>{printStatus.isPrinting ? 'Imprimiendo...' : 'Imprimir térmica / PDF'}</button><button className="secondary-button" type="button" onClick={() => shareViaWhatsApp(receipt)}>WhatsApp</button><button className="secondary-button" type="button" onClick={() => navigator.share ? navigator.share({ title: `Recibo ${receipt.comprobante}`, text: `Recibo ${receipt.comprobante} por S/ ${receipt.monto.toFixed(2)}` }) : navigator.clipboard?.writeText(`Recibo ${receipt.comprobante} - S/ ${receipt.monto.toFixed(2)}`)}>Compartir</button></div></div>}
              </form>
              <div className="panel payment-history"><div className="panel-heading"><div><div className="panel-title">Cobros recientes</div><div className="panel-subtitle">Estado actualizado al instante</div></div></div>{(cobros.length ? cobros : payments).slice(0, 6).map((row, index) => { const item = Array.isArray(row) ? { comprobante: row[0], comerciante: row[2], monto: row[6], metodo_pago: row[7], estado: row[8] } : row; return <div className="payment-row" key={item.comprobante || index}><div><strong>{item.comprobante || `#${item.id}`}</strong><span>{item.comerciante} · {item.metodo_pago}</span></div><div><strong>{typeof item.monto === 'number' ? `S/ ${item.monto.toFixed(2)}` : item.monto}</strong><span className="status paid">{item.estado}</span></div></div>; })}</div>
            </div>
            {showQrScanner && <QrScanner onScan={handleQrScan} onClose={() => setShowQrScanner(false)} />}
          </section>
        );
      case 'mapa':
        return mapPage();
      case 'ia':
        return intelligencePage();
      case 'auditoria':
        return (
          <section className="page">
            <div className="page-heading"><div><div className="eyebrow">CONTROL / TRAZABILIDAD</div><h1>Auditoría</h1><p>Historial de acciones sensibles, usuario responsable y timestamp.</p></div></div>
            <div className="table-card"><table><thead><tr><th>Fecha</th><th>Usuario</th><th>Entidad</th><th>Acción</th><th>Detalle</th></tr></thead><tbody>{auditRecords.map((item) => <tr key={item.id}><td>{item.fecha}</td><td>{item.usuario || `Usuario ${item.usuario_id}`}</td><td>{item.entidad}</td><td><span className="status paid">{item.accion}</span></td><td>{item.detalle}</td></tr>)}</tbody></table></div>
          </section>
        );
      case 'tarifas': {
        const allTariffs = tariffRecords.flatMap((zona) => zona.tarifas.map((item) => ({ ...item, zona: zona.zona })));
        const editingTariff = allTariffs.find((item) => item.categoria_id === editingTariffId);
        const today = new Date().toISOString().slice(0, 10);
        return (
          <section className="page">
            <div className="page-heading"><div><div className="eyebrow">CONFIGURACIÓN / TARIFAS</div><h1>Cobro por zona</h1><p>Monto fijo por día de feria (martes y miércoles); la semana equivale a 2 ferias. Una zona puede tener varias tarifas (por ejemplo, pista asfaltada y sin asfaltar) y cada puesto paga la suya; la predeterminada se usa cuando no se indica. Un cambio rige desde la fecha que indiques y no altera los meses anteriores.</p></div><button className="primary-button" type="button" onClick={() => { setEditingTariffId(null); setTariffMessage(''); setNewTariffForm(newTariffForm ? null : { zona_id: String(tariffRecords[0]?.zona_id || ''), nombre: '', monto_por_feria: '', vigencia_inicio: today, predeterminada: false }); }}>＋ Agregar tarifa a una zona</button></div>
            {tariffMessage && <div className="form-message" role="status">{tariffMessage}</div>}
            {newTariffForm && (
              <form className="panel merchant-form" onSubmit={handleTariffCreate}>
                <div className="panel-heading"><div><div className="panel-title">Nueva tarifa</div><div className="panel-subtitle">Se suma a las tarifas de la zona elegida.</div></div></div>
                <div className="merchant-form-grid">
                  <label><span>Zona</span><select value={newTariffForm.zona_id} onChange={(event) => setNewTariffForm({ ...newTariffForm, zona_id: event.target.value })}>{tariffRecords.map((zona) => <option key={zona.zona_id} value={zona.zona_id}>{zona.zona}</option>)}</select></label>
                  <label><span>Nombre de la tarifa</span><input required placeholder="Ej.: Pista sin asfaltar" value={newTariffForm.nombre} onChange={(event) => setNewTariffForm({ ...newTariffForm, nombre: event.target.value })} /></label>
                  <label><span>Monto por día de feria (S/)</span><input required min="0.01" step="0.01" type="number" value={newTariffForm.monto_por_feria} onChange={(event) => setNewTariffForm({ ...newTariffForm, monto_por_feria: event.target.value })} /></label>
                  <label><span>Rige desde</span><input required type="date" min={today} value={newTariffForm.vigencia_inicio} onChange={(event) => setNewTariffForm({ ...newTariffForm, vigencia_inicio: event.target.value })} /></label>
                  <label><span>Predeterminada de la zona</span><input type="checkbox" checked={newTariffForm.predeterminada} onChange={(event) => setNewTariffForm({ ...newTariffForm, predeterminada: event.target.checked })} /></label>
                  <button className="primary-button" type="submit">Agregar tarifa</button>
                </div>
              </form>
            )}
            {editingTariff && (
              <form className="panel merchant-form" onSubmit={handleTariffSubmit}>
                <div className="panel-heading"><div><div className="panel-title">Cambiar monto · {editingTariff.zona} · {editingTariff.nombre}</div><div className="panel-subtitle">Monto actual: {editingTariff.monto_por_feria === null ? 'sin monto' : `S/ ${editingTariff.monto_por_feria.toFixed(2)} por feria`}.</div></div></div>
                <div className="merchant-form-grid">
                  <label><span>Monto por día de feria (S/)</span><input required min="0.01" step="0.01" type="number" value={tariffForm.monto_por_feria} onChange={(event) => setTariffForm({ ...tariffForm, monto_por_feria: event.target.value })} /></label>
                  <label><span>Rige desde</span><input required type="date" min={today} value={tariffForm.vigencia_inicio} onChange={(event) => setTariffForm({ ...tariffForm, vigencia_inicio: event.target.value })} /></label>
                  <button className="primary-button" type="submit">Guardar monto</button>
                  <button className="secondary-button" type="button" onClick={() => setEditingTariffId(null)}>Cancelar</button>
                </div>
              </form>
            )}
            <div className="table-card"><table><thead><tr><th>Zona</th><th>Tarifa</th><th>Por día de feria</th><th>Por semana (2 ferias)</th><th>Vigente desde</th><th>Próximo cambio</th><th>Acción</th></tr></thead><tbody>
              {tariffRecords.map((zona) => (zona.tarifas.length ? zona.tarifas : [null]).map((item, index) => (
                <tr key={item ? item.categoria_id : `sin-${zona.zona_id}`}>
                  <td>{index === 0 ? zona.zona : ''}</td>
                  <td>{item ? <>{item.nombre}{item.predeterminada && <span className="status neutral" style={{ marginLeft: '6px' }}>predeterminada</span>}</> : <span className="status pending">Sin tarifas: no se puede cobrar</span>}</td>
                  <td>{item?.monto_por_feria == null ? '—' : `S/ ${item.monto_por_feria.toFixed(2)}`}</td>
                  <td>{item?.monto_semanal == null ? '—' : `S/ ${item.monto_semanal.toFixed(2)}`}</td>
                  <td>{item?.vigente_desde || '—'}</td>
                  <td>{item?.proximo_cambio ? `S/ ${item.proximo_cambio.monto_por_feria.toFixed(2)} desde ${item.proximo_cambio.vigente_desde}` : '—'}</td>
                  <td>{item && <><button className="table-action" type="button" onClick={() => { setNewTariffForm(null); setEditingTariffId(item.categoria_id); setTariffMessage(''); setTariffForm({ monto_por_feria: item.monto_por_feria === null ? '' : String(item.monto_por_feria), vigencia_inicio: today }); }}>Cambiar monto</button>{!item.predeterminada && <button className="table-action" type="button" onClick={() => handleTariffDefault(item.categoria_id)}>Hacer predeterminada</button>}</>}</td>
                </tr>
              )))}
            </tbody></table></div>
          </section>
        );
      }
      case 'usuarios':
        return simplePage('usuarios');
      case 'reportes':
        return (
          <section className="page">
            <div className="page-heading"><div><div className="eyebrow">ANÁLISIS / EXPORTACIÓN</div><h1>Reportes personalizados</h1><p>Consulta cobros por periodo, zona, rubro o cobrador.</p></div><div className="report-actions"><button className="secondary-button" type="button" onClick={() => window.print()}>Imprimir / PDF</button><a className="primary-button" href={`${apiBase}/reportes?formato=csv`} download="reporte-cobros.csv">Exportar CSV</a></div></div>
            <div className="report-kpis"><div className="stat-card"><span>Total cobrado</span><strong>S/ {reportRows.reduce((total, item) => total + Number(item.monto || 0), 0).toFixed(2)}</strong></div><div className="stat-card"><span>Operaciones</span><strong>{reportRows.length}</strong></div><div className="stat-card"><span>Zonas cubiertas</span><strong>{new Set(reportRows.map((item) => item.zona)).size}</strong></div></div>
            <div className="table-card"><table><thead><tr><th>Fecha</th><th>Comerciante</th><th>Rubro</th><th>Zona</th><th>Cobrador</th><th>Monto</th><th>Método</th><th>Comprobante</th></tr></thead><tbody>{reportRows.map((item) => <tr key={item.id}><td>{item.fecha}</td><td>{item.comerciante}</td><td>{item.rubro}</td><td>{item.zona}</td><td>{item.cobrador}</td><td>S/ {Number(item.monto).toFixed(2)}</td><td>{item.metodo_pago}</td><td>{item.comprobante}</td></tr>)}</tbody></table></div>
          </section>
        );
      case 'zonas':
        return (
          <section className="page">
            <div className="page-heading">
              <div>
                <div className="eyebrow">GESTIÓN / ZONAS Y CALLES</div>
                <h1>Zonas y calles</h1>
                <p>Administra la distribución territorial y la ubicación de cada comercio autorizado.</p>
              </div>
            </div>

            {zoneMessage && <div className="form-message">{zoneMessage}</div>}

            <div className="page-grid two-grid">
              <div className="panel detail-card">
                <div className="panel-heading">
                  <div>
                    <div className="panel-title">Crear o editar zona</div>
                    <div className="panel-subtitle">Cada zona agrupa varias calles y puestos.</div>
                  </div>
                </div>

                <form className="merchant-form" onSubmit={handleZoneSubmit}>
                  <div className="merchant-form-grid">
                    <input required placeholder="Nombre de la zona" value={zoneForm.nombre} onChange={(event) => setZoneForm({ ...zoneForm, nombre: event.target.value })} />
                    <input placeholder="Descripción" value={zoneForm.descripcion} onChange={(event) => setZoneForm({ ...zoneForm, descripcion: event.target.value })} />
                    <button className="primary-button" type="submit">{editingZoneId ? 'Actualizar zona' : 'Guardar zona'}</button>
                    {editingZoneId && (
                      <button type="button" className="secondary-button" onClick={() => {
                        setEditingZoneId(null);
                        setZoneForm({ nombre: '', descripcion: '' });
                      }}>Cancelar</button>
                    )}
                  </div>
                </form>

                <div className="table-card" style={{ marginTop: '16px' }}>
                  <table>
                    <thead>
                      <tr><th>Zona</th><th>Descripción</th><th>Calles</th><th>Acciones</th></tr>
                    </thead>
                    <tbody>
                      {(zoneRecords.length ? zoneRecords : []).map((zona) => (
                        <tr key={zona.id}>
                          <td>{zona.nombre}</td>
                          <td>{zona.descripcion || 'Sin descripción'}</td>
                          <td>{Number(zona.calles_count || 0)}</td>
                          <td>
                            <button className="table-action" type="button" onClick={() => {
                              setEditingZoneId(zona.id);
                              setZoneForm({ nombre: zona.nombre, descripcion: zona.descripcion || '' });
                            }}>Editar</button>
                            <button className="table-action" type="button" onClick={() => handleDeleteZone(zona.id)}>Eliminar</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="panel detail-card">
                <div className="panel-heading">
                  <div>
                    <div className="panel-title">Crear o editar calle</div>
                    <div className="panel-subtitle">Asocia cada vía a la zona correcta y mantén el estado visible.</div>
                  </div>
                </div>

                <form className="merchant-form" onSubmit={handleCalleSubmit}>
                  <div className="merchant-form-grid">
                    <select value={calleForm.zona_id} onChange={(event) => setCalleForm({ ...calleForm, zona_id: event.target.value })}>
                      <option value="">Selecciona zona</option>
                      {(catalogos.zonas || []).map((item) => (
                        <option key={item.id} value={item.id}>{item.nombre}</option>
                      ))}
                    </select>
                    <input required placeholder="Nombre de la calle" value={calleForm.nombre} onChange={(event) => setCalleForm({ ...calleForm, nombre: event.target.value })} />
                    <input placeholder="Descripción" value={calleForm.descripcion} onChange={(event) => setCalleForm({ ...calleForm, descripcion: event.target.value })} />
                    <select value={calleForm.estado} onChange={(event) => setCalleForm({ ...calleForm, estado: event.target.value })}>
                      <option value="activo">Activo</option>
                      <option value="inactivo">Inactivo</option>
                    </select>
                    <button className="primary-button" type="submit">{editingCalleId ? 'Actualizar calle' : 'Guardar calle'}</button>
                    {editingCalleId && (
                      <button type="button" className="secondary-button" onClick={() => {
                        setEditingCalleId(null);
                        setCalleForm({ zona_id: String((catalogos.zonas || [])[0]?.id || ''), nombre: '', descripcion: '', estado: 'activo' });
                      }}>Cancelar</button>
                    )}
                  </div>
                </form>

                <div className="table-card" style={{ marginTop: '16px' }}>
                  <table>
                    <thead>
                      <tr><th>Zona</th><th>Calle</th><th>Estado</th><th>Acciones</th></tr>
                    </thead>
                    <tbody>
                      {(calleRecords.length ? calleRecords : []).map((calle) => (
                        <tr key={calle.id}>
                          <td>{calle.zona || 'Sin zona'}</td>
                          <td>{calle.nombre}</td>
                          <td><span className={`status ${calle.estado === 'activo' ? 'paid' : 'pending'}`}>{calle.estado === 'activo' ? 'Activo' : 'Inactivo'}</span></td>
                          <td>
                            <button className="table-action" type="button" onClick={() => {
                              setEditingCalleId(calle.id);
                              setCalleForm({ zona_id: String(calle.zona_id || ''), nombre: calle.nombre, descripcion: calle.descripcion || '', estado: calle.estado || 'activo' });
                            }}>Editar</button>
                            <button className="table-action" type="button" onClick={() => handleDeleteCalle(calle.id)}>Eliminar</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>
        );
      case 'cobradores':
        return simplePage('cobradores');
      default:
        return simplePage('cobradores');
    }
  };

  const loginScreen = (
    <section className="login-screen" id="loginScreen">
      <div className="login-art">
        <div className="landing-brand brand-inline">
          <span className="brand-mark">S</span>
          <span><strong>SISREC</strong><small>Salcedo</small></span>
        </div>
        <div className="login-art-copy">
          <div className="eyebrow">CENTRO POBLADO DE SALCEDO</div>
          <h1>La gestión pública,<br /><em>en buenas manos.</em></h1>
          <p>Información confiable para recaudar mejor y servir más cerca.</p>
        </div>
        <div className="login-art-footer">Área de Rentas y Recaudación <span>·</span> Puno, Perú</div>
      </div>

      <div className="login-form-wrap">
        <div className="login-form">
          <div className="mobile-login-brand">
            <span className="brand-mark">S</span>
            <strong>SISREC</strong>
          </div>
          <div className="eyebrow">ACCESO SEGURO</div>
          <h2>Bienvenido de nuevo</h2>
          <p>Ingresa tus credenciales para continuar.</p>

          <form id="loginForm" onSubmit={handleLogin}>
            <label>
              Correo electrónico
              <input
                type="email"
                required
                placeholder="nombre@salcedo.gob.pe"
                value={loginForm.email}
                onChange={(event) => setLoginForm({ ...loginForm, email: event.target.value })}
              />
            </label>

            <label>
              Contraseña
              <div className="password-field">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="••••••••"
                  value={loginForm.password}
                  onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })}
                />
                <button type="button" id="togglePassword" aria-label="Mostrar contraseña" onClick={() => setShowPassword((current) => !current)}>
                  ◉
                </button>
              </div>
            </label>

            <div className="login-options">
              <label className="check-label"><input type="checkbox" defaultChecked /> Recordarme</label>
              <button type="button" className="link-button" onClick={() => setError('Solicita el restablecimiento al administrador del sistema')}>¿Olvidaste tu contraseña?</button>
            </div>

            {error && <div className="form-error">{error}</div>}

            <button className="primary-button login-submit" type="submit">Ingresar al sistema <span>→</span></button>

            <div className="demo-note">
              <span>✦</span>
              <div>
                <b>Acceso demo</b>
                <small>admin@sisrec.demo · sisrec2026</small>
              </div>
            </div>
          </form>

          <button type="button" className="login-back" onClick={() => setShowLogin(false)}>← Volver a la página principal</button>
        </div>
        <div className="login-copyright">© 2026 SISREC Salcedo · Plataforma demostrativa</div>
      </div>
    </section>
  );

  if (!user) {
    if (showPortal) {
      return (
        <section className="portal-screen">
          <div className="portal-header"><a className="landing-brand" href="#portal"><span className="brand-mark">S</span><span><strong>SISREC</strong><small>Portal del comerciante</small></span></a><button className="login-back" type="button" onClick={() => { setShowPortal(false); if (window.location.hash.startsWith('#portal')) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`); }}>← Volver a inicio</button></div>
          {!portalData ? <form className="portal-login panel" onSubmit={handlePortalLogin}><div className="eyebrow">PORTAL DEL COMERCIANTE</div><h1>Consulta tus pagos</h1><p>Escanea con tu celular el QR del reverso de tu carnet, o escribe tu DNI o código y la llave impresa en el carnet.</p><label className="portal-field"><span>DNI o código de comerciante</span><input required autoComplete="username" placeholder="DNI o código CM-001" value={portalIdentifier} onChange={(event) => setPortalIdentifier(event.target.value)} /></label><label className="portal-field"><span>Llave del carnet</span><input required autoComplete="current-password" autoCapitalize="characters" spellCheck="false" placeholder="XXXX-XXXX-XX" value={portalKey} onChange={(event) => setPortalKey(event.target.value.toUpperCase())} /></label>{portalError && <div className="form-error" role="alert">{portalError}</div>}<button className="primary-button" type="submit" disabled={portalLoading}>{portalLoading ? 'Consultando…' : 'Consultar información →'}</button><p className="portal-help">¿No tienes carnet o lo perdiste? Solicítalo en caja de la municipalidad: el anterior dejará de funcionar.</p></form> : <div className="portal-content"><div className="page-heading"><div><div className="eyebrow">MI CUENTA / INFORMACIÓN MUNICIPAL</div><h1>Hola, {portalData.comerciante.nombre}</h1><p>{[portalData.comerciante.codigo, portalData.comerciante.rubro, portalData.comerciante.zona].filter(Boolean).join(' · ')}</p><button className="link-button" type="button" onClick={() => closePortalSession()}>Cerrar sesión en este celular</button></div><span className="status pending">{portalData.deuda.saldo > 0 ? `Saldo: S/ ${portalData.deuda.saldo.toFixed(2)}` : 'Cuenta al día'}</span></div>{portalError && <div className="form-error" role="alert">{portalError}</div>}<div className="portal-debt panel"><div><span>Periodo</span><strong>{portalData.deuda.periodo}</strong></div><div><span>Total</span><strong>S/ {portalData.deuda.monto_total.toFixed(2)}</strong></div><div><span>Pagado</span><strong>S/ {portalData.deuda.monto_pagado.toFixed(2)}</strong></div><div><span>Saldo pendiente</span><strong>S/ {portalData.deuda.saldo.toFixed(2)}</strong></div></div><div className="table-card"><table><thead><tr><th>Fecha</th><th>Concepto</th><th>Monto</th><th>Método</th><th>Comprobante</th><th>Acción</th></tr></thead><tbody>{portalData.pagos.length ? portalData.pagos.map((payment) => <tr key={payment.id}><td>{payment.fecha}</td><td>{payment.concepto}</td><td>S/ {Number(payment.monto).toFixed(2)}</td><td>{payment.metodo_pago}</td><td>{payment.comprobante}</td><td><button className="table-action" type="button" onClick={() => downloadPortalReceipt(payment)}>Descargar PDF</button></td></tr>) : <tr><td colSpan="6">Aún no tienes pagos registrados.</td></tr>}</tbody></table></div>{portalData.deuda.saldo > 0 && <div className="portal-reminder"><strong>Recordatorio de deuda</strong><span>Tu saldo pendiente es de S/ {portalData.deuda.saldo.toFixed(2)}.</span><button className="secondary-button" type="button" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(`Recordatorio SISREC: saldo pendiente S/ ${portalData.deuda.saldo.toFixed(2)}`)}`, '_blank')}>Enviar recordatorio por WhatsApp</button></div>}</div>}
        </section>
      );
    }

    if (showLogin) {
      return loginScreen;
    }

    const presentationSections = [
      { id: 'inicio', label: 'Inicio' },
      { id: 'beneficios', label: 'Capacidades' },
      { id: 'impacto', label: 'Impacto fiscal' },
      { id: 'modulos', label: 'Módulos' },
      { id: 'tarifas', label: 'Tarificador' },
      { id: 'transparencia', label: 'Transparencia' }
    ];

    return (
      <ScrollSnapContainer sections={presentationSections}>
        <header className="landing-nav">
          <a className="landing-brand" href="#inicio">
            <span className="brand-mark">S</span>
            <span><strong>SISREC</strong><small>Salcedo</small></span>
          </a>
          <nav>
            <a href="#beneficios">Beneficios</a>
            <a href="#modulos">Módulos</a>
            <a href="#soporte">Soporte</a>
          </nav>
          <button type="button" className="landing-login" onClick={() => setShowLogin(true)}>
            Ingresar al sistema <span>→</span>
          </button>
            <button type="button" className="secondary-button" onClick={() => setShowPortal(true)}>Portal comerciante</button>
        </header>

        <ScrollSnapSection id="inicio" className="landing-screen landing-hero-section">
          <div className="hero-content">
          <div className="hero-copy">
            <div className="eyebrow">GESTIÓN PÚBLICA · SALCEDO</div>
            <h1>Recaudación moderna para una gestión más cercana a la comunidad.</h1>
            <p>
              SISREC Salcedo centraliza el padrón de comerciantes, la cobranza, la valoración de sitios y los reportes para impulsar una administración más transparente, eficiente y operativa.
            </p>
            <div className="hero-actions">
              <button type="button" className="primary-button" onClick={() => setShowLogin(true)}>Comenzar</button>
              <button type="button" className="secondary-button" onClick={() => setShowLogin(true)}>Ver demo</button>
            </div>
          </div>
          <div className="hero-panel">
            <div className="panel-card highlight-card">
              <div className="stat-top"><span>Recaudación total</span><span className="stat-icon green">↗</span></div>
              <div className="stat-value">{dashboardStats.recaudacion}</div>
              <div className="stat-change">Acumulado del periodo actual</div>
            </div>
          </div>
          </div>
          <div className="scroll-snap-hint">Desliza para explorar <span>↓</span></div>
        </ScrollSnapSection>

        <ScrollSnapSection id="beneficios" className="landing-section landing-features-section">
          <div className="section-intro"><div className="eyebrow">OPERACIÓN MUNICIPAL</div><h2>Una vista clara para cada jornada.</h2><p>Herramientas conectadas para registrar, cobrar y supervisar con menos fricción.</p></div>
          <div className="landing-features">
          <div className="feature-box">
            <span>01</span>
            <h3>Registro automatizado</h3>
            <p>Actualiza el padrón con validación de rubro, zona y tipo de comercio.</p>
          </div>
          <div className="feature-box">
            <span>02</span>
            <h3>Cobro en campo</h3>
            <p>Atención rápida para cobradores, con comprobantes inmediatos y trazabilidad.</p>
          </div>
          <div className="feature-box">
            <span>03</span>
            <h3>Reportes inteligentes</h3>
            <p>Supervisa morosidad, flujo de caja y evolución por sectores o ferias.</p>
          </div>
          </div>
        </ScrollSnapSection>

        <ScrollSnapSection id="impacto" className="landing-section landing-impact-section">
          <div className="section-intro"><div className="eyebrow">LECTURA EJECUTIVA</div><h2>El pulso fiscal, en una sola pantalla.</h2><p>Indicadores para tomar decisiones con trazabilidad y contexto territorial.</p></div>
          <div className="landing-kpi-grid">
            <KpiCard label="Recaudacion del periodo" value={dashboardStats.recaudacion} change="Acumulado del mes" icon="R" accent="green" />
            <KpiCard label="Pagos registrados" value={dashboardStats.pagos} change="Operaciones confirmadas" icon="P" accent="blue" />
            <KpiCard label="Morosidad" value={dashboardStats.morosidad} change="Indicador calculado por SISREC" icon="!" accent="amber" />
          </div>
        </ScrollSnapSection>

        <ScrollSnapSection id="modulos" className="landing-section landing-modules-section">
          <div className="section-title">Módulos clave</div>
          <div className="module-grid">
            <div className="module-item">Padrón de comerciantes</div>
            <div className="module-item">Cobros y pagos</div>
            <div className="module-item">Tarifas y liquidación</div>
            <div className="module-item">Dashboard municipal</div>
            <div className="module-item">Auditoría</div>
            <div className="module-item">Portal del comerciante</div>
          </div>
          <button type="button" className="primary-button landing-final-action" onClick={() => setShowLogin(true)}>Ingresar al sistema <span>→</span></button>
        </ScrollSnapSection>

        <ScrollSnapSection id="tarifas" className="landing-tariff-section">
          <TariffCalculator apiBase={apiBase} onRegister={() => setShowLogin(true)} />
        </ScrollSnapSection>

        <ScrollSnapSection id="transparencia" className="landing-transparency-section">
          <TransparencySection onOpenPortal={() => setShowPortal(true)} />
          <LandingFooter onOpenLogin={() => setShowLogin(true)} onOpenPortal={() => setShowPortal(true)} />
        </ScrollSnapSection>
      </ScrollSnapContainer>
    );
  }

  return (
    <div className="app-shell">
      <div className={`sidebar-backdrop ${sidebarOpen ? 'visible' : ''}`} onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`} id="sidebar">
        <div className="sidebar-header">
          <div className="landing-brand sidebar-brand">
            <span className="brand-mark">S</span>
            <span><strong>SISREC</strong><small>Salcedo</small></span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {navItems.filter((item) => !item.roles || item.roles.includes(user?.rol)).map((item) => (
            <button
              key={item.key}
              className={`nav-item ${currentPage === item.key ? 'active' : ''}`}
              type="button"
              onClick={() => { setCurrentPage(item.key); setSidebarOpen(false); }}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-left">
            <button className="menu-button" type="button" aria-label="Abrir menú" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen((open) => !open)}>
              ☰
            </button>
            <div>
              <div className="eyebrow">MUNICIPALIDAD DE SALCEDO</div>
              <h2>{navItems.find((item) => item.key === currentPage)?.label || 'Dashboard'}</h2>
            </div>
          </div>

          <div className="topbar-right">
            <SyncStatusBadge isOnline={isOnline} apiConnected={apiConnected} pendingSyncCount={pendingSyncCount} />
            <div className="search-box">
              <span>⌕</span>
              <input type="text" placeholder="Buscar registro" />
            </div>
            <button type="button" className="notification-button">🔔</button>
            <div className="user-badge">
              <span>{user?.nombre?.split(' ')[0] || 'A'}</span>
              <div>
                <strong>{user?.nombre || 'Usuario'}</strong>
                <small>{user?.rol || 'Super Admin'}</small>
              </div>
            </div>
            <button type="button" className="primary-button compact" onClick={handleLogout}>Cerrar sesión</button>
          </div>
        </header>

        <div className="page-content" id="pageContent">{renderPage()}</div>
        <nav className="mobile-bottom-nav" aria-label="Acciones rápidas">
          <button type="button" className={currentPage === 'dashboard' ? 'active' : ''} onClick={() => setCurrentPage('dashboard')}><span>⌂</span>Inicio</button>
          <button type="button" className={currentPage === 'pagos' ? 'active' : ''} onClick={() => setCurrentPage('pagos')}><span>＋</span>Cobro rápido</button>
          <button type="button" className={currentPage === 'mapa' ? 'active' : ''} onClick={() => setCurrentPage('mapa')}><span>⌖</span>Mapa</button>
          <button type="button" className={currentPage === 'reportes' ? 'active' : ''} onClick={() => setCurrentPage('reportes')}><span>▤</span>Reportes</button>
        </nav>
      </main>
    </div>
  );
}

export default App;
