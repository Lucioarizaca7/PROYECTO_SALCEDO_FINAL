/**
 * Sesión del dispositivo: token de acceso corto + token de renovación de 12 h.
 *
 * Ningún token se guarda en localStorage (un XSS podría leerlo):
 * - el de renovación lo guarda el navegador en la cookie HttpOnly sisrec_refresh, que este código no ve;
 * - el de acceso vive solo en memoria. Al recargar la página se pide uno nuevo con la cookie.
 *
 * authFetch agrega el token de acceso y, si no hay o la API responde 401, lo renueva una sola vez
 * y repite la petición. Si la renovación también falla con 401 (sesión vencida o revocada desde el
 * panel) avisa con el evento "sisrec:session-expired".
 * Sin red no se cierra la sesión: el cobrador sigue trabajando offline.
 */

const KEYS = {
  device: 'sisrec-device-id'
};

// Claves de versiones anteriores, que guardaban los tokens en localStorage: se borran al cargar.
const LEGACY_TOKEN_KEYS = ['sisrec-token', 'sisrec-refresh-token', 'sisrec-refresh-expira'];

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
    // almacenamiento bloqueado: el id del dispositivo dura lo que la pestaña
  }
}

LEGACY_TOKEN_KEYS.forEach((key) => write(key, null));

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

let accessToken = null;

export const getAccessToken = () => accessToken;

/** Guarda el token de acceso de la respuesta de login o de renovación (solo en memoria). */
export function saveSession({ token } = {}) {
  if (token) accessToken = token;
}

export function clearSession() {
  accessToken = null;
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

/** Renueva el token de acceso con la cookie. Varias peticiones a la vez comparten una sola renovación. */
export function refreshSession() {
  if (refreshing) return refreshing;

  refreshing = (async () => {
    // credentials: 'include' envía la cookie HttpOnly aunque la API esté en otro puerto u origen permitido.
    const response = await fetch(`${apiBase}/auth/refresh`, { method: 'POST', credentials: 'include' });
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) {
      const error = new SessionExpiredError(body.message ? `${body.message} Los cobros sin enviar se conservan.` : undefined);
      notifyExpired(error.message);
      throw error;
    }
    if (!response.ok) throw new Error(body.message || `No se pudo renovar la sesión (${response.status})`);
    saveSession({ token: body.token });
    return body.token;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

function withAuth(options) {
  return {
    ...options,
    headers: { ...(options.headers || {}), ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) }
  };
}

// Respuesta 401 para quien llama cuando la sesión venció antes de poder hacer la petición.
const expiredResponse = (error) => new Response(JSON.stringify({ message: error.message, sessionExpired: true }), {
  status: 401,
  headers: { 'Content-Type': 'application/json' }
});

/**
 * fetch autenticado con renovación transparente del token. Los errores de red se propagan tal cual
 * (TypeError), para que quien llama pueda pasar al modo sin señal.
 */
export async function authFetch(url, options = {}) {
  // Página recién abierta: aún no hay token de acceso en memoria; se pide con la cookie.
  if (!accessToken) {
    try {
      await refreshSession();
    } catch (error) {
      if (error.sessionExpired) return expiredResponse(error);
      throw error;
    }
  }

  let response = await fetch(url, withAuth(options));
  if (response.status !== 401) return response;

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

/** Cierra la sesión del dispositivo en el servidor (revoca el token y borra la cookie). No falla sin red. */
export async function logoutSession() {
  clearSession();
  try {
    await fetch(`${apiBase}/auth/logout`, { method: 'POST', credentials: 'include' });
  } catch {
    // sin señal: el token vence solo en 12 h o se revoca desde el panel
  }
}
