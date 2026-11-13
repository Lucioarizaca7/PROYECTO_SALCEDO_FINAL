-- Cobro solo por día cobrado, con el precio de cada zona (decisión del usuario, 13/11/2026).
--
-- La feria se cobra solo los días que el cobrador sale a cobrar: una feria que sale los miércoles paga los
-- miércoles. Ya no hay cuota mensual, semanal, "diaria × días del mes" ni por metro cuadrado, tampoco para
-- los meses pasados (hasta hoy solo hay datos de prueba; la deuda se suma desde diciembre de 2026).
--
--   Precio de la zona   una fila de tarifas con zona_id, unidad 'dia' y monto_fijo (el precio de un día), con
--                       su vigencia. Lo fija el super_admin; un cambio de precio "desde tal día" cierra el
--                       anterior (insertTarifa) y el trigger de la 0020 impide que dos se crucen.
--   zonas.tipo_via      queda como dato del sector (asfaltada / sin asfaltar); ya no decide el monto.
--   Zona = sector       las calles son las de su zona y ubican el puesto: puestos.calle_id debe ser una
--                       calle de la zona del puesto.
--   ticket_series       se identifican por su valor (S3 = S/ 3): el día de una zona lleva la serie activa
--                       cuyo valor es el precio de ese día; sin serie, solo el recibo R-.
--
-- Datos existentes:
--   - Cada zona con tipo de vía recibe como precio las tarifas generales de su tipo de vía (las de la 0013 y
--     sus cambios), con las mismas fechas, salvo que ya tenga su propia tarifa por día cobrado, que se
--     convierte. Si la zona cambió de tipo de vía, los días anteriores quedan con el precio del tipo actual.
--   - Las zonas sin tipo de vía quedan sin precio hasta que el super_admin lo ponga: no se inventa un monto.
--   - Las demás tarifas (por rubro, generales, mensuales, diarias, por m²) se desactivan. No se borran:
--     transacciones.tarifa_id las referencia.
--   - Un puesto con una calle de otra zona se queda sin calle.
BEGIN;

-- 1. Unidad 'dia'.
DO $$
DECLARE
  nombre TEXT;
BEGIN
  FOR nombre IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'tarifas'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%unidad_medida%'
  LOOP
    EXECUTE format('ALTER TABLE tarifas DROP CONSTRAINT %I', nombre);
  END LOOP;
END;
$$;
ALTER TABLE tarifas ADD CONSTRAINT tarifas_unidad_medida_check
  CHECK (unidad_medida IN ('dia', 'diaria', 'semanal', 'mensual', 'metro_cuadrado'));

-- 2. Las tarifas propias de una zona, por día cobrado y para todos los rubros, pasan a ser su precio.
UPDATE tarifas SET unidad_medida = 'dia', tipo_tarifa = 'fija', monto_variable = 0, version = version + 1
WHERE activo AND zona_id IS NOT NULL AND rubro_id IS NULL AND tipo_via IS NULL AND unidad_medida = 'semanal';

-- 3. Las zonas con tipo de vía y sin precio toman las tarifas generales activas de su tipo de vía (no se cruzan
--    con ellas en el trigger de la 0020: tienen zona y no tipo de vía).
INSERT INTO tarifas (rubro_id, zona_id, tipo_via, tipo_tarifa, monto_fijo, monto_variable, unidad_medida, vigencia_inicio, vigencia_fin)
SELECT NULL, z.id, NULL, 'fija', t.monto_fijo, 0, 'dia', t.vigencia_inicio, t.vigencia_fin
FROM zonas z
JOIN tarifas t ON t.activo AND t.rubro_id IS NULL AND t.zona_id IS NULL AND t.tipo_via = z.tipo_via AND t.unidad_medida = 'semanal'
WHERE z.tipo_via IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM tarifas p WHERE p.zona_id = z.id AND p.activo AND p.unidad_medida = 'dia')
ORDER BY z.id, t.vigencia_inicio;

-- 4. Las demás se desactivan.
UPDATE tarifas SET activo = FALSE, version = version + 1
WHERE activo AND unidad_medida <> 'dia';

-- 5. Una tarifa activa solo puede ser el precio de una zona.
ALTER TABLE tarifas ADD CONSTRAINT tarifas_precio_de_zona CHECK (
  NOT activo OR (zona_id IS NOT NULL AND rubro_id IS NULL AND tipo_via IS NULL AND unidad_medida = 'dia' AND monto_variable = 0)
);

-- 6. Las series de tickets se buscan por su valor.
ALTER TABLE ticket_series DROP CONSTRAINT IF EXISTS ticket_series_tipo_via_key;
ALTER TABLE ticket_series ALTER COLUMN tipo_via DROP NOT NULL;
CREATE UNIQUE INDEX ticket_series_valor_activa_uq ON ticket_series (valor) WHERE activa;

-- 7. La calle de un puesto es una calle de su zona.
UPDATE puestos p SET calle_id = NULL
FROM calles c WHERE c.id = p.calle_id AND c.zona_id <> p.zona_id;

CREATE FUNCTION puesto_calle_de_su_zona() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.calle_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM calles c WHERE c.id = NEW.calle_id AND c.zona_id = NEW.zona_id) THEN
    RETURN NEW;
  END IF;
  -- El puesto se movió de zona sin elegir calle nueva: deja la calle de la zona anterior.
  IF TG_OP = 'UPDATE' AND NEW.zona_id IS DISTINCT FROM OLD.zona_id AND NEW.calle_id IS NOT DISTINCT FROM OLD.calle_id THEN
    NEW.calle_id := NULL;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'La calle no pertenece a la zona del puesto' USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER trg_puesto_calle_de_su_zona BEFORE INSERT OR UPDATE OF calle_id, zona_id ON puestos
  FOR EACH ROW EXECUTE FUNCTION puesto_calle_de_su_zona();

-- Una calle que pasa a otra zona deja de ubicar a los puestos de la zona anterior.
CREATE FUNCTION calle_cambia_zona() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE puestos SET calle_id = NULL WHERE calle_id = NEW.id AND zona_id <> NEW.zona_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_calle_cambia_zona AFTER UPDATE OF zona_id ON calles
  FOR EACH ROW WHEN (NEW.zona_id IS DISTINCT FROM OLD.zona_id) EXECUTE FUNCTION calle_cambia_zona();

COMMIT;
