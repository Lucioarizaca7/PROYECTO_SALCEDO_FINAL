# Seguridad de SISREC: controles y dónde viven

Antes de tocar uno de estos controles, comprobar que sigue igual en el código (`grep` del nombre).

## Controles que ya existen (no se debilitan)

| Riesgo | Control | Dónde |
|---|---|---|
| Secretos en el código | Toda la configuración se lee y valida una vez; arranque falla si falta algo | `apps/server/src/config.ts` (único que lee `process.env`) |
| JWT débil | `JWT_SECRET` obligatorio; en producción ≥ 32 caracteres | `config.ts` |
| Tokens sin expiración | Acceso corto (`JWT_EXPIRES_IN`, 15 min por defecto); refresh de 12 h por dispositivo, revocable | `auth.ts`, tabla `sesiones_dispositivo`, `DELETE /auth/sesiones/:id` |
| Robo de token por XSS | Refresh en cookie HttpOnly `sisrec_refresh` (SameSite=Strict, Path=/api/v1/auth); acceso solo en memoria | `http/sesionCookie.ts`, `apps/client/src/services/session.js` |
| Contraseñas en texto plano | bcrypt (`BCRYPT_SALT_ROUNDS`) | `auth.ts`, `db.js` (`createAdminUser`) |
| Admin "hardcodeado" | Usuarios demo solo fuera de producción; en producción el primer admin se crea con `npm run crear-admin` | `db.js` (guardas `config.isProduction`), `src/cli/crear-admin.ts` |
| CORS abierto | Lista blanca: `FRONTEND_URL` (obligatorio en producción) + localhost solo en desarrollo | `app.ts` |
| Fuerza bruta | Límite general y de login (`express-rate-limit`); portal: 5 llaves erradas → bloqueo 15 min (429), mismo 401 para cualquier credencial errada; la llave sola (QR) sin dueño solo la frena el límite por IP | `app.ts`, `http/comunes.ts` (`loginLimiter`), `portalAcceso.js` |
| Cabeceras | helmet; HSTS solo en producción | `app.ts` |
| Cuerpos enormes | `express.json({ limit: '1mb' })`; lotes con máximo (`MAX_LOTE_COBROS = 100`, anulaciones 100, tickets por cobro 60) | `app.ts`, `db.js` |
| Acceso sin rol | `requireAuth` + `requireRoles`; prueba que cuenta las rutas GET y exige token | `auth.ts`, `tests/api-seguridad.test.js` |
| Cambios sin rastro | `auditMutation` + cadena de hash en `auditoria_logs`; `verifyAuditChain` | `auth.ts`, `db.js` |
| Inyección SQL | Consultas con parámetros `$n` | `db.js`, `pg.js` |
| Fuga de errores internos | El manejador global traduce errores de PostgreSQL a mensajes genéricos | `http/errorHandler.ts` |
| Recibos falsos | QR con firma HMAC; PDF del portal con enlace firmado de 30 min | `/publico/verificar/:token`, `reciboPdf.js` |
| Datos personales (Ley 29733) | Código con 3 dígitos del DNI; portal con documento oculto (y sin el `TEMP_DNI_` de un pendiente); llave fuera de `comerciantes` y nunca auditada; el hash del PIN se borró al quitarlo | migraciones 0005, 0007, 0016 y 0017, `portalAcceso.js` |
| Llave del carnet robada de la base | Solo se guarda su huella SHA-256 (comparada con `timingSafeEqual`); viaja en el fragmento `#llave=`, que no llega al servidor ni a sus registros, y el portal lo borra de la barra al entrar | `portalAcceso.js`, `pages/PortalPage.jsx` |
| Cobro fuera de toda caja | En línea, la fecha del cobro es la del servidor; sin señal, más de 3 días atrás o en el futuro queda observado | `db.js` (`fechaCobroEnLinea`, `fechaCobroFueraDeRango`), `routes/cobros.ts` |
| Enumeración de correos | El login siempre ejecuta bcrypt (hash de relleno si el correo no existe) | `auth.ts` (`HASH_DE_RELLENO`) |
| Atribución falsa | El creador del comerciante y el cobrador del cobro salen del token | `routes/comerciantes.ts`, `routes/cobros.ts` |
| Inyección CSV | `celdaCsv` antepone `'` a textos que empiezan con `= + - @` | `db.js` (`buildReportCsv`) |
| Clickjacking | `X-Frame-Options: DENY` y CSP `frame-ancestors 'none'` en la app web (la CSP aún no limita scripts) | `Caddyfile` |
| Listados enormes | `GET /cobros` con tope `MAX_COBROS_LISTADO`; el cobrador ve solo los suyos | `db.js` (`getCobros`) |
| Archivos de entorno | `.env`, `apps/server/.env`, `.env.production` en `.gitignore`; plantilla `.env.production.example` sin valores reales | `.gitignore` |

## Señales de alarma en una revisión (se rechaza el cambio)

- `process.env` fuera de `config.ts`, o un valor por defecto "de desarrollo" que también corre en producción.
- Una clave, token, PIN o contraseña real en código, pruebas commiteadas, logs, mensajes de error o el chat.
- Una ruta nueva sin `requireRoles`, o con un rol más amplio que el que decidió el usuario.
- Una ruta que modifica datos sin `auditMutation`.
- `localStorage`/`sessionStorage` con un token, o un token en la URL.
- `cors({ origin: '*' })`, `origin: true` en producción, o quitar `credentials` para "que funcione".
- SQL armado con `${}` o concatenación con datos de la petición.
- `res.status(500).json({ message: err.message })` o devolver el error de `pg` tal cual.
- Bajar `BCRYPT_SALT_ROUNDS`, alargar el JWT de acceso o quitar el límite de intentos para "facilitar pruebas".
- Mostrar el DNI completo fuera de la columna Documento del sistema interno.
- Confiar en el cliente para un permiso, un saldo o el valor de un ticket.

## Pruebas que deben seguir pasando

`tests/api-seguridad.test.js`, `tests/security.test.js`, `tests/auth.test.js`, `tests/portal.test.js`, `tests/produccion.test.js`. Un control nuevo trae su prueba en uno de estos archivos.
