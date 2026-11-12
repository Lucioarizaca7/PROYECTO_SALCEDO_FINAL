# Deuda técnica conocida (análisis del 2026-10-16)

Ordenada de más a menos grave. Antes de tomar uno de estos puntos, comprobar que siga igual en el código.

1. (Resuelto: el portal pide DNI o código + llave del carnet, con bloqueo tras 5 llaves erradas, y devuelve el documento oculto. El PIN de la rama `seguridad/portal-y-sesion` se quitó en la 0017.)
2. (Resuelto en la misma rama: el token de renovación va en la cookie HttpOnly `sisrec_refresh` y el de acceso solo en memoria.)
3. (Resuelto el 10/11/2026 en la rama de trabajo actual:
   - `getPendingDebt` ya no corta en 300 comerciantes; calcula de a 8 en paralelo.
   - El resumen de riesgo cuenta a todos los puntuados, no solo a los 5 que lista.

   Con un padrón de miles sigue siendo una liquidación por comerciante en cada carga del panel. La versión en lote de "Refactor 6" vive en `claude/compassionate-hermann-e2df59`, que no está en el remoto.)
4. (Resuelto en "Refactor 6": `calcularLiquidacionLote` reemplaza el bucle N+1 en el panel, el mapa, la jornada y el riesgo de morosidad.)
5. (Resuelto en "Refactor 5": `App.jsx` quedó en las rutas; cada página tiene su archivo y su hook.) Queda: todos los datos compartidos se recargan juntos con `refresh()` (10 peticiones), sin caché por página.
6. (Resuelto el 12/11/2026, migración 0031: paga por cada puesto desde noviembre de 2026; ver `reglas-negocio.md`.)
7. **Detalles menores:**
   - No hay páginas de Usuarios ni de Cobradores (las de relleno se quitaron en "Refactor 5"): se administran en la base.
   - Hay dos endpoints para crear puestos.
   - (Resuelto: el botón "Exportar CSV" de Reportes descarga con `authFetch` y un Blob, `useReportes.js`. Antes era un enlace sin token y la API respondía 401.)
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
- (Resuelto el 11/11/2026: `POST /comerciantes/:id/preferencias` ya no borra las demás claves.)
- Auditoría de seguridad del 2026-10-22 (skill appsec-elite-auditor). Quedan pendientes:
  - la CSP de la app web solo fija `frame-ancestors`, `base-uri`, `object-src` y `form-action`. Falta limitar scripts y estilos, y antes hay que probarlo con el mapa (mapbox-gl usa workers `blob:`) y con Google Fonts;
  - (Resuelto el 11/11/2026: `jwt.sign` y `jwt.verify` fijan HS256.)
  - el HMAC de los recibos usa el mismo secreto que el JWT;
  - (Resuelto el 11/11/2026 para el cobro: `concepto` hasta 200 y `observaciones` hasta 500 caracteres, se recortan sin perder el cobro; motivo de anulación hasta 300.) El nombre al editar un comerciante sigue sin largo máximo;
  - el log de accesos de Caddy guarda la URL completa (DNI en `?search=`, enlaces firmados de recibos).
- Las tarifas por rubro que estén en la base real siguen activas: en una zona sin tipo de vía se siguen usando.
- **Cambio de zona de un puesto:** (Resuelto el 02/11/2026, migración 0019, ver `reglas-negocio.md`.) Queda: cambiar la **zona del comerciante** (tarifa mensual) o el **tipo de vía de una zona** todavía recalcula los meses pasados.
- **Importación del padrón:**
  - el `previewToken` vive en la memoria de la API: con varias instancias o tras un reinicio, la confirmación responde 410 y el cliente reenvía el archivo;
  - confirmar 3 000 filas tarda ~32 s en local (Docker en Windows), unas 12 consultas por fila. Para bajar de un segundo haría falta guardar en lote con `unnest`, con una prueba que compare el resultado con `insertComerciante`/`insertPuesto`;
  - `exceljs` trae `uuid` < 11.1.1 (aviso moderado de `npm audit`).

