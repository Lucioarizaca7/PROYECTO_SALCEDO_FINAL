# Reglas de negocio de SISREC

## Puestos

| Estado | Comerciante | Significado |
|---|---|---|
| `disponible` | NULL | puesto físico libre, se puede asignar |
| `disponible` | con titular | ferial titular ausente (convención del padrón ferial); se conserva |
| `ocupado` | obligatorio (CHECK `puestos_ocupado_con_titular`) | tiene titular y genera deuda |
| `reservado` | opcional | apartado, todavía no cobra |
| `inactivo` | se conserva | dado de baja; se oculta salvo con `?incluirInactivos=1` |

Funciones de `db.js`:
- `getPuestos(db, { incluirInactivos, conPagos, periodo })`. `/publico/resumen` usa `conPagos: false`.
- `insertPuesto`: sin comerciante el puesto queda `disponible`; con comerciante queda `ocupado` por defecto.
- `updatePuesto`: si recibe `comerciante_id` sin estado, pasa a `ocupado` (con id) o a `disponible` (con null).
- `liberarPuesto` y `deactivatePuesto`.
- `parseComercianteId`: `undefined` = no se envió; `null`, `''` o `0` = puesto libre.
- `validatePuestoPlacement`: estado válido, zona existente, comerciante activo, y que no haya otro puesto en el mismo lugar físico.

### Deuda por puesto (`withPaymentStatus`)
- La deuda pertenece al comerciante, no al puesto.
- `findMerchantPost` elige el **puesto principal**: el de menor id con estado distinto de `disponible`/`inactivo`.
- Se llama a `calcularLiquidacion` una vez por comerciante. El saldo va en el puesto principal y los demás puestos salen como `incluido`.
- Campos que se agregan a cada puesto: `saldo_pendiente`, `monto_total`, `monto_pagado`, `cobro_diario`, `puesto_principal`, `motivo`, `estado_pago`, `periodo`.

| `estado_pago` | Cuándo | En el mapa (`SERVER_TO_MAP` en `sitesGeo.js`) |
|---|---|---|
| `pendiente` | saldo > 0 | `deuda` |
| `pagado` | saldo = 0 y la tarifa sí genera cobro | `al-dia` |
| `incluido` | puesto secundario del comerciante | `al-dia` |
| `no_devenga` | la liquidación devuelve `no_devengo` | `no-devengo` |
| `ausente` | ferial ausente | `no-devengo` |
| `libre` / `reservado` | según el estado del puesto | `libre` |
| `sin_tarifa` | `calcularLiquidacion` lanza un error porque no hay tarifa | `sin-tarifa` |
| `inactivo` | dado de baja | `no-devengo` |

Si se agrega un `estado_pago` nuevo, hay que actualizar también `SERVER_TO_MAP`, `SERVER_PAYMENT_STATUS` y `paymentStatusText` en `sitesGeo.js`, junto con sus pruebas en `apps/client/tests/sitesGeo.test.js`.

## Liquidación (`calcularLiquidacion(db, comercianteId, periodo, { dia })`)

- Lo pagado del mes es la suma de los cobros confirmados con fecha (de Lima) en ese mes, con cualquier tarifa. No se filtra por `tarifa_id`.
- `registrarCobro` bloquea la fila del comerciante antes de leer el saldo: los cobros simultáneos se atienden de uno en uno.
- En el cliente, el periodo se calcula con `periodoEnLima()`, nunca con `toISOString().slice(0, 7)`.

Depende de `tipo_comerciante`:
- **permanente:** cuota mensual = tarifa vigente del rubro y periodo × metraje del puesto principal.
- **ferial:** paga los días con asistencia del mes (`asistencias_feriales.asistio`, en cualquiera de sus puestos; varias marcas del mismo día cuentan una vez) × la tarifa de un día (`dailyTariffAmount`). Lo mismo el permanente con tarifa por día cobrado (ver abajo). Sin asistencias devuelve `no_devengo` con el motivo `ferial_sin_asistencia`. La respuesta trae `dias_asistidos`. El cobrador marca con `POST /asistencias` (también sin señal: reenviar no duplica).
- **eventual:** se cobra por día (`cobro_diario: true`). Si el día pedido no cae en el periodo, devuelve `no_devengo` con el motivo `eventual`.
- Otro motivo posible es `pendiente_regularizacion_sin_metraje`.
- Si no hay tarifa vigente, lanza un error ("No existe una tarifa vigente…"). Quien la llama debe tratar ese caso como `sin_tarifa` y no dejar que el proceso se caiga.

**Tarifa aplicable** (`findApplicableTariff`): la de la zona del comerciante > la del tipo de vía de su zona (`zonas.tipo_via`: asfaltada / sin_asfaltar) > la del rubro > la de todos los rubros (`tarifas.rubro_id` NULL). Una tarifa no puede ser de zona y de tipo de vía a la vez (CHECK `tarifas_zona_o_tipo_via`).

