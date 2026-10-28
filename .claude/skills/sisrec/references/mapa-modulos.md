# Mapa de módulos de SISREC

## Capas

**Backend (`apps/server/src`)**
- `index.ts`: solo `startServer` y el apagado; reexporta `app`.
- `app.ts`: helmet, CORS, límite de peticiones, JSON, montaje de los routers, 404 de `/api` y `http/errorHandler.ts`.
- `routes/<modulo>.ts`: un `express.Router()` por módulo. Cada ruta valida un poco, llama a `db.js` y da forma a la respuesta.
- `http/comunes.ts`: `staffOnly`, `loginLimiter`, `auditContext`, `receivePadronWorkbook`, `rowById`, `resolveComercianteParam`.
- `errors.js`: `AppError` y sus subclases con código HTTP.
- `db.js` mezcla SQL y reglas de negocio. Todas las funciones reciben `db` (el pool o un cliente de transacción) como primer argumento.
- `auth.ts`: bcrypt para las contraseñas, JWT corto de acceso, refresh token por dispositivo (tabla `sesiones_dispositivo`) y los middlewares `requireAuth`, `requireRoles` y `auditMutation`.
- `http/sesionCookie.ts`: la cookie HttpOnly `sisrec_refresh` (SameSite=Strict, Path=/api/v1/auth) que lleva el refresh token; el cuerpo de las respuestas nunca lo trae.
- `portalAcceso.js`: llave del carnet (huella SHA-256, tabla `comerciante_portal_acceso`), emisión de carnets, bloqueo por intentos y datos recortados del portal.
- `pg.js`: `pool` (máximo 10 conexiones), `withTransaction(fn)` y `testSchema`. En las pruebas, cada proceso usa su propio esquema.
- `validation.ts`, `config.ts`, `padronImport.js` (importa el padrón en Excel/CSV), `padronPlantilla.js` (plantilla oficial con `exceljs`) y `feriaZapatillasSeed.js`.

**Frontend (`apps/client/src`)**
- `App.jsx`: solo las rutas (React Router, `BrowserRouter`). Sin sesión: `/`, `/ingresar`, `/portal`; con sesión, una ruta por página de `app/navegacion.js` (`/panel`, `/pagos`, `/sitios`…), con su control de rol.
- `app/`: `useSesion` (ingreso, cierre, sesión vencida), `useDatosSisrec` (datos que comparten las páginas y `refresh()`), `SisrecContext` (`useSisrec()`), `AppShell` (menú y barra superior) y `navegacion.js`.
- `pages/`: una página por ruta. Su estado y sus llamadas van en `hooks/` (`usePagos`, `useSitios`, `useComerciantes`, `useZonas`, `useTarifas`).
- `features/payments`: `recibo.js` (huella, impresión, WhatsApp) y `sugerenciaExpress.js` (lógica pura, con prueba).
- `features/comerciantes`: directorio y QR del comerciante.
- `features/offline`: `useJornada`, `useOfflineQueue`, `ReviewPanel`, `DeviceSessions`, `FieldWorkPanel`.
- `components/features/map`: `SitesMap` (Leaflet), `SitesMap25D` (mapbox-gl) y `sitesGeo.js`, que es lógica pura y tiene pruebas.
- `services`: `session.js` (tokens, `authFetch`, renovación), `offlineQueue.js` + `offlineStore.js` (IndexedDB, huella SHA-256), `jornadaOffline.js` y `mapaOffline.js` + `colaMapa.js` (cambios del mapa sin señal; los rechazados se ven en `CambiosRechazadosMapa`).
- `utils`: `bluetoothPrint.js`, `offlinePrintQueue.js`, `testable/receiptFormatter.js`.

## Flujo de datos

```
PostgreSQL ──► función de db.js (filas planas; dinero como Number; fechas con TS())
           ──► routes/<modulo>.ts ──► { data, message?, total? } | { message }
           ──► authFetch (session.js) ──► useDatosSisrec o hook de la página ──► página
```

## Interacción entre módulos

```
Autenticación: login → JWT de acceso + refresh por dispositivo (sesiones_dispositivo)
      └─ requireAuth/requireRoles → auditMutation → auditoria_logs (cadena, verifyAuditChain)

Mapa / Padrón:  zonas ─┐
                comerciantes ─┼─ puestos (lat/lng, estado) ─→ GET /puestos → withPaymentStatus
                tarifas ──────┘                                    └─ calcularLiquidacion (mes)

Cobros: POST /cobros → registrarCobro (withTransaction, codigo_operacion)
        → transacciones + comprobantes → PDF (/comprobantes/:id/pdf) o impresora Bluetooth

Offline: GET /jornada/paquete → IndexedDB → cola → POST /cobros/sincronizar-lote
         → SUCCESS / IGNORED (repetido) / OBSERVED (cobros_observados → revisión)
```

`calcularLiquidacion` es el centro del sistema. La usan Pagos, el mapa, Sitios de venta, el panel (`getPendingDebt`), el portal, la jornada y el riesgo de morosidad.

## Rutas por módulo (`/api/v1`)

Roles: `super_admin`, `cobrador`, `auditor`, `comerciante`. `staffOnly` = los tres primeros.