## Pendientes de la auditoría full-stack (2026-10-27)

- **Calles sin estado.** La tabla `calles` no tiene columna `estado`; la pantalla ofrecía Activo/Inactivo y no se guardaba (todas salían "Inactivo"). Se quitó el selector. Si hace falta dar de baja calles, va una migración nueva con `estado` y su CHECK.
- **Barra superior.** Se quitaron la caja "Buscar registro" y el botón de notificaciones porque no tenían ninguna acción. Una búsqueda global sería una función nueva.
- **Riesgo de morosidad N+1.** `recalcularRiesgoMorosidad` corre por detrás una vez al día: una `calcularDeudaAcumulada` por comerciante, de a 8 en paralelo (los pagos ya salen de una sola consulta). Con decenas de miles de comerciantes conviene la liquidación en lote (paso 6).
- **Tarifas superpuestas.** (Resuelto el 02/11/2026, migración 0020, ver `reglas-negocio.md`.)

## Revisión de fallos del 10/11/2026

Corregidos (prueba en `apps/server/tests/fallos-noviembre.test.js` y en las pruebas del cliente):
- **Nota del cobro:** no se mostraba.
- **Boleta:** se cortaba a 390 px y la impresión salía en hoja A4/Carta con páginas en blanco.
- **"Imprimir / PDF" de Reportes** salía en blanco.
- **Código de operación** arrastrado al cobro en efectivo.
- **Reportes:** sumaba los anulados.
- **Sugerencia express:** tomaba el cobro más antiguo.
- **Deuda atrasada sin señal.**
- **Portal:** mostraba pagos anulados como válidos y "al día" con meses atrasados.
- **Comerciantes:** solo los 100 más recientes, con filtros por texto.
- **Calculadora pública:** usaba m².
- **Texto del PIN.**
- **Motivo de cada ticket:** se agregó la ruta `GET /tickets/lotes/:id/tickets` (`getTicketsDelLote`) y el botón "Ver detalle" en Tickets.

- **Riesgo de morosidad** (11/11/2026, prueba en `tests/riesgo-morosidad.test.js`): puntuaba solo a los primeros 300 y sin la deuda de quien paga por día. Ahora puntúa a todo el padrón, con la deuda acumulada, por detrás. Con 3051 comerciantes tarda ~2,8 s en local, y el panel responde en ~15 ms con el puntaje anterior.

## Revisión de fallos del 11/11/2026 (después de unir `main`)

Corregidos, con prueba en `tests/asistencia-lote.test.js`, `tests/auditoria-filtros.test.js`, `padron-import.test.js`, `api-seguridad.test.js` y `apps/client/tests/asistenciaOffline.test.js`:
- **Asistencia sin señal de un día anterior:** se borraba al cambiar el día.
- **Un lote de asistencia con una marca inválida** se rechazaba entero.
- **Asistencia en cualquier fecha pasada** y de comerciantes dados de baja.
- **Auditoría:** solo los últimos 200 registros, sin fechas ni páginas; la verificación de la cadena no tenía pantalla.
- **Rubro aproximado** al importar el padrón.
- **JWT sin algoritmo fijo**, **textos del cobro sin tope** y **preferencias que se borraban** en cada cobro.

## Tercera revisión del 11/11/2026: lo pasado no cambia

Corregidos, con prueba en `tests/api-seguridad.test.js`, `tests/tipo-via-de-cada-dia.test.js` y `tests/tarifas-vigentes.test.js`:
- **Puestos:** el cobrador rodeaba la prohibición de cambiar la zona. Podía crear un puesto en una zona más barata, pasar un puesto a otro titular, o liberarlo o darlo de baja. Ahora solo registra la ubicación.
- **Tipo de vía:** al cambiarlo se recalculaban los días pasados. Migración 0021.
- **Tarifas:** editar el monto de una tarifa que ya regía cambiaba los meses pasados. El formulario de tarifa nueva traía una fecha de inicio pasada.
- **`GET /calles`:** no pedía rol.

