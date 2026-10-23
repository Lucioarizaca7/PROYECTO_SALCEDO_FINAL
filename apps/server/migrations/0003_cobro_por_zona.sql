-- Cobro fijo por zona y por día de feria (martes y miércoles).
-- El rubro y el metraje dejan de influir en el monto; el comerciante elige cada cuánto paga.

BEGIN;

-- Las tarifas por zona no llevan rubro.
ALTER TABLE tarifas ALTER COLUMN rubro_id DROP NOT NULL;
ALTER TABLE tarifas DROP CONSTRAINT IF EXISTS tarifas_unidad_medida_check;
ALTER TABLE tarifas ADD CONSTRAINT tarifas_unidad_medida_check
  CHECK (unidad_medida IN ('diaria','semanal','mensual','metro_cuadrado','dia_feria'));
CREATE INDEX IF NOT EXISTS idx_tarifas_zona_vigencia ON tarifas(zona_id, vigencia_inicio) WHERE rubro_id IS NULL;

-- Frecuencia con la que el comerciante prefiere pagar: por feria, por semana (2 ferias) o por mes.
ALTER TABLE comerciantes ADD COLUMN IF NOT EXISTS frecuencia_pago TEXT NOT NULL DEFAULT 'semanal';
ALTER TABLE comerciantes DROP CONSTRAINT IF EXISTS comerciantes_frecuencia_pago_check;
ALTER TABLE comerciantes ADD CONSTRAINT comerciantes_frecuencia_pago_check
  CHECK (frecuencia_pago IN ('por_feria','semanal','mensual'));

-- Mes al que se imputa cada cobro (antes se deducía de la fecha en que se cobró).
ALTER TABLE transacciones ADD COLUMN IF NOT EXISTS periodo TEXT;
UPDATE transacciones SET periodo = to_char(fecha_cobro_cliente, 'YYYY-MM') WHERE periodo IS NULL;

-- Las tarifas por rubro y por metro cuadrado quedan solo como historial (los cobros antiguos apuntan a ellas).
UPDATE tarifas SET activo = FALSE WHERE rubro_id IS NOT NULL;

-- Monto inicial de referencia para que ninguna zona quede sin tarifa; el super admin lo ajusta.
INSERT INTO tarifas (rubro_id, zona_id, tipo_tarifa, monto_fijo, monto_variable, unidad_medida, vigencia_inicio, activo, version)
SELECT NULL, z.id, 'fija', 5, 0, 'dia_feria', '2026-01-01', TRUE, 1
FROM zonas z
WHERE NOT EXISTS (SELECT 1 FROM tarifas t WHERE t.zona_id = z.id AND t.rubro_id IS NULL);

COMMIT;
