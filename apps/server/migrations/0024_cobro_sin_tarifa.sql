-- Un cobro sin señal de un comerciante sin tarifa vigente queda observado, no rechazado (revisión del 11/11/2026).
--
-- El paquete de jornada descarga a ese comerciante con saldo 0, así que el cobrador puede cobrarle sin señal. Al
-- sincronizar, el cobro se rechazaba (no había tarifa que poner en transacciones.tarifa_id) y el dinero ya recibido
-- quedaba fuera de la recaudación. La regla: sin señal, un conflicto nunca se descarta, va a revisión.
--
-- tarifa_id NULL solo lo escribe registrarCobro para un cobro sin señal, y siempre junto con su fila en
-- cobros_observados (un CHECK no puede mirar otra tabla; lo cubre tests/cobro-sin-tarifa.test.js). En línea se
-- sigue exigiendo tarifa. Los datos existentes no cambian.
BEGIN;

ALTER TABLE transacciones ALTER COLUMN tarifa_id DROP NOT NULL;

COMMIT;
