# Reglas de negocio de SISREC

Este archivo tiene dos partes:

1. **Reglamento:** las reglas vigentes, numeradas, con su responsable y su control. Es lo que se valida con la Jefa de Rentas. La versión para firmar, sin términos técnicos, está en `docs/reglamento-sisrec.md`.
2. **Anexo técnico:** el detalle de cada regla para quien programa (funciones, migraciones, casos borde e historia).

Las reglas propuestas y las decisiones pendientes están en `docs/plan-reglas-negocio.md`. Una regla pasa al reglamento cuando el usuario la aprueba y queda programada; conserva su número.

**Cómo mantenerlo:** una regla nueva se agrega primero al reglamento (número, regla, responsable, control) y después su detalle al anexo. Si una regla cambia, se corrige en los dos sitios y en `docs/reglamento-sisrec.md`. La historia («antes hacía…») va solo en el anexo.

## Reglamento

### Padrón y puestos

| N.º | Regla | Responsable | Control | Detalle en el anexo |
|---|---|---|---|---|
| RN-01 | Cada persona tiene un solo registro, identificado por su DNI o RUC. | Super administrador | El sistema rechaza un documento repetido, aunque sea de un dado de baja. | Importación del padrón |
| RN-02 | Un comerciante sin DNI se registra como pendiente de regularización y paga igual. | Super administrador | Lista de pendientes en Comerciantes. | Importación del padrón |
| RN-03 | Un comerciante no se borra: se da de baja. La baja anula su carnet y da de baja sus puestos. | Super administrador | Auditoría. | Liquidación (Baja) |
| RN-04 | Un puesto pertenece a una zona. Solo el super administrador cambia la zona habitual de un puesto. | Super administrador | El servidor rechaza el cambio de otro rol. | Puestos |
| RN-05 | Un puesto sin zona confirmada no tiene precio propio: para marcarlo o cobrarlo, el cobrador elige la zona donde vende ese día. | Cobrador | En línea el sistema no deja marcar ni cobrar sin la zona del día. Sin señal, el cobro queda observado. | Modelo simplificado (Etapa 4) |
| RN-06 | El comerciante tiene una sola zona: la de su puesto principal. Solo se edita a mano la de quien no tiene puesto. | Sistema | La base la actualiza sola cuando cambia el puesto. | Modelo simplificado (Etapa 4) |

### Zonas y precios

| N.º | Regla | Responsable | Control | Detalle en el anexo |
|---|---|---|---|---|
| RN-10 | Una zona es un área donde todos pagan el mismo precio por día. No hay calles. | Super administrador | Pantalla Zonas. | Liquidación |
| RN-11 | Una feria con parte asfaltada y parte sin asfaltar se registra como dos zonas. | Super administrador | Explicación en la pantalla Zonas. | Liquidación |
| RN-12 | La zona nace con su precio. El tipo de vía lo sugiere: S/ 3 asfaltada, S/ 2 sin asfaltar. | Super administrador | El formulario lo propone; se puede cambiar. | Liquidación |
| RN-13 | Solo el super administrador fija o cambia un precio. | Super administrador | El servidor rechaza a otros roles. Auditoría. | Liquidación |
| RN-14 | Un precio nuevo rige desde hoy o después, nunca hacia atrás. Los días anteriores conservan su precio. | Sistema | El servidor rechaza una fecha pasada. | Liquidación |
| RN-15 | Cada precio nuevo lleva la norma que lo respalda (número de ordenanza o resolución). | Super administrador | El sistema no guarda un precio nuevo sin la norma. | Modelo simplificado (Etapa 4) |
| RN-16 | Una zona sin precio no puede cobrar en línea. Sin señal, el cobro queda observado. | Sistema | Aviso en Tarifas. | Liquidación |

### Día cobrado

| N.º | Regla | Responsable | Control | Detalle en el anexo |
|---|---|---|---|---|
| RN-20 | Se debe solo el día que el cobrador marcó o cobró. Sin día cobrado no hay deuda. | Cobrador | Marca de asistencia o cobro. | Liquidación |
| RN-21 | Cada puesto marcado paga su día. Dos puestos el mismo día son dos pagos. | Cobrador | Detalle por puesto en la liquidación. | Liquidación (Varios puestos) |
| RN-22 | Al cobrar a un comerciante con varios puestos, el cobrador marca cuáles abrieron ese día. Cada puesto marcado paga su día. | Cobrador | Pantalla de cobro; el servidor marca la asistencia de cada puesto con el cobro. | Modelo simplificado (Etapa 4) |
| RN-23 | Si el comerciante vende ese día en otra zona, el cobrador elige la zona del día y se cobra ese precio. | Cobrador | Queda en Observaciones. | Liquidación (Zona del día) |
| RN-24 | El cobrador marca hasta 3 días atrás. Más atrás, solo el super administrador. | Sistema | El servidor lo rechaza. Auditoría. | Liquidación |
| RN-25 | «No salió» no genera deuda. «No vendió» y «se negó a pagar» sí la generan. | Cobrador | Motivo obligatorio y coherente con la marca. | Liquidación (Observación del cobrador) |
| RN-26 | Antes de cerrar su caja, el cobrador ve los puestos que quedaron sin marcar en las zonas donde ese día ya marcó a otros, y los marca. | Cobrador | Lista «sin marcar hoy» en Cierre de caja. Avisa, no bloquea. | Caja |
| RN-27 | El comerciante puede reclamar un día marcado hasta 7 días después. Lo registra y lo resuelve el super administrador. Si procede un «no asistió», ese día deja de deberse. | Super administrador | Registro de reclamos en «Deuda y reclamos». Auditoría. | Deuda, anulaciones y reclamos |

