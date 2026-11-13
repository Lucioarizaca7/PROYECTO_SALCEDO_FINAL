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
  - **Alta idempotente** (migración 0022, 11/11/2026): el celular manda `clave_cliente` (una por alta, la misma en línea y en la cola del mapa). Si ya existe un puesto con esa clave, se devuelve ese puesto (`ya_registrado`, HTTP 200) y no se crea otro.
  - Con señal débil (el navegador cree que hay red pero la petición no llega), el alta y la corrección de ubicación pasan a la cola del mapa en vez de perderse (`useSitios`, `encolarSiFalla`).
- `updatePuesto`: si recibe `comerciante_id` sin estado, pasa a `ocupado` (con id) o a `disponible` (con null).
- **Solo `super_admin` cambia la zona de un puesto** (decisión del usuario, 28/10/2026): la zona fija la tarifa del cobro por día. El cobrador recibe 403 si pide otra zona, y reenviar la misma no confirma una "zona por regularizar"; sí mueve el puesto en el mapa y asigna o libera al titular. La importación del padrón (solo super_admin) sí asigna zonas.
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

**Cobro solo por día cobrado, con el precio de la zona** (decisión del usuario, 13/11/2026; migración 0032). Reemplaza la cuota mensual, semanal, "diaria × días del mes" y por m², también para los meses pasados (hasta entonces solo había datos de prueba; la deuda se suma desde diciembre de 2026):
- Se cobra **solo el día que el cobrador sale a cobrar**: cada puesto marcado ese día (o cobrado, que marca el día) paga el **precio por día de la zona** donde vendió. Sin días cobrados no hay deuda. Una feria que sale solo los miércoles paga solo los miércoles, sin configurar días de feria.
- **El precio lo fija el `super_admin` para cada zona** en Tarifas ("Precios por zona"): una fila de `tarifas` con `zona_id`, unidad `dia` y `monto_fijo`, con su vigencia. No depende del rubro, del tipo de comerciante ni de los metros. Un cambio de precio "desde tal día" cierra el anterior (`insertTarifa`); los días anteriores conservan su precio.
- **Zona = sector.** Cada zona tiene un tipo de vía (asfaltada / sin asfaltar) y un precio por día. El tipo de vía es un dato del sector y sugiere el precio al ponerlo (S/ 3 / S/ 2), pero no lo decide. Si una calle es de otro tipo de vía, va en otra zona.
- **Calles dentro de la zona:** cada calle es de una zona y ubica el puesto (`puestos.calle_id`, opcional). La calle de un puesto debe ser de su zona (`calleDeLaZona` y el trigger `trg_puesto_calle_de_su_zona`); si el puesto pasa a otra zona o la calle a otra zona, el puesto se queda sin calle.
- La base solo acepta activas las tarifas que son precio de una zona (CHECK `tarifas_precio_de_zona`); `validateTariff` rechaza con mensaje claro rubro, tipo de vía, monto variable y unidades mensuales. Las tarifas viejas quedaron inactivas (no se borran: `transacciones.tarifa_id` las referencia). La 0032 dio a cada zona con tipo de vía el precio general de su tipo de vía, con sus fechas; las zonas sin tipo de vía quedaron **sin precio** hasta que el `super_admin` lo ponga.
- **Zona sin precio:** sin días cobrados no debe nada; un día marcado en ella da `sinTarifaVigente` ("La zona X no tiene precio por día…"). El mapa la muestra como "Zona sin precio" y sin señal el cobro queda observado.
- El metraje del puesto es opcional y solo informativo.
- **Tickets por valor:** la serie de un día es la serie activa cuyo `valor` es el precio de ese día en su zona (`ticket_series` sin UNIQUE en `tipo_via`, índice único de `valor` entre las activas). Si la zona tiene un precio sin serie, ese tramo se cobra solo con el recibo R-.

Depende de `tipo_comerciante`:
- **ferial y permanente:** pagan los días con asistencia del mes (`asistencias_feriales.asistio`, en cualquiera de sus puestos; varias marcas del mismo puesto y día cuentan una vez) × el precio por día de la zona de cada marca (`dailyTariffAmount`). Sin asistencias devuelve `no_devengo` con el motivo `sin_dias_cobrados` (antes `ferial_sin_asistencia` y `sin_asistencia`). La respuesta trae `dias_asistidos`. El cobrador marca con `POST /asistencias` (también sin señal: reenviar no duplica). Antes del 13/11/2026 el permanente pagaba una cuota mensual del rubro.
  - **Qué días puede marcar** (11/11/2026): el cobrador, hasta `DIAS_COBRO_SIN_SENAL = 3` días atrás, la misma ventana que el cobro sin señal (decisión del 22/10/2026). Más atrás, solo el `super_admin`, y queda en la auditoría. Antes podía marcar cualquier día pasado y crear deuda sin revisión.
  - **Dados de baja** (decisión del usuario, 11/11/2026): no se registra asistencia de un comerciante dado de baja ni de un puesto inactivo. La marca se rechaza con aviso y no genera deuda.
  - **Lotes del celular:** `POST /asistencias` con `{ marcas }` responde marca por marca (`data` = guardadas, `rechazadas` = `{ puesto_id, fecha, error }`). Antes una sola marca inválida rechazaba todo el lote. El celular no reintenta las rechazadas y muestra su motivo.
  - **Días anteriores sin señal:** las marcas que no subieron pasan al día siguiente a `anteriores` y se siguen enviando con su fecha. Antes se borraban al cambiar el día y ese día no generaba deuda.
