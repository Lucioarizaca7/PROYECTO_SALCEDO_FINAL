# Instalación del servidor de SISREC

Paso a paso para dejar SISREC en un servidor propio, cargar los datos reales y preparar los celulares de los cobradores para el piloto.

El sistema queda en un VPS con Docker Compose y cinco contenedores:

| Contenedor | Qué hace |
|---|---|
| `web` | Caddy: HTTPS automático y sirve la web |
| `api` | Express y las migraciones |
| `analytics` | proyección de recaudación |
| `postgres` | la base de datos |
| `backup` | respaldo diario |

Solo `web` queda expuesto a internet, por los puertos 80 y 443.

> Lo marcado con **[tú]** solo lo puede hacer la municipalidad o el responsable del proyecto: contratar, pagar, decidir nombres o tener acceso a cuentas.

**Antes de empezar:** el servidor descarga la rama `main` de GitHub. Lo que se quiera instalar debe estar unido a `main` (el pull request de la rama de trabajo, ya revisado).

## 1. Servidor y dominio **[tú]**

1. Contratar un VPS Ubuntu 24.04 de 2 vCPU y 4 GB de RAM (unos US$ 24 al mes en DigitalOcean o Akamai Linode). Alcanza para el piloto de 400 a 600 comerciantes y unos 10 usuarios.
2. Registrar el dominio y crear un registro DNS **A** que apunte a la IP del servidor.
   - Si será `.gob.pe`, el trámite va con la Secretaría de Gobierno y Transformación Digital.
   - Para un servidor de pruebas sin dominio sirve `203-0-113-10.sslip.io`, poniendo la IP con guiones.
3. Crear un bucket S3 compatible para los respaldos (DigitalOcean Spaces, Linode Object Storage o Backblaze B2) con una regla de ciclo de vida de 30 días. Anotar el endpoint, la access key y la secret key.

Sin HTTPS los celulares no pueden instalar la app ni trabajar sin señal: por eso el dominio (o `sslip.io`) es obligatorio, una IP sola no sirve.

## 2. Preparar el servidor

```bash
# como root, una sola vez
curl -fsSL https://get.docker.com | sh
adduser --disabled-password --gecos "" deploy && usermod -aG docker deploy
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
mkdir -p /opt/sisrec && chown deploy: /opt/sisrec
```

Luego, como `deploy`:

```bash
git clone https://github.com/Lucioarizaca7/PROYECTO_SALCEDO_FINAL.git /opt/sisrec
cd /opt/sisrec
cp .env.production.example .env.production
```

En `.env.production` hay que completar:

| Variable | Qué poner |
|---|---|
| `DOMAIN` | el dominio del paso 1 |
| `POSTGRES_PASSWORD` | una clave larga |
| `JWT_SECRET` | el resultado de `openssl rand -hex 48` (mínimo 32 caracteres) |
| `BACKUP_S3_*` | los datos del bucket |

Las demás variables ya traen un valor razonable. Este archivo solo existe en el servidor: no se sube a GitHub.

