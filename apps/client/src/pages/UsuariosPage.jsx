import { useState } from 'react';
import { useSisrec } from '../app/SisrecContext';
import { MIN_CLAVE, useUsuarios } from '../hooks/useUsuarios';
import { fechaHoraEnLima, formatRole } from '../lib/formato';

// Clave nueva de una persona: se escribe dos veces; el super_admin se la entrega y no se le pide cambiarla.
function ClaveNueva({ usuario, ocupado, onGuardar, onCancelar }) {
  const [clave, setClave] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const coinciden = clave === confirmacion;

  const guardar = async (event) => {
    event.preventDefault();
    if (coinciden && await onGuardar(usuario, clave)) onCancelar();
  };

  return (
    <form className="usuario-clave" onSubmit={guardar}>
      <input type="password" required minLength={MIN_CLAVE} autoComplete="new-password" placeholder={`Clave nueva (mín. ${MIN_CLAVE})`} aria-label={`Clave nueva de ${usuario.nombre}`} value={clave} onChange={(event) => setClave(event.target.value)} />
      <input type="password" required minLength={MIN_CLAVE} autoComplete="new-password" placeholder="Repita la clave" aria-label="Repita la clave" value={confirmacion} onChange={(event) => setConfirmacion(event.target.value)} />
      {!coinciden && confirmacion && <span className="usuario-clave-aviso">No coinciden</span>}
      <button type="submit" className="table-action" disabled={ocupado || !coinciden}>Guardar</button>
      <button type="button" className="table-action" onClick={onCancelar}>Cancelar</button>
    </form>
  );
}

export function UsuariosPage() {
  const { user } = useSisrec();
  const usuarios = useUsuarios();
  const { formulario, setFormulario } = usuarios;
  const [claveDe, setClaveDe] = useState(null);
  const campo = (nombre) => (event) => setFormulario({ ...formulario, [nombre]: event.target.value });

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">CONFIGURACIÓN / USUARIOS</div>
          <h1>Usuarios</h1>
          <p>Cuentas del personal: super administradores, cobradores y auditores. Una cuenta no se borra, se desactiva: sus cobros y registros se conservan.</p>
        </div>
      </div>

      {usuarios.message && <div className="form-message">{usuarios.message}</div>}
      {usuarios.error && <div className="form-error" role="alert">{usuarios.error}</div>}

      <div className="panel detail-card">
        <div className="panel-heading">
          <div>
            <div className="panel-title">Nuevo usuario</div>
            <div className="panel-subtitle">Entregue la clave a la persona; podrá entrar con ella de inmediato y cambiarla cuando quiera en Mi clave.</div>
          </div>
        </div>
        <form className="merchant-form" onSubmit={usuarios.crear}>
          <div className="merchant-form-grid">
            <input required placeholder="Nombre completo" aria-label="Nombre completo" value={formulario.nombre} onChange={campo('nombre')} />
            <input required type="email" placeholder="Correo" aria-label="Correo" autoComplete="off" value={formulario.email} onChange={campo('email')} />
            <select aria-label="Rol" value={formulario.rol} onChange={campo('rol')}>
              <option value="cobrador">Cobrador</option>
              <option value="auditor">Auditor</option>
              <option value="super_admin">Super administrador</option>
            </select>
            <input required type="password" minLength={MIN_CLAVE} autoComplete="new-password" placeholder={`Clave (mín. ${MIN_CLAVE} caracteres)`} aria-label="Clave" value={formulario.password} onChange={campo('password')} />
            <input required type="password" minLength={MIN_CLAVE} autoComplete="new-password" placeholder="Repita la clave" aria-label="Repita la clave" value={formulario.confirmacion} onChange={campo('confirmacion')} />
            <button className="primary-button" type="submit" disabled={usuarios.ocupado}>Crear usuario</button>
          </div>
        </form>
      </div>

      <div className="table-card" style={{ marginTop: '16px' }}>
        <table>
          <thead>
            <tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Último ingreso</th><th>Acciones</th></tr>
          </thead>
          <tbody>
            {usuarios.usuarios.map((usuario) => {
              const esUsted = Number(usuario.id) === Number(user?.id);
              return (
                <tr key={usuario.id} className={usuario.activo ? '' : 'usuario-inactivo'}>
                  <td>{usuario.nombre}{esUsted && <span className="usuario-usted"> (usted)</span>}</td>
                  <td>{usuario.email}</td>
                  <td>{formatRole(usuario.rol)}</td>
                  <td><span className={`status ${usuario.activo ? 'paid' : 'danger'}`}>{usuario.activo ? 'Activo' : 'Desactivado'}</span></td>
                  <td>{fechaHoraEnLima(usuario.ultimo_ingreso) || 'Nunca'}</td>
                  <td>
                    {claveDe === usuario.id ? (
                      <ClaveNueva usuario={usuario} ocupado={usuarios.ocupado} onGuardar={usuarios.cambiarClave} onCancelar={() => setClaveDe(null)} />
                    ) : (
                      <>
                        <button type="button" className="table-action" onClick={() => setClaveDe(usuario.id)}>Clave nueva</button>
                        {!esUsted && (
                          <button type="button" className={`table-action ${usuario.activo ? 'peligro' : ''}`} disabled={usuarios.ocupado} onClick={() => usuarios.cambiarEstado(usuario)}>
                            {usuario.activo ? 'Desactivar' : 'Activar'}
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