- **eventual:** se cobra por día (`cobro_diario: true`), el día en que se le encuentra, sin marca: el precio de su zona × sus puestos. Si el día pedido no cae en el periodo, devuelve `no_devengo` con el motivo `eventual`.
- Un pendiente de regularización (titular sin DNI) paga igual que cualquier otro (decisión del usuario, 2026-10-27); antes no devengaba si le faltaba el metraje (`pendiente_regularizacion_sin_metraje`, ya no existe). Por eso entra en la deuda del panel (`getPendingDebt`) y en el padrón de la jornada (`getJornadaPackage`): los dos toman `estado IN ('activo', 'pendiente')` (`ESTADOS_QUE_PAGAN_SQL`).
- Si un día cobrado cae en una zona sin precio, lanza un error con `sinTarifa` ("La zona X no tiene precio por día…"). Quien la llama debe tratar ese caso como `sin_tarifa` y no dejar que el proceso se caiga.

**Precio aplicable** (`findApplicableTariff`, `tarifasDelMes`): el precio de la zona vigente ese día (desde la 0032). Antes: zona > tipo de vía > rubro > todos los rubros.

**Cobro por día cobrado** (decisión del usuario, 2026-10-17; migración 0013; desde el 13/11/2026 con el precio de cada zona, ver arriba):
- Por cada día que el cobrador salió y marcó asistencia, un monto fijo por puesto, sin metros, para **todos los rubros**. Sin día cobrado no hay deuda. Hasta la 0032 eran dos tarifas generales por tipo de vía (unidad `semanal`, S/ 3 y S/ 2) y una zona sin tipo de vía seguía con la tarifa de su rubro.
- El ferial y el permanente pagan, **por cada puesto**, sus días con asistencia × el precio de la zona de cada marca (`asistenciasPorPuesto` + `liquidarPorAsistencia`): dos puestos marcados el mismo día son dos cobros (decisión del usuario, 2026-10-17). `dias_asistidos` es el total de días-puesto, `puestos_cobrados` trae el detalle y `monto_dia` es NULL si los puestos pagan montos distintos. El cobro marca solo el puesto principal; los otros se marcan en el panel. Sin marcas devuelve `no_devengo` con el motivo `sin_dias_cobrados`.
- El eventual paga el precio el día en que se le encuentra, sin marca.
- `cobraPorAsistencia` decide a quién se le marca: a todos menos al eventual (13/11/2026). La usan `getAsistencias`, `marcarAsistencias` y `puesto_ferial_id` del paquete de jornada.
- **El cobro marca el día** (`marcarDiaCobrado`, dentro de la transacción de `registrarCobro`): si nadie marcó ese día en la app, el cobro inserta la asistencia ('P', fuente `cobro`) en el puesto principal.
  - No pisa una marca de la app: con "no salió", el cobro excede el saldo.
  - No marca cuando se paga un mes anterior.
  - Si el cobro se rechaza, la marca no queda.
  - Así un cobro sin señal que llega antes que la marca no va a revisión.
- **Cambio de zona de un puesto** (decisión del usuario, 02/11/2026, migración 0019): la zona nueva rige desde el día del cambio. Cada marca guarda su zona (`asistencias_feriales.zona_id`), así que los días anteriores conservan su tarifa y el mismo mes puede tener dos tramos (dos filas en `puestos_cobrados`). Una marca que llega después pero es de antes del cambio toma la zona de su fecha (`zona_de_asistencia`).
  - **Excepción:** asignar una "zona por regularizar" corrige también los días pasados, porque la zona anterior era provisional. Puede subir o bajar la deuda de esos días; lo ya pagado no se toca.
  - Un trigger registra cada cambio en `puestos_zona_cambios`, sea cual sea el camino (Sitios, mapa o padrón).
- **Tipo de vía de cada día** (decisión del usuario, 11/11/2026, migración 0021): cada marca guarda el tipo de vía de su fecha (`asistencias_feriales.tipo_via`). Desde la 0032 el precio ya no sale del tipo de vía: si se asfalta un sector, el `super_admin` le pone el precio nuevo desde ese día y los días anteriores conservan el anterior (y su serie de ticket).
- **Precio de cada día** (decisión del usuario, 11/11/2026): cada día marcado se cobra con el precio vigente ese día (`tarifasDelMes` + `tarifaDelDia` en `liquidarPorAsistencia`). Si en el mes entra un precio nuevo, salen dos filas en `puestos_cobrados`. El eventual paga con el precio del día en que se le encuentra. Antes todo se buscaba con la del día 1: una tarifa nueva "desde hoy" recién se aplicaba el mes siguiente.
- **Precios sin cruces** (decisión del usuario, 02/11/2026, migración 0020): dos precios activos de la misma zona no pueden cruzar sus fechas; lo impide el trigger `tarifa_sin_cruces`.
- **Una tarifa que ya rige no cambia lo que cobra** (decisión del usuario, 11/11/2026): en `updateTarifa`, si `vigencia_inicio <= hoy`, se rechaza cambiar monto, unidad, tipo, inicio, rubro, zona o tipo de vía. Para otro monto se crea una tarifa nueva, que cierra la anterior. Sí se puede cerrar con `vigencia_fin`, pero no antes de hoy. Reenviar los mismos valores no es un cambio. Una tarifa que todavía no empieza se edita libremente. La pantalla bloquea esos campos y la tarifa nueva empieza hoy por omisión (antes el formulario traía 2026-01-01).
  - **Una tarifa nueva no empieza antes de hoy** (decisión del usuario, 11/11/2026): con una fecha pasada cerraba la anterior hacia atrás y recalculaba meses ya cobrados. Tampoco se mueve al pasado una tarifa que aún no empieza. Si una ordenanza llega tarde, la diferencia se cobra aparte. (`insertTarifa(..., { permitirInicioPasado })` solo lo usan las pruebas para armar historia; la API nunca lo pasa.)
  - Crear una que empieza después cierra la anterior el día previo (`insertTarifa`, `tarifas_cerradas` en la respuesta y en la auditoría).
  - Se rechaza con 409 si empieza el mismo día o antes, o si termina antes que la anterior, porque quedaría un tramo sin tarifa.
  - Editar nunca cierra otra tarifa: si las fechas se cruzan, se rechaza.
