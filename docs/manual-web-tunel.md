# Manual: probar SISREC en el celular con web-tunel

Este manual explica cómo abrir SISREC en un celular usando tu PC con Windows como servidor, sin contratar hosting. También explica qué hacer cada vez que el código cambia.

> **Otra opción:** `docs/prueba-con-tunel.md` (PR #8) levanta todo con Docker, igual que en producción. Este manual usa los servidores de desarrollo: es más rápido para probar cambios, porque las pantallas se actualizan solas.

---

## 1. Cómo funciona

```
Celular ──HTTPS──► https://<algo>.trycloudflare.com
                          │  (Cloudflare pone el certificado)
                          ▼
                   cloudflared en tu PC
                          │
                          ▼
            Web de SISREC   http://127.0.0.1:5176   (apps/client/vite.tunel.config.js)
                          │  todo lo que empieza con /api pasa a ▼
                          ▼
            API de SISREC   http://localhost:3003   (apps/server)
                          │
                          ▼
            PostgreSQL      localhost:5433          (contenedor Docker sisrec-postgres)
```

Son **cuatro piezas** y **se encienden en este orden**: base de datos → API → web → túnel. Si una se cae, todas las que vienen después fallan.

- **El orden importa.** Si la API arranca antes que la base de datos, se apaga y no vuelve a intentar. En el celular aparece «El servidor no respondió» (en versiones antiguas: `Failed to execute 'json' on 'Response'`).
- **El celular no habla directo con la API.** Habla con la web, y la web le pasa los pedidos de `/api` a la API. Por eso la dirección del túnel puede cambiar sin recompilar nada.
- **La web solo escucha en `127.0.0.1`.** Nadie de tu red Wi-Fi puede entrar directo; solo se entra por el túnel.

---

## 2. Preparación (se hace una sola vez)

| Qué | Cómo comprobarlo | Si falta |
|---|---|---|
| Docker Desktop | `docker --version` | Instalar Docker Desktop y abrirlo |
| Contenedor de la base | `docker ps -a --filter name=sisrec-postgres` | `docker compose up -d` en la raíz del proyecto |
| Node.js (versión LTS) | `node --version` | Instalar Node.js LTS |
| Dependencias | existe la carpeta `node_modules` en la raíz | `npm install` en la raíz del proyecto |
| cloudflared | `cloudflared --version` | `winget install --id Cloudflare.cloudflared` y cerrar y abrir la terminal |

No hace falta una cuenta de Cloudflare: el «túnel rápido» es gratis y anónimo.

---

## 3. Levantar web-tunel, paso a paso

Abre **cuatro ventanas de PowerShell** en la carpeta del proyecto (`D:\visual_code\Proyecto_Final_Salcedo_Rentas`): una para cada pieza. No cierres ninguna mientras pruebas.

> En PowerShell se escribe `curl.exe`, no `curl`: `curl` a secas es otro comando.

### Paso 1. Base de datos

1. Abre **Docker Desktop** y espera a que diga *Engine running*.
2. En la ventana 1:

```powershell
docker start sisrec-postgres
```

3. Comprueba que ya acepta conexiones (repítelo hasta que diga `accepting connections`):

```powershell
docker exec sisrec-postgres pg_isready
```

### Paso 2. API

En la ventana 2:

```powershell
npm run dev --workspace apps/server
```

Comprueba en la ventana 1:

```powershell
curl.exe http://localhost:3003/api/v1/health
```

Tiene que responder con `"status":"ok"` y `"base_de_datos":"ok"`. Si en la ventana 2 aparece `ECONNREFUSED 127.0.0.1:5433`, la base todavía no estaba lista: espera a que `pg_isready` diga *accepting connections*, presiona `Ctrl+C` en la ventana 2 y vuelve a correr el comando.

### Paso 3. Web

En la ventana 3:

```powershell
cd apps\client
npx vite --config vite.tunel.config.js
```

Comprueba en la ventana 1 que la web le pasa los pedidos a la API:

```powershell
curl.exe http://127.0.0.1:5176/api/v1/health
```

Tiene que responder lo mismo que en el paso 2.

### Paso 4. Túnel

En la ventana 4:

```powershell
cloudflared tunnel --no-autoupdate --protocol http2 --url http://127.0.0.1:5176
```

Después de unos segundos aparece un recuadro con una dirección parecida a esta:

```
https://palabra-palabra-palabra-palabra.trycloudflare.com
```

Esa es la dirección que vas a abrir en el celular. Espera a que la ventana muestre `Registered tunnel connection` antes de usarla.

- `--protocol http2` es necesario en esta red: el protocolo normal (QUIC) está bloqueado y sin esta opción Cloudflare devuelve el error 530.
- **La dirección cambia cada vez que reinicias cloudflared.** Mientras no cierres esta ventana, sigue siendo la misma.

### Paso 5. Abrir en el celular

1. En el celular abre **Chrome** (en iPhone, **Safari**) y escribe la dirección del paso 4.
2. Entra con un usuario de prueba.
3. Para probar sin señal, la primera vez entra con señal: así el celular guarda el padrón del día.

### Atajo desde la app de Claude

En `.claude/launch.json` están los servidores `api` y `web-tunel` (pasos 2 y 3). Puedes pedirle a Claude «enciende api y web-tunel». La base de datos (paso 1) y el túnel (paso 4) se encienden igual a mano.

---

## 4. Versión instalable (para probar «Instalar app» y el trabajo sin señal)

En el modo del paso 3 **no hay Service Worker**: no se puede instalar la app y, sin señal, la página no abre. Para probar eso se usa la versión compilada, en el mismo puerto 5176.

1. Detén la web del paso 3 (`Ctrl+C` en la ventana 3).
2. En la ventana 3, dentro de `apps\client`:

```powershell
npx vite build --config vite.tunel.config.js
npx vite preview --config vite.tunel.config.js
```

3. El túnel (ventana 4) **no se toca**: la dirección sigue siendo la misma.
4. En el celular recarga la página. Aparece el botón **Instalar app** en el menú (en iPhone: Compartir → Agregar a inicio).

El build queda en `apps/client/dist/tunel`, que no se sube a git.

> **Cuidado:** la app instalada queda ligada a la dirección del túnel. Si reinicias cloudflared, la dirección cambia y la app instalada deja de abrir. Hay que desinstalarla y volver a instalarla desde la dirección nueva.

---

## 5. Cuando el código cambia: cómo actualizar

Busca en la tabla qué cambió y haz solo lo que dice esa fila.

| Qué cambió | Modo desarrollo (paso 3) | Versión instalable (sección 4) |
|---|---|---|
| **Pantallas** (`apps/client/src`) | Nada: la web se actualiza sola. En el celular, recarga la página si no cambió. | Vuelve a correr `vite build` y `vite preview` (sección 4, punto 2). En el celular aparece «Hay una nueva versión de SISREC.» → toca **Actualizar**. |
| **Servidor** (`apps/server/src`) | Nada: la API se reinicia sola. Mira la ventana 2 para ver si arrancó sin error. | Igual. |
| **Migración nueva** (`apps/server/migrations`) | Reinicia la API: `Ctrl+C` en la ventana 2 y otra vez `npm run dev --workspace apps/server`. Las migraciones se aplican al arrancar. | Igual. |
| **`.env`**, `vite.config.js` o `vite.tunel.config.js` | Reinicia la pieza que lo usa: la API (ventana 2) o la web (ventana 3). | Igual, y vuelve a hacer el build. |
| **Bajaste cambios** (`git pull`) o **cambiaste de rama** | 1. Si cambió `package-lock.json`: `npm install` en la raíz. 2. Reinicia la API (ventana 2). 3. Reinicia la web (ventana 3). | Lo mismo y, al final, el build otra vez. |
| **Reiniciaste la PC** | Empieza desde el paso 1. La dirección del túnel será otra. | Igual, y reinstala la app en el celular. |

**El túnel (ventana 4) casi nunca se reinicia.** Ningún cambio de código lo necesita. Reiniciarlo solo cambia la dirección.

### Cómo comprobar que el celular ya tiene la versión nueva

1. En la PC: `curl.exe http://127.0.0.1:5176/api/v1/health` responde `ok`.
2. En el celular: recarga la página. En la versión instalable, toca **Actualizar** cuando aparezca el aviso. Si no aparece, cierra la app del todo (deslízala fuera de las apps recientes) y ábrela de nuevo.
3. Revisa que el cambio que esperabas se vea en la pantalla.

---

## 6. Apagar

Presiona `Ctrl+C` en este orden: ventana 4 (túnel), ventana 3 (web), ventana 2 (API). La base de datos puede quedar encendida; si quieres apagarla:

```powershell
docker stop sisrec-postgres
```

**Apaga el túnel apenas termines la prueba** (ver sección 8).

---

## 7. Problemas frecuentes

| Lo que ves | Por qué pasa | Qué hacer |
|---|---|---|
| «El servidor no respondió» o `Failed to execute 'json' on 'Response': Unexpected end of JSON input` | La API está apagada. Casi siempre arrancó antes que la base de datos. | Paso 1 (`pg_isready`) y después reinicia la API (paso 2). Recarga el celular. |
| Error **530** de Cloudflare, o en la ventana 4 `failed to dial to edge with quic` | La red bloquea QUIC. | Reinicia cloudflared **con** `--protocol http2`. |
| `Port 5176 is already in use` | Ya hay otra web en el 5176 (la de desarrollo, la instalable o una que encendió Claude). | Detén la otra. Solo puede haber una en ese puerto. |
| `Blocked request. This host is not allowed` | Entraste por una dirección que no es `*.trycloudflare.com`. | Usa la dirección que muestra la ventana 4. |
| El celular dice que no encuentra la página | El túnel se cerró o cambió la dirección. | Mira la ventana 4. Si la reiniciaste, usa la dirección nueva. |
| Los cambios no aparecen en la versión instalable | El Service Worker sigue mostrando la versión anterior. | Vuelve a hacer el build (sección 4) y toca **Actualizar** en el celular. |
| En una pestaña aparece otro usuario | La sesión es del navegador, no de la pestaña: entraste con otra cuenta en otra pestaña. | Es lo esperado. Usa una sola cuenta por navegador. |
| `cloudflared` no se reconoce como comando | Se instaló, pero la terminal no lo ve. | Cierra y abre PowerShell. Si sigue igual, usa la ruta completa: `& "C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel ...` |

---

## 8. Seguridad: el enlace es público

- **Cualquiera que tenga la dirección entra a la pantalla de ingreso.** No la publiques en grupos ni redes sociales.
- **En modo desarrollo existen los usuarios de demostración, con claves conocidas.** Quien tenga el enlace puede entrar con ellos. Por eso:
  - usa solo datos de prueba, nunca el padrón real ni datos personales reales;
  - apaga el túnel (ventana 4) al terminar.
- Nunca escribas en el chat ni en un documento las claves reales, ni las del super administrador.
- Para el piloto real con cobradores se usa el servidor de producción: `docs/despliegue-produccion.md`.