### Cobro y comprobantes

| N.º | Regla | Responsable | Control | Detalle en el anexo |
|---|---|---|---|---|
| RN-30 | Todo cobro genera un recibo con número correlativo. | Sistema | Automático. | Cobros |
| RN-31 | Por cada puesto y día cobrado se entrega un ticket preimpreso del valor de ese día. | Cobrador | La suma de los tickets debe ser igual al monto. | Tickets preimpresos |
| RN-32 | Los talonarios los asigna solo el super administrador. | Super administrador | Lotes con rango único. | Tickets preimpresos |
| RN-33 | Un talonario perdido o robado se reporta el mismo día y el super administrador anula de una vez sus tickets disponibles, con motivo. | Cobrador y super administrador | Botón «Perdido o robado» en Tickets. Auditoría. | Modelo simplificado (Etapa 4) |
| RN-34 | Solo se cobra en efectivo. No se acepta Yape, Plin ni POS. | Cobrador | El sistema rechaza cualquier otro medio. Un cobro digital guardado sin señal antes del cambio entra y queda observado. | Cobros |
| RN-36 | Sin señal, el cobro se guarda en el celular y se envía después. Un conflicto queda observado, nunca se descarta. | Sistema | Revisión de cobros. | Cobros y Offline |
| RN-37 | Un cobro no se borra: lo anula el super administrador con un motivo. | Super administrador | Auditoría. | Tickets preimpresos (anularCobro) |
| RN-38 | Un super administrador anula solo un cobro de hoy cuya caja sigue abierta. Si el cobro es de otro día, o esa caja ya se cerró, uno pide la anulación y el otro super administrador la aprueba o la rechaza. Si no hay otro super administrador activo, la anula quien la pide, con motivo, y queda señalada para la revisión mensual. | Super administrador titular y suplente | El sistema deja la anulación pendiente; nadie aprueba ni revisa la que él mismo hizo. Lista «Anuladas sin segunda aprobación». Auditoría. | Deuda, anulaciones y reclamos |

### Caja

| N.º | Regla | Responsable | Control | Detalle en el anexo |
|---|---|---|---|---|
| RN-40 | El cobrador cierra su caja una vez por día y declara lo que tiene por método de pago. | Cobrador | El sistema calcula lo esperado y la diferencia. | Caja |
| RN-41 | La entrega del efectivo queda registrada: quién recibe, cuándo y cuánto. La registra el super administrador que lo recibe, nunca quien cerró esa caja. | Super administrador | Constancia de entrega ligada al cierre. Auditoría. | Caja |
| RN-42 | Todo faltante de caja se justifica por escrito al cerrar. Un sobrante, desde S/ 5. | Cobrador | El sistema no deja cerrar sin la justificación. | Caja |
| RN-43 | Un cierre no se edita. Un error se corrige con una rectificación del super administrador, con motivo. | Super administrador | Se conserva el cierre original. Auditoría. | Caja |
| RN-44 | Los cobros que llegan después del cierre se entregan aparte, como entrega complementaria. | Cobrador y super administrador | El sistema los separa y registra la entrega. | Caja |

### Deuda

| N.º | Regla | Responsable | Control | Detalle en el anexo |
|---|---|---|---|---|
| RN-50 | La deuda es la suma de los días cobrados sin pagar, desde el inicio de cobro. | Sistema | Una sola fórmula para todo el sistema. | Liquidación (Deuda acumulada) |
| RN-51 | Un pago cancela primero el mes más antiguo. | Sistema | Automático. | Liquidación (Deuda acumulada) |
| RN-52 | El eventual no acumula deuda. | Sistema | Automático. | Liquidación |
| RN-53 | Quien debe un día cobrado desde hace 30 días o más recibe un aviso formal de deuda. La suspensión del puesto la decide la municipalidad, no el sistema. | Super administrador | Lista «avisos por emitir» y registro de cada aviso. | Deuda, anulaciones y reclamos |
| RN-54 | La deuda de meses pasados se da de baja solo con resolución, registrando su número. No hay fraccionamiento. Los días cobrados no se borran. | Super administrador | Registro de bajas con número de resolución. Auditoría. | Deuda, anulaciones y reclamos |

### Control y auditoría

| N.º | Regla | Responsable | Control | Detalle en el anexo |
|---|---|---|---|---|
| RN-60 | El auditor solo consulta. No escribe en ninguna pantalla. | Sistema | Prueba automática de todas las rutas. | Autenticación y auditoría |
| RN-61 | Hay dos super administradores: titular y suplente. Cada mes uno revisa lo que hizo el otro. | Gerencia | Memorando y auditoría. | Super administrador titular y suplente |
| RN-62 | Los reportes por zona cuentan cada cobro en la zona donde se vendió ese día. | Sistema | Automático. | Cobros (Reportes) |
| RN-63 | Cada mes se revisa el reporte «cobros en otra zona» por cobrador. | Super administrador | Reporte en Reportes, para super administrador y auditor. | Cobros (Reportes) |
| RN-64 | Cada cobrador tiene zonas asignadas. Cobrar fuera de ellas no se impide, pero queda señalado. Sin zonas asignadas, cobra en todas. | Super administrador | Asignación en Usuarios. Reporte «marcas fuera de las zonas asignadas». | Modelo simplificado (Etapa 4) |

---

