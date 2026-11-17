# Plan de reglas de negocio de SISREC

Fecha: 14/11/2026. Estado: **propuesta para revisar**. Nada de este plan está aplicado todavía, salvo lo que la columna «Estado» marca como vigente.

Este documento hace tres cosas:

1. Dice qué le falta a las reglas de negocio actuales (sección 2).
2. Propone un reglamento ordenado, hecho sobre el sistema que ya existe (sección 3).
3. Lista las decisiones que solo tú puedes tomar y un plan por etapas para aplicarlas (secciones 4 y 5).

Se basa en la lectura completa de `reglas-negocio.md`, en el código del servidor (cobro, caja, anulación, tickets, zonas) y en las decisiones tomadas hasta hoy.

---

## 1. Lo que ya está bien resuelto

Conviene no tocar estas reglas: están decididas, programadas y con pruebas.

| Tema | Regla vigente |
|---|---|
| Qué se cobra | Solo el día que el cobrador sale a cobrar. Sin día cobrado no hay deuda. |
| Cuánto se cobra | El precio por día de la zona donde se vende ese día. Igual para todos los rubros, sin metros. |
| Zona | Un área con un solo precio. No hay calles. La zona puede nacer con su precio (pendiente de unir). |
| Lo pasado no cambia | Un precio, una zona o un tipo nuevo rigen desde el día del cambio. Los días anteriores conservan lo suyo. |
| El dinero nunca se pierde | Un cobro sin señal con conflicto no se descarta: queda observado y va a revisión. |
| Nada se borra | Un cobro se anula con motivo y responsable. Un usuario se desactiva. Un comerciante se da de baja. |
| Sin duplicados | El mismo cobro enviado dos veces se registra una sola vez. |
| Rastro | Toda modificación queda en la auditoría, encadenada para detectar alteraciones. |
| Datos personales | El comerciante entra con la llave de su carnet. Los recibos no llevan DNI. |

---

## 2. Carencias de las reglas actuales

### 2.1. Carencias del documento

El contenido es bueno, pero el documento es difícil de usar.

| # | Carencia | Consecuencia |
|---|---|---|
| D1 | Mezcla la regla con el nombre de la función, la migración y la historia («antes hacía…»). | Solo lo entiende quien programa. La Jefa de Rentas no puede validarlo. |
| D2 | Las reglas no tienen número ni estado. | No se puede citar una regla ni saber si está vigente o fue reemplazada. |
| D3 | Reglas viejas conviven con las nuevas. Hoy corregimos cuatro frases que se contradecían. | Riesgo de programar sobre una regla que ya no rige. |
| D4 | No dice quién es responsable de cada regla ni cómo se controla que se cumpla. | Las reglas de organización (por ejemplo, titular y suplente) quedan sueltas. |
| D5 | Temas enteros no tienen sección propia: el cierre de caja aparece solo dentro de «Tickets». | Hay reglas que existen en el código y en ningún documento. |

### 2.2. Reglas que faltan

Son situaciones reales que hoy no tienen regla escrita. El sistema no hace nada, o hace algo que nadie decidió.

