# Guía de prueba manual — Fase 2: trabajo en campo y offline

Esta guía cubre lo que las pruebas automáticas no pueden hacer: la impresora térmica real y los celulares de los cobradores en modo avión. Lo demás (cola offline, lote, sesión de 12 h, revisión manual) ya lo comprueba `npm test`.

Anota el resultado de cada paso en la tabla del final. Si un paso falla, apunta el modelo de celular, la versión de Chrome y una captura.

## Qué hace falta

| Recurso | Detalle |
|---|---|
| Servidor de pruebas con HTTPS | `docker-compose.prod.yml` con Caddy y dominio propio. Sin HTTPS no funcionan el Service Worker, la instalación, el GPS ni el Bluetooth. `http://192.168.x.x` **no sirve**. |
| 2 celulares Android | Los de los cobradores, con Chrome actualizado. En iPhone no existe Web Bluetooth: allí el recibo se comparte por WhatsApp. |
| Impresora térmica de 58 mm | Bluetooth LE con comandos ESC/POS (servicio `ffe0`, `18f0` o `1200`). Papel cargado y batería llena. |
| Cuentas | Una cuenta de cobrador por celular y una de administrador (en una PC). |
| Padrón | Al menos 30 comerciantes activos con saldo en el periodo actual. |
| Acceso a la base | Para las consultas de verificación: `docker compose -f docker-compose.prod.yml exec postgres psql -U sisrec sisrec` |

## A. Instalar la app en Android

1. En Chrome, abre `https://<tu-dominio>`.
2. Espera el aviso **"Instala SISREC en este celular…"** y pulsa **Instalar** (o menú ⋮ → *Instalar aplicación*).
3. Comprueba que en la pantalla de inicio aparece el ícono azul con la **S** y que, al abrirlo, la app ocupa toda la pantalla sin barra de direcciones.
4. Con la app abierta, activa el **modo avión** y ciérrala por completo. Ábrela de nuevo: debe cargar la pantalla de inicio (sin señal).

**Esperado:** se instala, el ícono no queda recortado y abre sin señal.

## B. Iniciar la jornada

1. Con señal, ingresa con la cuenta de cobrador.
2. Ve a **Cobro rápido**. En el panel **Jornada sin señal** debe decir *"Padrón del … · N comerciantes · periodo AAAA-MM"* y la etiqueta **Listo para hoy**. Si no, pulsa **Descargar padrón y tarifas**.
3. Activa el modo avión. Busca un comerciante por DNI, por código (`CM-001`), por puesto (`S-001`) y por parte del nombre sin tildes.

**Esperado:** aparece la franja amarilla *"Sin señal…"*, cada búsqueda encuentra al comerciante y muestra su saldo del padrón.

## C. Impresora térmica de 58 mm (con cada celular)

1. Enciende la impresora. Con señal, haz un cobro pequeño (S/ 1.00) y pulsa **Imprimir térmica / PDF**.
2. La primera vez Chrome pide elegir el dispositivo Bluetooth: elige la impresora.
3. Revisa el papel:
   - encabezado *MUNI SALCEDO* centrado y *RECIBO DE PAGO*;
   - número `R-000123`, fecha, comerciante, concepto, método, monto y hash;
   - las tildes y la ñ (*Liquidación*, *Método*, *Ñuñoa*). **Si salen símbolos raros, anótalo**: hay que configurar la página de códigos de la impresora (ESC t) en una fase posterior;
   - que ninguna línea se corte a la mitad (58 mm ≈ 32 caracteres) y que el papel avance y se corte al final.
4. Haz un segundo cobro: debe imprimir sin volver a pedir la impresora.
5. En modo avión, haz un cobro e imprime: el papel debe decir **RECIBO PROVISIONAL** y un número `PROV-XXXXXXXX`.
6. Apaga la impresora e intenta imprimir: la app no debe colgarse; el recibo queda en la cola de impresión y sale al volver a encenderla con la app abierta.

## D. 30 cobros en modo avión

Hazlo con los dos celulares a la vez, 15 cobros cada uno, en comerciantes distintos.

1. Con señal, inicia sesión y descarga el padrón (paso B). Anota la hora.
2. Activa el **modo avión**.
3. Registra **15 cobros por celular**: mezcla efectivo (12) y Yape/Plin con código de operación inventado pero único (3). Usa montos pequeños y apunta cada uno en una hoja (comerciante, monto, método).
4. Después de cada cobro comprueba:
   - el mensaje *"…el cobro quedó guardado en el celular…"* y el recibo provisional;
   - que el saldo del comerciante baja en pantalla;
   - que el contador de la barra superior sube (*"N pendientes"*).