## 3. Primer arranque

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml ps        # todos "healthy"
curl https://$DOMINIO/api/v1/health                                             # {"status":"ok","base_de_datos":"ok","analitica":"ok"}
```

- La API aplica sola las migraciones al arrancar (hoy, de la 0001 a la 0031).
- En producción **no** se crean los usuarios de demostración (`admin@salcedo.gob.pe` y los demás).
- La primera vez Caddy tarda uno o dos minutos en obtener el certificado.

## 4. Cuentas reales **[tú decides los nombres y correos]**

```bash
C="docker compose --env-file .env.production -f docker-compose.prod.yml exec api"
$C node dist/cli/crear-admin.js                        # primer administrador (pide nombre, correo y clave)
$C node dist/cli/crear-usuario.js --rol cobrador       # una vez por cada cobrador
$C node dist/cli/crear-usuario.js --rol auditor        # jefa de área / auditor
```

Después del primer administrador, los demás usuarios (otros super administradores, cobradores y auditores) se pueden crear desde la web, en **Configuración → Usuarios**, y quedan en la auditoría. Los comandos de arriba siguen sirviendo.

| Rol | Qué puede hacer |
|---|---|
| `super_admin` | todo: tarifas, zonas, lotes de tickets, carnets, anular cobros, resolver los cobros observados y revocar sesiones de celulares |
| `cobrador` | cobrar, marcar asistencia, registrar la ubicación de puestos y cerrar su caja |
| `auditor` | consultar: comerciantes, tarifas, tickets, auditoría, reportes y la lista de cobros observados (no los resuelve) |

- Las claves tienen como mínimo 10 caracteres.
- Nunca se escriben en la línea de comandos: el script las pregunta.

**Super administrador titular y suplente** (decisión del 13/11/2026): se crean **dos** cuentas `super_admin` con `crear-admin`, una para el **titular** y otra para el **suplente**, cada una con su propio correo y su propia clave. "Super" es el nivel de permisos, no la cantidad de personas: el titular trabaja a diario y el suplente solo actúa cuando el titular falta. Una cuenta nunca se comparte. Detalle en la sección 11.

## 5. Datos reales, en este orden

Todo esto se hace en la web, con la cuenta `super_admin`.

1. **Zonas y calles [tú confirmas las zonas]:** en *Configuración → Zonas y calles*, crear cada zona con su **Tipo de vía** (*Vía asfaltada* o *Vía sin asfaltar*) y sus calles.
2. **Tarifas: el precio lo pone la zona [tú confirmas la ordenanza vigente]:** en *Configuración → Tarifas*, *Nueva tarifa*:
   - **Rubro:** *Todos los rubros*. El rubro y los metros no cambian el precio.
   - **Aplica a:** *Zonas con vía asfaltada*, *Zonas con vía sin asfaltar* o *Solo <zona>* si una zona tiene un precio propio.
   - **Unidad:** *Por día cobrado*. Ejemplo: S/ 3 la vía asfaltada y S/ 2 la sin asfaltar.
   - **Vigencia desde:** hoy o una fecha futura. Lo ya cobrado no cambia. Para cambiar un monto se crea una tarifa nueva y la anterior se cierra sola.
   - Solo el `super_admin` crea y cierra tarifas.
3. **Padrón [tú entregas el Excel]:** en *Gestión → Comerciantes*, *Carga masiva del padrón*:
   - pulsar *Descargar plantilla oficial* si el Excel no tiene ese formato;
   - subir el `.xlsx`: la previsualización no modifica datos y muestra los errores y advertencias;
   - pulsar *Confirmar importación de N filas*.
   - Después, revisar las coordenadas. Este comando lista los puestos a más de 2 km del centro de Salcedo y termina con código 2 si encuentra alguno:

     ```bash
     $C node dist/cli/revisar-coordenadas.js
     ```

     Hay que corregirlos en el *Mapa de sitios*.
4. **Inicio de cobro:** en *Tarifas*, *Deuda acumulada desde (inicio de cobro)*, elegir el primer mes que se cobra (por ejemplo `2026-12`, el mes del piloto) y pulsar *Guardar inicio de cobro*. Antes de ese mes no se suma deuda.
5. **Tickets preimpresos [tú entregas los talonarios]:** en *Gestión → Tickets*, asignar a cada cobrador un lote de la serie **S3** (vía asfaltada) y uno de la **S2** (sin asfaltar), con *Desde el N°* y *Hasta el N°* de su talonario. El ticket es el comprobante físico que recibe el comerciante en cada cobro.
6. **Carnets del portal:** en *Comerciantes*, *Emitir carnet*, uno por uno o en lote (hasta 500), e imprimirlos. La llave se muestra una sola vez y un carnet nuevo anula el anterior. Con el carnet, el comerciante ve sus pagos, el ticket que recibió en cada uno y descarga sus recibos en el portal.

## 6. Celulares de los cobradores

Con cada celular Android, en Chrome:

1. Abrir `https://<dominio>` y aceptar el aviso **"Instala SISREC en este celular…"**, o desde el menú ⋮ → *Instalar aplicación*.
2. Entrar con la cuenta del cobrador.
3. En *Pagos y cobros*, panel de la jornada, pulsar *Descargar padrón y tarifas* hasta que diga **Listo para hoy**. Así puede cobrar sin señal; lo cobrado se sincroniza solo al volver la señal.
4. Hacer un cobro de prueba pequeño y enviarlo con *Enviar por WhatsApp*: el recibo sale como imagen con su QR de verificación. No se usa impresora.

Antes del piloto, hacer la **prueba en seco** con 2 cobradores y unos 20 comerciantes siguiendo [`guia-prueba-campo-offline.md`](guia-prueba-campo-offline.md) (instalación, cobros en modo avión, sincronización, recibo, portal).