- Un mes sin días cobrados devuelve `no_devengo` pero con `monto_pagado` (lo pagado se ve y la deuda acumulada lo muestra).
- `diasAsistidos`: la marca de la app (`sesion = ''`) manda sobre las del Excel del mismo puesto y día ("no salió" anula una P importada).
- Al tocar Asistió / Faltó en el panel se conserva la observación si sigue siendo coherente (`observacionQueSeConserva`).

**De quién es cada marca** (decisión del usuario, 2026-10-27; migración 0015):
- `asistencias_feriales.comerciante_id` es el titular que tenía el puesto **el día de la marca**. `asistenciasPorPuesto`, `marcarDiaCobrado` y `getObservacionesCobro` buscan por él, no por el titular actual del puesto.
- Si el puesto pasa de A a B, lo marcado antes lo sigue debiendo A y B no lo hereda; si se libera, A conserva su deuda.
- Lo llena el trigger `asistencia_titular` al insertar (app, cobro, Excel, semilla). Corregir una marca no cambia su titular.
- Marcas anteriores a 0015: `titular_de_asistencia(puesto, fecha)` toma el titular previo del primer cambio del puesto auditado después de ese día (`ACTUALIZAR_PUESTO_MAPA`, `LIBERAR_PUESTO`, `DAR_DE_BAJA_PUESTO_MAPA`); sin cambios, el actual.
- Límite: si el puesto cambia de titular el mismo día, la marca de ese día es una sola (`UNIQUE (puesto_id, fecha, sesion)`).

**Observación del cobrador** (`asistencias_feriales.motivo` / `observacion`):
- `no_salio` es una falta: no genera deuda.
- `no_vendio` y `se_nego_a_pagar` son asistencias: el día se debe igual. La excusa no libera.
- `otro` va con la marca que se elija.
- Un motivo que contradice la marca se rechaza.
- Reporte: `GET /asistencias/observaciones?desde&hasta&comerciante_id` (`getObservacionesCobro`). El cobrador ve solo las suyas. Se muestra en Reportes.

**Consulta de la auditoría** (11/11/2026): `GET /auditoria` filtra por `desde`/`hasta` (días de Lima), `buscar` (acción, entidad o detalle, sin comodines), `usuario_id`, `entidad` y `comerciante_id`, y pagina en el servidor (`page`, `limit` hasta 200, `total` = todo lo filtrado). La pantalla Auditoría trae el mes en curso de a 50 y el botón "Verificar integridad" (`GET /auditoria/verificacion`). Antes mostraba siempre los últimos 200 registros.

**Preferencias del comerciante:** `POST /comerciantes/:id/preferencias` cambia solo las claves enviadas (claves `a-z0-9_`, hasta 30, valores de hasta 200 caracteres). Antes borraba todas.

**Auditoría por comerciante:** `getAuditTrail({ comerciante_id })` busca el id exacto en `recurso_id` (entidades del comerciante) y en `payload_nuevo/previo->>'comerciante_id'` (cobros, puestos), nunca con LIKE.

**Baja:** pasar a un comerciante a `inactivo` por `PUT` (o `updateComerciante`) da de baja sus puestos y fija `fecha_baja`, igual que `DELETE`. Al reactivarlo, los puestos siguen de baja hasta reasignarlos.

**Meses de baja** (migración 0027, 11/11/2026): la historia de estados (`comerciantes_estado_cambios`) se sigue guardando. Desde el 13/11/2026 no hay cuota mensual: un dado de baja no debe nada mientras no se le cobren días, y no se le registra asistencia; lo que debía de los días cobrados antes de la baja se mantiene. Un eventual de baja no paga el día. (Hasta entonces la 0027 cuidaba que la cuota mensual no se cobrara los meses de baja enteros; `activoEnMes` ya no existe.)

**Reactivados por la importación del padrón antes de la 0027** (migración 0029, decisión del usuario del 12/11/2026): la importación no dejaba un registro por comerciante, solo la fila `IMPORTAR_PADRON_EXCEL` con el número de reactivados, y sus meses de baja se seguían cobrando. La reactivación rige desde la **primera importación con reactivados posterior a la baja** (y anterior al siguiente cambio registrado). Si no hubo ninguna, desde el día en que se sabe con seguridad que ya estaba activo: el del siguiente cambio registrado (una reactivación perdida entre dos bajas) o el día en que se aplicó la 0027 (si sigue activo hoy). Desde la 0027 el trigger registra cada cambio de estado, también los de la importación.

