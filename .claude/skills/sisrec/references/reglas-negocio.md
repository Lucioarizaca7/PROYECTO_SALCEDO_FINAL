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

Depende de `tipo_comerciante`:
- **permanente:** cuota mensual = tarifa vigente del rubro y periodo × metraje del puesto principal.
- **ferial:** paga los días con asistencia del mes (`asistencias_feriales.asistio`, en cualquiera de sus puestos; varias marcas del mismo día cuentan una vez) × la tarifa de un día (`dailyTariffAmount`). Lo mismo el permanente con tarifa por día cobrado (ver abajo). Sin asistencias devuelve `no_devengo` con el motivo `ferial_sin_asistencia`. La respuesta trae `dias_asistidos`. El cobrador marca con `POST /asistencias` (también sin señal: reenviar no duplica).
  - **Qué días puede marcar** (11/11/2026): el cobrador, hasta `DIAS_COBRO_SIN_SENAL = 3` días atrás, la misma ventana que el cobro sin señal (decisión del 22/10/2026). Más atrás, solo el `super_admin`, y queda en la auditoría. Antes podía marcar cualquier día pasado y crear deuda sin revisión.
  - **Dados de baja** (decisión del usuario, 11/11/2026): no se registra asistencia de un comerciante dado de baja ni de un puesto inactivo. La marca se rechaza con aviso y no genera deuda.
  - **Lotes del celular:** `POST /asistencias` con `{ marcas }` responde marca por marca (`data` = guardadas, `rechazadas` = `{ puesto_id, fecha, error }`). Antes una sola marca inválida rechazaba todo el lote. El celular no reintenta las rechazadas y muestra su motivo.
  - **Días anteriores sin señal:** las marcas que no subieron pasan al día siguiente a `anteriores` y se siguen enviando con su fecha. Antes se borraban al cambiar el día y ese día no generaba deuda.
- **eventual:** se cobra por día (`cobro_diario: true`). Si el día pedido no cae en el periodo, devuelve `no_devengo` con el motivo `eventual`.
- Un pendiente de regularización (titular sin DNI) paga igual que cualquier otro (decisión del usuario, 2026-10-27); antes no devengaba si le faltaba el metraje (`pendiente_regularizacion_sin_metraje`, ya no existe). Por eso entra en la deuda del panel (`getPendingDebt`) y en el padrón de la jornada (`getJornadaPackage`): los dos toman `estado IN ('activo', 'pendiente')` (`ESTADOS_QUE_PAGAN_SQL`).
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
- **Cambio de zona de un puesto** (decisión del usuario, 02/11/2026, migración 0019): la zona nueva rige desde el día del cambio. Cada marca guarda su zona (`asistencias_feriales.zona_id`), así que los días anteriores conservan su tarifa y el mismo mes puede tener dos tramos (dos filas en `puestos_cobrados`). Una marca que llega después pero es de antes del cambio toma la zona de su fecha (`zona_de_asistencia`).
  - **Excepción:** asignar una "zona por regularizar" corrige también los días pasados, porque la zona anterior era provisional. Puede subir o bajar la deuda de esos días; lo ya pagado no se toca.
  - Un trigger registra cada cambio en `puestos_zona_cambios`, sea cual sea el camino (Sitios, mapa o padrón).
  - No cubre la tarifa mensual, que depende de la zona del comerciante.
- **Tipo de vía de cada día** (decisión del usuario, 11/11/2026, migración 0021): si cambia el tipo de vía de una zona (la calle se asfalta: S/ 2 → S/ 3), el nuevo rige desde el día del cambio. Cada marca guarda el tipo de vía de su fecha (`asistencias_feriales.tipo_via`, `via_de_zona`), y la liquidación busca la tarifa con ese tipo de vía (`findApplicableTariff(..., { tipoVia })`). Antes se recalculaban con el tipo de vía actual también los días pasados, incluso los ya pagados.
- **Tarifa de cada día** (decisión del usuario, 11/11/2026): el cobro por día cobra cada día marcado con la tarifa vigente ese día (`tarifasDelMes` + `tarifaDelDia` en `liquidarPorAsistencia`). Si en el mes entra una tarifa nueva, salen dos filas en `puestos_cobrados`. El eventual paga con la tarifa del día en que se le encuentra. La cuota mensual sigue con la tarifa del día 1. Antes todo se buscaba con la del día 1: una tarifa nueva "desde hoy" recién se aplicaba el mes siguiente.
- **Tarifas sin cruces** (decisión del usuario, 02/11/2026, migración 0020): dos tarifas activas del mismo rubro, zona y tipo de vía no pueden cruzar sus fechas; lo impide el trigger `tarifa_sin_cruces`.
- **Una tarifa que ya rige no cambia lo que cobra** (decisión del usuario, 11/11/2026): en `updateTarifa`, si `vigencia_inicio <= hoy`, se rechaza cambiar monto, unidad, tipo, inicio, rubro, zona o tipo de vía. Para otro monto se crea una tarifa nueva, que cierra la anterior. Sí se puede cerrar con `vigencia_fin`, pero no antes de hoy. Reenviar los mismos valores no es un cambio. Una tarifa que todavía no empieza se edita libremente. La pantalla bloquea esos campos y la tarifa nueva empieza hoy por omisión (antes el formulario traía 2026-01-01).
  - **Una tarifa nueva no empieza antes de hoy** (decisión del usuario, 11/11/2026): con una fecha pasada cerraba la anterior hacia atrás y recalculaba meses ya cobrados. Tampoco se mueve al pasado una tarifa que aún no empieza. Si una ordenanza llega tarde, la diferencia se cobra aparte. (`insertTarifa(..., { permitirInicioPasado })` solo lo usan las pruebas para armar historia; la API nunca lo pasa.)
  - Crear una que empieza después cierra la anterior el día previo (`insertTarifa`, `tarifas_cerradas` en la respuesta y en la auditoría).
  - Se rechaza con 409 si empieza el mismo día o antes, o si termina antes que la anterior, porque quedaría un tramo sin tarifa.
  - Editar nunca cierra otra tarifa: si las fechas se cruzan, se rechaza.
