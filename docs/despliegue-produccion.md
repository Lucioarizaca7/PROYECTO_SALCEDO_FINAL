# Despliegue en producción (fase 4)

Paso a paso para dejar SISREC en un servidor propio. El sistema queda en un VPS con Docker Compose y cinco contenedores:

| Contenedor | Qué hace |
|---|---|
| `web` | Caddy: HTTPS automático y sirve la web |
| `api` | Express y las migraciones |
| `analytics` | proyección de recaudación |
| `postgres` | la base de datos |
| `backup` | respaldo diario |

Solo `web` queda expuesto a internet, por los puertos 80 y 443.

> Lo marcado con **[tú]** solo lo puede hacer la municipalidad o el responsable del proyecto: contratar, pagar, decidir nombres o tener acceso a cuentas.

## 1. Servidor y dominio **[tú]**

1. Contratar un VPS Ubuntu 24.04 de 2 vCPU y 4 GB de RAM (unos US$ 24 al mes en DigitalOcean o Akamai Linode). Alcanza de sobra para 120 comerciantes y 5 usuarios.
2. Registrar el dominio y crear un registro DNS **A** que apunte a la IP del servidor.
   - Si será `.gob.pe`, el trámite va con la Secretaría de Gobierno y Transformación Digital.
   - Para un servidor de pruebas sin dominio sirve `203-0-113-10.sslip.io`, poniendo la IP con guiones.
3. Crear un bucket S3 compatible para los respaldos (DigitalOcean Spaces, Linode Object Storage o Backblaze B2) con una regla de ciclo de vida de 30 días. Anotar el endpoint, la access key y la secret key.

## 2. Preparar el servidor

```bash
# como root, una sola vez
adduser --disabled-password deploy && usermod -aG docker deploy
curl -fsSL https://get.docker.com | sh
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
mkdir -p /opt/sisrec && chown deploy: /opt/sisrec
```

Luego, como `deploy`:

```bash
git clone https://github.com/luiarca/VISUAL_CODE.git /opt/sisrec
cd /opt/sisrec/Proyecto_Final_Salcedo_Rentas
cp .env.production.example .env.production
```

En `.env.production` hay que completar:

| Variable | Qué poner |
|---|---|
| `DOMAIN` | el dominio del paso 1 |
| `POSTGRES_PASSWORD` | una clave larga |
| `JWT_SECRET` | el resultado de `openssl rand -hex 48` |
| `BACKUP_S3_*` | los datos del bucket |

Este archivo solo existe en el servidor: no se sube a GitHub.

