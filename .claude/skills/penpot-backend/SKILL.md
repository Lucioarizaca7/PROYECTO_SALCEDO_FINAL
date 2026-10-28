---
name: penpot-backend
description: Lee las pantallas de SISREC en Penpot y adapta el backend (apps/server) para que la API entregue lo que el diseño muestra. Úsala cuando el usuario diga "mira mi Penpot", "según el diseño", "lo que sale en la pantalla X de Penpot" o pida cambiar el backend a partir de una pantalla. Para cambios solo visuales del cliente usa ui-ux-pro-max; para reglas de negocio, la skill sisrec.
---

# Del diseño en Penpot al backend de SISREC

Traída de la rama `claude/gifted-mendel-9fxas5` y ajustada a la estructura de `correccion/logica-cobros`, donde las rutas viven en `routes/` y el cliente en `pages/` y `hooks/` (28/10/2026).

El diseño vive en el archivo de Penpot **"New File 1"**, con 4 páginas:

- **Fundamentos:** colores, tipografías, íconos y componentes.
- **Gestión:** pantallas 01 a 12 de la oficina.
- **Cobrador móvil:** pantallas M1 a M3.
- **Público y portal:** pantallas P1 a P5.

**Los colores del Penpot son azules, pero el sistema usa el verde del escudo** (decisión del 28/10/2026). Del diseño se toman los datos, la tipografía y el layout; la paleta, no. La capa visual está en `apps/client/src/tema-municipal.css`.

## 0. Antes de empezar

- Lee la skill `sisrec`: sus reglas (migraciones, roles, Ley 29733, nota de cambio) mandan sobre esta.
- Comprueba que las herramientas de Penpot (`execute_code`, `export_shape`) responden. Si no, pide al usuario dos cosas y espera:
  - que abra el archivo en Penpot con el plugin MCP conectado;
  - que deje esa pestaña **visible**, porque el navegador suspende las pestañas de fondo ("no heartbeat").
- La primera vez en la sesión, lee `high_level_overview` del servidor de Penpot.

## 1. Leer la pantalla (solo lectura)

**No modifiques Penpot salvo que el usuario lo pida.**

1. Con `execute_code`, lista las páginas y los tableros (`penpotUtils.getPages()`, `page.root.children`). Busca el tablero que nombra el usuario, por ejemplo "05 · Pagos y cobros".
2. Extrae los textos del tablero en orden: títulos, etiquetas de campos, columnas de tablas, estados y botones. Esos textos son los datos que la API debe entregar o aceptar.
3. Si hace falta ver la composición, exporta **solo ese tablero** con `export_shape`. La página completa tarda demasiado.
4. Mantén cada llamada corta (menos de 60 s) y sin `setTimeout`.

## 2. Comparar el diseño con la API

Por cada dato de la pantalla, decide si ya existe, si falta o si cambia. Rutas actuales, con el prefijo `/api/v1` (cada archivo en `apps/server/src/routes/`):

