# Glosario del dominio (lenguaje ubicuo)

Los términos que usa la Municipalidad de Salcedo son los mismos en la base de datos, la API, el código y las pantallas. Si un término nuevo aparece en una conversación con el área de rentas, se agrega aquí antes de usarlo en el código.

## Términos

| Término | Qué es | Tabla / columna | API | Código | Pantalla |
|---|---|---|---|---|---|
| **Comerciante** | Persona o empresa que vende en la vía pública, mercado o feria y paga el derecho de uso | `comerciantes` | `/api/v1/comerciantes` | `insertComerciante`, `updateComerciante`, `findComerciante` | Comerciantes |
| **Código del comerciante** | Identificador de negocio legible (ver abajo); es lo que se imprime, se dicta y va en el QR | `comerciantes.codigo` | campo `codigo`; `/comerciantes/:codigo` | `buscarComerciantePorCodigo`; trigger `asignar_codigo_comerciante` | primera columna de Comerciantes, QR, portal |
| **Correlativo** | Número de orden del comerciante; nunca cambia | `comerciantes.correlativo` | campo `correlativo` | — | parte del código (`0004`) |
| **Código anterior** | Código que tuvo el comerciante antes de un cambio; sigue sirviendo para buscarlo | `comerciante_codigos_historicos` | `codigos_anteriores` (paquete de jornada) | trigger `guardar_codigo_anterior` | búsqueda del cobrador y portal |
| **Tipo de comerciante** | Eventual (paga el día que se le encuentra), permanente (paga el mes) o ferial (paga si asiste a la feria) | `comerciantes.tipo_comerciante` | `tipo_comerciante` (y `categoria`, alias antiguo) | `TIPOS_COMERCIANTE` | formulario de comerciante |
| **Estado** | activo, inactivo (dado de baja) o pendiente | `comerciantes.estado` | `estado` | `ESTADOS_COMERCIANTE` | columna Estado |
| **Baja** | Retiro lógico del comerciante; no se borra, se conserva su historial | `comerciantes.fecha_baja` | `DELETE /comerciantes/:id` | `deactivateComerciante` | botón "Dar de baja" |
| **Documento** | DNI (8 dígitos) o RUC (11 dígitos) | `comerciantes.dni_ruc` | `dni_ruc` | `validateDocument` | columna Documento |
| **Rubro** | Giro del negocio: comida, ropa, zapatillas, otros | `rubros` (`codigo`: COMI, ROPA…) | `/api/v1/rubros` | `getRubros` | filtro y formulario |
| **Zona** | Sector de la ciudad donde se cobra | `zonas` (`codigo`: MCEN, ZNOR…) | `/api/v1/zonas` | `getZonas`, `insertZona` | Zonas, mapa |
| **Calle** | Vía dentro de una zona | `calles` | `/api/v1/calles` | `getCalles` | Zonas |
| **Puesto** | Espacio físico que ocupa el comerciante | `puestos.codigo_puesto` | `/api/v1/puestos-mapa` | `insertPuesto` | mapa |
| **Tarifa** | Monto que corresponde por rubro (y zona), por día, semana, mes o m² | `tarifas` | `/api/v1/tarifas` | `insertTarifa`, `updateTarifa` | Tarifas |
| **Liquidación** | Cuánto debe un comerciante en un periodo (o día, si es eventual) y cuánto pagó | — (se calcula) | `/api/v1/liquidaciones/:codigo`, `/comerciantes/:codigo/saldo` | `calcularLiquidacion` | Cobro rápido, portal |
| **Periodo** | Mes de cobro, `AAAA-MM`, según el calendario de Lima | — | `periodo` | `currentPeriod` | Cobro rápido |
| **No devengo** | Periodo en que el comerciante no debe nada (ferial que no asistió, eventual fuera de su día) | — | `no_devengo` | `calcularLiquidacion` | Cobro rápido |
| **Cobro** | Pago que recibe el cobrador | `transacciones` | `/api/v1/cobros` | `registrarCobro` | Cobro rápido |
| **Cobro observado** | Cobro hecho sin señal que excede el saldo; lo acepta o anula el administrador | `cobros_observados` | `/api/v1/cobros/observados` | `resolveCobroObservado` | Revisión de cobros |
| **Comprobante / recibo** | Constancia del cobro, `R-000123` (o `PROV-…` sin señal) | `comprobantes.numero_correlativo` | `comprobante` | — | recibo térmico |
| **Jornada** | Día de trabajo del cobrador; el padrón se descarga al iniciarla | — | `/api/v1/jornada/paquete` | `getJornadaPackage`, `jornadaOffline.js` | Jornada sin señal |
| **Padrón** | Lista oficial de comerciantes | `comerciantes` | `/api/v1/comerciantes/importar-padron` | `padronImport.js` | importar Excel |
| **Plantilla del padrón** | Excel oficial con los encabezados que reconoce la importación y listas de zonas, rubros, tipos y estado | — | `/api/v1/comerciantes/plantilla-padron` | `padronPlantilla.js` | Descargar plantilla oficial (Comerciantes) |
| **Empadronamiento** | Situación del registro: regularizado o pendiente de regularización | `comerciantes.estado_empadronamiento` | `estado_empadronamiento` | — | — |
| **Pendiente de regularización** | Titular importado sin DNI: queda con un documento provisional `TEMP_DNI_…` y paga igual; se regulariza al registrar su DNI real | `comerciantes.estado_empadronamiento = 'PENDIENTE_REGULARIZACION'` | `pendingMerchants` | `esDocumentoTemporal`, `updateComerciante` | sin DNI, pendientes de regularizar |
| **Morosidad (panel)** | Parte de lo devengado en el periodo que sigue impaga: deuda pendiente ÷ (deuda pendiente + cobrado) | — | `stats.morosidad` | `indicadoresPanel` | Morosidad |
| **Asistencia ferial** | Marca de que el ferial vino (P) o faltó (F) un día; el ferial paga solo los días que asistió. La marca es del titular que tenía el puesto ese día | `asistencias_feriales` (`asistio`, `comerciante_id`) | `/api/v1/asistencias` | `marcarAsistencias` | Asistencia ferial de hoy (Pagos) |
| **Tipo de vía** | Si la zona es de vía asfaltada o sin asfaltar; puede tener tarifa propia | `zonas.tipo_via`, `tarifas.tipo_via` | `tipo_via` | `findApplicableTariff` | Zonas, Tarifas |
| **Deuda acumulada** | Meses impagos desde el alta, nunca antes del inicio de cobro | — (se calcula) | `deuda_acumulada` | `calcularDeudaAcumulada` | Pagos, portal |
| **Inicio de cobro** | Primer mes desde el que se suma la deuda acumulada | `parametros_sistema` | `/api/v1/parametros` | `setInicioCobro` | Tarifas |
| **Ticket preimpreso** | Ticket de papel numerado que se entrega por cada puesto y día cobrado; disponible, usado, anulado o devuelto | `tickets` | `tickets` en `POST /cobros`; `/api/v1/tickets/anulaciones` | `validarTicketsCobro`, `anularTickets`, `ticketsOffline.js` | Cobro rápido (Entregar ticket N°) |
| **Serie de tickets** | Numeración propia por tipo de vía: S3 (S/ 3, asfaltada) y S2 (S/ 2, sin asfaltar) | `ticket_series` | `/api/v1/tickets/series`; `series_cobro` (saldo y paquete de jornada) | `seriesDelComerciante` | Tickets |
| **Lote de tickets** | Rango de números de una serie entregado a un cobrador; se puede reasignar o devolver lo no usado | `ticket_lotes` | `/api/v1/tickets/lotes` | `asignarLote`, `reasignarTickets`, `devolverTickets` | Tickets |
| **Mes aplicado** | Mes al que se aplicó un cobro (puede ser uno anterior con deuda) | `transacciones.periodo_aplicado` | `periodo` | `registrarCobro` | Pagos, recibo |
| **Anulación** | Un cobro que deja de contar, con motivo y responsable; no se borra | `transacciones.motivo_anulacion` | `/api/v1/cobros/:id/anular` | `anularCobro` | Pagos (admin), recibo ANULADO |
| **Cierre de caja** | Lo que el cobrador entrega al final del día frente a lo que registró | `cierres_caja` | `/api/v1/caja` | `cerrarCaja`, `resumenCaja` | Cierre de caja |
| **Tiempo de atención** | Segundos entre abrir al comerciante y registrar el cobro | `transacciones.inicio_atencion` | `/api/v1/cobros/tiempos` | `getTiemposCobro` | Analítica |
| **Verificación de recibo** | QR del recibo que comprueba que es auténtico | — (firma HMAC) | `/api/v1/publico/verificar/:token` | `verificarRecibo` | `/verificar/:token` |
| **Cobrador** | Usuario que cobra en campo | `usuarios` con rol `cobrador` | — | `requireRoles(['cobrador'])` | — |