**Lo pagado de un mes** (`paidInPeriod`): cobros confirmados con `periodo_aplicado` = ese mes, o sin él y cobrados (día de Lima) en ese mes. `registrarCobro` guarda `periodo_aplicado` = el periodo liquidado (NULL para el eventual), así un pago de hoy puede cancelar un mes anterior.

**Tipo de comerciante de cada mes** (migración 0023, decisión del usuario del 11/11/2026): el cambio de tipo rige desde su día. `comerciantes_tipo_cambios` lo guarda (trigger) y `tipoEnPeriodo` decide el tipo de cada mes:
- el mes en curso, con el tipo actual;
- un mes pasado, con el que tenía; si en ese mes fue ferial o permanente aunque sea unos días, se liquida con ese tipo (sus días marcados se deben), no como eventual.

Antes pasar a un ferial a eventual borraba su deuda atrasada entera, y pasar un eventual a permanente le creaba deuda de meses en que era eventual.

**Rubro, zona y metros de cada mes** (migración 0025, 11/11/2026, la misma decisión "rige desde el cambio"): los cambios los guardan triggers en `comerciantes_datos_cambios` y `puestos_metros_cambios`. Desde el 13/11/2026 ni el rubro ni los metros cambian lo que se debe, y cada día cobrado conserva la zona de su marca: mover al comerciante de zona no cambia los días ya marcados.

**Deuda acumulada** (`calcularDeudaAcumulada`): recorre los meses desde `max(mes de alta, parametros_sistema.inicio_cobro)` hasta el actual llamando a `calcularLiquidacion` en cada uno (no hay otra fórmula). El eventual no acumula, pero solo los meses en que fue eventual (ver abajo). Devuelve `periodos`, `meses_impagos`, `periodo_mas_antiguo` (el que se cobra primero), `deuda_vencida`, `deuda_mes` y `deuda_total`. Va en `/comerciantes/:id/saldo`, `/liquidaciones/:id`, el portal y el paquete de jornada.

**Varios puestos** (decisión del usuario, 12/11/2026): **paga por cada puesto**: cada puesto marcado un día paga ese día. El eventual paga un día por cada puesto que tuvo algún día del mes (`puestos_tenencia`, migración 0031); sin ningún puesto, uno; la respuesta lleva `cantidad_puestos` y la pantalla dice "S/ 3 × 2 puestos". El mapa muestra la deuda en el puesto principal y "sus días se cobran junto con el puesto…" en los demás. (La cuota mensual por puesto y `COBRO_POR_PUESTO_DESDE` se quitaron el 13/11/2026.)

**Zona del día** (decisión del usuario, 12/11/2026): cuando faltan otros comerciantes, uno puede vender en otra zona; ese día se le cobra con el precio de esa zona. **La elige el cobrador en campo**: en el panel de asistencia ("Hoy en …") o al cobrar ("Zona de hoy"); funciona sin señal con las zonas del paquete de jornada. La marca guarda esa zona (`asistencias_feriales.zona_id`; `marcarAsistencias` acepta `zona_id`, `registrarCobro` acepta `zona_dia` y corrige la zona de las marcas de ese día ya hechas). Los tickets de hoy salen de esa zona (`series_cobro[].puestos_hoy`). Los tickets de hoy son **lo que se le cobra hoy** (12/11/2026): con marcas de hoy, un ticket por puesto marcado "asistió" (el que faltó no suma); sin ninguna marca, uno por el puesto principal, que es el que marca el cobro. **Sin señal**, los tickets de hoy salen del padrón (`puestos_hoy`) y de la marca de hoy del celular: marcado "faltó" no sugiere ticket, y la zona marcada en el panel de asistencia queda elegida como zona del día al cobrar (tickets de esa zona y `zona_dia` en el cobro). Se puede cobrar a quien paga por día **aunque el día no esté marcado**: el cobro lo marca y el servidor valida el monto ("Confirmar" ya no se deshabilita con saldo 0 en el mes en curso). Cambiar después la zona del puesto no pisa una zona del día elegida (0031). Queda en la auditoría y el administrador la ve en Observaciones: "Cobrado en otra zona: X (su puesto es de Y)".

**El precio lo pone la zona** (decisión del usuario, 13/11/2026): lo que se cobra cada día depende de la zona donde el comerciante vende ese día (se mueve por la lluvia, por la ubicación o porque faltan otros), no de su rubro ni de los metros. El precio de cada zona lo fija el `super_admin` en Tarifas (`POST /tarifas` solo `super_admin`, con `zona_id`, `monto_fijo` y `vigencia_inicio`). Por eso no se parte el mes cuando cambian el rubro o los metros: no cambian el monto del día. La zona va por día en la marca de asistencia (0019, 0031). El detalle está en "Cobro solo por día cobrado, con el precio de la zona" (0032).

**Cambio de rubro** (recomendación aceptada, 12/11/2026): se edita el rubro del mismo comerciante. No se crea otro registro con el mismo DNI (es único en la base) ni se da de baja el anterior: desde la 0025 el rubro nuevo rige desde el día del cambio y los meses pasados conservan el anterior, con su deuda y sus pagos en un solo historial.

## Importación del padrón (`padronImport.js`, 2026-10-27)