(Resuelto el 11/11/2026 en la séptima revisión, migración 0024: el cobro sin señal sin tarifa queda observado.)

Ramas viejas (decisión del usuario, 11/11/2026): `limpieza/archivos-sobrantes` se unió a esta rama. `fix/arranque-local` está obsoleta (puerto 4000 y `apiService.js`, que ya no existen; `.env.example` ya estaba) y el usuario la borró del remoto (11/11/2026).

Quedan:
- **Tamaño del papel al imprimir el recibo:** sale del alto medido en pantalla. Puede sobrar un poco de papel al final.

## Cuarta revisión del 11/11/2026: cobros sin señal, tickets y velocidad

Corregidos, con prueba en `tests/codigo-operacion.test.js`, `tests/tipo-via-de-cada-dia.test.js` y `tests/api-seguridad.test.js`:
- **Código de operación repetido sin señal:** otro cobro con un número de Yape/Plin/POS ya usado se daba por "duplicado"; el celular lo borraba y el dinero no entraba. Ahora solo el mismo hash es duplicado; lo demás queda rechazado a la vista.
- **Número de operación comparado sin el método:** un POS con el mismo número que un Yape se rechazaba, aunque la base lo permite.
- **Tickets tras asfaltar una calle** (regresión de la 0021): la serie salía solo del tipo de vía de hoy, y el cobro de los días sin asfaltar con ticket S2 se rechazaba.
- **Paquete de jornada y mapa lentos:** con 3051 comerciantes, `GET /jornada/paquete` tardaba 22,5 s y `GET /puestos` 7,4 s (una liquidación tras otra). Con `enGrupos` bajan a ~7,3 s y ~2,4 s.
- **`POST /notificaciones`** sin auditoría ni largo máximo; **`GET /catalogos` y `GET /roles`** sin rol.

Queda: el paquete de jornada calcula dos veces el mes en curso (`calcularLiquidacion` y otra vez dentro de `calcularDeudaAcumulada`). Con un padrón mucho mayor convendrá la liquidación en lote (paso 6).

## Decimonovena revisión del 12/11/2026: reenviar el recibo oficial y recibos ajenos

Corregido, con prueba en `tests/recibo-pdf.test.js` y `apps/client/tests/zonaDelDiaYRecibo.test.js`; comprobado en el navegador a 390 px en una copia de la demo:
- **No había cómo reenviar el recibo oficial** (con número R- y QR) después de un cobro sin señal, que entregó uno provisional, o si se perdió el WhatsApp. Ahora hay botón en Cobros recientes y en la cola sin señal (`GET /comprobantes/:id/recibo`).
- **Un cobrador bajaba recibos de cobros ajenos** por `GET /comprobantes/:id/pdf` (`staffOnly`, por número correlativo que se puede recorrer). Ahora solo los suyos, con 404.
- **El recibo armado de nuevo** decía "Huella: N/A", no avisaba si estaba anulado y no traía la fecha ISO del cobro (`buscarRecibo` solo daba `DD/MM/YYYY HH24:MI`, que el cliente no puede leer).
- **Cobros recientes en el celular:** las notas largas quedaban en una columna angosta de una palabra por línea; ahora van en su propio renglón con el botón debajo.

## Decimoctava revisión del 12/11/2026: el recibo de WhatsApp se puede verificar

Corregido, con prueba en `tests/api-seguridad.test.js` y `apps/client/tests/zonaDelDiaYRecibo.test.js`; comprobado en el navegador en una copia de la demo (el QR se lee desde la imagen con `html5-qrcode` y abre la página de verificación; tras anular el cobro dice "Recibo anulado"): el recibo que se manda por WhatsApp (ronda 16) no traía nada para comprobar que era auténtico, y una imagen se edita y se reenvía. Ahora lleva el QR y el enlace de verificación del PDF del portal. La fila de la huella interna se llama "Huella" para no confundirla con la verificación.