- Las tarifas generales de la migración 0013 rigen desde el mes en que se aplicó. Los meses anteriores siguen con la tarifa del rubro, así cargar el tipo de vía no reescribe la historia.
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

**Lo pagado de un mes** (`paidInPeriod`): cobros confirmados con `periodo_aplicado` = ese mes, o sin él y cobrados (día de Lima) en ese mes. `registrarCobro` guarda `periodo_aplicado` = el periodo liquidado (NULL para el eventual), así un pago de hoy puede cancelar un mes anterior.

**Tipo de comerciante de cada mes** (migración 0023, decisión del usuario del 11/11/2026): el cambio de tipo rige desde su día. `comerciantes_tipo_cambios` lo guarda (trigger) y `tipoEnPeriodo` decide el tipo de cada mes:
- el mes en curso, con el tipo actual;
- un mes pasado, con el que tenía; si en ese mes fue ferial o permanente aunque sea unos días, se liquida con ese tipo (sus días marcados se deben), no como eventual.

Antes pasar a un ferial a eventual borraba su deuda atrasada entera, y pasar un eventual a permanente le creaba deuda de meses en que era eventual.

**Deuda acumulada** (`calcularDeudaAcumulada`): recorre los meses desde `max(mes de alta, parametros_sistema.inicio_cobro)` hasta el actual llamando a `calcularLiquidacion` en cada uno (no hay otra fórmula). El eventual no acumula, pero solo los meses en que fue eventual (ver abajo). Devuelve `periodos`, `meses_impagos`, `periodo_mas_antiguo` (el que se cobra primero), `deuda_vencida`, `deuda_mes` y `deuda_total`. Va en `/comerciantes/:id/saldo`, `/liquidaciones/:id`, el portal y el paquete de jornada.

**Varios puestos:** con cobro por día (tarifa `semanal` o ferial) paga por cada puesto marcado. Con tarifa mensual o diaria de rubro sigue pagando por uno solo, el principal.

## Importación del padrón (`padronImport.js`, 2026-10-27)

- **Vista previa en lote:** cruza el libro con la base en 4 consultas (`= ANY`), no por fila. Devuelve `previewToken`: la confirmación lo envía en vez del Excel. Vence a los 15 minutos, es del usuario que la hizo y vive en la memoria de la API (410 si no existe: el cliente reenvía el archivo).
- **Confirmación:** con `insertComerciante`, `updateComerciante`, `insertPuesto` y `updatePuesto` (las mismas reglas que la API), en una transacción con un savepoint por fila: un choque inesperado se informa en `result.rowErrors` y no deshace las demás. Al confirmar se vuelve a cruzar con la base.
- **Sin DNI/RUC:** documento provisional `TEMP_DNI_` + huella del nombre (estable: reimportar no duplica), estado `pendiente` y `PENDIENTE_REGULARIZACION`. Si un padrón posterior trae el DNI para el mismo puesto y el mismo nombre, se regulariza ese comerciante; editarlo con su DNI real también. Solo la importación crea documentos `TEMP_` (`insertComerciante(..., { documentoTemporal: true })`). Un sin DNI con el mismo nombre que otro con DNI es una advertencia.
- **Varios puestos:** filas con el mismo DNI y el mismo nombre son un comerciante con varios puestos; el mismo DNI con otro nombre es error de fila.
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
  - el **hash** (`hash_transaccion`, el mismo en línea y en la cola del celular) evita que el mismo cobro se registre dos veces;
  - el `codigo_operacion` es único **por método** (`uq_transacciones_operacion`): un Yape y un POS con el mismo número no chocan. Otro cobro con un número ya usado en el mismo método responde 409 con el recibo donde se usó (11/11/2026).
  - Genera la `transaccion` y su `comprobante` (con número correlativo).
- **Fecha del cobro** (decisión del usuario, 2026-10-22). Decide en qué caja diaria cuenta el cobro:
  - en línea (`POST /cobros`) manda la hora del servidor; la del celular solo se usa si difiere menos de 5 minutos (`fechaCobroEnLinea`);
  - sin señal se acepta la hora del celular hasta `DIAS_COBRO_SIN_SENAL = 3` días atrás y 5 minutos en el futuro. Fuera de ese rango el cobro **no se descarta**: queda observado con el motivo "fecha fuera de rango" (`fechaCobroFueraDeRango`).
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

### Tickets preimpresos (migración 0014, `routes/tickets.ts`)

- **Qué es:** se entrega un ticket de papel numerado por cada puesto y día cobrado.
- **Series:** `ticket_series`, una por tipo de vía:
  - S3 = S/ 3, vía asfaltada;
  - S2 = S/ 2, sin asfaltar.
- **Series de un comerciante:** las da `seriesDelComerciante`. Es la serie del tipo de vía de cada puesto (y, para los días ya marcados en el mes, la del tipo de vía de ese día, migración 0021: tras asfaltar, los días de antes van con S2), siempre que:
  - la tarifa de ese puesto sea por día cobrado (`semanal`) con tipo de vía;
  - el valor de la serie sea igual al monto de un día de esa tarifa.

  Si la lista sale vacía, el cobro no lleva ticket: zona sin tipo de vía, tarifa por rubro o mes con tarifa anterior.
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
