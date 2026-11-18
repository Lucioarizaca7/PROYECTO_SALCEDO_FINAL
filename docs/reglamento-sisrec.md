# Reglamento de cobro de SISREC

Municipalidad del Centro Poblado de Salcedo · Oficina de Rentas

Versión del 14/11/2026. Este documento resume, sin términos técnicos, las reglas con las que el sistema SISREC cobra hoy. Sirve para que la Jefa de Rentas las valide y las firme.

- Solo incluye las reglas que **ya rigen** en el sistema.
- Las reglas propuestas y las decisiones pendientes están en `docs/plan-reglas-negocio.md`.
- El detalle para quien programa está en [Reglas de negocio](sisrec/references/reglas-negocio.md), con los mismos números.

## En pocas palabras

1. Se cobra **solo el día que el cobrador sale a cobrar**. Si un día no se cobra, ese día no se debe.
2. Cada puesto paga **el precio por día de la zona donde vende ese día**. Es igual para todos los rubros y no depende de los metros.
3. Una **zona** es un área donde todos pagan lo mismo. Si una feria tiene una parte asfaltada (S/ 3) y otra sin asfaltar (S/ 2), son dos zonas.
4. **Lo pasado no cambia:** un precio nuevo rige desde el día en que se pone.
5. **Nada se borra:** un cobro se anula con motivo, y todo cambio queda registrado con la persona que lo hizo.

## Padrón y puestos

| N.º | Regla | Responsable | Cómo se controla |
|---|---|---|---|
| RN-01 | Cada persona tiene un solo registro, identificado por su DNI o RUC. | Super administrador | El sistema rechaza un documento repetido, aunque sea de un dado de baja. |
| RN-02 | Un comerciante sin DNI se registra como pendiente de regularización y paga igual. | Super administrador | Lista de pendientes en Comerciantes. |
| RN-03 | Un comerciante no se borra: se da de baja. La baja anula su carnet y da de baja sus puestos. | Super administrador | Auditoría. |
| RN-04 | Un puesto pertenece a una zona. Solo el super administrador cambia la zona habitual de un puesto. | Super administrador | El servidor rechaza el cambio de otro rol. |
| RN-05 | Un puesto sin zona confirmada no tiene precio propio: para marcarlo o cobrarlo, el cobrador elige la zona donde vende ese día. | Cobrador | En línea el sistema no deja marcar ni cobrar sin la zona del día. Sin señal, el cobro queda observado. |
| RN-06 | El comerciante tiene una sola zona: la de su puesto principal. Solo se edita a mano la de quien no tiene puesto. | Sistema | La base la actualiza sola cuando cambia el puesto. |

## Zonas y precios

| N.º | Regla | Responsable | Cómo se controla |
|---|---|---|---|
| RN-10 | Una zona es un área donde todos pagan el mismo precio por día. No hay calles. | Super administrador | Pantalla Zonas. |
| RN-11 | Una feria con parte asfaltada y parte sin asfaltar se registra como dos zonas. | Super administrador | Explicación en la pantalla Zonas. |
| RN-12 | La zona nace con su precio. El tipo de vía lo sugiere: S/ 3 asfaltada, S/ 2 sin asfaltar. | Super administrador | El formulario lo propone; se puede cambiar. |
| RN-13 | Solo el super administrador fija o cambia un precio. | Super administrador | El servidor rechaza a otros roles. Auditoría. |
| RN-14 | Un precio nuevo rige desde hoy o después, nunca hacia atrás. Los días anteriores conservan su precio. | Sistema | El servidor rechaza una fecha pasada. |
| RN-15 | Cada precio nuevo lleva la norma que lo respalda (número de ordenanza o resolución). | Super administrador | El sistema no guarda un precio nuevo sin la norma. |
| RN-16 | Una zona sin precio no puede cobrar en línea. Sin señal, el cobro queda observado. | Sistema | Aviso en Tarifas. |

## Día cobrado

| N.º | Regla | Responsable | Cómo se controla |
|---|---|---|---|
| RN-20 | Se debe solo el día que el cobrador marcó o cobró. Sin día cobrado no hay deuda. | Cobrador | Marca de asistencia o cobro. |
| RN-21 | Cada puesto marcado paga su día. Dos puestos el mismo día son dos pagos. | Cobrador | Detalle por puesto en la liquidación. |
| RN-22 | Al cobrar a un comerciante con varios puestos, el cobrador marca cuáles abrieron ese día. Cada puesto marcado paga su día. | Cobrador | Pantalla de cobro; el servidor marca la asistencia de cada puesto con el cobro. |
| RN-23 | Si el comerciante vende ese día en otra zona, el cobrador elige la zona del día y se cobra ese precio. | Cobrador | Queda en Observaciones. |
| RN-24 | El cobrador marca hasta 3 días atrás. Más atrás, solo el super administrador. | Sistema | El servidor lo rechaza. Auditoría. |
| RN-25 | «No salió» no genera deuda. «No vendió» y «se negó a pagar» sí la generan. | Cobrador | Motivo obligatorio y coherente con la marca. |
| RN-26 | Antes de cerrar su caja, el cobrador ve los puestos que quedaron sin marcar en las zonas donde ese día ya marcó a otros, y los marca. | Cobrador | Lista «sin marcar hoy» en Cierre de caja. Avisa, no bloquea. |
| RN-27 | El comerciante puede reclamar un día marcado hasta 7 días después. Lo registra y lo resuelve el super administrador. Si procede un «no asistió», ese día deja de deberse. | Super administrador | Registro de reclamos en «Deuda y reclamos». Auditoría. |