## 7. Respaldos

| Qué | Cómo |
|---|---|
| Respaldo automático | El servicio `backup` hace `pg_dump` cada día a las 02:00 de Lima. Lo guarda 30 días en el volumen `respaldos` y, si se configuró el bucket, también fuera del servidor |
| Respaldo manual | `docker compose --env-file .env.production -f docker-compose.prod.yml run --rm backup ahora` |
| Restauración de prueba | `docker compose --env-file .env.production -f docker-compose.prod.yml run --rm backup sh /scripts/restaurar-respaldo.sh`. Hacerla una vez al mes |

La restauración de prueba carga la copia más reciente en una base temporal, muestra cuántas filas tiene cada tabla clave y después la borra. La base real no se toca.

Para restaurar de verdad tras un desastre, detener la API y usar `pg_restore --clean` sobre la base `sisrec`. Hacerlo con la guía de este documento a mano.

## 8. Monitoreo y logs **[tú creas la cuenta de UptimeRobot]**

- **UptimeRobot** (plan gratuito):
  - monitor HTTP(s) a `https://$DOMINIO/api/v1/health` cada 5 minutos;
  - responde 503 si la base de datos no contesta;
  - avisa por correo a la jefa de área y al responsable técnico.
- **Logs:** cada contenedor rota sus logs, con 5 archivos de 10 MB como máximo. Para verlos:

  ```bash
  docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail 200 api
  ```

## 9. Actualizar el servidor

Antes de cada actualización, hacer un **respaldo manual** (paso 7). Las migraciones nuevas se aplican solas al arrancar la API y nunca borran datos.

**A mano**, como `deploy`:

```bash
cd /opt/sisrec
git pull origin main
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
curl https://$DOMINIO/api/v1/health
```

**Con GitHub Actions** (recomendado cuando ya esté configurado):

- `.github/workflows/sisrec-ci.yml` corre en cada push o pull request:
  - las pruebas de la API (con su propio PostgreSQL), del cliente y del modelo de analítica;
  - el chequeo de tipos y el build.
- `.github/workflows/sisrec-deploy.yml` corre al crear un tag `sisrec-v*`:
  1. vuelve a pasar las pruebas;
  2. entra al servidor por SSH y hace `git checkout` del tag y `docker compose up -d --build`;
  3. espera a que `/api/v1/health` responda dentro del contenedor `api`. Si no responde en 5 minutos, el despliegue queda como fallido.

**[tú]** En GitHub, en Settings → Secrets and variables → Actions, cargar estos secretos:

| Secreto | Valor |
|---|---|
| `SISREC_SSH_HOST` | IP del servidor |
| `SISREC_SSH_USER` | `deploy` |
| `SISREC_SSH_KEY` | la clave privada SSH; la pública va en `~deploy/.ssh/authorized_keys` |
| `SISREC_SSH_KNOWN_HOSTS` | la huella del servidor, con `ssh-keyscan <IP>`; compararla con la que muestra el panel del VPS |
| `SISREC_APP_DIR` | `/opt/sisrec` |

Después crear el entorno `produccion`, en Settings → Environments, para poder exigir una aprobación antes de cada despliegue.

```bash
git tag sisrec-v1.0.0 && git push origin sisrec-v1.0.0
```

## 10. Si algo falla

| Síntoma | Qué pasa | Qué hacer |
|---|---|---|
| `/api/v1/health` responde 503 | la base de datos no contesta | `docker compose … logs --tail 100 postgres` y `docker compose … restart postgres` |
| El navegador avisa de un certificado inválido | el DNS aún no apunta al servidor o los puertos 80/443 están cerrados | revisar el registro A y `ufw status`; luego `docker compose … restart web` |
| El celular dice "El servidor no respondió" | el servidor está caído o lento | el cobrador sigue cobrando: el cobro queda en la cola sin señal y se sincroniza solo. Revisar el paso 8 |
| Un cobro aparece "En revisión" | llegó sin señal con algo dudoso (hora, tickets, sin tarifa) | el `super_admin` lo resuelve en *Control → Revisión de cobros*: el dinero ya se recibió, nunca se descarta |
| Un cobrador olvidó su clave | — | un super administrador le pone una clave nueva en **Usuarios → Clave nueva** y se la entrega; el cobrador puede cambiarla por una suya en **Mi clave** |
| Falta el super administrador titular (vacaciones, se fue, olvidó su clave o falleció) | — | el suplente entra, le pone clave nueva o desactiva su cuenta y crea al reemplazo en **Usuarios**; si faltan los dos, sección 11 |
| Se perdió un celular | la sesión del celular sigue abierta | en *Configuración → Dispositivos*, revocar su sesión: tendrá que volver a ingresar con la clave |