# Anexo técnico

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
- **Solo `super_admin` cambia la zona de un puesto** (decisión del usuario, 28/10/2026): la zona fija el precio del cobro por día. Es la zona habitual del puesto; la **zona del día** sí la elige el cobrador en campo (12/11/2026) y queda en Observaciones. El cobrador recibe 403 si pide otra zona, y reenviar la misma no confirma una "zona por regularizar"; sí mueve el puesto en el mapa y asigna o libera al titular. La importación del padrón (solo super_admin) sí asigna zonas.
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
- **Zona = área con un solo precio.** Cada zona tiene un tipo de vía (asfaltada / sin asfaltar) y un precio por día. El tipo de vía es un dato de la zona y sugiere el precio al ponerlo (S/ 3 / S/ 2), pero no lo decide. Una parte de la feria con otro tipo de vía va en otra zona. No hay calles (14/11/2026).
- La base solo acepta activas las tarifas que son precio de una zona (CHECK `tarifas_precio_de_zona`); `validateTariff` rechaza con mensaje claro rubro, tipo de vía, monto variable y unidades mensuales. Las tarifas viejas quedaron inactivas (no se borran: `transacciones.tarifa_id` las referencia). La 0032 dio a cada zona con tipo de vía el precio general de su tipo de vía, con sus fechas; las zonas sin tipo de vía quedaron **sin precio** hasta que el `super_admin` lo ponga.
- **La zona nace con su precio** (decisión del usuario, 14/11/2026): al crear una zona el formulario pide el precio por día y lo sugiere según el tipo de vía (S/ 3 asfaltada, S/ 2 sin asfaltar); se puede cambiar o dejar vacío. `insertZona` acepta `precio_dia` y guarda la zona y su precio (desde hoy) en una transacción. Cambiarlo después sigue siendo en Tarifas, y cambiar el tipo de vía de una zona que ya existe no cambia su precio.
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
- Por eso su saldo de hoy **no es deuda** (RN-52): el Panel no lo suma (`getPendingDebt`) y Sitios lo muestra aparte, «Eventuales: S/ X de hoy si se les encuentra» (`totalesDeSitios`, 18/11/2026). Antes Sitios lo sumaba al saldo del mes y daba S/ 74 contra S/ 48 del Panel.
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

**Zona del día** (decisión del usuario, 12/11/2026): cuando faltan otros comerciantes, uno puede vender en otra zona; ese día se le cobra con el precio de esa zona. **La elige el cobrador en campo**: en el panel de asistencia ("Hoy en …") o al cobrar ("Zona de hoy"); funciona sin señal con las zonas del paquete de jornada. La marca guarda esa zona (`asistencias_feriales.zona_id`; `marcarAsistencias` acepta `zona_id`, `registrarCobro` acepta `zona_dia` y corrige la zona de las marcas de ese día ya hechas). Los tickets de hoy salen de esa zona (`series_cobro[].puestos_hoy`). Los tickets de hoy son **lo que se le cobra hoy** (12/11/2026): con marcas de hoy, un ticket por puesto marcado "asistió" (el que faltó no suma); sin ninguna marca, uno por el puesto principal, que es el que marca el cobro. **Sin señal**, los tickets de hoy salen del padrón (`puestos_hoy`) y de la marca de hoy del celular: marcado "faltó" no sugiere ticket, y la zona marcada en el panel de asistencia queda elegida como zona del día al cobrar (tickets de esa zona y `zona_dia` en el cobro). Se puede cobrar a quien paga por día **aunque el día no esté marcado**: el cobro lo marca y el servidor valida el monto ("Confirmar" ya no se deshabilita con saldo 0 en el mes en curso). Cambiar después la zona del puesto no pisa una zona del día elegida (0031). Elegir la zona en el panel de asistencia marca «Asistió»; por eso, **con la marca en «Faltó» la zona no se ofrece** (18/11/2026, `zonaDelDiaEditable`): antes cambiarla pasaba al comerciante a «Asistió» y se le cobraba el día. Para elegirla, primero se toca «Asistió». Queda en la auditoría y el administrador la ve en Observaciones: "Cobrado en otra zona: X (su puesto es de Y)".

**Una zona es un área con un solo precio; no hay calles** (decisión del usuario, 14/11/2026): en una misma feria hay partes de S/ 3 (asfaltada) y de S/ 2 (sin asfaltar), y el comerciante se mueve dentro de la feria para vender más. Por eso cada parte se registra como una zona distinta («Feria sábado – asfaltada», «Feria sábado – sin asfaltar») y el movimiento se cobra con la zona del día. Moverse dentro de la misma zona no se registra. Se quitaron el catálogo de calles, sus rutas (`/api/v1/calles`) y su panel: nada los usaba (ni puestos, ni cobro, ni mapa) y pedir una zona para crear una calle confundía. La pantalla se llama «Zonas» y explica la regla. La tabla `calles` y `puestos.calle_id` siguen en la base, sin uso (ver `deuda-tecnica.md`).

**El precio lo pone la zona** (decisión del usuario, 13/11/2026): lo que se cobra cada día depende de la zona donde el comerciante vende ese día (se mueve por la lluvia, por la ubicación o porque faltan otros), no de su rubro ni de los metros. El precio de cada zona lo fija el `super_admin` en Tarifas (`POST /tarifas` solo `super_admin`, con `zona_id`, `monto_fijo` y `vigencia_inicio`). Por eso no se parte el mes cuando cambian el rubro o los metros: no cambian el monto del día. La zona va por día en la marca de asistencia (0019, 0031). El detalle está en "Cobro solo por día cobrado, con el precio de la zona" (0032).