| # | Situación sin regla | Qué pasa hoy en el sistema |
|---|---|---|
| F1 | **Entrega del dinero.** A quién entrega el cobrador lo recaudado y con qué constancia. | El cierre de caja compara lo esperado con lo declarado y guarda la diferencia. No registra la entrega a tesorería ni quién recibió. |
| F2 | **Faltante o sobrante de caja.** Qué se hace cuando lo declarado no coincide. | La diferencia queda guardada. No hay tope, aviso, responsable ni seguimiento. |
| F3 | **Cierre mal hecho.** Cómo se corrige un cierre con un error. | Un cobrador cierra una sola vez por día. No existe reapertura ni corrección. |
| F4 | **Cobros que llegan después del cierre** (sincronizados tarde). | El sistema los muestra aparte. No hay regla sobre quién los revisa ni cómo se entregan. |
| F5 | **Yape, Plin y POS.** Quién comprueba que el pago llegó a la cuenta municipal. | Solo se exige el número de operación y que no se repita. Nadie lo concilia con el banco. |
| F6 | **Deuda antigua.** Fraccionamiento, tope, condonación, prescripción. | La deuda se acumula sin límite desde el inicio de cobro. |
| F7 | **Consecuencia de no pagar.** Qué pasa con quien acumula deuda o se niega a pagar. | «Se negó a pagar» genera deuda y sale en reportes. No hay aviso formal ni suspensión. |
| F8 | **Reclamo del comerciante.** «Ese día no vine» o «ya pagué». | No hay flujo de reclamo. Solo el super administrador puede corregir, sin plazo definido. |
| F9 | **Anulación.** Plazo, tope y devolución del dinero. | La anula el super administrador con un motivo. No hay plazo ni regla para un cobro de una caja ya cerrada. |
| F10 | **Supervisión del cobrador.** Puestos presentes que no se marcan. | Lo que no se marca no existe: no genera deuda ni alerta. |
| F11 | **Zona del día.** El cobrador decide si un día vale S/ 3 o S/ 2. | Queda en Observaciones. Los tickets por valor lo frenan, pero no hay reporte por cobrador. |
| F12 | **Talonario perdido o robado.** | Se pueden anular tickets uno por uno con motivo. No hay regla de denuncia ni de responsabilidad. |
| F13 | **Base legal del precio.** Qué ordenanza respalda cada precio. | El precio se registra con su fecha, sin referencia a la norma. |
| F14 | **Asignación de cobradores.** Qué cobrador cobra en qué zona. | Cualquier cobrador puede cobrar a cualquier comerciante. |
| F15 | **Conservación de datos personales** (Ley 29733). Cuánto tiempo se guardan los datos de un dado de baja. | Se guardan sin plazo. |

### 2.3. Reglas que no concuerdan entre sí

| # | Qué choca | Estado |
|---|---|---|
| C1 | Metraje «obligatorio sin tipo de vía» frente a «siempre opcional». | Corregido hoy. |
| C2 | Se seguía nombrando la «tarifa mensual», que ya no existe. | Corregido hoy. |
| C3 | «Solo el super administrador cambia la zona» frente a «el cobrador elige la zona del día». | Aclarado hoy: zona habitual frente a zona del día. |
| C4 | Los reportes por zona usaban la zona del comerciante, no la del día. | Corregido, pendiente de unir (migración 0033). |
| C5 | **Dos zonas por comerciante:** la suya y la de su puesto. La suya ya solo sirve para su código. | Pendiente. |
| C6 | **Tipo de comerciante:** ferial y permanente pagan exactamente igual. Solo el eventual se distingue. | Pendiente. |
| C7 | **Puesto sin zona confirmada:** el padrón lo pone en «la primera zona» y paga ese precio. | Pendiente. |
| C8 | **«Paga por cada puesto»** frente a «el cobro marca solo el puesto principal». | Pendiente. |
| C9 | Un mensaje de tickets todavía dice «no cobra por día cobrado con tipo de vía». | Pendiente (texto). |

---

## 3. Reglamento propuesto

Cada regla tiene un número, una frase clara, un responsable y la forma de controlarla. La columna «Estado» dice si ya rige.

- **Vigente:** ya está en el sistema.
- **Por unir:** está programada y probada, falta unirla a `main`.
- **Propuesta:** regla nueva de este plan. Necesita tu aprobación.
- **Decisión:** no puedo proponer un valor; depende de la municipalidad (sección 4).

### 3.1. Padrón y puestos

| N.º | Regla | Responsable | Control | Estado |
|---|---|---|---|---|
| RN-01 | Cada persona tiene un solo registro, identificado por su DNI o RUC. | Super administrador | El sistema rechaza un documento repetido, aunque sea de un dado de baja. | Vigente |
| RN-02 | Un comerciante sin DNI se registra como «pendiente de regularización» y paga igual. | Super administrador | Lista de pendientes en Comerciantes. | Vigente |
| RN-03 | Un comerciante no se borra: se da de baja. La baja anula su carnet y da de baja sus puestos. | Super administrador | Auditoría. | Vigente |
| RN-04 | Un puesto pertenece a una zona. Solo el super administrador cambia la zona habitual de un puesto. | Super administrador | El servidor rechaza el cambio de otro rol. | Vigente |
| RN-05 | Un puesto sin zona confirmada **no tiene precio** hasta que el super administrador le asigne zona. | Super administrador | El mapa lo muestra como «zona sin precio». | Propuesta (C7) |
| RN-06 | El comerciante tiene una sola zona de referencia: la de su puesto principal. | Sistema | Se calcula; no se edita aparte. | Propuesta (C5) |
| RN-07 | Hay dos tipos de comerciante: **con puesto** (acumula deuda por sus días cobrados) y **eventual** (paga el día que se le encuentra y no acumula). | Super administrador | Campo tipo en Comerciantes. | Propuesta (C6) |