(Resuelto en la decimonovena revisión: se reenvía el recibo oficial desde Cobros recientes y desde la cola sin señal.)

## Decimoséptima revisión del 12/11/2026: tickets de hoy y cobrar sin marca previa

Corregidos, con prueba en `tests/zona-del-dia-y-por-puesto.test.js` y `apps/client/tests/zonaDelDiaYRecibo.test.js`; comprobado en el navegador a 390 px en una copia de la demo:
- **Tickets de hoy de más** (de la ronda 16): `puestos_hoy` contaba también el puesto marcado "faltó" y todos los puestos sin marca; se pedía S/ 3 a quien no salió, y a quien tiene 2 puestos se le sugerían 2 tickets que el servidor rechazaba porque el cobro marca un solo puesto. Ahora es lo que se cobra hoy; el cliente ya no vuelve a "uno por puesto" cuando da 0.
- **No se podía cobrar a quien paga por día sin el día marcado:** "Confirmar" se deshabilitaba con saldo 0 y el monto tenía tope en el saldo, aunque el servidor marca el día al cobrar. Ahora, en el mes en curso, se puede; el servidor valida.
- **"× N puestos" sin señal:** el paquete de jornada no traía `cantidad_puestos`.

## Decimosexta revisión del 12/11/2026: zona del día, cobro por puesto, baja sin señal y recibo por WhatsApp

Hecho, con prueba en `tests/zona-del-dia-y-por-puesto.test.js`, `tests/tickets.test.js` y `apps/client/tests/zonaDelDiaYRecibo.test.js` (migración 0031); comprobado por HTTP y en el navegador a 390 px en una copia de la demo:
- **Zona del día:** el cobrador elige la zona donde vende hoy; el día se cobra con su tarifa y su ticket (S2 o S3), y el administrador lo ve en Observaciones.
- **Cobro por puesto** desde noviembre de 2026, con `puestos_tenencia` para que un mes cerrado no cambie.
- **Baja y liberación de un puesto con señal débil:** se encolan como el alta, y reenviarlas responde "ya estaba dado de baja / ya estaba libre" en vez de un rechazo.
- **Recibo por WhatsApp** como imagen de celular; se quitó la impresión Bluetooth de la pantalla y la cola de impresión que la sondeaba cada 30 s. Los módulos `utils/bluetoothPrint.js`, `utils/offlinePrintQueue.js` y `hooks/useColaImpresion.js` se conservan sin uso por si vuelve la impresora; si no vuelve, se pueden borrar.

Prioridades que cambian:
- **Rendimiento:** el piloto es de 400 a 600 comerciantes en toda la feria (usuario, 12/11/2026). Ya se midió con 3051 y responde bien; la liquidación en lote deja de ser prioridad.
- **Papel del recibo:** fuera de alcance, no hay impresora térmica.

Queda: el tramo de cada puesto en `puestos_tenencia` empieza el 2026-11-01 para los que ya existían; lo cedido o liberado antes de la 0031 no se reconstruye (no cambia nada antes de noviembre, que sigue con un puesto).

## Decimoquinta revisión del 12/11/2026: deuda atrasada sin señal y DNI de un dado de baja