**Cambio de rubro** (recomendación aceptada, 12/11/2026): se edita el rubro del mismo comerciante. No se crea otro registro con el mismo DNI (es único en la base) ni se da de baja el anterior: desde la 0025 el rubro nuevo rige desde el día del cambio y los meses pasados conservan el anterior, con su deuda y sus pagos en un solo historial.

## Importación del padrón (`padronImport.js`, 2026-10-27)

- **Vista previa en lote:** cruza el libro con la base en 4 consultas (`= ANY`), no por fila. Devuelve `previewToken`: la confirmación lo envía en vez del Excel. Vence a los 15 minutos, es del usuario que la hizo y vive en la memoria de la API (410 si no existe: el cliente reenvía el archivo).
- **Confirmación:** con `insertComerciante`, `updateComerciante`, `insertPuesto` y `updatePuesto` (las mismas reglas que la API), en una transacción con un savepoint por fila: un choque inesperado se informa en `result.rowErrors` y no deshace las demás. Al confirmar se vuelve a cruzar con la base.
- **Sin DNI/RUC:** documento provisional `TEMP_DNI_` + huella del nombre (estable: reimportar no duplica), estado `pendiente` y `PENDIENTE_REGULARIZACION`. Si un padrón posterior trae el DNI para el mismo puesto y el mismo nombre, se regulariza ese comerciante; editarlo con su DNI real también. Solo la importación crea documentos `TEMP_` (`insertComerciante(..., { documentoTemporal: true })`). Un sin DNI con el mismo nombre que otro con DNI es una advertencia.
- **Varios puestos:** filas con el mismo DNI y el mismo nombre son un comerciante con varios puestos; el mismo DNI con otro nombre es error de fila.
- **DNI de un dado de baja** (12/11/2026): el documento es único en la base aunque su dueño esté de baja. Registrarlo en otro comerciante responde 409 con el código del dado de baja, para reactivarlo en vez de duplicar a la persona.
- **Errores por fila:** código de otro titular, puesto físico ocupado (zona + dirección, como `validatePuestoPlacement`), código repetido en el libro. Una baja que reaparece se reactiva (`reactivatedMerchants`).
- **Metraje:** siempre opcional y solo informativo (13/11/2026): el cobro es por día y no usa metros. Sin metraje en el libro se conserva el que tenía el puesto.
- **Zona por regularizar** (decisión del usuario, 28/10/2026; migración 0018). La zona se busca por nombre exacto (sin mayúsculas, tildes ni espacios de más) en la columna Zona o, si viene vacía, en el nombre de la hoja.
  - Si no hay coincidencia, la fila **no es error**: el puesto queda en la primera zona, paga con su tarifa y se guarda `puestos.zona_por_regularizar` (`''` = venía sin zona; texto = la zona del libro que no está registrada). La vista previa lo avisa por fila y cuenta `zonePendingPosts`.
  - Antes la búsqueda era aproximada: "Barrio Alto Salcedo" caía en la zona "SALCEDO" sin avisar.
- **Rubro exacto** (decisión del usuario, 11/11/2026): el rubro de la columna se busca por nombre exacto, igual que la zona. Si no está registrado, el comerciante queda en "otros" y la vista previa lo avisa por fila (no impide importar). Antes "Ropa de bebé" caía en "ropa" sin avisar. Si la columna viene vacía se usa el rubro del nombre del archivo ("FERIA ZAPATILLAS.xlsx") o de la hoja.
  - Se regulariza en Sitios ("Asignar zona…", solo `super_admin` en la pantalla) o reimportando con una zona registrada: enviar `zona_id` borra la marca; mover el puesto en el mapa no. Solo cambia la zona del **puesto** (la que usa el cobro por día); la zona del comerciante (su código y la agrupación de los reportes) se corrige en Comerciantes.
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
  - **Los reportes por zona cuentan donde se vendió** (decisión del usuario, 14/11/2026; migración 0033): `zona_cobro_id` es la **zona del día** del cobro, la de la marca de ese día (la que eligió el cobrador en "Zona de hoy" o la del puesto). Antes era la zona del comerciante: quien vendía un día en otra zona pagaba el precio de esa zona, pero el panel y los reportes sumaban el cobro a su zona habitual. Sin marca ese día (pago de un mes atrasado, eventual, fecha fuera de rango) sigue la zona del comerciante. Si en un segundo cobro del mismo día se elige otra zona, los cobros de ese día ya hechos pasan también a esa zona. La 0033 corrigió los cobros existentes. Los días marcados de la proyección se agrupan igual, por la zona de la marca. **Límite:** un cobro que paga días vendidos en zonas distintas cuenta entero en la zona del día del cobro; y cambiar la zona de una marca en el panel de asistencia después de cobrar no mueve el cobro.
  - **Cobros en otra zona, por cobrador** (RN-63, 15/11/2026): `getCobrosEnOtraZona(db, { desde, hasta })`, `GET /asistencias/otra-zona` (super_admin y auditor; el cobrador recibe 403). Por cada cobrador cuenta las marcas de la app con asistencia, cuántas fueron en una zona distinta a la del puesto ese día (`zona_de_asistencia`), cuántas a una zona más barata o más cara, y la diferencia: precio de la zona del puesto menos precio de la zona del día, con la tarifa vigente ese día. Positivo = se cobró menos que en la zona del puesto. Si una de las dos zonas no tenía precio ese día, la marca cuenta en `sin_precio` y no entra en la diferencia. Solo consulta: no cambia montos ni bloquea al cobrador. Por omisión, del día 1 del mes a hoy.
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

