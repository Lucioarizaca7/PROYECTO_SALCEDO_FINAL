// Varias pestañas del mismo navegador comparten una sola sesión: la cookie sisrec_refresh es del navegador,
// no de la pestaña. Si en otra pestaña se entra con otra cuenta, la cookie pasa a ser de esa cuenta y esta
// pestaña recibe sus tokens al renovar. Antes seguía mostrando al usuario anterior mientras actuaba como el
// nuevo (el servidor respondía 403 en pantallas que la pestaña creía permitidas).
//
// Señales de cuál es el usuario real: la respuesta de /auth/refresh (session.js) y el evento "storage" de
// la clave sisrec-user, que el navegador entrega a las demás pestañas cuando una entra o sale. Ese dato solo
// trae nombre, correo, id y rol: ningún token va a localStorage.

export const USUARIO_SESION_EVENT = 'sisrec:usuario-de-sesion';
export const CLAVE_USUARIO = 'sisrec-user';

const mismaCuenta = (a, b) => Number(a?.id) === Number(b?.id) && a?.rol === b?.rol;

/**
 * Qué hace la pestaña con el usuario que trae la sesión del navegador:
 *  'igual'   es el mismo: nada;
 *  'cambiar' es otra cuenta: la pestaña pasa a ella y avisa;
 *  'entrar'  la pestaña no tenía sesión y otra pestaña entró: la adopta;
 *  'cerrar'  otra pestaña cerró la sesión: esta también la cierra.
 */
export function cambioDeSesion(actual, recibido) {
  if (!recibido) return actual ? 'cerrar' : 'igual';
  if (!actual) return 'entrar';
  return mismaCuenta(actual, recibido) ? 'igual' : 'cambiar';
}

/** El usuario guardado por otra pestaña (texto de localStorage) o null si no hay o no se entiende. */
export function leerUsuario(texto) {
  try {
    const usuario = texto ? JSON.parse(texto) : null;
    return usuario && typeof usuario === 'object' && usuario.id !== undefined ? usuario : null;
  } catch {
    return null;
  }
}
