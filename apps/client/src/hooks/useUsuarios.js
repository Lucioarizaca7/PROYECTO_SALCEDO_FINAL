import { useEffect, useState } from 'react';
import { apiBase, authFetch, leerJson } from '../services/session';

export const MIN_CLAVE = 10; // la misma que valida el servidor (db.js, MIN_CLAVE)
const FORMULARIO_VACIO = { nombre: '', email: '', rol: 'cobrador', password: '', confirmacion: '' };

// Página Usuarios (solo super_admin): lista del personal, alta, desactivar/activar y clave nueva.
// El servidor vuelve a comprobar el rol y las reglas (no desactivarse a sí mismo, último super_admin).
export function useUsuarios() {
  const [usuarios, setUsuarios] = useState([]);
  const [formulario, setFormulario] = useState(FORMULARIO_VACIO);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const cargar = async () => {
    try {
      const response = await authFetch(`${apiBase}/usuarios`);
      const data = await leerJson(response);
      if (!response.ok) throw new Error(data.message || 'No se pudo cargar la lista de usuarios');
      setUsuarios(Array.isArray(data.data) ? data.data : []);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    cargar();
  }, []);

  // Llama al servidor y recarga la lista. Devuelve true si salió bien.
  const enviar = async (url, metodo, cuerpo, mensajeError) => {
    setMessage('');
    setError('');
    setOcupado(true);
    try {
      const response = await authFetch(url, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
      const data = await leerJson(response);
      if (!response.ok) throw new Error(data.message || mensajeError);
      setMessage(data.message);
      await cargar();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setOcupado(false);
    }
  };

  const crear = async (event) => {
    event.preventDefault();
    if (formulario.password !== formulario.confirmacion) {
      setError('Las dos claves no coinciden');
      return;
    }
    const { confirmacion: _c, ...datos } = formulario;
    if (await enviar(`${apiBase}/usuarios`, 'POST', datos, 'No se pudo crear el usuario')) setFormulario(FORMULARIO_VACIO);
  };

  const cambiarEstado = (usuario) => {
    const activar = !usuario.activo;
    const aviso = activar
      ? `¿Activar la cuenta de ${usuario.nombre}? Podrá volver a entrar.`
      : `¿Desactivar la cuenta de ${usuario.nombre}? Se cerrarán sus sesiones y no podrá entrar. Sus cobros y registros se conservan.`;
    if (!window.confirm(aviso)) return Promise.resolve(false);
    return enviar(`${apiBase}/usuarios/${usuario.id}/estado`, 'PATCH', { activo: activar }, 'No se pudo cambiar el estado');
  };

  const cambiarClave = (usuario, password) => enviar(`${apiBase}/usuarios/${usuario.id}/clave`, 'PUT', { password }, 'No se pudo cambiar la clave');

  return { usuarios, formulario, setFormulario, message, error, ocupado, crear, cambiarEstado, cambiarClave };
}