## 11. Continuidad: cambio de gestión y contingencia

La gestión municipal cambia cada 4 años y el personal rota. SISREC no puede depender de una persona: las cuentas son **de la municipalidad y de los cargos**, no de quien los ocupa.

### 11.1 Reglas fijas **[tú, al instalar]**

1. **Correos institucionales por cargo**, no personales: por ejemplo `sistemas@<dominio>` para el VPS, el dominio, GitHub y UptimeRobot, y `rentas@<dominio>` para avisos. Si la persona se va, el correo queda.
2. **Un super administrador titular y uno suplente**, de cargos distintos y designados por memorando (por ejemplo, titular la jefatura del área de cobranza y suplente la Gerencia de Rentas):
   - los dos tienen la cuenta activa, pero el suplente **solo la usa cuando el titular falta** (vacaciones, licencia, renuncia, fallecimiento) o con un encargo escrito;
   - cada mes el titular revisa en *Auditoría* lo que hizo el suplente, y el suplente revisa las anulaciones de cobros del titular: ninguno actúa sin que el otro pueda verlo;
   - si falta el titular, el suplente sigue trabajando ese mismo día, sin abrir el sobre.
3. **Un responsable técnico designado por resolución o memorando**: el área de informática o quien la municipalidad contrate como soporte.
4. **Sobre de contingencia** bajo custodia de **Secretaría General**, con acta de entrega. Contiene:
   - el acceso a la cuenta del VPS, del dominio y de GitHub (correo institucional y clave);
   - la clave del usuario `deploy` del servidor y la clave SSH privada, impresa o en una memoria USB;
   - una copia de `.env.production`;
   - esta guía impresa.

   El sobre va firmado y lacrado. **Nadie** conoce las claves de SISREC de los administradores: cada uno pone la suya.

### 11.2 Quién hace qué

| Papel | Quién | Qué hace |
|---|---|---|
| Autoriza | Gerente municipal (o el alcalde) | Firma el memorando que designa al nuevo administrador y autoriza abrir el sobre |
| Custodia | Secretaría General | Guarda el sobre y lo entrega solo con el memorando firmado; levanta el acta |
| Ejecuta | Responsable técnico designado | Ejecuta los comandos con su acceso al servidor; abre el sobre ante Secretaría General solo cuando corresponde (11.3) y entonces prepara uno nuevo |
| Reemplaza | Super administrador suplente | Actúa mientras falta el titular; no necesita el sobre ni al técnico |
| Usa | El nuevo administrador | Escribe su propia clave al crear su cuenta; el técnico no la conoce |

### 11.3 Cuándo se activa

| Situación | Qué se hace |
|---|---|
| El titular falta unos días (vacaciones, licencia, enfermedad) | Actúa el suplente. No se toca el servidor |
| El titular se va del cargo, olvida su clave o fallece | Actúa el suplente mientras tanto. Con memorando, el técnico crea al nuevo titular y desactiva la cuenta anterior (pasos 1 a 3 y 5 de 11.4), con su acceso habitual al servidor |
| Faltan **los dos** super administradores, o el técnico no tiene acceso al servidor | Se abre el sobre ante Secretaría General (pasos 1 a 5) |
| **Cambio de gestión** (cada 4 años, dentro de la transferencia de gestión) | Siempre, aunque nadie haya olvidado nada: se revisan titular y suplente, se desactivan las cuentas de quienes se van y se cambian las claves con un sobre nuevo (pasos 1 a 5) |
| Sospecha de que una clave se filtró | De inmediato: pasos 1, 3 y 4 |

### 11.4 Pasos del técnico

Con el memorando firmado, entrar al servidor con el acceso habitual del técnico o, si hace falta, abriendo el sobre ante Secretaría General. Luego:

