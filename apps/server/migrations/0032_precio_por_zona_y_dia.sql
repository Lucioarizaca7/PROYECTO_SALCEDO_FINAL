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
--   Zona = área         un área con un solo precio por día. No hay calles (decisión del 14/11/2026): la
--                       tabla calles y puestos.calle_id de la 0002 quedan sin uso.
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

COMMIT;
