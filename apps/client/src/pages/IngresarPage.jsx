import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

export function IngresarPage({ onLogin, error, setError }) {
  const [form, setForm] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const passwordRef = useRef(null);
  const intento = useRef(false);

  // Un ingreso fallido lleva el foco a la contraseña para volver a escribirla, y el aviso lo lee el lector de
  // pantalla (role="alert"). Antes el foco se quedaba en el botón y el error solo se veía (18/11/2026).
  // login() borra el error antes de cada intento: el aviso se vuelve a anunciar aunque el texto se repita.
  useEffect(() => {
    if (!error || !intento.current) return;
    intento.current = false;
    passwordRef.current?.focus();
    passwordRef.current?.select();
  }, [error]);

  const submit = (event) => {
    event.preventDefault();
    intento.current = true;
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
                autoComplete="username"
                aria-describedby={error ? 'loginError' : undefined}
                placeholder="nombre@salcedo.gob.pe"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            </label>

            <label>
              Contraseña
              <div className="password-field">
                <input
                  ref={passwordRef}
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  aria-describedby={error ? 'loginError' : undefined}
                  placeholder="••••••••"
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                />
                <button type="button" id="togglePassword" aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={showPassword} onClick={() => setShowPassword((current) => !current)}>
                  ◉
                </button>
              </div>
            </label>

            <div className="login-options">
              <button type="button" className="link-button" onClick={() => setError('Solicita el restablecimiento al administrador del sistema')}>¿Olvidaste tu contraseña?</button>
            </div>

            {error && <div className="form-error" id="loginError" role="alert">{error}</div>}

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