## Caja (`routes/caja.ts`, `resumenCaja`, `cerrarCaja`)

- **Lo esperado** lo calcula el servidor: los cobros confirmados del cobrador ese día (día de Lima, según `fecha_cobro_cliente`), por método: efectivo, Yape, Plin y POS.
- **El cobrador declara** lo que tiene por método (`POST /caja/cierre`, cobrador y super_admin). La diferencia es lo declarado menos lo esperado y queda guardada en `cierres_caja`.
- **Un cierre por cobrador y día.** Un segundo cierre responde 409. No se puede cerrar un día futuro. El cierre no se reabre ni se edita: se rectifica (ver abajo).
- **Cobros posteriores al cierre:** si entran cobros de ese día después de cerrar (por ejemplo, sincronizados tarde), `resumenCaja` los muestra aparte en `posteriores_al_cierre`.
- **Tickets:** el cierre guarda el resumen de tickets del día y sus alertas (ver Tickets preimpresos).
- **Consulta:** `GET /caja/cierres` es para super_admin y auditor. El cierre queda en la auditoría con lo esperado y la diferencia.
- **Puestos sin marcar hoy** (RN-26, 15/11/2026): antes de cerrar, la pantalla de Caja lista los puestos sin marca del día, por zona. Solo entran las zonas donde ese día ya se marcó al menos un puesto: una feria que hoy no sale no tiene pendientes. Lo calcula el cliente (`puestosSinMarcar`, `services/asistenciaOffline.js`) con `GET /asistencias`. Es un aviso: no bloquea el cierre. **Límite:** todavía no hay zonas asignadas por cobrador (RN-64, decisión pendiente), así que la lista incluye los puestos de esas zonas que le tocaban a otro cobrador.
- **Justificación de la diferencia** (RN-42, decisión del usuario del 15/11/2026; migración 0034): todo faltante y todo sobrante de S/ 5 o más piden `justificacion` (5 a 500 caracteres) al cerrar; si falta, `cerrarCaja` responde 400. La base repite la regla (`cierres_caja_diferencia_justificada`, `NOT VALID`: no obliga a los cierres anteriores). El tope vive en `SOBRANTE_SIN_JUSTIFICAR` (servidor) y en `lib/caja.js` (cliente, solo para mostrar el campo).
- **Entrega del dinero** (RN-41 y RN-44, misma decisión): `registrarEntregaCaja`, `POST /caja/cierres/:id/entrega`, solo super_admin. Se entrega el **efectivo**; Yape, Plin y POS llegan a la cuenta. Tabla `entregas_caja`: tipo `cierre` (una sola por cierre, índice único) o `complementaria` (los cobros que entraron después del cierre; solo si los hay y con monto mayor que cero). Si el monto recibido no es el efectivo declarado vigente, las observaciones son obligatorias. **Quien recibe no puede ser quien cerró esa caja** (409): con titular y suplente, uno recibe la caja del otro. La pantalla muestra la constancia (`textoConstancia`, número `E-000012`).
- **Rectificación** (RN-43, misma decisión): `rectificarCierreCaja`, `POST /caja/cierres/:id/rectificacion`, solo super_admin, con los cuatro montos corregidos y el motivo (5 a 500 caracteres). No toca `cierres_caja`: agrega una fila en `cierres_caja_rectificaciones` y vale la última. Cada cierre devuelve `vigente` (lo declarado y la diferencia que valen hoy), `rectificacion`, `entregas` y `entregado`. Rectificar con los mismos montos responde 409.
- **Conciliación de Yape, Plin y POS (RN-35): retirada** el 17/11/2026, porque ya solo se cobra en efectivo (ver «Solo efectivo»). **Límites:** una entrega registrada no se anula ni se corrige; rectificar después de la entrega no cambia la entrega ya registrada.

## Deuda, anulaciones y reclamos (migración 0035, `routes/deuda.ts` y `routes/cobros.ts`)

Decisiones del usuario del 15/11/2026 (Etapa 3 del plan de reglas). Pantalla: «Deuda y reclamos» (`DeudaPage.jsx`, `useDeuda.js`), para super_admin y auditor; solo el super_admin escribe.

- **Anulación con segunda aprobación** (RN-38): `anularCobro` anula directo solo si el cobro es de hoy (día de Lima de `fecha_cobro_cliente`) y el cobrador no cerró la caja de ese día (`porQuePideAprobacion`). Si no, crea una fila en `anulaciones_solicitadas` y la ruta responde **202** con `pendiente_aprobacion: true`; el cobro sigue confirmado. `resolverAnulacion` (`POST /cobros/anulaciones/:id/resolver`, decisión `aprobar` o `rechazar`): quien la pidió no la resuelve (409, y CHECK `anulaciones_otro_resuelve`); rechazar pide explicación. Al aprobar, el cobro se anula con el motivo y a nombre de quien lo pidió (`aprobada: true`). Una pendiente por cobro (índice único parcial). `GET /cobros/anulaciones?estado=`.
  - **Excepción:** la revisión de un cobro observado (`resolveCobroObservado`) anula sin segunda aprobación: ese cobro nunca fue aceptado y su revisión ya es un control. (Interpretación de la implementación, pendiente de confirmar con el usuario.)
  - **Un solo super_admin activo** (decisión del 18/11/2026, migración 0038): si no hay otro super_admin activo (`hayOtroSuperAdminActivo`, bloquea esas filas con `FOR SHARE`), quien anula lo hace él solo con motivo. `registrarAnulacionSinSegundo` deja la fila en `anulaciones_solicitadas` como `aprobada`, con `resuelto_por = solicitado_por` y `sin_segundo_admin = true` (CHECK `anulaciones_sin_segundo_completa`; `anulaciones_otro_resuelve` admite solo esta excepción). Si él mismo la había pedido cuando había otro, se cierra esa misma solicitud; si la pidió otro, responde 409. La ruta responde 200 con `sin_segunda_aprobacion: true`.
  - **Revisión mensual** (RN-61): `GET /cobros/anulaciones?estado=sin_segunda_aprobacion` (super_admin y auditor; primero las no revisadas) y `revisarAnulacionSinSegundo` (`POST /cobros/anulaciones/:id/revisar`, solo super_admin, nunca quien la anuló: 409 y CHECK `anulaciones_revision_completa`). Revisarla no deshace la anulación. Pantalla: «Anuladas sin segunda aprobación» en Deuda y reclamos. Prueba: `tests/anulacion-un-solo-admin.test.js`.
  - **Límite:** mientras haya un solo super_admin, nadie puede marcar revisadas sus anulaciones: quedan señaladas hasta que exista el segundo. El auditor las ve, pero no las marca.
