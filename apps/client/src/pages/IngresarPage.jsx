import { useState } from 'react';
import { Link } from 'react-router-dom';

export function IngresarPage({ onLogin, error, setError }) {
  const [form, setForm] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);

  const submit = (event) => {
    event.preventDefault();
    onLogin(form);
  };

  return (
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

          <form id="loginForm" onSubmit={submit}>
            <label>
              Correo electrónico
              <input
                type="email"
                required
                placeholder="nombre@salcedo.gob.pe"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            </label>

            <label>
              Contraseña
              <div className="password-field">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="••••••••"
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
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

            {import.meta.env.DEV && (
              <div className="demo-note">
                <span>✦</span>
                <div>
                  <b>Acceso demo (solo en desarrollo)</b>
                  <small>admin@sisrec.demo · sisrec2026</small>
                </div>
              </div>
            )}
          </form>

          <Link className="login-back" to="/" onClick={() => setError('')}>← Volver a la página principal</Link>
        </div>
        <div className="login-copyright">© 2026 SISREC Salcedo · Plataforma demostrativa</div>
      </div>
    </section>
  );
}