## Cobro y comprobantes

| N.º | Regla | Responsable | Cómo se controla |
|---|---|---|---|
| RN-30 | Todo cobro genera un recibo con número correlativo. | Sistema | Automático. |
| RN-31 | Por cada puesto y día cobrado se entrega un ticket preimpreso del valor de ese día. | Cobrador | La suma de los tickets debe ser igual al monto. |
| RN-32 | Los talonarios los asigna solo el super administrador. | Super administrador | Lotes con rango único. |
| RN-33 | Un talonario perdido o robado se reporta el mismo día y el super administrador anula de una vez sus tickets disponibles, con motivo. | Cobrador y super administrador | Botón «Perdido o robado» en Tickets. Auditoría. |
| RN-34 | Solo se cobra en efectivo. No se acepta Yape, Plin ni POS. | Cobrador | El sistema rechaza cualquier otro medio. Un cobro digital guardado sin señal antes del cambio entra y queda observado. |
| RN-36 | Sin señal, el cobro se guarda en el celular y se envía después. Un conflicto queda observado, nunca se descarta. | Sistema | Revisión de cobros. |
| RN-37 | Un cobro no se borra: lo anula el super administrador con un motivo. | Super administrador | Auditoría. |
| RN-38 | Un super administrador anula solo un cobro de hoy cuya caja sigue abierta. Si el cobro es de otro día, o esa caja ya se cerró, uno pide la anulación y el otro super administrador la aprueba o la rechaza. | Super administrador titular y suplente | El sistema deja la anulación pendiente; nadie aprueba la que él mismo pidió. Auditoría. |

## Caja

| N.º | Regla | Responsable | Cómo se controla |
|---|---|---|---|
| RN-40 | El cobrador cierra su caja una vez por día y declara lo que tiene por método de pago. | Cobrador | El sistema calcula lo esperado y la diferencia. |
| RN-41 | La entrega del efectivo queda registrada: quién recibe, cuándo y cuánto. La registra el super administrador que lo recibe, nunca quien cerró esa caja. | Super administrador | Constancia de entrega ligada al cierre. Auditoría. |
| RN-42 | Todo faltante de caja se justifica por escrito al cerrar. Un sobrante, desde S/ 5. | Cobrador | El sistema no deja cerrar sin la justificación. |
| RN-43 | Un cierre no se edita. Un error se corrige con una rectificación del super administrador, con motivo. | Super administrador | Se conserva el cierre original. Auditoría. |
| RN-44 | Los cobros que llegan después del cierre se entregan aparte, como entrega complementaria. | Cobrador y super administrador | El sistema los separa y registra la entrega. |

## Deuda

| N.º | Regla | Responsable | Cómo se controla |
|---|---|---|---|
| RN-50 | La deuda es la suma de los días cobrados sin pagar, desde el inicio de cobro. | Sistema | Una sola fórmula para todo el sistema. |
| RN-51 | Un pago cancela primero el mes más antiguo. | Sistema | Automático. |
| RN-52 | El eventual no acumula deuda. | Sistema | Automático. |
| RN-53 | Quien debe un día cobrado desde hace 30 días o más recibe un aviso formal de deuda. La suspensión del puesto la decide la municipalidad, no el sistema. | Super administrador | Lista «avisos por emitir» y registro de cada aviso. |
| RN-54 | La deuda de meses pasados se da de baja solo con resolución, registrando su número. No hay fraccionamiento. Los días cobrados no se borran. | Super administrador | Registro de bajas con número de resolución. Auditoría. |

## Control y auditoría

| N.º | Regla | Responsable | Cómo se controla |
|---|---|---|---|
| RN-60 | El auditor solo consulta. No escribe en ninguna pantalla. | Sistema | Prueba automática de todas las rutas. |
| RN-61 | Hay dos super administradores: titular y suplente. Cada mes uno revisa lo que hizo el otro. | Gerencia | Memorando y auditoría. |
| RN-62 | Los reportes por zona cuentan cada cobro en la zona donde se vendió ese día. | Sistema | Automático. |
| RN-63 | Cada mes se revisa el reporte «cobros en otra zona» por cobrador. | Super administrador | Reporte en Reportes, para super administrador y auditor. |
| RN-64 | Cada cobrador tiene zonas asignadas. Cobrar fuera de ellas no se impide, pero queda señalado. Sin zonas asignadas, cobra en todas. | Super administrador | Asignación en Usuarios. Reporte «marcas fuera de las zonas asignadas». |

## Quién hace qué

| Rol | Quién es | Qué hace |
|---|---|---|
| Super administrador | Jefa de Rentas (titular) y su suplente | Hace todos los cambios: padrón, zonas, precios, talonarios, usuarios y anulaciones. |
| Cobrador | Personal de campo | Cobra, marca los días cobrados, entrega tickets y cierra su caja. |
| Auditor | Gerencia o alcaldía | Solo consulta: panel, reportes, caja y auditoría. No cambia nada. |
| Comerciante | Titular del puesto | Consulta su deuda y sus recibos con la llave de su carnet. |

## Conformidad

| | Nombre | Cargo | Firma | Fecha |
|---|---|---|---|---|
| Validado por | | Jefa de Rentas | | |
| Revisado por | | Gerencia | | |
