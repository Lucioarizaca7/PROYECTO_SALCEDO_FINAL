---
name: penpot-backend
description: Lee las pantallas de SISREC en Penpot y adapta el backend (apps/server) para que la API entregue lo que el diseño muestra. Úsala cuando el usuario diga "mira mi Penpot", "según el diseño", "lo que sale en la pantalla X de Penpot" o pida cambiar el backend a partir de una pantalla.
---

# Del diseño en Penpot al backend de SISREC

El diseño vive en el archivo de Penpot **"New File 1"**, con 4 páginas:

- **Fundamentos:** colores, tipografías, íconos y componentes.
- **Gestión:** pantallas 01 a 12 de la oficina.
- **Cobrador móvil:** pantallas M1 a M3.
- **Público y portal:** pantallas P1 a P5.

El backend es Express + TypeScript con PostgreSQL, en `apps/server`.

## 0. Antes de empezar

- Comprueba que las herramientas `mcp__penpot*` responden. Si no responden, pide al usuario dos cosas y espera:
  - que abra el archivo en Penpot con el plugin MCP conectado;
  - que deje esa pestaña **visible**, porque el navegador frena las pestañas de fondo.
- La primera vez en la sesión, lee `high_level_overview` del servidor de Penpot.

## 1. Leer la pantalla (solo lectura)

**No modifiques Penpot salvo que el usuario lo pida.**

1. Con `execute_code`, lista las páginas y los tableros. Busca el tablero que nombra el usuario, por ejemplo "05 · Pagos y cobros".
2. Extrae los textos del tablero en orden: títulos, etiquetas de campos, columnas de tablas, estados y botones. Esos textos son los datos que la API debe entregar o aceptar.
3. Si hace falta ver la composición, exporta **solo ese tablero** con `export_shape`. No exportes la página completa, porque tarda demasiado.
4. Mantén cada llamada corta, de menos de 60 s, y sin `setTimeout`.

## 2. Comparar el diseño con la API

Por cada dato de la pantalla, decide si ya existe, si falta o si cambia. Estas son las rutas actuales (`apps/server/src/index.ts`):

| Pantalla | Rutas |
|---|---|
| 01 Dashboard | `GET /api/v1/dashboard` |
| 02 Comerciantes, 04 Emitir carnet | `GET /comerciantes`, `GET /comerciantes/:id`, `POST /comerciantes/:id/llave`, `POST /comerciantes/llaves` |
| 03 Importar padrón | `POST /comerciantes/importar-padron`, `GET /comerciantes/plantilla-padron` |
| 05 Pagos y cobros, M1 a M3 | `GET /liquidaciones/:comercianteId`, `GET /cobros`, `POST /cobros/sincronizar`, `GET /comprobantes/:id/pdf` |
| 06 Cobro por zona | `GET /tarifas-zona`, `PUT /tarifas-zona/:categoriaId`, `PUT /tarifas-zona/:categoriaId/predeterminada` |
| 07 y 08 Sitios y mapa | `GET /puestos`, `POST /puestos-mapa`, `PUT /puestos-mapa/:id` |
| 09 Zonas y calles | `/zonas`, `/calles` (GET, POST, PUT, DELETE) |
| 10 Reportes | `GET /reportes` |
| 11 Auditoría | `GET /auditoria`, `GET /auditoria/verificacion` |
| 12 Analítica | `GET /analitica/prediccion`, `GET /analitica/riesgo` |
| P1 Pública | `GET /tarifas`, `GET /zonas`, `GET /catalogos` |
| P2 Ingreso del personal | `POST /auth/login` |
| P3 a P5 Portal | `POST /portal/login`, `GET /portal/me`, `GET /portal/:comercianteId/notificaciones` |

Antes de tocar código, muestra al usuario una lista corta con tres grupos: lo que ya cubre la API, lo que falta y lo que propones cambiar. Si el cambio toca dinero (tarifas, liquidación, crédito) o borra datos, **pide confirmación**.

## 3. Cambiar el backend

Sigue las convenciones del proyecto:

- **Esquema:** crea una migración nueva `apps/server/migrations/NNNN_descripcion.sql`, con el número siguiente al último.
  - **Nunca edites una migración ya aplicada.** `db.js` las aplica en orden y las registra en `schema_migrations`.
- **Consultas:** van como funciones exportadas en `apps/server/src/db.js`, con SQL parametrizado (`$1`, `$2`). Nunca concatenes valores.
- **Rutas:** van en `apps/server/src/index.ts`.
  - Si escriben datos, usan `requireAuth`, `requireRoles([...])` y `auditMutation({ db, accion, entidad, ... })`, igual que las rutas vecinas.
  - Las respuestas tienen la forma `{ data }` o `{ message }`.
- **Validación:** va en `apps/server/src/validation.ts`.
- **Roles:** `super_admin`, `auditor` y `cobrador`. El portal del comerciante usa su propio token.
- **Frontend:** si el cliente (`apps/client/src/App.jsx`) también debe cambiar, dilo y hazlo solo si el usuario lo pide.

## 4. Probar

Hace falta PostgreSQL con `DATABASE_URL` y `JWT_SECRET` definidos en `apps/server/.env` o en el entorno.

```bash
cd apps/server
node --import tsx --test tests/*.test.js   # todas deben pasar
npx tsc --noEmit                            # tipos
```

- Añade o ajusta una prueba en `apps/server/tests/` por cada regla nueva. Toma como modelo `cobro-zona.test.js`.
- Si puedes levantar el servidor (`npx tsx src/index.ts`), llama la ruta con `curl` y comprueba que la respuesta tenga los campos que muestra la pantalla de Penpot.

## 5. Cerrar

- Informa en español:
  - qué pantalla leíste;
  - qué rutas o tablas cambiaron y por qué;
  - el resultado de las pruebas;
  - qué queda pendiente en el frontend.
- Haz commit solo si el usuario lo pide o si es la norma de la sesión.