```bash
cd /opt/sisrec
C="docker compose --env-file .env.production -f docker-compose.prod.yml"

# 1. Respaldo antes de tocar nada
$C run --rm backup ahora

# 2. Crear el nuevo super administrador (él mismo escribe su clave)
$C exec api node dist/cli/crear-admin.js

# 3. Ver las cuentas y desactivar las de quienes se fueron (no se borran: sus cobros quedan a su nombre)
$C exec postgres psql -U sisrec sisrec -c "SELECT u.id, u.nombre, u.email, r.codigo AS rol, u.activo FROM usuarios u JOIN roles r ON r.id = u.rol_id ORDER BY r.codigo, u.nombre"
$C exec postgres psql -U sisrec sisrec -c "UPDATE usuarios SET activo = false WHERE email = 'correo.de.quien.se.fue@ejemplo.pe'"
```

- Una cuenta desactivada ya no puede ingresar ni renovar su sesión; si tenía una abierta, se corta como máximo en 15 minutos (`JWT_EXPIRES_IN`).
- El cambio hecho con `psql` no queda en la auditoría de SISREC: por eso se anota en el acta (quién, qué cuenta, fecha y hora).
- Si ya hay un super administrador que puede entrar, es mejor desactivar las cuentas desde **Usuarios**: corta la sesión al instante y queda en la auditoría.

**4. Cambiar las claves del servidor y preparar un sobre nuevo:**

- cambiar la clave de la cuenta del VPS, del dominio y de GitHub (y del correo institucional `sistemas@` si la conocía la gestión saliente);
- cambiar la clave SSH: generar un par nuevo con `ssh-keygen -t ed25519`, poner la pública en `~deploy/.ssh/authorized_keys` y borrar la anterior; si se usa el despliegue automático, actualizar el secreto `SISREC_SSH_KEY` en GitHub;
- guardar todo en un **sobre nuevo**, lacrado, y destruir el anterior ante Secretaría General.

**5. Comprobar:** el nuevo administrador entra a SISREC, ve el padrón y la *Auditoría*, y `https://<dominio>/api/v1/health` responde `ok`.

### 11.5 Acta (modelo)

> En Salcedo, a las ___ horas del ___ de ______ de 20__, en la Secretaría General, con el memorando N° ______ de la Gerencia Municipal, se abrió el sobre de contingencia de SISREC en presencia de: ____________________ (Secretaría General), ____________________ (responsable técnico) y ____________________ (nuevo administrador).
>
> Se realizó: [ ] respaldo; [ ] alta del administrador ____________________ (correo ______________); [ ] desactivación de las cuentas: ____________________; [ ] cambio de claves del VPS, dominio, GitHub y SSH; [ ] prueba de ingreso y de `/api/v1/health`.
>
> Se entregó un sobre nuevo lacrado y se destruyó el anterior. Firman: ______________ · ______________ · ______________

### 11.6 Revisión anual

Una vez al año (y al empezar cada gestión), la Gerencia y el responsable técnico revisan:
- que haya un super administrador titular y uno suplente activos, y que sigan en sus cargos;
- que las cuentas de quienes se fueron estén desactivadas;
- que el sobre exista y sus claves funcionen, sin abrirlo: el técnico prueba el acceso con las claves vigentes y, si cambiaron, se prepara un sobre nuevo con acta.

## Lista de lo que te toca hacer a ti

- [ ] Unir a `main` el pull request de la rama de trabajo.
- [ ] Contratar el VPS y el dominio, y apuntar el DNS.
- [ ] Crear el bucket de respaldos y su regla de 30 días.
- [ ] Completar `.env.production` en el servidor.
- [ ] Definir las cuentas reales (nombres y correos) y crearlas con los scripts.
- [ ] Confirmar las zonas y su tipo de vía, y crear las tarifas por zona según la ordenanza.
- [ ] Entregar el Excel del padrón real y revisar las coordenadas.
- [ ] Fijar el mes de inicio de cobro.
- [ ] Asignar los lotes de tickets S3 y S2 a cada cobrador.
- [ ] Emitir e imprimir los carnets del portal.
- [ ] Instalar la app en los celulares de los cobradores y hacer la prueba en seco.
- [ ] Cargar los secretos en GitHub y crear el entorno `produccion`.
- [ ] Crear el monitor en UptimeRobot.
- [ ] Hacer la primera restauración de prueba y anotar el resultado.
- [ ] Crear los correos institucionales por cargo y poner a su nombre el VPS, el dominio, GitHub y UptimeRobot.
- [ ] Designar por memorando al responsable técnico y a los super administradores titular y suplente.
- [ ] Preparar el sobre de contingencia y entregarlo con acta a Secretaría General (sección 11).
