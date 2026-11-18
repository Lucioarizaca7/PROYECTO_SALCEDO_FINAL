# Pruebas de Zonas y tarifas

Ejecución del 18 de noviembre de 2026 sobre la pantalla unificada. La copia local incluía el commit `1476261` de la rama de corrección, con cinco pruebas de cliente adicionales respecto a `main`. Las pruebas de navegador y API usaron una instancia local desechable de PostgreSQL 16 con datos de demostración. El navegador fue Chromium integrado con controles Playwright.

## Resultado automatizado

| Comando | Resultado |
| --- | --- |
| `npm test --workspace apps/server` | 293 aprobadas, 0 fallidas, 0 omitidas. |
| `node --test apps/client/tests/*.test.js` | 109 aprobadas, 0 fallidas, 0 omitidas. |
| `npm run build` | Compilación de la API y el cliente completada. |

Las pruebas del [cliente](../../apps/client/tests/tarifasPorZona.test.js) cubren los estados Vigente, Programada, Finalizada e Inactiva, incluidas las fechas límite. Las pruebas de [navegación](../../apps/client/tests/navegacion.test.js) cubren la entrada única, el enlace anterior y los roles que pueden abrirlo. La suite del servidor incluye creación de zonas, vigencia de precios, conflictos de fechas, permisos y liquidaciones.

## Pruebas en navegador

Para repetir el recorrido, inicia la API y el cliente con la configuración de una base de demostración como indica la [guía de desarrollo](../sisrec/guia-desarrollo.md). Genera nombres distintos para las zonas de cada ejecución. Elige una fecha futura en hora de Lima para el precio programado.

| Caso | Cómo se probó | Resultado observado |
| --- | --- | --- |
| Entrada única y enlace anterior | Abrir `/tarifas` sin sesión e iniciar sesión como superadministrador. | La aplicación abrió `/zonas` y el menú mostró una sola entrada **Zonas y tarifas**. |
| Alta sin precio | Crear una zona con **Nueva zona**, dejar vacío el precio inicial y guardar. Luego usar **Poner precio** para registrar S/ 2.00 y su norma. | La fila mostró **Sin precio vigente** primero y S/ 2.00 después de registrar el precio. |
| Alta con precio | Crear **QA Avenida**, seleccionar **Asfaltada** y guardar con el precio sugerido de S/ 3.00 y una norma de prueba. | La lista mostró S/ 3.00 como precio vigente y el precio apareció en el historial. |
| Edición de la zona | Cambiar **QA Avenida** a **Sin asfaltar** desde **Editar zona**. | Cambió el tipo de vía y el precio vigente siguió en S/ 3.00. |
| Programación y conflicto | Usar **Cambiar precio**. Intentar primero guardar S/ 4.00 con la misma fecha de inicio que el precio vigente. Después seleccionar el 20 de noviembre y guardar. | La aplicación rechazó la fecha duplicada. S/ 3.00 permaneció **Vigente** hasta el 19 de noviembre. S/ 4.00 quedó **Programada** desde el día 20. |
| Historial y persistencia | Abrir **Ver historial** e **Historial general**. Recargar la página y volver a abrir el historial de la zona. | Se pudo consultar el historial de una zona y el general. El precio y su programación persistieron tras recargar. |
| Inicio de cobro general | Guardar el mes de **Inicio de cobro general** desde su sección. | El parámetro se guardó desde su propio formulario. |
| Acceso del auditor | Abrir `/tarifas` como auditor, entrar a la pantalla unificada y consultar el historial. | El enlace redirigió a `/zonas`. El historial estuvo disponible y la pantalla omitió los controles de creación, edición y guardado. |
| Acceso del cobrador | Buscar la entrada en el menú y abrir `/zonas` y `/tarifas` directamente como cobrador. | El menú omitió la entrada. Ambos enlaces devolvieron al panel. |
| Teclado y ancho móvil | Abrir un editor, cancelar y revisar el foco. Inspeccionar la pantalla en un viewport de 390 × 844 px. | El foco entró al editor y volvió a la acción que lo abrió al cancelar. La página no tuvo desbordamiento horizontal. La tabla conservó su desplazamiento interno. |

## Comprobaciones por API

| Caso | Resultado observado |
| --- | --- |
| Eliminar una zona sin vínculos como superadministrador | El alta devolvió HTTP 201, la eliminación HTTP 200 y la siguiente consulta confirmó que la zona ya no aparecía. |
| Eliminar una zona con vínculos como superadministrador | El intento sobre **Mercado Central** de demostración devolvió HTTP 409. La zona permaneció en el catálogo. |
| Consultar y editar como auditor | Las consultas de zonas, tarifas y parámetros devolvieron HTTP 200. Los tres intentos de actualización correspondientes devolvieron HTTP 403. |