- **Aviso de deuda** (RN-53): `DIAS_PARA_AVISO_DE_DEUDA = 30`. El día impago más antiguo sale de la liquidación: `calcularLiquidacion` devuelve `dias_cobrados` (cada día con su precio) y `primerDiaImpago` aplica lo pagado a los días más antiguos primero; `calcularDeudaAcumulada` devuelve `dia_impago_mas_antiguo`. `getAvisosDeuda` (`GET /deuda/avisos`) lista `por_emitir` (cumplen la regla y no tienen aviso por ese día impago) y `emitidos`. `emitirAvisoDeuda` (`POST /deuda/avisos`) recalcula la deuda en el servidor; un aviso por comerciante y día impago (`avisos_deuda_uno_por_dia`). El texto del aviso lo arma el cliente (`lib/deuda.js`, `textoAviso`, número `A-000012`), sin DNI. El sistema no suspende a nadie.
  - Si el comerciante paga una parte, el día impago más antiguo avanza; si el nuevo sigue con 30 días o más, vuelve a la lista. (Interpretación de la implementación.)
- **Baja de deuda con resolución** (RN-54): `darDeBajaDeuda` (`POST /deuda/bajas`), solo super_admin, solo meses anteriores al actual, con `resolucion` (3 a 80 caracteres) y `motivo`. Da de baja el saldo completo de cada mes vencido hasta `hasta_periodo`: una fila por mes en `deuda_bajas`. La liquidación resta la baja como resta lo pagado (`bajaEnPeriodo`, campo `monto_baja`), pero no cuenta como recaudación ni borra los días cobrados. **No hay fraccionamiento** (se dejó para después). **Límite:** una baja no se revierte.
- **Reclamo de un día marcado** (RN-27): `DIAS_PARA_RECLAMAR = 7` (también en la base: `reclamos_dentro_del_plazo`). `registrarReclamo` (`POST /reclamos`): lo registra el super_admin en nombre del comerciante; tipo `no_asistio` o `ya_pago`; solo sobre un día que el comerciante tiene marcado como asistió; uno pendiente por comerciante y día. `resolverReclamo` (`POST /reclamos/:id/resolver`, `procedente` o `no_procedente`, con explicación):
  - procedente y `no_asistio`: cada puesto marcado ese día pasa a falta (`no_salio`, marca de la app, que manda sobre el Excel) y el día deja de deberse. Si ese día tiene un cobro confirmado responde 409: primero se anula el cobro (con RN-38). Un reclamo no devuelve dinero por su cuenta.
  - procedente y `ya_pago`: el sistema no inventa un pago; la resolución dice qué se hizo.

## Solo efectivo (decisión del 17/11/2026, migración 0037)

**Por qué:** el POS de la municipalidad no está activado y figura a nombre de una persona de la gestión anterior; con el cambio de alcalde no hay una cuenta municipal donde comprobar un pago digital.

- **Regla (RN-34):** solo se cobra en efectivo. `registrarCobro` rechaza en línea (400) todo `metodo_pago` que no sea `efectivo`.
- **Sin señal:** un cobro por Yape, Plin o POS que un celular guardó antes del cambio entra con `allowExcess` y queda **observado** («Pago por YAPE (operación …): ya solo se cobra en efectivo»). Sigue exigiendo número de operación, único por método.
- **En la base:** disparador diferido `trg_transacciones_solo_efectivo` (error 23514, `transacciones_solo_efectivo`): una fila nueva, o un cambio de `metodo_pago`, que no sea efectivo solo pasa si tiene su fila en `cobros_observados`. Es un disparador y no un CHECK porque la fila de observados se escribe después del cobro, en la misma transacción.
- **Historia:** los cobros digitales ya registrados no cambian y se siguen viendo con su medio y su operación (recibo, reportes, portal). Las columnas `*_yape`, `*_plin` y `*_pos` del cierre de caja se quedan.
- **Cliente:** Pagos ya no tiene selector de medio ni código de operación; envía siempre `efectivo`. Caja muestra solo efectivo, y un medio digital únicamente si ese día tiene monto (`mediosDeCaja` en `lib/caja.js`).
- **RN-35 (conciliación) se retira.** Para volver a cobrar con POS o QR hace falta una decisión nueva y una migración que quite el disparador.
- **Límite:** un cierre de caja con un Yape observado lo sigue contando en lo esperado de Yape; el cobrador lo declara en ese campo, que aparece solo ese día.
- **Pruebas:** `tests/codigo-operacion.test.js` (servidor) y `tests/caja.test.js` (cliente).

