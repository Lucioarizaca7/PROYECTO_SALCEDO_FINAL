import { useEffect, useState } from 'react';
import { apiBase, getDeviceId, getDeviceName, logoutSession, saveSession, SESSION_EXPIRED_EVENT } from '../services/session';

function readStoredUser() {
  try {
    const savedUser = localStorage.getItem('sisrec-user');
    const parsedUser = savedUser ? JSON.parse(savedUser) : null;
    return parsedUser && typeof parsedUser === 'object' ? parsedUser : null;
  } catch {
    try {
      localStorage.removeItem('sisrec-user');
      localStorage.removeItem('sisrec-token');
    } catch {
      // La página principal debe abrir aunque el navegador bloquee el almacenamiento.
    }
    return null;
  }
}

// Usuario conectado, inicio y cierre de sesión. Los tokens los guarda services/session.js;
// aquí solo los datos visibles del usuario.
export function useSesion() {
  const [user, setUser] = useState(readStoredUser);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user) {
      const { token: _legacyToken, ...storedUser } = user;
      localStorage.setItem('sisrec-user', JSON.stringify(storedUser));
    } else {
      localStorage.removeItem('sisrec-user');
    }
  }, [user]);

  // La sesión del dispositivo venció o fue revocada: se pide ingresar de nuevo sin borrar la cola offline.
  const expire = (message) => {
    setUser(null);
    setError(message || 'Tu sesión venció. Ingresa de nuevo; los cobros sin enviar se conservan en el celular.');
  };

  useEffect(() => {
    const onExpired = (event) => expire(event.detail?.message);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  const login = async (credentials) => {
    setError('');
    try {
      const response = await fetch(`${apiBase}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...credentials, device_id: getDeviceId(), device_nombre: getDeviceName() })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Credenciales inválidas');

      saveSession(data);
      setUser(data.user);
    } catch (loginError) {
      setError(loginError.message || 'No se pudo iniciar sesión');
    }
  };

  const logout = () => {
    setUser(null);
    setError('');
    logoutSession();
  };

  return { user, error, setError, login, logout, expire };
}
