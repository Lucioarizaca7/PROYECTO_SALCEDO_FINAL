-- Solo se cobra en efectivo (decisión del usuario, 17/11/2026; RN-34 y RN-35 del plan de reglas).
--
-- El POS de la municipalidad no está activado y figura a nombre de una persona de la gestión anterior; con el
-- cambio de alcalde no hay una cuenta municipal donde comprobar un Yape, un Plin o un pago con POS. Se quita el
-- cobro digital: la pantalla de cobro ya no lo ofrece y el servidor lo rechaza.
--
-- La base lo impide aunque el cobro entre por otro camino. Hay una sola excepción: un cobro hecho sin señal antes
-- del cambio, que el celular sincroniza después. El dinero ya se recibió, así que entra y queda observado
-- (cobros_observados) para que el super administrador lo revise. Por eso la regla es un disparador que se
-- comprueba al terminar la transacción (cuando la fila de cobros_observados ya existe) y no un CHECK.
--
-- Datos existentes: no cambia ninguno. Los cobros digitales ya registrados se conservan con su medio de pago y
-- su número de operación; el disparador solo mira filas nuevas o un cambio del medio de pago.
-- Las columnas de Yape, Plin y POS del cierre de caja se quedan: guardan la historia.
BEGIN;

CREATE FUNCTION transacciones_solo_efectivo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.metodo_pago <> 'efectivo'
     AND NOT EXISTS (SELECT 1 FROM cobros_observados o WHERE o.transaccion_id = NEW.id) THEN
    RAISE EXCEPTION 'Solo se cobra en efectivo: un cobro por % entra únicamente como observado', NEW.metodo_pago
      USING ERRCODE = '23514', CONSTRAINT = 'transacciones_solo_efectivo';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER trg_transacciones_solo_efectivo
  AFTER INSERT OR UPDATE OF metodo_pago ON transacciones
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION transacciones_solo_efectivo();

COMMIT;