Corregidos:
- **Deuda atrasada sin señal** (prueba en `apps/client/tests/jornadaOffline.test.js`): `aplicarCobroLocal` bajaba la deuda vencida local en el monto entero del cobro de un mes atrasado. Pagar con S/ 10 un mes que debía S/ 4 dejaba la deuda en S/ 2, como si el mes siguiente también se hubiera pagado, hasta sincronizar. Ahora baja solo lo que se debía de ese mes; el exceso queda en ese mes, como en el servidor (que lo deja observado).
- **DNI de un dado de baja** (prueba en `tests/dni-de-dado-de-baja.test.js`): registrar en un comerciante el DNI/RUC de otro dado de baja respondía solo "El registro ya existe" (el UNIQUE de la base). Ahora `updateComerciante` responde 409 con el código del dado de baja (con el DNI oculto) para reactivarlo en vez de duplicar a la persona. Comprobado por HTTP en una copia de la demo.

Revisado sin hallazgos: la revisión de cobros observados, el estado de pago de los puestos en el mapa, la cola de cobros sin señal del celular y la edición de tarifas.

## Decimocuarta revisión del 12/11/2026: cobro sin señal con la hora mal

Corregido, con prueba en `tests/cobro-fecha-dudosa.test.js` (migración 0030): un cobro sin señal con la fecha del celular fuera de rango (futura o de más de 3 días) quedaba observado, pero `registrarCobro` marcaba igual la asistencia de ese día: un día cobrado de S/ 3 en un mes que no era, saltándose la ventana de 3 días de las marcas de la app. Comprobado por HTTP en una copia de la demo: un cobro fechado el 22/12 dejaba una marca futura; ahora no.

Vistos en esta revisión y resueltos en la decimoquinta: la deuda vencida local al pagar de más un mes atrasado y el mensaje del DNI de un dado de baja.

## Decimotercera revisión del 12/11/2026: reactivaciones del padrón

Corregido, con prueba en `tests/reactivacion-del-padron.test.js` (migración 0029): la importación del padrón reactivaba sin un registro por comerciante en la auditoría, la 0027 no pudo reconstruir esas reactivaciones y se cobraban sus meses de baja (en la copia de la demo, un reactivado tras una baja de julio debía S/ 990 en vez de S/ 900). La 0029 busca los huecos de la historia (una baja seguida de algo que no es baja) y fija la reactivación según la decisión del usuario (`reglas-negocio.md`). `ESTADO_EN_MES_SQL` ordena ahora por `desde, registrado_en, id`, porque una reactivación reparada puede caer el mismo día que el cambio siguiente con un id mayor.

Queda: una baja que no pasó por la API ni por el trigger (SQL a mano con el trigger desactivado) no se detecta; ningún camino de la aplicación da de baja sin registrarlo.

## Duodécima revisión del 11/11/2026: la recaudación cerrada no se mueve de zona

Corregido, con prueba en `tests/zona-rubro-de-cada-cobro.test.js` (migración 0028): el panel, los reportes y la proyección agrupaban cada cobro con la zona y el rubro de HOY; mover a un comerciante de zona pasaba su recaudación ya cerrada a la zona nueva y el filtro del reporte dejaba de traer sus cobros. Ahora cada cobro guarda esa foto en su fila. De paso, el conteo de comerciantes por zona del panel ya no incluye a los dados de baja.

Rendimiento (24 000 cobros, 3051 comerciantes): panel +9 %, reporte y proyección iguales dentro del ruido. Se probaron y midieron dos formas sin columna (función SQL por fila: proyección ×50; LATERAL con UNION: ×2) antes de elegir la foto en la fila, que es además el registro honesto de dónde se cobró.

## Undécima revisión del 11/11/2026: meses de baja

Corregido, con prueba en `tests/baja-de-cada-mes.test.js` (migración 0027): la cuota mensual se cobraba también los meses en que el comerciante estaba de baja. Dado de baja en julio y reactivado en noviembre, debía S/ 180 en vez de S/ 90; y uno de baja desde antes de este mes mostraba la cuota del mes. Los cambios de estado anteriores se reconstruyen de la auditoría (`ACTUALIZAR`, `DAR_DE_BAJA` y el alta que reactiva); un dado de baja sin rastro en la auditoría toma su `fecha_baja`.