5. **Cierra la app por completo** y vuelve a abrirla en modo avión: los 15 cobros siguen en **Cobros sin enviar** como *Pendiente*.
6. Desactiva el modo avión. En menos de un minuto la cola debe sincronizarse sola (o pulsa **Sincronizar ahora**). Cada cobro pasa a **Sincronizado** con su número `R-…`.
7. **Prueba de corte:** repite 5 cobros más en modo avión, desactívalo y, apenas empiece *"Sincronizando…"*, vuelve a activar el modo avión. Luego desactívalo de nuevo. Ningún cobro debe quedar duplicado ni perdido.

Verifica en la base (cambia la fecha y los ids):

```sql
-- Cobros de hoy por cobrador: deben coincidir con la hoja (cantidad y suma)
SELECT u.nombre, COUNT(*) AS cobros, SUM(t.monto) AS total
FROM transacciones t JOIN usuarios u ON u.id = t.cobrador_id
WHERE (t.fecha_cobro_cliente AT TIME ZONE 'America/Lima')::date = DATE '2026-11-10'
GROUP BY u.nombre;

-- Duplicados: debe devolver 0 filas
SELECT comerciante_id, monto, fecha_cobro_cliente, COUNT(*)
FROM transacciones
WHERE (fecha_cobro_cliente AT TIME ZONE 'America/Lima')::date = DATE '2026-11-10'
GROUP BY 1, 2, 3 HAVING COUNT(*) > 1;

-- Lo que llegó de cada celular y en qué estado
SELECT device_id, estado, COUNT(*) FROM colas_sincronizacion GROUP BY 1, 2 ORDER BY 1, 2;
```

**Esperado:** 30 (+5) cobros, ninguno duplicado, ninguno en *error*, y la hora de cada cobro es la del celular (no la de sincronización).

## E. Cobro que excede el saldo (revisión manual)

1. Elige un comerciante con saldo S/ X. Con los dos celulares en modo avión, cobra **el saldo completo en ambos**.
2. Desactiva el modo avión en los dos.
3. Uno queda *Sincronizado*; el otro, *Sincronizado · en revisión* (no se rechaza: el dinero ya se cobró).
4. En la PC, como administrador, abre **Revisión de cobros → Por revisar**: aparece el cobro con el motivo *"…excede el saldo pendiente…"*.
5. Escribe un motivo y pulsa **Aceptar** (o **Anular** si se devolverá el dinero). Debe pasar a la pestaña correspondiente y quedar en **Auditoría**.
6. Repite con un comerciante dado de baja después de descargar el padrón: ese cobro debe quedar en **Error** en el celular (botón *Reintentar*) y en la pestaña **Rechazados** del panel.

## F. Sesión de 12 horas por dispositivo

1. Inicia sesión en el celular y deja la app sin usar **más de 15 minutos** (lo que dura el token de acceso).
2. Vuelve a usarla (buscar, cobrar): **no debe pedir la clave**.
3. En la PC, como administrador, abre **Dispositivos**: aparece el celular (*Android · Chrome*), con su último uso y la hora en que vence (12 h después del ingreso).
4. Con un cobro pendiente en el celular (modo avión), pulsa **Revocar** en la PC. Desactiva el modo avión en el celular.
5. **Esperado:** el celular pide ingresar de nuevo con el aviso de que los cobros sin enviar se conservan; tras ingresar, el cobro pendiente se sincroniza.

## G. Nueva versión

1. Con la app instalada y abierta, publica un build nuevo en el servidor.
2. En menos de una hora (o al reabrir la app) aparece **"Hay una nueva versión de SISREC"**. Pulsa **Actualizar**: recarga sin perder la sesión ni la cola offline.

## Resultados

| Paso | Celular 1 | Celular 2 | Observaciones |
|---|---|---|---|
| A. Instalación y apertura sin señal | | | |
| B. Padrón y búsqueda sin señal | | | |
| C. Impresión en línea | | | |
| C. Tildes y ñ en el papel | | | |
| C. Recibo provisional sin señal | | | |
| C. Impresora apagada / cola de impresión | | | |
| D. 15 cobros en modo avión | | | |
| D. Sincronización sin duplicados | | | |
| D. Corte a mitad de la sincronización | | | |
| E. Cobro observado y revisión | | | |
| E. Cobro rechazado | | | |
| F. Sin pedir clave tras 15 min | | | |
| F. Revocación desde el panel | | | |
| G. Actualización de versión | | | |

Modelos probados: celular 1 ______________________ · celular 2 ______________________ · impresora ______________________