## Modelo simplificado (Etapa 4, migración 0036)

Decisiones del usuario del 15/11/2026.

- **Norma del precio** (RN-15): `tarifas.norma` (3 a 120 caracteres). `insertTarifa` e `insertZona` con `precio_dia` la exigen (`normaDelPrecio`); la base lo repite con `tarifas_con_norma` (los precios activos creados desde la 0036). Los precios anteriores quedan sin norma; `updateTarifa` deja escribirla o corregirla siempre, porque no cambia lo que se cobra. Las semillas de demostración usan «Datos de demostración».
- **Zonas por cobrador** (RN-64): tabla `cobrador_zonas`; `asignarZonasCobrador` (`PUT /usuarios/:id/zonas`, solo super_admin) reemplaza la lista; `GET /usuarios` devuelve `zonas_asignadas`. **Solo avisa**: la marca hecha en una zona no asignada se guarda con `asistencias_feriales.fuera_de_asignacion = true` (`senalarFueraDeAsignacion`, en `marcarAsistencias` y en la marca que pone el cobro). Un cobrador sin zonas asignadas cobra en todas. El dato queda en la marca: cambiar la asignación después no cambia lo ya marcado. Reporte: `getMarcasFueraDeAsignacion` (`GET /asistencias/fuera-de-asignacion`, super_admin y auditor). **Límite:** un cobro sobre un día que otro ya marcó no se señala (la señal va en la marca).
- **Talonario perdido** (RN-33): `anularDisponiblesDelLote` (`POST /tickets/lotes/:id/anular-disponibles`, solo super_admin, con motivo). Anula todos los tickets disponibles del lote y lo cierra; los usados no se tocan. El aviso «el mismo día» es una regla de trabajo: el sistema no la mide.
- **Puestos del día al cobrar** (RN-22): el cobro acepta `puestos_dia` (ids). `marcarDiaCobrado` marca cada puesto de la lista que no tenga marca de la app ese día (no pisa un «no salió»). Sin la lista, como antes: solo el puesto principal y solo si nadie marcó el día. En línea, un puesto ajeno o dado de baja rechaza el cobro; sin señal se ignora. La liquidación y `/liquidaciones/:id` devuelven `puestos_del_dia` (`puestosDelDia`: puestos y `marcado_hoy`); el paquete de jornada trae `puestos` por comerciante. Cliente: `lib/cobroDelDia.js` (`puestosParaElegir`, `requeridosConPuestos`, `montoDePuestos`); el selector solo aparece con dos o más puestos y sin marca de hoy.
- **Puesto sin zona confirmada** (RN-05): con `puestos.zona_por_regularizar` no nulo, `marcarAsistencias` rechaza «asistió» sin `zona_id` (una falta no necesita precio) y `registrarCobro` en línea rechaza el cobro que marcaría ese puesto sin `zona_dia`. Sin señal el cobro entra con la zona provisional y queda observado. Las marcas anteriores a la 0036 no cambian; al confirmar la zona se corrigen como antes (0019).
- **Zona única del comerciante** (RN-06): `comerciantes.zona_id` es la zona del puesto principal (`zona_del_puesto_principal`, el de menor id en uso). Dos triggers la mantienen: `trg_puesto_mueve_al_comerciante` (al cambiar zona, titular o estado de un puesto) y `trg_comerciantes_a_zona_de_puesto` (al guardar el comerciante). `updateComerciante(..., { zonaDelPuesto: true })` (la ruta) responde 400 si se intenta otra zona; la importación del padrón no lo pide y la base acomoda la zona. Quien no tiene puesto conserva una zona editable. El cambio rige desde ese día (0025) y el código del comerciante se vuelve a armar; el código anterior sigue sirviendo para buscarlo.
- **Tipos de comerciante** (RN-07): se mantienen ferial, permanente y eventual (decisión del 15/11/2026). No se unieron.

## Recibo (12/11/2026)

No se usa la impresora térmica en el piloto. El recibo se envía por WhatsApp **como imagen con ancho de celular** (`reciboComoImagen`, un canvas sin librerías) con la hoja de compartir del celular; si el celular no puede compartir imágenes, se abre WhatsApp con el texto completo (`textoRecibo`). "Guardar PDF" usa la impresión del navegador. La pantalla, la imagen y el texto salen de las mismas filas (`lineasRecibo`). No lleva el DNI (Ley 29733).

**Verificación del recibo** (12/11/2026): como una imagen se falsifica fácil, el recibo en pantalla, la imagen de WhatsApp y el texto llevan el QR y el enlace de verificación, los mismos del PDF del portal (`urlVerificacion`, token HMAC por número y monto). El enlace abre `/verificar/:token`, que muestra solo número, fecha, monto y estado, y dice "Recibo anulado" si se anuló. `POST /cobros` los devuelve (`url_verificacion`, `qr_verificacion`). El recibo provisional sin señal no los lleva: el número oficial existe al sincronizar.

**Reenviar el recibo oficial** (12/11/2026): "Enviar recibo por WhatsApp" en Cobros recientes y "Enviar recibo oficial" en la cola sin señal (ya sincronizado) traen el recibo oficial con su QR (`GET /comprobantes/:id/recibo`) y lo comparten; así el comerciante cambia el provisional por uno verificable. Un recibo anulado lo dice ("RECIBO ANULADO: motivo"). El cobrador solo trae sus recibos.

