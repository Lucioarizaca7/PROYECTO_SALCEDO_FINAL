/**
 * Sesión del dispositivo: token de acceso corto + token de renovación de 12 h.
 *
 * authFetch agrega el token de acceso y, si la API responde 401, lo renueva una sola vez
 * con el token de renovación y repite la petición. Si la renovación también falla con 401
 * (sesión vencida o revocada desde el panel) avisa con el evento "sisrec:session-expired".
 * Sin red no se cierra la sesión: el cobrador sigue trabajando offline.
 */

const KEYS = {
  access: 'sisrec-token',
  refresh: 'sisrec-refresh-token',
  refreshExpiresAt: 'sisrec-refresh-expira',
  device: 'sisrec-device-id'
};

export const SESSION_EXPIRED_EVENT = 'sisrec:session-expired';

const configuredApiBase = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) || 'http://localhost:3003';
export const apiBase = `${String(configuredApiBase).replace(/\/+$/, '').replace(/\/api(?:\/v1)?$/, '')}/api/v1`;

function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key, value) {
  try {
    if (value === null || value === undefined || value === '') localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // almacenamiento bloqueado: la sesión dura lo que la pestaña
  }
}

function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Identificador estable de este navegador/celular: una sesión de renovación por dispositivo. */
export function getDeviceId() {
  let id = read(KEYS.device);
  if (!id) {
    id = `web-${randomId()}`;
    write(KEYS.device, id);
  }
  return id;
}

/** Nombre legible para el panel de dispositivos (p. ej. "Android · Chrome"). */
export function getDeviceName() {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent || '';
  const system = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone/iPad' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : 'Dispositivo';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  return `${system} · ${browser}`;
}

export const getAccessToken = () => read(KEYS.access);
export const getRefreshToken = () => read(KEYS.refresh);

export function saveSession({ token, refreshToken, refreshExpiresAt } = {}) {
  if (token) write(KEYS.access, token);
  if (refreshToken) write(KEYS.refresh, refreshToken);
  if (refreshExpiresAt) write(KEYS.refreshExpiresAt, String(refreshExpiresAt));
}

export function clearSession() {
  write(KEYS.access, null);
  write(KEYS.refresh, null);
  write(KEYS.refreshExpiresAt, null);
}

function notifyExpired(message) {
  clearSession();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { message } }));
  }
}

export class SessionExpiredError extends Error {
  constructor(message = 'Tu sesión venció. Ingresa de nuevo; los cobros sin enviar se conservan.') {
    super(message);
    this.sessionExpired = true;
  }
}

let refreshing = null;

/** Renueva el token de acceso. Varias peticiones a la vez comparten una sola renovación. */
export function refreshSession() {
  if (refreshing) return refreshing;
  const refreshToken = getRefreshToken();
  if (!refreshToken) return Promise.reject(new SessionExpiredError());

  refreshing = (async () => {
    const response = await fetch(`${apiBase}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken })
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) {
      const error = new SessionExpiredError(body.message ? `${body.message} Los cobros sin enviar se conservan.` : undefined);
      notifyExpired(error.message);
      throw error;
    }
    if (!response.ok) throw new Error(body.message || `No se pudo renovar la sesión (${response.status})`);
    saveSession({ token: body.token, refreshExpiresAt: body.refreshExpiresAt });
    return body.token;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

function withAuth(options) {
  const token = getAccessToken();
  return {
    ...options,
    headers: { ...(options.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  };
}

/**
 * fetch autenticado con renovación transparente del token. Los errores de red se propagan tal cual
 * (TypeError), para que quien llama pueda pasar al modo sin señal.
 */
export async function authFetch(url, options = {}) {
  let response = await fetch(url, withAuth(options));
  if (response.status !== 401) return response;

  if (!getRefreshToken()) {
    notifyExpired();
    return response;
  }
  try {
    await refreshSession();
  } catch (error) {
    if (error.sessionExpired) return response;
    throw error;
  }
  response = await fetch(url, withAuth(options));
  if (response.status === 401) notifyExpired();
  return response;
}

/** Cierra la sesión del dispositivo en el servidor (revoca el token de renovación). No falla sin red. */
export async function logoutSession() {
  const refreshToken = getRefreshToken();
  clearSession();
  if (!refreshToken) return;
  try {
    await fetch(`${apiBase}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken })
    });
  } catch {
    // sin señal: el token vence solo en 12 h o se revoca desde el panel
  }
}