### 3.2. Zonas y precios

| N.º | Regla | Responsable | Control | Estado |
|---|---|---|---|---|
| RN-10 | Una zona es un área donde todos pagan el mismo precio por día. No hay calles. | Super administrador | Pantalla Zonas. | Vigente |
| RN-11 | Una feria con parte asfaltada y parte sin asfaltar se registra como dos zonas. | Super administrador | Explicación en la pantalla Zonas. | Vigente |
| RN-12 | La zona nace con su precio. El tipo de vía lo sugiere: S/ 3 asfaltada, S/ 2 sin asfaltar. | Super administrador | El formulario lo propone; se puede cambiar. | Por unir |
| RN-13 | Solo el super administrador fija o cambia un precio. | Super administrador | El servidor rechaza a otros roles. Auditoría. | Vigente |
| RN-14 | Un precio nuevo rige desde hoy o después, nunca hacia atrás. Los días anteriores conservan su precio. | Sistema | El servidor rechaza una fecha pasada. | Vigente |
| RN-15 | Cada precio lleva la norma que lo respalda (número de ordenanza o resolución). | Super administrador | Campo obligatorio al fijar el precio. | Propuesta (F13) |
| RN-16 | Una zona sin precio no puede cobrar en línea. Sin señal, el cobro queda observado. | Sistema | Aviso en Tarifas: «N zonas no tienen precio». | Vigente |

### 3.3. Día cobrado

| N.º | Regla | Responsable | Control | Estado |
|---|---|---|---|---|
| RN-20 | Se debe solo el día que el cobrador marcó o cobró. Sin día cobrado no hay deuda. | Cobrador | Marca de asistencia o cobro. | Vigente |
| RN-21 | Cada puesto marcado paga su día. Dos puestos el mismo día son dos pagos. | Cobrador | Detalle por puesto en la liquidación. | Vigente |
| RN-22 | Al cobrar, el cobrador marca **todos** los puestos del comerciante presentes ese día en un solo paso. | Cobrador | Pantalla de cobro. | Propuesta (C8) |
| RN-23 | Si el comerciante vende ese día en otra zona, el cobrador elige la zona del día y se cobra ese precio. | Cobrador | Queda en Observaciones. | Vigente |
| RN-24 | El cobrador marca hasta 3 días atrás. Más atrás, solo el super administrador. | Sistema | El servidor lo rechaza. Auditoría. | Vigente |
| RN-25 | «No salió» no genera deuda. «No vendió» y «se negó a pagar» sí la generan. | Cobrador | Motivo obligatorio y coherente con la marca. | Vigente |
| RN-26 | Al cerrar la jornada, el cobrador ve los puestos de su zona que quedaron sin marcar y confirma el motivo. | Cobrador | Lista «sin marcar hoy» antes del cierre de caja. | Propuesta (F10) |
| RN-27 | Un comerciante puede reclamar un día marcado dentro de un plazo. Lo resuelve el super administrador y queda en la auditoría. | Super administrador | Registro de reclamos. | Decisión (F8) |

### 3.4. Cobro y comprobantes

| N.º | Regla | Responsable | Control | Estado |
|---|---|---|---|---|
| RN-30 | Todo cobro genera un recibo con número correlativo. | Sistema | Automático. | Vigente |
| RN-31 | Por cada puesto y día cobrado se entrega un ticket preimpreso del valor de ese día. | Cobrador | La suma de los tickets debe ser igual al monto. | Vigente |
| RN-32 | Los talonarios los asigna solo el super administrador. | Super administrador | Lotes con rango único. | Vigente |
| RN-33 | Un talonario perdido o robado se reporta el mismo día y sus tickets disponibles se anulan en bloque. | Cobrador y super administrador | Anulación por lote con motivo. | Propuesta (F12) |
| RN-34 | Yape, Plin y POS exigen número de operación, único por método. | Cobrador | El sistema rechaza un número repetido. | Vigente |
| RN-35 | Cada pago por Yape, Plin o POS se concilia con el estado de la cuenta municipal. | Tesorería | Marca «conciliado» por cobro. Reporte de no conciliados. | Propuesta (F5) |
| RN-36 | Sin señal, el cobro se guarda en el celular y se envía después. Un conflicto queda observado, nunca se descarta. | Sistema | Revisión de cobros. | Vigente |
| RN-37 | Un cobro no se borra: lo anula el super administrador con un motivo. | Super administrador | Auditoría. | Vigente |
| RN-38 | La anulación tiene plazo. Fuera de plazo, o si la caja de ese día ya se entregó, necesita una segunda aprobación. | Super administrador titular y suplente | Plazo y doble firma. | Decisión (F9) |

