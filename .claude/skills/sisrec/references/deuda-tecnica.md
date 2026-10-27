# Deuda técnica conocida (análisis del 2026-10-16)

Ordenada de más a menos grave. Antes de tomar uno de estos puntos, comprobar que siga igual en el código.

1. (Resuelto en la rama `seguridad/portal-y-sesion`: el portal pide DNI o código + PIN del carnet, con bloqueo tras 5 PIN errados, y devuelve el documento oculto.)
2. (Resuelto en la misma rama: el token de renovación va en la cookie HttpOnly `sisrec_refresh` y el de acceso solo en memoria.)
3. (Resuelto en "Refactor 6", rama `claude/compassionate-hermann-e2df59`: `getPendingDebt` ya no corta en 300 comerciantes.)
4. (Resuelto en "Refactor 6": `calcularLiquidacionLote` reemplaza el bucle N+1 en el panel, el mapa, la jornada y el riesgo de morosidad.)
5. (Resuelto en "Refactor 5": `App.jsx` quedó en las rutas; cada página tiene su archivo y su hook.) Queda: todos los datos compartidos se recargan juntos con `refresh()` (10 peticiones), sin caché por página.
6. **Varios puestos:** con cobro por día paga por cada puesto marcado; con tarifa mensual o diaria de rubro, por uno solo (el principal).
7. **Detalles menores:**
   - No hay páginas de Usuarios ni de Cobradores (las de relleno se quitaron en "Refactor 5"): se administran en la base.
   - Hay dos endpoints para crear puestos.
   - El botón "Exportar CSV" de Reportes es un enlace sin token (`<a href=…/reportes?formato=csv>`): la API responde 401. Debe descargarse con `authFetch` y un Blob.
   - (Resuelto en "Refactor 2": cada error responde con el código HTTP de su causa.)

## Errores de lógica (revisión del 2026-10-16)

Resueltos en la rama `correccion/logica-cobros` (commit 5a23ca5f, sale de `seguridad/portal-y-sesion`), con pruebas en `tests/logica-cobros.test.js`:
- Cobros simultáneos pasaban del saldo: ahora `registrarCobro` bloquea al comerciante con `FOR NO KEY UPDATE`.
- Una tarifa nueva desde el día 1 dejaba lo pagado en 0: la liquidación mensual ya no filtra por `tarifa_id`.
- Editar un puesto sin GPS lo dejaba en (0, 0): `parseCoord` en `db.js`.
- Periodo en UTC en el cliente: ahora se usa `periodoEnLima` (`services/jornadaOffline.js`).

Los mismos arreglos de servidor están también en `claude/compassionate-hermann-e2df59` (commit acdda653), sobre `repos/cobros.js` (`sumPagadoDelPeriodo`, `getPagadoDelPeriodoPorComerciante`, `bloquearComerciante`), `services/liquidacion.js` (el lote) y `services/puestos.js`. **Al unir:** quedarse con la versión de repos/services y con la prueba `logica-cobros.test.js` de esa rama (llama también al lote). El arreglo del periodo en el cliente solo está en `correccion/logica-cobros`.

Resueltos el 2026-10-17:
- **Filtro de auditoría por comerciante** y **baja por edición** (`updateComerciante` a `inactivo` ahora da de baja los puestos, con `darDeBajaComerciante`): commit e3ac9a8b en la rama `correccion/logica-pendientes` (sale de `correccion/logica-cobros`, copia de trabajo en `.claude/worktrees/logica-pendientes`) y commit 0ab12ac2 en `claude/compassionate-hermann-e2df59` (en `repos/auditoria.js` y `repos/comerciantes.js`). Prueba: `tests/logica-pendientes.test.js`. También aplicados, sin commit, en el checkout principal.
- **Pago de un periodo anterior:** ya lo resolvía el trabajo de despliegue sin commit (`transacciones.periodo_aplicado`, migración 0011, `paidInPeriod`).
- **Tarifa semanal → cobro por día cobrado** y **observación del cobrador**: sin commit en el checkout principal, sobre el trabajo de despliegue (dependen de las migraciones 0009 y 0010, que no están en ninguna rama). Migración `0013_cobro_por_dia.sql`, prueba `tests/cobro-por-dia.test.js`. No se puede aplicar a `claude/compassionate-hermann-e2df59`: esa rama no tiene la tabla de asistencias. Ver la regla en `reglas-negocio.md`.

Revisión del cobro por día (2026-10-17), corregidos sin commit en el checkout principal y probados en `tests/cobro-por-dia.test.js`:
- un cobro sin señal que llegaba antes que la marca iba a revisión;
- cargar el tipo de vía reescribía meses anteriores;
- lo pagado en un mes sin días desaparecía;
- el botón Asistió borraba la observación;
- una P del Excel valía más que un "no salió".

Decidido: con dos puestos marcados el mismo día paga por cada puesto (S/ 3 por puesto en vía asfaltada), con la tarifa de la zona de cada puesto.