- **Vista previa en lote:** cruza el libro con la base en 4 consultas (`= ANY`), no por fila. Devuelve `previewToken`: la confirmación lo envía en vez del Excel. Vence a los 15 minutos, es del usuario que la hizo y vive en la memoria de la API (410 si no existe: el cliente reenvía el archivo).
- **Confirmación:** con `insertComerciante`, `updateComerciante`, `insertPuesto` y `updatePuesto` (las mismas reglas que la API), en una transacción con un savepoint por fila: un choque inesperado se informa en `result.rowErrors` y no deshace las demás. Al confirmar se vuelve a cruzar con la base.
- **Sin DNI/RUC:** documento provisional `TEMP_DNI_` + huella del nombre (estable: reimportar no duplica), estado `pendiente` y `PENDIENTE_REGULARIZACION`. Si un padrón posterior trae el DNI para el mismo puesto y el mismo nombre, se regulariza ese comerciante; editarlo con su DNI real también. Solo la importación crea documentos `TEMP_` (`insertComerciante(..., { documentoTemporal: true })`). Un sin DNI con el mismo nombre que otro con DNI es una advertencia.
- **Varios puestos:** filas con el mismo DNI y el mismo nombre son un comerciante con varios puestos; el mismo DNI con otro nombre es error de fila.
- **DNI de un dado de baja** (12/11/2026): el documento es único en la base aunque su dueño esté de baja. Registrarlo en otro comerciante responde 409 con el código del dado de baja, para reactivarlo en vez de duplicar a la persona.
- **Errores por fila:** código de otro titular, puesto físico ocupado (zona + dirección, como `validatePuestoPlacement`), código repetido en el libro. Una baja que reaparece se reactiva (`reactivatedMerchants`).
- **Metraje:** opcional en una zona con tipo de vía (cobro por día, sin metros); obligatorio sin tipo de vía. `insertPuesto` acepta `metros_cuadrados: null` solo en una zona con tipo de vía.
- **Zona por regularizar** (decisión del usuario, 28/10/2026; migración 0018). La zona se busca por nombre exacto (sin mayúsculas, tildes ni espacios de más) en la columna Zona o, si viene vacía, en el nombre de la hoja.
  - Si no hay coincidencia, la fila **no es error**: el puesto queda en la primera zona, paga con su tarifa y se guarda `puestos.zona_por_regularizar` (`''` = venía sin zona; texto = la zona del libro que no está registrada). La vista previa lo avisa por fila y cuenta `zonePendingPosts`.
  - Antes la búsqueda era aproximada: "Barrio Alto Salcedo" caía en la zona "SALCEDO" sin avisar.
- **Rubro exacto** (decisión del usuario, 11/11/2026): el rubro de la columna se busca por nombre exacto, igual que la zona. Si no está registrado, el comerciante queda en "otros" y la vista previa lo avisa por fila (no impide importar). Antes "Ropa de bebé" caía en "ropa" sin avisar. Si la columna viene vacía se usa el rubro del nombre del archivo ("FERIA ZAPATILLAS.xlsx") o de la hoja.
  - Se regulariza en Sitios ("Asignar zona…", solo `super_admin` en la pantalla) o reimportando con una zona registrada: enviar `zona_id` borra la marca; mover el puesto en el mapa no. Solo cambia la zona del **puesto** (la que usa el cobro por día); la zona del comerciante (tarifa mensual y su código) se corrige en Comerciantes.
- **Ausente:** sigue la convención de puestos (queda `disponible` con titular).
- **Plantilla oficial:** `GET /comerciantes/plantilla-padron` (super_admin, auditor), `padronPlantilla.js`; la hoja oculta `LISTAS_SISREC` no se lee como padrón.

## Panel y riesgo

- **Morosidad del panel** (`indicadoresPanel`, auditoría 2026-10-27): deuda pendiente del periodo ÷ (deuda pendiente + lo cobrado en el periodo) × 100, a un decimal. Es la parte de lo devengado que sigue impaga. Antes se dividía la deuda entre sí misma (siempre 0 % o 100 %). Si el usuario prefiere otra definición (p. ej. % de comerciantes con deuda), se cambia solo en esa función.
- **Veredicto de recaudación** (`veredictoRecaudacion.js`, decisión del usuario, 02/11/2026): compara el primer mes proyectado con el promedio de los últimos 3 meses completos.
  - Más de +5 % es "sube", menos de −5 % es "baja" y lo demás es "estable".
  - "No se puede concluir" si hay menos de 3 meses, si no hubo cobros en esos 3 meses, si no se pudo medir el error, o si el error (MAPE) es mayor que el cambio; para "estable", mayor que 5 %.
  - La causa compara, por zona del comerciante, el último mes con el promedio de hasta 3 meses anteriores (umbrales confirmados por el usuario el 05/11/2026, en las constantes del módulo): asistencia que cae 10 % o más, cobro por día marcado que cae 10 % o más, y una zona que concentra 60 % o más de la caída.
  - Las acciones son sugerencias: nada se ejecuta solo. Habla de recaudación, no de ventas, porque el sistema no conoce lo vendido.
- **Riesgo de morosidad** (`getRiskDashboard`, `recalcularRiesgoMorosidad`; decisión del usuario, 11/11/2026):
  - el puntaje se recalcula una vez por día de Lima para **todos** los comerciantes no dados de baja, sin tope (antes, los primeros 300);
  - la deuda del puntaje es la **acumulada** (`calcularDeudaAcumulada`: meses atrasados y días cobrados sin pagar). Antes era solo el mes en curso, y a quien paga por día se le contaba 0;
  - el recálculo corre **por detrás**: la primera carga del día muestra el puntaje anterior con el aviso "Puntaje del … · actualizando…". Solo si nunca se puntuó se espera el cálculo;
  - se guarda todo junto en una transacción, con el candado `pg_try_advisory_xact_lock(7002)`, así que dos instancias no duplican el puntaje del día;
  - la fórmula vive solo en `puntuarMorosidad`;
  - los dados de baja no aparecen. El panel muestra como "Alertas importantes" solo los niveles `alto` y `critico`, igual que la marca `alerta` de la métrica.