### 3.5. Caja y entrega del dinero

| N.º | Regla | Responsable | Control | Estado |
|---|---|---|---|---|
| RN-40 | El cobrador cierra su caja una vez por día y declara lo que tiene por método de pago. | Cobrador | El sistema calcula lo esperado y la diferencia. | Vigente |
| RN-41 | La entrega del dinero queda registrada: quién recibe, cuándo y cuánto. | Tesorería | Constancia de entrega ligada al cierre. | Propuesta (F1) |
| RN-42 | Una diferencia de caja mayor que el tope se justifica por escrito y la revisa el super administrador. | Super administrador | Alerta en el cierre y lista de diferencias. | Decisión (F2) |
| RN-43 | Un cierre no se edita. Se corrige con una rectificación del super administrador, con motivo. | Super administrador | Auditoría. | Propuesta (F3) |
| RN-44 | Los cobros que llegan después del cierre forman una entrega complementaria. | Cobrador y tesorería | El sistema ya los separa. | Propuesta (F4) |

### 3.6. Deuda

| N.º | Regla | Responsable | Control | Estado |
|---|---|---|---|---|
| RN-50 | La deuda es la suma de los días cobrados sin pagar, desde el inicio de cobro. | Sistema | Una sola fórmula para todo el sistema. | Vigente |
| RN-51 | Un pago cancela primero el mes más antiguo. | Sistema | Automático. | Vigente |
| RN-52 | El eventual no acumula deuda. | Sistema | Automático. | Vigente |
| RN-53 | Desde cierto monto o antigüedad de deuda, el sistema emite un aviso formal al comerciante. | Super administrador | Lista de avisos pendientes. | Decisión (F7) |
| RN-54 | La deuda antigua se puede fraccionar o dar de baja solo con resolución, registrada en el sistema. | Super administrador | Registro con número de resolución. | Decisión (F6) |

### 3.7. Control y auditoría

| N.º | Regla | Responsable | Control | Estado |
|---|---|---|---|---|
| RN-60 | El auditor solo consulta. No escribe en ninguna pantalla. | Sistema | Prueba automática de todas las rutas. | Vigente |
| RN-61 | Hay dos super administradores: titular y suplente. Cada mes uno revisa lo que hizo el otro. | Gerencia | Memorando y auditoría. | Vigente |
| RN-62 | Los reportes por zona cuentan cada cobro en la zona donde se vendió ese día. | Sistema | Automático. | Por unir |
| RN-63 | Cada mes se revisa el reporte «cobros en otra zona» por cobrador. | Super administrador | Reporte nuevo. | Propuesta (F11) |
| RN-64 | Cada cobrador tiene zonas asignadas. Cobrar fuera de ellas queda marcado. | Super administrador | Asignación de zonas por cobrador. | Decisión (F14) |
| RN-65 | Los datos personales de un dado de baja se conservan un plazo definido y después se anonimizan. | Gerencia | Tarea periódica. | Decisión (F15) |

---

## 4. Decisiones que necesito de ti

Son valores o criterios de la municipalidad. No los puedo inventar. Para cada una doy una recomendación.

| # | Pregunta | Recomendación |
|---|---|---|
| 1 | ¿A quién entrega el cobrador el dinero y con qué documento? | Registrar en el sistema quién recibe y el monto; la constancia se imprime o se envía por WhatsApp. |
| 2 | ¿Desde qué diferencia de caja se exige justificación? | Cualquier faltante, y sobrantes de S/ 5 o más. |
| 3 | ¿Quién concilia Yape, Plin y POS, y cada cuánto? | Tesorería, una vez por semana, con el estado de cuenta. |
| 4 | ¿Hasta cuántos días después se puede anular un cobro sin segunda aprobación? | El mismo día o hasta el cierre de caja. Después, con el visto bueno del suplente. |
| 5 | ¿Qué pasa con quien acumula deuda? ¿Desde cuánto se le avisa? | Aviso formal al mes de deuda. La suspensión del puesto la decide la municipalidad, no el sistema. |
| 6 | ¿Se permite fraccionar o dar de baja deuda antigua? ¿Con qué documento? | Solo con resolución, registrando su número. |
| 7 | ¿El comerciante puede reclamar un día marcado? ¿En cuántos días? | Sí, hasta 7 días después, ante el super administrador. |
| 8 | ¿Cada cobrador tiene zonas fijas? | Sí, si hay más de un cobrador. Si es uno solo, no hace falta. |
| 9 | ¿Ferial y permanente son distintos para algo fuera del cobro (permisos, padrón)? | Si no lo son, unirlos en «con puesto». |
| 10 | ¿Qué ordenanza respalda S/ 3 y S/ 2? | Registrar su número en cada precio. |
| 11 | ¿Cuánto tiempo se guardan los datos de un dado de baja? | El plazo que indique el área legal; mientras tanto, no borrar nada. |

