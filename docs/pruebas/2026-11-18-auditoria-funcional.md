# Auditoría funcional de SISREC

- Fecha de ejecución: 18 de noviembre de 2026 (hora de Lima).
- Versión evaluada: [`57e907a`](https://github.com/Lucioarizaca7/PROYECTO_SALCEDO_FINAL/commit/57e907afba67e60be3e8db7bcd732edb2cc4e5d6), en `main` al momento de la prueba.
- Entorno: copia aislada, PostgreSQL 16 con datos de demostración y compilación del cliente. El recorrido manual se hizo con Chromium en el navegador integrado y controles Playwright.

## Resultados automatizados

| Comando | Resultado |
| --- | --- |
| `npm ci` | Instalación correcta. |
| `npm run build` | API y cliente compilados. Vite generó el service worker. |
| `npm test` | 293 pruebas del servidor y 100 del cliente aprobadas. Cero fallos y cero omitidas. |

Estos resultados corresponden a la versión evaluada. El flujo [SISREC CI](../../.github/workflows/sisrec-ci.yml) ejecuta las pruebas con Node.js 22 y una instancia desechable de PostgreSQL 16.

## Recorrido en navegador

| Caso | Acción y resultado observado |
| --- | --- |
| Acceso y permisos | Un intento con contraseña incorrecta mostró el rechazo. Administrador y cobrador pudieron iniciar sesión. El visitante que abrió Reportes regresó a esa pantalla después de autenticarse. El cobrador que abrió Usuarios fue redirigido al panel. |
| Asistencia | El cobrador marcó la asistencia de un comerciante de demostración. La marca pasó de pendiente a sincronizada. |
| Cobro y recibo | El pago demo de S/ 3.00 en efectivo generó un comprobante. El enlace de verificación pública mostró el mismo monto y estado «Válido». |
| Caja | La caja detectó un cobro por S/ 3.00. Al declarar el mismo importe, quedó cerrada con diferencia cero y entrega pendiente. |
| Portal del comerciante | El portal rechazó una llave ficticia. Tras emitir un carnet de demostración, el portal mostró el pago y su recibo. |
| Cadena de auditoría | La verificación informó cinco registros enlazados y cadena íntegra. |
| Mapa | Un puesto de demostración apareció en el mapa. Se comprobó el cambio de 2.5D a 2D. |
| Ancho móvil | Cobros, Mapa y Caja quedaron dentro del ancho del documento en un viewport configurado a 390 px. |

## Hallazgos reproducidos en la versión evaluada

| Caso | Pasos | Observado | Resultado esperado |
| --- | --- | --- | --- |
| Total pagado después de un cobro | Buscar un comerciante demo. Registrar un pago en efectivo. Comparar la liquidación y el recibo antes de repetir la búsqueda. | El recibo mostró S/ 3.00 y la liquidación mantuvo «Pagado S/ 0.00» hasta buscar otra vez. | La liquidación refleja el pago en pantalla al confirmarse. |
| Teclado en el menú móvil | Usar un viewport de 390 px. Con el menú cerrado, enfocar «Abrir menú» y pulsar Mayús+Tab. Abrir el menú, enfocar un enlace y pulsar Escape. | El foco entró en el menú cerrado y quedó fuera de pantalla. Escape dejó abierto el menú. | El menú cerrado queda fuera del orden de tabulación. Escape lo cierra y devuelve el foco al botón. |
| Mensaje de acceso | Enviar el formulario con una contraseña incorrecta e inspeccionar el mensaje y el foco. | «Credenciales inválidas» carecía de alerta o región dinámica. El foco seguía en el botón de ingreso. | El error se anuncia de forma accesible y el foco permite corregir la entrada. |

El commit [`1476261` de la rama de corrección](https://github.com/Lucioarizaca7/PROYECTO_SALCEDO_FINAL/commit/1476261bd47a23acaf1778fe1f06e08b5d2b1430) incorpora cambios para los tres hallazgos. La repetición de estos tres casos en navegador sobre ese commit queda pendiente en este registro.

## Alcance y próximas ejecuciones

Quedaron pendientes el corte y la recuperación de red en navegador, la cámara QR, WhatsApp, la impresión física y la comprobación en producción. La analítica externa quedó fuera del entorno local.

Para repetir el recorrido, usa una instancia de PostgreSQL de prueba, instala dependencias con `npm ci`, ejecuta `npm run build` y `npm test`, e inicia la API y el cliente con la configuración de esa instancia. La [guía de desarrollo](../sisrec/guia-desarrollo.md) describe el entorno y el esquema de pruebas.

Para registrar otra ejecución, anota la fecha, el commit, el entorno, los pasos, el resultado esperado y el observado. Incluye las pruebas automatizadas nuevas en el mismo PR que su cambio, cuando corresponda. Usa datos de demostración en las evidencias que se publiquen.