## Cobros

- `registrarCobro(db, payload, { audit, allowExcess })`:
  - Si recibe el pool, abre su propia transacción. Si recibe un cliente, usa la transacción que ya está abierta.
  - **el servidor no respondió bien** (12/11/2026): si el cobro en línea recibe un 5xx o una respuesta que no es JSON (el proxy con la API caída), se guarda en el celular con el **mismo hash** y recibo provisional, como sin señal; si el servidor sí lo había registrado, la sincronización lo da por repetido y no se duplica.
  - el **monto se lleva a céntimos** antes de validarlo (`dinero()`, 12/11/2026), porque así lo guarda la base: S/ 3.004 se cobra como S/ 3.00 y un monto que en céntimos es cero (S/ 0.004) se rechaza como "monto positivo"; sin señal, queda como cobro incompleto.
  - el **hash** (`hash_transaccion`, el mismo en línea y en la cola del celular) evita que el mismo cobro se registre dos veces;
  - el `codigo_operacion` es único **por método** (`uq_transacciones_operacion`): un Yape y un POS con el mismo número no chocan. Otro cobro con un número ya usado en el mismo método responde 409 con el recibo donde se usó (11/11/2026).
  - Genera la `transaccion` y su `comprobante` (con número correlativo).
- **Fecha del cobro** (decisión del usuario, 2026-10-22). Decide en qué caja diaria cuenta el cobro:
  - en línea (`POST /cobros`) manda la hora del servidor; la del celular solo se usa si difiere menos de 5 minutos (`fechaCobroEnLinea`);
  - sin señal se acepta la hora del celular hasta `DIAS_COBRO_SIN_SENAL = 3` días atrás y 5 minutos en el futuro. Fuera de ese rango el cobro **no se descarta**: queda observado con el motivo "fecha fuera de rango" (`fechaCobroFueraDeRango`). Ese cobro **no marca asistencia** en su día (12/11/2026, misma ventana que las marcas de la app): antes un celular con la hora mal creaba un día cobrado en el futuro o semanas atrás. La 0030 quitó esas marcas cuando la revisión seguía pendiente; las ya resueltas por el administrador no se tocaron.
- `GET /cobros` (decisión del usuario, 2026-10-22): el cobrador ve solo sus cobros; administrador y auditor, todos. Devuelve los más recientes, con tope `MAX_COBROS_LISTADO = 500`; los totales van por `/reportes`.
- `syncOfflineCobro` devuelve `SUCCESS`, `IGNORED` (ya se había recibido) u `OBSERVED` (se aceptó y va a revisión, por ejemplo porque excede el saldo).
  - `IGNORED` es **solo el mismo hash**. Un cobro sin señal con otro hash y un número de operación ya usado en su método queda `rechazado`: el celular lo conserva con el motivo y sale en `GET /cobros/sincronizacion/errores`. Antes se daba por duplicado, el celular lo borraba y el dinero no entraba (11/11/2026).
- **Cobro sin señal de un comerciante sin tarifa vigente** (migración 0024, 11/11/2026): queda observado con `tarifa_id` NULL y el motivo "sin tarifa vigente", para que el administrador revise el rubro, la zona o la tarifa. Antes se rechazaba y el dinero ya recibido quedaba fuera. En línea se sigue rechazando. `calcularLiquidacion` marca ese error con `sinTarifa`.
- `syncOfflineBatch`: como máximo `MAX_LOTE_COBROS = 100` cobros por lote. Responde 200 con `data.resumen` (sincronizado, observado, duplicado, rechazado), aunque haya cobros rechazados.
- `resolveCobroObservado`: bloquea la fila con `SELECT … FOR UPDATE` dentro de `withTransaction`.
- **Código de operación** (corregido el 10/11/2026): es el número de Yape, Plin o POS. En efectivo no existe:
  - `codigoOperacionDelPago` (`db.js`) ignora el que llegue con un cobro en efectivo y solo usa `idempotency_key`;
  - el cliente lo limpia, junto con la nota, después de cada cobro y al cambiar de comerciante.
  - Antes el formulario arrastraba el código del Yape anterior: el efectivo siguiente se rechazaba en línea (409) y sin señal se tomaba como "duplicado" y se perdía.
- **Nota del cobrador** (`transacciones.observaciones`, corregido el 10/11/2026): la ve el personal en:
  - Cobros recientes;
  - Reportes y su CSV;
  - Revisión de cobros;
  - el panel "Observaciones de cobro" (`getObservacionesCobro`, con `origen: 'cobro'`; las de asistencia llevan `origen: 'asistencia'`);
  - el detalle de la auditoría.

  No va en el PDF del comerciante, porque puede ser una anotación interna.
