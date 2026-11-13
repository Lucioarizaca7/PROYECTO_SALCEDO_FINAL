# Probar SISREC en los celulares desde una PC (túnel HTTPS gratuito)

Esta prueba instala SISREC en los celulares de los cobradores **sin contratar todavía un servidor**. La PC con Windows hace de servidor y un túnel gratuito de Cloudflare le da una dirección `https://…trycloudflare.com`. Hace falta HTTPS: sin él, Chrome no instala la app ni deja trabajar sin señal.

> **Solo para probar.** Se usan los usuarios de demostración, cuyas claves son públicas. **Nunca** cargue aquí el padrón real y cierre el túnel al terminar. Para el piloto se usa el servidor de [`despliegue-produccion.md`](despliegue-produccion.md).

## Qué hace falta

| Qué | Detalle |
|---|---|
| PC con Windows 10/11 | Con **Docker Desktop** instalado y abierto, y conectada a internet. No debe suspenderse durante la prueba |
| El proyecto actualizado | En la carpeta del proyecto: `git pull origin main` |
| cloudflared | El programa del túnel. Se instala en el paso 1 |
| 2 celulares Android | Con Chrome actualizado y datos móviles o wifi |

## 1. Instalar cloudflared (una sola vez)

En **PowerShell**:

```powershell
winget install --id Cloudflare.cloudflared
```

Cierre y vuelva a abrir PowerShell. Para comprobarlo, `cloudflared --version` debe mostrar un número de versión.

## 2. Levantar SISREC en la PC

En PowerShell, dentro de la carpeta del proyecto:

```powershell
Copy-Item .env.tunel.example .env.tunel
notepad .env.tunel     # cambie POSTGRES_PASSWORD y JWT_SECRET por textos largos cualesquiera, y guarde
docker compose --env-file .env.tunel -f docker-compose.prod.yml -f docker-compose.tunel.yml up -d --build
```

- La primera vez tarda entre 5 y 15 minutos, porque descarga y compila todo.
- Para comprobarlo, abra `http://localhost:8080` en el navegador de la PC: debe aparecer SISREC.
- Si el puerto 8080 está ocupado, cambie `HTTP_PORT=8080` por `HTTP_PORT=8081` en `.env.tunel`, repita el último comando y use 8081 en los pasos siguientes.

## 3. Abrir el túnel

En **otra** ventana de PowerShell, que debe quedar abierta toda la prueba:

```powershell
cloudflared tunnel --url http://localhost:8080
```

Después de unos segundos aparece un recuadro con una dirección como:

```
https://palabras-al-azar.trycloudflare.com
```

Esa es la dirección para los celulares. **Cambia cada vez** que se cierra y se vuelve a abrir el túnel.

## 4. Preparar los datos de prueba (en la PC)

Abra la dirección del túnel en el navegador de la PC e ingrese con `admin@salcedo.gob.pe` / `admin123`. Luego:

1. **Comerciantes → Carga masiva del padrón:** suba `datos-prueba/padron-prueba-50.xlsx` y pulse *Confirmar importación de 50 filas*.
2. **Zonas y calles:** a cada zona (Mercado Central, Parque Principal, Zona Norte) póngale su **Tipo de vía**, por ejemplo una con *Vía sin asfaltar* y las otras con *Vía asfaltada*. Sin tipo de vía no se puede cobrar por día a los feriales.
3. **Tickets** (opcional, para probar los tickets): asigne al *Cobrador Principal* un lote **S3** del 1 al 100 y uno **S2** del 1 al 100.

Para un segundo celular puede crear otro cobrador:

```powershell
docker compose --env-file .env.tunel -f docker-compose.prod.yml -f docker-compose.tunel.yml exec api node dist/cli/crear-usuario.js --rol cobrador
```

## 5. Instalar la app en cada celular

1. En Chrome del celular, abra la dirección `https://…trycloudflare.com`.
2. Acepte el aviso **"Instala SISREC en este celular…"**, o use el menú ⋮ → *Instalar aplicación* (o *Agregar a pantalla principal*).
3. Abra SISREC desde el ícono de la pantalla de inicio e ingrese con `cobrador@salcedo.gob.pe` / `cobro123`.
4. En **Pagos y cobros**, espere a que diga **Listo para hoy**, o pulse *Descargar padrón y tarifas*.

## 6. Probar sin señal

Siga [`guia-prueba-campo-offline.md`](guia-prueba-campo-offline.md) desde la parte **B** y anote cada resultado en su tabla. Lo principal:

1. Active el **modo avión** y cierre la app por completo. Ábrala de nuevo: debe abrir y mostrar *"Sin señal…"*.
2. Busque comerciantes por DNI, código o nombre, y haga varios cobros. Cada uno debe decir *"el cobro quedó guardado en el celular…"* y mostrar un recibo `PROV-…`.
3. Quite el modo avión. En unos segundos, o con *Sincronizar ahora*, cada cobro debe pasar a **Sincronizado** con número `R-…`.
4. En la PC, en *Pagos y cobros* o *Cierre de caja*, los cobros deben aparecer **una sola vez**.

Ya se comprobó en un navegador de computadora con esta misma configuración (13/11/2026): la app abrió sin señal, el cobro quedó guardado con recibo `PROV-` y, al volver la señal, se registró una sola vez como `R-000001`. Lo que falta es probarlo en los celulares reales.

## 7. Al terminar

```powershell
# en la ventana del túnel: Ctrl + C
docker compose --env-file .env.tunel -f docker-compose.prod.yml -f docker-compose.tunel.yml down        # apaga SISREC, conserva los datos
docker compose --env-file .env.tunel -f docker-compose.prod.yml -f docker-compose.tunel.yml down -v     # apaga y BORRA los datos de prueba
```

## Problemas frecuentes

| Qué pasa | Qué hacer |
|---|---|
| `docker` no se reconoce o "cannot connect to the Docker daemon" | Abra Docker Desktop y espere a que diga *Engine running* |
| `http://localhost:8080` no abre | Espere un minuto más; vea `docker compose --env-file .env.tunel -f docker-compose.prod.yml -f docker-compose.tunel.yml ps` (todos *running/healthy*) |
| El celular no muestra la opción de instalar | Abra la dirección **https** del túnel, no `http://localhost` ni la IP de la PC |
| Se cerró el túnel y la dirección cambió | En el celular: mantenga presionado el ícono → *Desinstalar*, y vuelva al paso 5 con la dirección nueva. **Antes**, sincronice los cobros pendientes |
| "Demasiados intentos" al ingresar | Espere 15 minutos; o suba `LOGIN_RATE_LIMIT_MAX` en `.env.tunel` y repita el comando del paso 2 |
| La PC se suspendió | El túnel se corta: los celulares siguen cobrando sin señal y sincronizan cuando la PC y el túnel vuelvan |

Si algo falla, anote el paso, el modelo de celular y una captura de pantalla.