| Pantalla | Rutas | Archivo |
|---|---|---|
| 01 Dashboard | `GET /dashboard` | `sistema.ts` |
| 02 Comerciantes | `GET/POST /comerciantes`, `GET/PUT/DELETE /comerciantes/:id`, `POST /comerciantes/:id/portal-pin` | `comerciantes.ts` |
| 04 Emitir carnet | `POST /comerciantes/:id/carnet`, `POST /comerciantes/carnets` (solo super_admin) | `comerciantes.ts` |
| 03 Importar padrón | `POST /comerciantes/importar-padron`, `GET /comerciantes/plantilla-padron` | `comerciantes.ts` |
| 05 Pagos y cobros, M1 a M3 | `GET /liquidaciones/:comercianteId`, `GET /comerciantes/:id/saldo`, `GET/POST /cobros`, `POST /cobros/sincronizar(-lote)`, `POST /cobros/:id/anular`, `GET /comprobantes/:id/pdf`, `GET /jornada/paquete` | `cobros.ts` y `tarifas.ts` (liquidación y saldo) |
| Caja (sin pantalla en Penpot) | `GET /caja/resumen`, `GET /caja/cierres`, `POST /caja/cierre` | `caja.ts` |
| 06 Cobro por zona | `GET/POST /tarifas`, `PUT /tarifas/:id`, `PUT /parametros/inicio_cobro` | `tarifas.ts` |
| 07 y 08 Sitios y mapa | `GET/POST /puestos`, `POST /puestos/:id/liberar`, `POST/PUT/DELETE /puestos-mapa` | `puestos.ts` |
| 09 Zonas y calles | `/zonas`, `/calles` (GET, POST, PUT, DELETE) | `catalogos.ts` |
| 10 Reportes | `GET /reportes` | `sistema.ts` |
| 11 Auditoría | `GET /auditoria`, `GET /auditoria/verificacion` | `auditoria.ts` |
| 12 Analítica | `GET /analitica/prediccion`, `GET /analitica/riesgo` | `sistema.ts` |
| P1 Pública | `GET /publico/resumen`, `GET /tarifas`, `GET /zonas`, `GET /catalogos` | varios |
| P2 Ingreso del personal | `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout` | `sesiones.ts` |
| P3 a P5 Portal | `POST /portal/login` (PIN o llave del carnet), `GET /portal/recibos/:token/pdf` | `portal.ts` |

Si una ruta no está en esta tabla, búscala con `grep -n "router\.\(get\|post\|put\|delete\)" apps/server/src/routes/*.ts`.

Antes de tocar código, muestra al usuario una lista corta con tres grupos: lo que ya cubre la API, lo que falta y lo que propones cambiar. Si el cambio toca dinero (tarifas, liquidación, crédito), roles, datos personales o borra datos, **pide confirmación**. Esas son decisiones del usuario.

## 3. Cambiar el backend

Sigue la skill `sisrec`:

- **Esquema:** crea una migración nueva `apps/server/migrations/NNNN_descripcion.sql` con el número siguiente al último, con `BEGIN; … COMMIT;` y comentarios en español. **Nunca edites una migración ya aplicada.**
- **Reglas y consultas:** van como funciones exportadas en `apps/server/src/db.js` (o en su módulo, como `portalAcceso.js`), con SQL parametrizado.
- **Rutas:** van en `apps/server/src/routes/<modulo>.ts`, con `requireAuth` y `requireRoles([...])` (o `...staffOnly`). Si escriben datos, también `auditMutation`, sin guardar secretos.
  - Las respuestas tienen la forma `{ data, message?, total? }` o `{ message }`.
  - Una ruta GET nueva sube el conteo fijo de `tests/api-seguridad.test.js`.
- **Roles:** `super_admin`, `cobrador`, `auditor` y `comerciante`. El portal no tiene sesión guardada: cada consulta pide PIN o llave.
- **Frontend:** página en `apps/client/src/pages/`, lógica en `hooks/`, llamadas con `authFetch`. Cámbialo solo si el usuario lo pide.

## 4. Probar

```bash
cd apps/server
npm test                 # todas deben pasar
npx tsc --noEmit         # tipos
```

- Añade una prueba en `apps/server/tests/` por cada regla nueva. Toma como modelo `portal-llave.test.js` (API levantada de verdad, cada prueba con sus propios datos).
- Con los servidores `api` y `web` de `.claude/launch.json`, comprueba en el navegador que la pantalla muestre los campos del tablero de Penpot.

## 5. Cerrar

- Informa en español:
  - qué pantalla leíste;
  - qué rutas o tablas cambiaron y por qué;
  - el resultado de las pruebas;
  - qué queda pendiente.
- Entrega la nota de cambio de la skill `sisrec`.
- No hagas commit ni push sin que el usuario lo pida.