- **Reportes** (`GET /reportes`):
  - El cobrador ve solo sus cobros, como en `GET /cobros`. Excepción: con `comerciante_id` ve el historial de ese comerciante, que la pantalla de cobro usa para sugerir monto y método.
  - El total de la pantalla suma solo los cobros confirmados.
  - El super_admin anula desde el reporte. Antes solo podía desde los 6 cobros más recientes.
  - **Zona y rubro del día del cobro** (migración 0028, 11/11/2026, misma decisión "rige desde el cambio"): cada cobro guarda en su fila la zona y el rubro que tenía el comerciante ese día (`zona_cobro_id`, `rubro_cobro_id`; un cobro sin señal fechado días atrás toma el valor de ese día). El panel (`porZona`, `porRubro`), las columnas y filtros de `/reportes` y las series de la proyección agrupan con esa foto: corregir el padrón ya no cambia la recaudación cerrada de los meses pasados. Una fila sin foto (escrita fuera de la API) cae al valor actual. Los días marcados por zona de la proyección usan la zona del comerciante el día de la marca (`CAMBIO_POSTERIOR`). El conteo "comerciantes" por zona del panel sí es el padrón de hoy, sin dados de baja (antes los contaba).

### Tickets preimpresos (migración 0014, `routes/tickets.ts`)

- **Qué es:** se entrega un ticket de papel numerado por cada puesto y día cobrado.
- **Series:** `ticket_series`, una por valor impreso (desde la 0032 se buscan por su valor, no por el tipo de vía):
  - S3 = S/ 3;
  - S2 = S/ 2.
- **Series de un comerciante:** las da `seriesDelComerciante`. Es la serie activa cuyo valor es el precio de hoy de la zona de cada puesto y, para los días ya marcados en el mes, el precio de ese día en la zona de la marca (si la zona subió de precio en el mes, los días de antes van con su serie). Un puesto cuenta una vez por serie.

  Si la lista sale vacía, el cobro no lleva ticket: la zona no tiene precio o su precio no tiene serie (por ejemplo S/ 4).
- **Lotes:**
  - los asigna solo `super_admin`, con `asignarLote`, `reasignarTickets` (solo los disponibles) y `devolverTickets`;
  - el auditor solo consulta;
  - **detalle de un lote:** `GET /tickets/lotes/:id/tickets` (`getTicketsDelLote`, super_admin y auditor) devuelve cada ticket usado, anulado o devuelto con su motivo, fecha, quién lo registró y el comprobante del cobro;
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
- **Anular quita la asistencia que puso el cobro** (decisión del usuario, 11/11/2026): la marca de `marcarDiaCobrado` (`fuente = 'cobro'`) de ese día se borra si no queda otro cobro confirmado del comerciante ese día. Si el cobro era del comerciante equivocado, ese día ya no se le cobra; si sí estuvo, el cobrador vuelve a marcarlo. Las marcas de la app o del Excel no se tocan. La respuesta trae `asistencias_quitadas` y la auditoría lo dice.
- **Anular un cobro en revisión cierra su revisión** (11/11/2026, migración 0026): si el cobro sin señal estaba observado y pendiente, la revisión queda anulada con el mismo motivo y quien anuló (`observacion_cerrada` en la respuesta). Un cobro ya anulado no se puede aceptar en la revisión: solo se cierra como anulado, sin volver a anularlo. Antes la revisión quedaba pendiente para siempre (anularla daba 409 y aceptarla dejaba como válido un cobro anulado).
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

## Recibo (12/11/2026)

No se usa la impresora térmica en el piloto. El recibo se envía por WhatsApp **como imagen con ancho de celular** (`reciboComoImagen`, un canvas sin librerías) con la hoja de compartir del celular; si el celular no puede compartir imágenes, se abre WhatsApp con el texto completo (`textoRecibo`). "Guardar PDF" usa la impresión del navegador. La pantalla, la imagen y el texto salen de las mismas filas (`lineasRecibo`). No lleva el DNI (Ley 29733).

**Verificación del recibo** (12/11/2026): como una imagen se falsifica fácil, el recibo en pantalla, la imagen de WhatsApp y el texto llevan el QR y el enlace de verificación, los mismos del PDF del portal (`urlVerificacion`, token HMAC por número y monto). El enlace abre `/verificar/:token`, que muestra solo número, fecha, monto y estado, y dice "Recibo anulado" si se anuló. `POST /cobros` los devuelve (`url_verificacion`, `qr_verificacion`). El recibo provisional sin señal no los lleva: el número oficial existe al sincronizar.

**Reenviar el recibo oficial** (12/11/2026): "Enviar recibo por WhatsApp" en Cobros recientes y "Enviar recibo oficial" en la cola sin señal (ya sincronizado) traen el recibo oficial con su QR (`GET /comprobantes/:id/recibo`) y lo comparten; así el comerciante cambia el provisional por uno verificable. Un recibo anulado lo dice ("RECIBO ANULADO: motivo"). El cobrador solo trae sus recibos.

**Comprobante del cobro sin señal** (decisión del usuario, 13/11/2026): el comprobante físico es el **ticket preimpreso** que el cobrador entrega en el momento; el recibo de la pantalla es provisional hasta sincronizar. Después, el comerciante ve sus pagos en el portal público (con la llave del carnet) y descarga el recibo oficial en PDF. Cada pago del portal dice qué tickets se entregaron ("Ticket: S3 N° 000012", `tickets` en `pagos` de `ingresarAlPortal`), para que empareje el papel con el recibo. No se usa impresora térmica: el código de la impresora Bluetooth se quitó (13/11/2026).

## Offline (cliente)