---

## 5. Plan por etapas

Cada etapa se puede aprobar y unir por separado. El orden va de lo más barato y seguro a lo más grande.

### Etapa 0. Ordenar el documento (sin tocar el sistema)

- Reescribir `reglas-negocio.md` con el formato de la sección 3: número, regla, responsable, control y estado.
- Pasar los detalles técnicos (funciones, migraciones, historia) a un anexo para quien programa.
- Sacar una versión corta, sin términos técnicos, para que la Jefa de Rentas la valide y firme.
- Resuelve: D1 a D5 y C9.

### Etapa 1. Controles que no cambian cómo se cobra

- Reporte «cobros en otra zona» por cobrador (RN-63). **Hecho el 15/11/2026.**
- Lista «puestos sin marcar hoy» antes del cierre (RN-26). **Hecho el 15/11/2026**, como aviso que no bloquea; solo en las zonas donde ese día ya se marcó a alguien.
- Unir lo que ya está hecho: reportes por zona del día (RN-62) y precio al crear la zona (RN-12).
- Riesgo: bajo. Son consultas y avisos; no cambian montos.

### Etapa 2. Caja y dinero

- Constancia de entrega del dinero (RN-41) y entrega complementaria (RN-44). **Hecho el 15/11/2026**: la registra el super administrador que recibe.
- Tope y justificación de diferencias (RN-42), rectificación de cierre (RN-43). **Hecho el 15/11/2026**: todo faltante y sobrantes desde S/ 5.
- Conciliación de Yape, Plin y POS (RN-35). **Pendiente**: se dejó para después (decisión del 15/11/2026).
- Necesita las decisiones 1, 2 y 3. Pide migraciones nuevas y una pantalla para tesorería.

### Etapa 3. Deuda, anulaciones y reclamos

- Plazo y doble aprobación de anulaciones (RN-38). **Hecho el 15/11/2026**: directo solo el mismo día y con la caja abierta; después, la aprueba el otro super administrador.
- Avisos formales de deuda (RN-53) y baja con resolución (RN-54). **Hecho el 15/11/2026**: aviso a los 30 días del día impago más antiguo; solo baja, sin fraccionamiento (**pendiente** por decisión).
- Reclamo de un día marcado (RN-27). **Hecho el 15/11/2026**: hasta 7 días después, ante el super administrador.
- Necesita las decisiones 4, 5, 6 y 7.

### Etapa 4. Simplificar el modelo

- Marcar y cobrar todos los puestos en un paso (RN-22). **Hecho el 16/11/2026**: el cobrador elige en la pantalla de cobro qué puestos abrieron.
- Puesto sin zona confirmada sin precio (RN-05). **Hecho el 16/11/2026**: pide la zona del día.
- Una sola zona de referencia por comerciante (RN-06). **Hecho el 16/11/2026**. Dos tipos de comerciante (RN-07): **no se hace**, se mantienen los tres (decisión del 15/11/2026).
- Norma legal en cada precio (RN-15), talonario perdido (RN-33), zonas por cobrador (RN-64). **Hecho el 16/11/2026**: norma obligatoria en precios nuevos; las zonas del cobrador solo avisan.
- Riesgo: medio. Cambia pantallas de cobro y datos del padrón; necesita las decisiones 8, 9 y 10.

### Qué recomiendo aprobar primero

1. **Etapa 0**, porque todo lo demás se apoya en un reglamento que se pueda leer y firmar.
2. **Etapa 1**, porque da control sin riesgo y la mitad ya está programada.
3. **Etapa 2**, porque es el vacío más serio: hoy el sistema sabe cuánto se cobró, pero no registra que el dinero llegó a la municipalidad.