## El código del comerciante

```
COM-0004-LAC-COMI-***744-MCEN-ACT-20261016
 │   │    │   │     │     │    │   └─ fecha de registro (hora de Lima)
 │   │    │   │     │     │    └─ estado: ACT activo · INA inactivo · PEN pendiente
 │   │    │   │     │     └─ código de la zona (Mercado Central)
 │   │    │   │     └─ 3 últimos dígitos del DNI o RUC (no el documento completo)
 │   │    │   └─ código del rubro (comida)
 │   │    └─ iniciales del nombre (Lucio Arizaca Carrion)
 │   └─ correlativo: no cambia nunca
 └─ entidad: comerciante
```

- El código va en QR, recibos y reportes, así que **no lleva el DNI/RUC completo** (Ley 29733, principio de proporcionalidad): solo sus 3 últimos dígitos. El documento completo se ve solo en la columna Documento, dentro del sistema.
- La base de datos arma el código con un trigger (`migrations/0004_codigo_comerciante.sql`), así ningún alta, edición, importación o script se lo salta.
- Si cambia el nombre, el rubro, el documento, la zona o el estado, el código se vuelve a armar y el anterior queda en `comerciante_codigos_historicos`. Un QR o recibo impreso con el código viejo sigue encontrando al comerciante, y también `CM-004`, el formato anterior.
- El `id` numérico se usa solo dentro del sistema, para relacionar tablas; no se muestra a nadie.

## Pendiente

Quedan en inglés algunos nombres de la capa técnica, como `MerchantDirectory`, `insertComerciante`, `getJornadaPackage` y las variables `merchant` dentro de `App.jsx`. Se irán cambiando por partes, porque `App.jsx` lo editan varias sesiones a la vez.