**Comprobante del cobro sin señal** (decisión del usuario, 13/11/2026): el comprobante físico es el **ticket preimpreso** que el cobrador entrega en el momento; el recibo de la pantalla es provisional hasta sincronizar. Después, el comerciante ve sus pagos en el portal público (con la llave del carnet) y descarga el recibo oficial en PDF. Cada pago del portal dice qué tickets se entregaron ("Ticket: S3 N° 000012", `tickets` en `pagos` de `ingresarAlPortal`), para que empareje el papel con el recibo. No se usa impresora térmica: el código de la impresora Bluetooth se quitó (13/11/2026).

## Offline (cliente)

- `GET /jornada/paquete` (`getJornadaPackage`) entrega al cobrador los comerciantes y saldos del periodo. Se guarda en IndexedDB (`offlineStore.js`).
- **Cuándo se vuelve a bajar** (18/11/2026, `padronPorRenovar`): al abrir la app con señal, siempre que no queden cobros sin subir (por subir o con error). Antes solo si no era de hoy, y un padrón de la mañana seguía todo el día sin las altas, bajas y precios nuevos (en la auditoría, comerciantes ya borrados seguían en «Asistencia de hoy»). Con cobros sin subir se conserva, porque su saldo local ya los descuenta; un padrón de otro día se baja igual, como antes. Las marcas de asistencia y los tickets se guardan aparte y no se pierden. El contador «N de M marcados» cuenta solo a los de la lista (`marcadosDeLaLista`).
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

- **Usuarios del personal** (decisión del usuario, 13/11/2026; pantalla Usuarios, `routes/usuarios.ts`, sección "Usuarios del personal" de `db.js`):
  - solo `super_admin` ve la lista, crea cuentas, las desactiva o reactiva y les pone clave nueva;
  - puede crear **super_admin, cobradores y auditores** (no comerciantes: el comerciante entra al portal con su carnet);
  - una cuenta **no se borra, se desactiva**: sus cobros, cierres de caja y la auditoría guardan quién los hizo. Desactivar cierra sus sesiones al instante;
  - nadie desactiva su propia cuenta, y no se desactiva al **último super_admin activo** (nadie podría volver a administrar);
  - la clave nueva **no obliga a cambiarla** al entrar. Mínimo `MIN_CLAVE = 10` caracteres. Cambiarla cierra las otras sesiones de esa persona;
  - **cada persona cambia su propia clave** en la pantalla Mi clave (super_admin, cobrador y auditor; `PUT /auth/mi-clave`, `cambiarMiClave`): pide la clave actual, la nueva debe ser distinta, y se cierran sus sesiones en otros dispositivos (la del que la cambia sigue). Clave actual errada = 400, no 401, para que el cliente no crea vencida la sesión;
  - los comandos `crear-admin` / `crear-usuario` siguen para el primer administrador y para la contingencia sin ningún super_admin (`docs/despliegue-produccion.md`, sección 11).
- **Roles del personal** (decisión del usuario, 04/11/2026):
  - `super_admin` es la Jefa de Rentas: hace todos los cambios.
  - `auditor` es la gerencia o la alcaldía (en la tesis, "administrador"): **solo consulta y audita**. Ve el panel, reportes, analítica, comerciantes, sitios, caja, tickets, tarifas, zonas, revisión de cobros y la auditoría, y descarga la plantilla del padrón. No escribe en ninguna ruta: zonas, padrón, comerciantes, preferencias y notificaciones quedaron para `super_admin` (preferencias y notificaciones, también el cobrador). Solo puede cerrar sus propias sesiones.
  - `cobrador`: cobra, marca asistencia y cierra su caja.
  - Lo comprueba `tests/api-seguridad.test.js` ("el auditor solo consulta"): recorre todas las rutas que escriben y exige 403.
- `POST /auth/login` devuelve un JWT corto (`config.jwtExpiresIn`) en el cuerpo y deja el refresh token de 12 h, ligado al dispositivo (`createDeviceSession`), en la cookie HttpOnly `sisrec_refresh`. `/auth/refresh` y `/auth/logout` solo leen la cookie.
- **Una sesión por navegador, no por pestaña** (13/11/2026): la cookie `sisrec_refresh` es del navegador, así que si en otra pestaña se entra con otra cuenta, todas pasan a esa cuenta. Cada pestaña muestra siempre al usuario de la cookie (`services/sesionPestanas.js`: `cambioDeSesion`), con dos señales: el usuario que trae `/auth/refresh` y el evento `storage` de `sisrec-user` (solo datos visibles, nunca tokens). Si cambia de cuenta, la pestaña lo avisa en la barra superior; si otra pestaña cierra la sesión, esta también. Antes una pestaña podía mostrar al super_admin mientras su token ya era del cobrador.
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

- Si la zona no tiene precio el portal abre igual: la deuda del mes va en 0 con `sin_tarifa`, y la pantalla dice "La zona de su puesto aún no tiene precio por día" en vez de "Cuenta al día". Antes respondía 400 y no se veían ni los recibos.
- Un cobro observado que aún no se revisó sale "En revisión", no "Válido": la municipalidad todavía puede anularlo.

## Super administrador titular y suplente (13/11/2026)

Decisión del usuario: dos cuentas `super_admin` activas, de cargos distintos y designadas por memorando. El titular trabaja a diario; el suplente solo actúa cuando el titular falta o con encargo escrito. Cada mes uno revisa en la auditoría lo que hizo el otro. El sistema no limita la cantidad de `super_admin` (no hace falta código); la regla es de organización y está en `docs/despliegue-produccion.md` (secciones 4 y 11).