- `GET /jornada/paquete` (`getJornadaPackage`) entrega al cobrador los comerciantes y saldos del periodo. Se guarda en IndexedDB (`offlineStore.js`).
- **Deuda atrasada sin señal** (corregido el 10/11/2026):
  - El paquete trae `periodos_impagos` (el saldo de cada mes) además de `deuda_vencida`.
  - Sin señal, la pantalla muestra los meses impagos y cobra primero el más antiguo, como en línea (`aSaldoDePantalla`).
  - `aplicarCobroLocal` descuenta el cobro del mes al que se aplicó.
  - "Cobrar" desde Sitios o el Mapa sin señal carga el saldo del padrón del celular (`jornada.porId`).
- Cada cobro offline lleva una huella SHA-256 (`offlineQueue.js`), que el servidor usa como clave de idempotencia.
- Un conflicto nunca se resuelve en el cliente: va a `cobros_observados` y se revisa en `ReviewPanel`.
- **Cambios del mapa sin señal** (`mapa_pendientes`, decisión del usuario, 28/10/2026): se suben en orden (`colaMapa.js`).
  - Un rechazo que reintentar no arregla (400, 403, 404, 409, 410, 422) **no traba la cola**: el cambio queda marcado `rechazado` con el mensaje del servidor y se sigue con el resto.
  - No se borra solo: Mapa y Sitios lo muestran (`CambiosRechazadosMapa`) con "Reintentar" y "Descartar"; descartarlo lo decide el usuario.
  - Sin conexión, 401, 429 o un error del servidor (5xx) se para y se reintenta al volver la señal.

## Autenticación y auditoría

- **Roles del personal** (decisión del usuario, 04/11/2026):
  - `super_admin` es la Jefa de Rentas: hace todos los cambios.
  - `auditor` es la gerencia o la alcaldía (en la tesis, "administrador"): **solo consulta y audita**. Ve el panel, reportes, analítica, comerciantes, sitios, caja, tickets, tarifas, zonas, revisión de cobros y la auditoría, y descarga la plantilla del padrón. No escribe en ninguna ruta: zonas, calles, padrón, comerciantes, preferencias y notificaciones quedaron para `super_admin` (preferencias y notificaciones, también el cobrador). Solo puede cerrar sus propias sesiones.
  - `cobrador`: cobra, marca asistencia y cierra su caja.
  - Lo comprueba `tests/api-seguridad.test.js` ("el auditor solo consulta"): recorre todas las rutas que escriben y exige 403.
- `POST /auth/login` devuelve un JWT corto (`config.jwtExpiresIn`) en el cuerpo y deja el refresh token de 12 h, ligado al dispositivo (`createDeviceSession`), en la cookie HttpOnly `sisrec_refresh`. `/auth/refresh` y `/auth/logout` solo leen la cookie.
- En el cliente ningún token va en `localStorage`: el de acceso vive en memoria y, al recargar, `authFetch` pide uno nuevo con la cookie (`credentials: 'include'`).
- Portal del comerciante (`portalAcceso.js`): **solo con la llave del carnet** (decisión del usuario, 28/10/2026, como el Penpot P3). El PIN de 6 dígitos se quitó (migración 0017: sin ruta que lo genere ni login que lo acepte; quien solo tenía PIN necesita su carnet).
  - DNI o código + llave del carnet (`XXXX-XXXX-XX`);
  - la llave sola desde el QR del reverso: con la cámara del celular (`/portal#llave=…`) o con el botón "Escanear el QR del reverso" del portal (`QrScanner` + `llaveQr.js`, que rechaza el QR del frente).
- Credenciales erradas responden siempre el mismo 401. 5 llaves erradas seguidas bloquean 15 minutos (429). La llave se muestra una sola vez y nunca se audita en claro.
- **No hay sesión guardada en el celular del comerciante** (decisión del 28/10/2026): cada consulta vuelve a pedir la llave.
- **El carnet lo emite solo `super_admin`**, uno por uno o en lote (hasta 500), desde Comerciantes. Un carnet nuevo anula la llave anterior. No se emite a un dado de baja.
- **La baja anula la llave** (borra la fila de `comerciante_portal_acceso`), para que una reactivación no reviva un carnet viejo.
- `session.js` renueva el token una sola vez aunque fallen varias peticiones a la vez (`refreshing`), y emite `SESSION_EXPIRED_EVENT` si no puede.
- Las sesiones se pueden revocar desde el panel (`DELETE /auth/sesiones/:id`).
- `auditMutation` guarda el estado anterior y el nuevo en `auditoria_logs`, encadenados con un hash. `verifyAuditChain` detecta si alguien los alteró.

## Portal del comerciante (11/11/2026)

- Sin tarifa vigente el portal abre igual: la deuda del mes va en 0 con `sin_tarifa`, y la pantalla dice "Aún no hay una tarifa vigente para su puesto" en vez de "Cuenta al día". Antes respondía 400 y no se veían ni los recibos.
- Un cobro observado que aún no se revisó sale "En revisión", no "Válido": la municipalidad todavía puede anularlo.

## Super administrador titular y suplente (13/11/2026)

Decisión del usuario: dos cuentas `super_admin` activas, de cargos distintos y designadas por memorando. El titular trabaja a diario; el suplente solo actúa cuando el titular falta o con encargo escrito. Cada mes uno revisa en la auditoría lo que hizo el otro. El sistema no limita la cantidad de `super_admin` (no hace falta código); la regla es de organización y está en `docs/despliegue-produccion.md` (secciones 4 y 11).