| Módulo | Rutas | Roles para modificar |
|---|---|---|
| Salud / público | `GET /health`, `GET /publico/resumen` | públicas |
| Panel y analítica | `GET /dashboard`, `/analitica/prediccion`, `/analitica/riesgo`, `/reportes` | lectura del personal |
| Catálogos | `GET /roles`, `/catalogos`; CRUD `/zonas`, `/calles` | super_admin, auditor |
| Comerciantes | CRUD `/comerciantes`, `POST /comerciantes/importar-padron`, `GET /comerciantes/plantilla-padron`, `/comerciantes/:id/preferencias` | super_admin, auditor (las preferencias también cobrador) |
| Puestos | `GET /puestos?incluirInactivos=1`, `POST /puestos`, `POST/PUT/DELETE /puestos-mapa`, `POST /puestos/:id/liberar` | super_admin, cobrador |
| Tarifas | `GET/POST/PUT /tarifas` | según la ruta (ver `routes/tarifas.ts`) |
| Liquidación | `GET /liquidaciones/:comercianteId`, `GET /comerciantes/:id/saldo` | lectura |
| Cobros | `GET/POST /cobros`, `POST /cobros/sincronizar`, `/cobros/sincronizar-lote`, `/cobros/observados(/:id/resolver)`, `/cobros/sincronizacion/errores` | cobrador, super_admin |
| Anulación y tiempos | `POST /cobros/:id/anular` (motivo), `GET /cobros/tiempos` | anular: solo super_admin; tiempos: super_admin, auditor |
| Asistencia ferial | `GET /asistencias?fecha=`, `POST /asistencias` (una o `{ marcas: [...] }`) | cobrador, super_admin |
| Parámetros | `GET /parametros`, `PUT /parametros/inicio_cobro` | super_admin |
| Caja (`routes/caja.ts`) | `GET /caja/resumen`, `POST /caja/cierre`, `GET /caja/cierres` | cobrador ve solo la suya; cierres: super_admin, auditor |
| Tickets (`routes/tickets.ts`) | `GET /tickets/series`, `/tickets/lotes`, `/tickets/cobradores`, `/tickets/mios`; `POST /tickets/lotes`, `/tickets/lotes/:id/reasignar`, `/tickets/lotes/:id/devolver`, `/tickets/anulaciones` | lotes: solo super_admin (auditor consulta); mios y anulaciones: cobrador, super_admin |
| Recibo | `GET /comprobantes/:id/pdf` (personal), `GET /portal/recibos/:token/pdf` (enlace firmado de 30 min), `GET /publico/verificar/:token` (QR) | `src/reciboPdf.js` |
| Jornada | `GET /jornada/paquete` | cobrador |
| Auditoría | `GET /auditoria`, `/auditoria/verificacion` | lectura |
| Autenticación | `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `GET/DELETE /auth/sesiones` | — |
| Portal | `POST /portal/login` (identifier + llave, o la llave sola), `POST /comerciantes/:id/carnet`, `POST /comerciantes/carnets`, `GET /portal/:id/notificaciones`, `POST /notificaciones`, `GET /comprobantes/:id/pdf` | el carnet lo emite solo super_admin |

Para ver los roles exactos de una ruta: `grep -rn "'/api/v1/<ruta>" apps/server/src/routes/` y leer las líneas siguientes.

## Esquema

- **0001 (núcleo):** `roles`, `usuarios`, `zonas`, `rubros`, `comerciantes`, `puestos`, `tarifas`, `comprobantes`, `transacciones`, `colas_sincronizacion`, `auditoria_logs`, `modelos_ia_metricas`.
- **0002:** `calles`, `notificaciones`, `comerciante_preferencias`, `asistencias_feriales`.
- **0003 (fase 2, offline):** `sesiones_dispositivo` (refresh de 12 h, revocable) y `cobros_observados`.
- **0004:** código de negocio del comerciante `COM-{correlativo}-{iniciales}-{rubro}-{documento}-{zona}-{estado}-{AAAAMMDD}` y `comerciante_codigos_historicos`.
- **0005:** el código solo muestra los 3 últimos dígitos del DNI/RUC (Ley 29733). Los códigos antiguos pasan al historial para que los QR ya impresos sigan funcionando.
- **0006:** `puestos.comerciante_id` acepta NULL, con el CHECK `puestos_ocupado_con_titular`.
- **0007:** `comerciante_portal_acceso` (PIN del portal con bcrypt, intentos fallidos y bloqueo). Va aparte de `comerciantes` para que el hash no salga en `SELECT *` ni en la auditoría.
- **0008:** anulación con motivo (`anulado_en`, `anulado_por`, `motivo_anulacion`, CHECK) e `inicio_atencion` (tiempo por cobro).
- **0009:** `zonas.tipo_via` y `tarifas.tipo_via`.
- **0010:** `asistencias_feriales.asistio` (calculada: marca que empieza con P) y `registrado_por`.
- **0011:** `parametros_sistema` (`inicio_cobro`) y `transacciones.periodo_aplicado`.
- **0012:** `cierres_caja` (esperado del servidor vs. declarado, `diferencia` calculada, uno por cobrador y día).
- **0013:** cobro por día cobrado (tarifas generales `semanal` por tipo de vía, S/ 3 y S/ 2) y observación del cobrador en `asistencias_feriales`.
- **0014:** tickets preimpresos: `ticket_series`, `ticket_lotes`, `tickets` (`UNIQUE (serie, numero)`), `transacciones.tickets`, `cierres_caja.tickets` y el parámetro `tickets_umbral_aviso`.
- **0015:** `asistencias_feriales.comerciante_id` (titular del día de la marca; trigger `asistencia_titular`, CHECK `NOT VALID`) y `titular_de_asistencia(puesto, fecha)`, que reconstruye las marcas viejas con la auditoría.
- **0016:** llave del carnet en `comerciante_portal_acceso` (`llave_hash` SHA-256, `llave_emitida_en/por`).
- **0017:** el portal queda solo con la llave: se borra `pin_hash` y los accesos que solo tenían PIN.
- **0018:** `puestos.zona_por_regularizar` (puesto del padrón sin zona o con zona no registrada).