**Tickets preimpresos (consigna 6, 2026-10-20):**
- Están sin commit en el checkout principal y dependen de 0009, 0012 y 0013.
- Comprende:
  - la migración `0014_tickets_preimpresos.sql`;
  - `routes/tickets.ts`;
  - la prueba `tests/tickets.test.js`;
  - en el cliente: `services/ticketsOffline.js`, `pages/TicketsPage.jsx` y la prueba `tests/ticketsOffline.test.js`.
- Decisiones del usuario:
  - asigna solo `super_admin`;
  - el ticket convive con el recibo R-;
  - un ticket por día cobrado (también para varios días o varios puestos).
- No se aplicó a `claude/compassionate-hermann-e2df59`.

Pendientes menores:
- El PDF de `/comprobantes/:id/pdf` siempre imprime "sha256:local", porque `getCobros` no trae `hash_transaccion`, y carga todos los cobros para buscar uno.
- El hash de auditoría incluye `Date.now()`, que no se guarda: la cadena verifica los enlaces pero no el contenido.
- `POST /comerciantes/:id/preferencias` reemplaza todas las claves.
- Auditoría de seguridad del 2026-10-22 (skill appsec-elite-auditor). Quedan pendientes:
  - la CSP de la app web solo fija `frame-ancestors`, `base-uri`, `object-src` y `form-action`. Falta limitar scripts y estilos, y antes hay que probarlo con el mapa (mapbox-gl usa workers `blob:`) y con Google Fonts;
  - `jwt.verify` no fija `algorithms: ['HS256']`;
  - el HMAC de los recibos usa el mismo secreto que el JWT;
  - `concepto` y `observaciones` del cobro, y el nombre al editar un comerciante, no tienen largo máximo;
  - el log de accesos de Caddy guarda la URL completa (DNI en `?search=`, enlaces firmados de recibos).
- Las tarifas por rubro que estén en la base real siguen activas: en una zona sin tipo de vía se siguen usando.
- **Cambio de zona de un puesto (2026-10-27):** la liquidación toma la zona actual del puesto, así que cambiarla recalcula los meses pasados con la tarifa de la zona nueva. La rama de GitHub `claude/gifted-mendel-9fxas5` lo resuelve con `puestos_historial` (zona y tarifa por tramos de fechas); aquí falta.
- **Importación del padrón:**
  - el `previewToken` vive en la memoria de la API: con varias instancias o tras un reinicio, la confirmación responde 410 y el cliente reenvía el archivo;
  - confirmar 3 000 filas tarda ~32 s en local (Docker en Windows), unas 12 consultas por fila. Para bajar de un segundo haría falta guardar en lote con `unnest`, con una prueba que compare el resultado con `insertComerciante`/`insertPuesto`;
  - `exceljs` trae `uuid` < 11.1.1 (aviso moderado de `npm audit`).

## Pendientes de la auditoría full-stack (2026-10-27)

- **Calles sin estado.** La tabla `calles` no tiene columna `estado`; la pantalla ofrecía Activo/Inactivo y no se guardaba (todas salían "Inactivo"). Se quitó el selector. Si hace falta dar de baja calles, va una migración nueva con `estado` y su CHECK.
- **Barra superior.** Se quitaron la caja "Buscar registro" y el botón de notificaciones porque no tenían ninguna acción. Una búsqueda global sería una función nueva.
- **Riesgo de morosidad N+1.** `getRiskDashboard` recalcula una vez al día con un `calcularLiquidacion` por comerciante (hasta 300); con un padrón grande conviene la liquidación en lote (paso 6).
- **Tarifas superpuestas.** El tarifario local tiene varias tarifas activas iguales para `comida` desde 2026-01-01; `findApplicableTariff` toma una. Falta decidir si la base debe impedir dos tarifas vigentes para el mismo rubro, zona y tipo de vía.

## Orden de refactorización sugerido (de menor a mayor riesgo)

Los pasos 1 a 3 y el 5 están en la rama `refactor/arquitectura` (commits "Refactor 1" a "Refactor 3" y "Refactor 5", 2026-10-16). El paso 4 está en la rama `claude/compassionate-hermann-e2df59` (commit 84e687e7), y el 6 se trabaja encima de ella; falta unirlas.

| Paso | Cambio | Condición para darlo por terminado |
|---|---|---|
| 1 ✅ | Borrar `apiService.js`, `useApiQueries.js` y `DashboardStats.jsx` | `vite build` y las pruebas del cliente pasan |
| 2 ✅ | Errores con tipo (`ValidationError`, `NotFoundError`) y un manejador de errores global en Express | las pruebas de seguridad comprueban los códigos 400, 404 y 500 |
| 3 ✅ | Dividir `index.ts` en un router por módulo (`routes/puestos.ts`, `routes/cobros.ts`…) | se mantienen las mismas rutas, roles y auditoría; todas las pruebas pasan |
| 4 | Pasar el SQL de `db.js` a `repos/` y las reglas a `services/` | `calcularLiquidacion` y `registrarCobro` mantienen sus firmas |
| 5 ✅ | Sacar de `App.jsx` cada página con su hook (`usePagos`, `useSitios`…) y agregar un router | el recorrido verificado en el navegador sigue igual |
| 6 | Liquidación en lote | una prueba compara sus resultados con los de `calcularLiquidacion` para todos los tipos de comerciante |