**Cobro por día cobrado** (decisión del usuario, 2026-10-17; migración 0013):
- El cobro es S/ 3 en vía asfaltada y S/ 2 sin asfaltar, para **todos los rubros**, por cada día que el cobrador salió y marcó asistencia. Es un monto fijo por puesto, sin metros. Sin día cobrado no hay deuda.
- Se guarda como dos tarifas generales (`rubro_id` NULL) por tipo de vía con unidad `semanal`, que significa "por día cobrado" (en pantalla: "Por día cobrado"). Su monto se cobra completo cada día (`dailyTariffAmount`).
- Una zona pasa a este cobro cuando se le carga el tipo de vía. Una zona sin tipo de vía sigue con la tarifa de su rubro.
- Con esa tarifa:
  - el ferial y el permanente pagan, **por cada puesto**, sus días con asistencia × el monto de un día de la tarifa de la zona de ese puesto (`asistenciasPorPuesto` + `liquidarPorAsistencia`): dos puestos marcados el mismo día son dos cobros (decisión del usuario, 2026-10-17). `dias_asistidos` es el total de días-puesto, `puestos_cobrados` trae el detalle y `monto_dia` es NULL si los puestos pagan montos distintos. El cobro marca solo el puesto principal; los otros se marcan en el panel. Sin marcas devuelve `no_devengo`, con el motivo `ferial_sin_asistencia` o `sin_asistencia`;
  - el eventual paga el monto el día en que se le encuentra, sin marca.
- `cobraPorAsistencia` decide a quién se le marca (ferial, o permanente con tarifa `semanal`). La usan `getAsistencias`, `marcarAsistencias` y `puesto_ferial_id` del paquete de jornada.
- **El cobro marca el día** (`marcarDiaCobrado`, dentro de la transacción de `registrarCobro`): si nadie marcó ese día en la app, el cobro inserta la asistencia ('P', fuente `cobro`) en el puesto principal.
  - No pisa una marca de la app: con "no salió", el cobro excede el saldo.
  - No marca cuando se paga un mes anterior.
  - Si el cobro se rechaza, la marca no queda.
  - Así un cobro sin señal que llega antes que la marca no va a revisión.
- Las tarifas generales de la migración 0013 rigen desde el mes en que se aplicó. Los meses anteriores siguen con la tarifa del rubro, así cargar el tipo de vía no reescribe la historia.
- Un mes sin días cobrados devuelve `no_devengo` pero con `monto_pagado` (lo pagado se ve y la deuda acumulada lo muestra).
- `diasAsistidos`: la marca de la app (`sesion = ''`) manda sobre las del Excel del mismo puesto y día ("no salió" anula una P importada).
- Al tocar Asistió / Faltó en el panel se conserva la observación si sigue siendo coherente (`observacionQueSeConserva`).

**Observación del cobrador** (`asistencias_feriales.motivo` / `observacion`):
- `no_salio` es una falta: no genera deuda.
- `no_vendio` y `se_nego_a_pagar` son asistencias: el día se debe igual. La excusa no libera.
- `otro` va con la marca que se elija.
- Un motivo que contradice la marca se rechaza.
- Reporte: `GET /asistencias/observaciones?desde&hasta&comerciante_id` (`getObservacionesCobro`). El cobrador ve solo las suyas. Se muestra en Reportes.

**Auditoría por comerciante:** `getAuditTrail({ comerciante_id })` busca el id exacto en `recurso_id` (entidades del comerciante) y en `payload_nuevo/previo->>'comerciante_id'` (cobros, puestos), nunca con LIKE.

**Baja:** pasar a un comerciante a `inactivo` por `PUT` (o `updateComerciante`) da de baja sus puestos y fija `fecha_baja`, igual que `DELETE`. Al reactivarlo, los puestos siguen de baja hasta reasignarlos.

**Lo pagado de un mes** (`paidInPeriod`): cobros confirmados con `periodo_aplicado` = ese mes, o sin él y cobrados (día de Lima) en ese mes. `registrarCobro` guarda `periodo_aplicado` = el periodo liquidado (NULL para el eventual), así un pago de hoy puede cancelar un mes anterior.

**Deuda acumulada** (`calcularDeudaAcumulada`): recorre los meses desde `max(mes de alta, parametros_sistema.inicio_cobro)` hasta el actual llamando a `calcularLiquidacion` en cada uno (no hay otra fórmula). El eventual no acumula. Devuelve `periodos`, `meses_impagos`, `periodo_mas_antiguo` (el que se cobra primero), `deuda_vencida`, `deuda_mes` y `deuda_total`. Va en `/comerciantes/:id/saldo`, `/liquidaciones/:id`, el portal y el paquete de jornada.

**Varios puestos:** con cobro por día (tarifa `semanal` o ferial) paga por cada puesto marcado. Con tarifa mensual o diaria de rubro sigue pagando por uno solo, el principal.

## Cobros

- `registrarCobro(db, payload, { audit, allowExcess })`:
  - Si recibe el pool, abre su propia transacción. Si recibe un cliente, usa la transacción que ya está abierta.
  - `codigo_operacion` (o `idempotency_key`) evita que el mismo cobro se registre dos veces.
  - Genera la `transaccion` y su `comprobante` (con número correlativo).