(Resuelto el 12/11/2026 en la decimotercera revisión, migración 0029.) Antes: un comerciante reactivado por la importación del padrón antes de esta migración no tenía la reactivación en la auditoría; sus meses de baja se seguían cobrando.

## Décima revisión del 11/11/2026: revisión de un cobro anulado

Corregido, con prueba en `tests/anular-cobro-observado.test.js` (migración 0026): anular desde la lista de cobros un cobro sin señal que estaba en revisión dejaba la revisión pendiente para siempre. Anularla respondía 409 ("El cobro ya estaba anulado") y aceptarla dejaba como pago válido un cobro anulado. Ahora `anularCobro` cierra la revisión con el mismo motivo, y `resolveCobroObservado` no acepta un cobro anulado. La migración cierra las que ya estaban así.

## Novena revisión del 11/11/2026: rubro, zona y metros de cada mes

Corregido, con prueba en `tests/rubro-zona-metros-de-cada-mes.test.js` (migración 0025): cambiar el rubro o la zona de un comerciante, o los metros de un puesto, recalculaba los meses pasados. En la prueba, un mes pagado a S/ 30 pasaba a S/ 50. Medido con 3051 comerciantes, el recálculo del riesgo y el paquete de jornada tardan lo mismo que antes, porque los datos del mes salen en la consulta que ya se hacía por el tipo de comerciante.

Queda: el mes del cambio se liquida entero con los datos del día 1 cuando ya terminó, y con los de hoy mientras está en curso. Un cambio a mitad de mes no parte ese mes en dos tramos, salvo la zona del puesto y el tipo de vía, que van por día (0019 y 0021).

## Octava revisión del 11/11/2026: tarifas en el tiempo

Corregidos, con prueba en `tests/tarifa-de-cada-dia.test.js` y `tests/tarifas-http.test.js`:
- **Crear una tarifa con fecha pasada** recalculaba meses ya cobrados. Lo mismo se había bloqueado al editar en la tercera revisión.
- **Tarifa nueva "desde hoy"**: recién se aplicaba el mes siguiente, porque se buscaba la vigente el día 1.

## Séptima revisión del 11/11/2026: comerciantes sin tarifa vigente

Corregidos, con prueba en `tests/cobro-sin-tarifa.test.js`:
- **Cobro sin señal de un comerciante sin tarifa:** se rechazaba al sincronizar, y el dinero ya recibido quedaba fuera. Ahora queda observado (migración 0024).
- **Portal sin tarifa:** respondía 400 y el comerciante no veía sus recibos.
- **Portal:** un cobro observado sin revisar salía "Válido".

## Sexta revisión del 11/11/2026: el tipo de comerciante rige desde el cambio

Corregido, con prueba en `tests/tipo-comerciante-de-cada-mes.test.js`: cambiar el tipo de un comerciante recalculaba todos sus meses pasados. Pasar a eventual borraba la deuda atrasada (en la prueba, S/ 28 pasaban a S/ 0). Migración 0023.

(Resuelto en la novena revisión, migración 0025.) Antes: el **rubro**, la **zona del comerciante** y el **metraje actual del puesto** se leían con el valor de hoy al liquidar un mes pasado. Con las tarifas generales por día y tipo de vía (0013), la zona y el tipo de vía de cada día ya van en la marca (0019, 0021). Lo que queda solo afecta a tarifas mensuales, por rubro o por m², y al eventual.

## Quinta revisión del 11/11/2026: puestos sin señal y anulación

Corregidos, con prueba en `tests/puesto-idempotente.test.js`, `tests/anulacion-asistencia.test.js` y `tests/api-seguridad.test.js`:
- **Puesto duplicado al reenviar la cola del mapa:** si el alta llegaba pero la respuesta se perdía, el reenvío creaba otro puesto igual. Migración 0022 (`clave_cliente`).
- **Puesto perdido con señal débil:** el alta fallaba con "No se pudo conectar" y no pasaba a la cola. Ahora se encola.
- **Anular un cobro dejaba la asistencia que había puesto:** el comerciante seguía debiendo ese día.