## 3. Primer arranque

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml ps        # todos "healthy"
curl https://$DOMINIO/api/v1/health                                             # {"status":"ok","base_de_datos":"ok","analitica":"ok"}
```

La API aplica sola las migraciones al arrancar. En producción **no** se crean los usuarios de demostración.

## 4. Cuentas reales **[tú decides los nombres y correos]**

```bash
C="docker compose --env-file .env.production -f docker-compose.prod.yml exec api"
$C node dist/cli/crear-admin.js                        # primer administrador (pide nombre, correo y clave)
$C node dist/cli/crear-usuario.js --rol cobrador       # una vez por cada cobrador
$C node dist/cli/crear-usuario.js --rol auditor        # jefa de área / auditor
```

- Las claves tienen como mínimo 10 caracteres.
- Nunca se escriben en la línea de comandos: el script las pregunta.

## 5. Datos reales

1. **Importar el padrón [tú entregas el Excel]:** en Comerciantes → Importar padrón, subir el Excel de la municipalidad. Primero se ve la vista previa y luego se confirma.
2. **Revisar coordenadas.** Este comando lista los puestos a más de 2 km del centro de Salcedo y termina con código 2 si encuentra alguno:

   ```bash
   $C node dist/cli/revisar-coordenadas.js
   ```

   Hay que corregirlos en el Mapa de sitios. El puesto de demostración S-001, por ejemplo, estaba a 63 km.
3. **Cargar las tarifas [tú confirmas la ordenanza vigente]:**
   - En Tarifas, crear las tarifas por rubro.
   - Las de vía asfaltada y sin asfaltar se crean con "Aplica a: zonas con vía asfaltada / sin asfaltar".
   - En Zonas, marcar el tipo de vía de cada zona.
4. **Inicio de cobro:** en Tarifas, fijar el primer mes desde el que se suma la deuda acumulada (por ejemplo `2026-12`, el mes del piloto).
5. **PIN del portal:** generar el PIN de cada comerciante desde Comerciantes → Ver QR, e imprimir el carnet.

## 6. Respaldos

| Qué | Cómo |
|---|---|
| Respaldo automático | El servicio `backup` hace `pg_dump` cada día a las 02:00 de Lima. Lo guarda 30 días en el volumen `respaldos` y, si se configuró el bucket, también fuera del servidor |
| Respaldo manual | `docker compose --env-file .env.production -f docker-compose.prod.yml run --rm backup ahora` |
| Restauración de prueba | `docker compose --env-file .env.production -f docker-compose.prod.yml run --rm backup sh /scripts/restaurar-respaldo.sh`. Hacerla una vez al mes |

La restauración de prueba carga la copia más reciente en una base temporal, muestra cuántas filas tiene cada tabla clave y después la borra. La base real no se toca.

Para restaurar de verdad tras un desastre, detener la API y usar `pg_restore --clean` sobre la base `sisrec`. Hacerlo con la guía de este documento a mano.

## 7. Monitoreo y logs **[tú creas la cuenta de UptimeRobot]**

- **UptimeRobot** (plan gratuito):
  - monitor HTTP(s) a `https://$DOMINIO/api/v1/health` cada 5 minutos;
  - responde 503 si la base de datos no contesta;
  - avisa por correo a la jefa de área y al responsable técnico.
- **Logs:** cada contenedor rota sus logs, con 5 archivos de 10 MB como máximo. Para verlos:

  ```bash
  docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail 200 api
  ```

## 8. Despliegues siguientes (GitHub Actions)

- `.github/workflows/sisrec-ci.yml` corre en cada push o pull request que toque el proyecto:
  - las pruebas de la API (con su propio PostgreSQL), del cliente y del modelo de analítica;
  - el chequeo de tipos y el build.
- `.github/workflows/sisrec-deploy.yml` corre al crear un tag `sisrec-v*`:
  1. vuelve a pasar las pruebas;
  2. entra al servidor por SSH y hace `git checkout` del tag y `docker compose up -d --build`;
  3. espera a que `/api/v1/health` responda.

**[tú]** En GitHub, en Settings → Secrets and variables → Actions, cargar estos secretos:

| Secreto | Valor |
|---|---|
| `SISREC_SSH_HOST` | IP del servidor |
| `SISREC_SSH_USER` | `deploy` |
| `SISREC_SSH_KEY` | la clave privada SSH; la pública va en `~deploy/.ssh/authorized_keys` |
| `SISREC_APP_DIR` | `/opt/sisrec` |

Después crear el entorno `produccion`, en Settings → Environments, para poder exigir una aprobación antes de cada despliegue.

```bash
git tag sisrec-v1.0.0 && git push origin sisrec-v1.0.0
```

## Lista de lo que te toca hacer a ti

- [ ] Contratar el VPS y el dominio, y apuntar el DNS.
- [ ] Crear el bucket de respaldos y su regla de 30 días.
- [ ] Completar `.env.production` en el servidor.
- [ ] Definir las cuentas reales (nombres y correos) y crearlas con los scripts.
- [ ] Entregar el Excel del padrón real y revisar las coordenadas.
- [ ] Confirmar las tarifas vigentes (ordenanza) y el tipo de vía de cada zona.
- [ ] Cargar los secretos en GitHub y crear el entorno `produccion`.
- [ ] Crear el monitor en UptimeRobot.
- [ ] Hacer la primera restauración de prueba y anotar el resultado.