- `syncOfflineCobro` devuelve `SUCCESS`, `IGNORED` (ya se había recibido) u `OBSERVED` (se aceptó y va a revisión, por ejemplo porque excede el saldo).
- `syncOfflineBatch`: como máximo `MAX_LOTE_COBROS = 100` cobros por lote. Responde 200 con `data.resumen` (sincronizado, observado, duplicado, rechazado), aunque haya cobros rechazados.
- `resolveCobroObservado`: bloquea la fila con `SELECT … FOR UPDATE` dentro de `withTransaction`.

### Tickets preimpresos (migración 0014, `routes/tickets.ts`)

- **Qué es:** se entrega un ticket de papel numerado por cada puesto y día cobrado.
- **Series:** `ticket_series`, una por tipo de vía:
  - S3 = S/ 3, vía asfaltada;
  - S2 = S/ 2, sin asfaltar.
- **Series de un comerciante:** las da `seriesDelComerciante`. Es la serie del tipo de vía de cada puesto, siempre que:
  - la tarifa de ese puesto sea por día cobrado (`semanal`) con tipo de vía;
  - el valor de la serie sea igual al monto de un día de esa tarifa.

  Si la lista sale vacía, el cobro no lleva ticket: zona sin tipo de vía, tarifa por rubro o mes con tarifa anterior.
- **Lotes:**
  - los asigna solo `super_admin`, con `asignarLote`, `reasignarTickets` (solo los disponibles) y `devolverTickets`;
  - el auditor solo consulta;
  - `UNIQUE (serie, numero)` impide que se crucen los rangos;
  - un lote reasignado mueve sus tickets a un lote nuevo, con `lote_origen_id`.
- **`registrarCobro` con `tickets: [{ serie, numero }]`:**
  - `validarTicketsCobro` bloquea cada ticket (`FOR UPDATE`) y exige que:
    - sea del lote del cobrador de la sesión;
    - esté `disponible`;
    - su serie sea de un puesto del comerciante;
    - la suma de los valores sea igual al monto.
  - En línea, un fallo rechaza el cobro.
  - Sin señal (`allowExcess`), el cobro se registra **observado** y solo se marcan usados los tickets válidos.
  - `transacciones.tickets` guarda lo declarado.
  - Un cobrador sin lotes de esas series cobra sin ticket; es la transición.
- **`anularCobro`:** anula también los tickets de ese cobro.
- **`anularTickets`:**
  - exige un motivo de al menos 5 caracteres y que el ticket sea del cobrador (el administrador puede anular cualquiera);
  - es idempotente: devuelve `ya_anulado`;
  - procesa cada anulación en su propia transacción.
- **Cierre:**
  - `resumenTickets`, dentro de `resumenCaja` y guardado en `cierres_caja.tickets`, da por serie los usados, anulados y devueltos del día.
  - Marca como alertas:
    - los saltos: disponibles por debajo del último usado;
    - los cobros observados por un ticket;
    - la diferencia entre lo cobrado con ticket y lo que valen los tickets.
- **Umbral de aviso:** `parametros_sistema.tickets_umbral_aviso`, 20 por defecto.
- **Celular:**
  - `services/ticketsOffline.js` (estado en el store `jornada`, clave `tickets`) y `useTicketsCobrador`;
  - los consumidos y las anulaciones pendientes no vuelven a estar disponibles al refrescar.
- **Límite conocido:** el cobro marca la asistencia solo en el puesto principal (`marcarDiaCobrado`). Para cobrar dos puestos el mismo día, el cobrador debe marcar los dos en el panel de asistencia.

## Offline (cliente)

- `GET /jornada/paquete` (`getJornadaPackage`) entrega al cobrador los comerciantes y saldos del periodo. Se guarda en IndexedDB (`offlineStore.js`).
- Cada cobro offline lleva una huella SHA-256 (`offlineQueue.js`), que el servidor usa como clave de idempotencia.
- Un conflicto nunca se resuelve en el cliente: va a `cobros_observados` y se revisa en `ReviewPanel`.

## Autenticación y auditoría

- `POST /auth/login` devuelve un JWT corto (`config.jwtExpiresIn`) en el cuerpo y deja el refresh token de 12 h, ligado al dispositivo (`createDeviceSession`), en la cookie HttpOnly `sisrec_refresh`. `/auth/refresh` y `/auth/logout` solo leen la cookie.
- En el cliente ningún token va en `localStorage`: el de acceso vive en memoria y, al recargar, `authFetch` pide uno nuevo con la cookie (`credentials: 'include'`).
- Portal del comerciante: DNI o código + PIN de 6 dígitos (`portalAcceso.js`). Credenciales erradas responden siempre el mismo 401; 5 PIN errados seguidos bloquean 15 minutos (429). El PIN se muestra una sola vez y nunca se audita en claro.
- `session.js` renueva el token una sola vez aunque fallen varias peticiones a la vez (`refreshing`), y emite `SESSION_EXPIRED_EVENT` si no puede.
- Las sesiones se pueden revocar desde el panel (`DELETE /auth/sesiones/:id`).
- `auditMutation` guarda el estado anterior y el nuevo en `auditoria_logs`, encadenados con un hash. `verifyAuditChain` detecta si alguien los alteró.