Queda: la baja de un puesto con señal débil no se encola (es del super_admin, que trabaja con señal); un reenvío de una baja ya hecha saldría como rechazado en el aviso del mapa.

## Rediseño visual del Penpot (2026-10-28)

- **Tres capas de estilos.** `tema-municipal.css` es ahora la capa del rediseño (tokens, menú por grupos, tarjetas, píldoras). Debajo sigue `styles.css` (~4600 líneas) con reglas que el tema pisa. Limpiarlo es un trabajo aparte.
- **Tailwind sin uso.** `tailwind.config.js` tiene una paleta azul que no corresponde, y los `@apply` de `styles.css` (`.glass-card`, `.badge-*`) no se usan en ningún JSX. Se puede quitar Tailwind.
- **Pantallas del Penpot que no se hicieron:**
  - "Importar padrón" como página propia;
  - "Para atender" y "Recaudación por zona" en el Dashboard;
  - búsqueda global;
  - sesión de 30 días del portal y aviso de sesión vencida: el usuario decidió **no** guardar sesión (28/10/2026).

  Son funciones nuevas con reglas de negocio: hay que decidirlas antes.
- **Página pública (P1).** Solo tomó fuentes y colores; su estructura sigue siendo la de antes.

## Lo que se trajo y lo que no de `claude/gifted-mendel-9fxas5` (2026-10-28)

Esa rama de GitHub se separó de `main` el 15/10 y nunca se unió con esta. No se le hace merge: tiene otra estructura (`App.jsx`, `index.ts`), migraciones 0003–0006 que aquí son otras y tokens en `localStorage`. Se trajo a mano, en la rama `feature/carnet-llave`:

- **Carnet con llave del portal:** migración 0016, `emitirCarnets` e `ingresarAlPortal` con llave en `portalAcceso.js`, `MerchantCardDialog.jsx` y el portal con llave o QR. Sin sesión guardada; solo `super_admin` emite.
- **Libros Excel de prueba:** `datos-prueba/` y `apps/server/scripts/generar-padron-prueba.js`. Allá eran Python con `openpyxl`; aquí son Node con `exceljs`, sin "Fecha Feria" ni "Tarifa".
- **Skill `penpot-backend`**, con las rutas de `routes/`.
- **Confirmación del padrón en lote:** se trabaja en una sesión aparte.

Lo que **no** se trajo, para decidirlo aparte:

| Commit remoto | Por qué no |
|---|---|
| 54fe11c | Monto por zona por día de feria y `frecuencia_pago`: choca con el cobro por día marcado (0013) |
| 27bf9a6 | Ausente = falta de esa feria: aquí el ausente deja el puesto disponible |
| 45061dd, cd32230 | Varias tarifas por zona y `puestos_historial`: aquí el titular de cada día lo resuelve 0015 y la zona de cada día, 0019 |
| a35684d | Carnet desde Pagos: el usuario no lo quiere; el arreglo de búsqueda ya estaba aquí |

**Hallazgo al probar los libros (resuelto el 28/10/2026, migración 0018):** una zona que no existía en el Excel caía en la primera zona sin avisar, y la búsqueda aproximada mandaba "Barrio Alto Salcedo" a la zona "SALCEDO". Ahora la zona se busca exacta y el puesto queda marcado "zona por regularizar" (ver `reglas-negocio.md`). (Resuelto el 11/11/2026: los rubros también se buscan exactos; ver `reglas-negocio.md`.) (Resuelto el 28/10/2026: la ruta `PUT /puestos-mapa/:id` dejaba cambiar la zona también al cobrador; ahora solo `super_admin`, ver `seguridad.md`.)

## Orden de refactorización sugerido (de menor a mayor riesgo)

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
