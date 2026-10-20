-- Cobro por día cobrado, igual para todos los rubros: S/ 3 en vía asfaltada y S/ 2 sin asfaltar por cada
-- día que el cobrador salió y marcó asistencia (monto fijo por puesto, sin metros). Sin día cobrado no hay
-- deuda. Vale para ferial, permanente y eventual.
--
--   tarifas.rubro_id  deja de ser obligatorio: NULL = la tarifa es para todos los rubros.
--   unidad 'semanal'  pasa a significar "por día cobrado": su monto se cobra completo por cada día con
--                     asistencia (antes la cuota mensual cobraba una sola semana).
--   asistencias_feriales.motivo / observacion
--                     reporte del cobrador sobre el día: no_salio (falta: no genera deuda), no_vendio y
--                     se_nego_a_pagar (asistió: el día sí se debe), otro.
--
-- Datos existentes: se crean las dos tarifas generales por tipo de vía, vigentes desde el mes en que se
-- aplica la migración: los meses anteriores se siguen liquidando con la tarifa del rubro, así cargar el
-- tipo de vía de una zona no reescribe la deuda ni lo pagado de esos meses. Como ninguna zona tiene tipo
-- de vía todavía, ninguna liquidación cambia hasta que se le cargue a cada zona; desde entonces, y para
-- los meses desde la vigencia, la tarifa general por tipo de vía gana a las tarifas por rubro.

BEGIN;

ALTER TABLE tarifas ALTER COLUMN rubro_id DROP NOT NULL;

INSERT INTO tarifas (rubro_id, tipo_via, tipo_tarifa, monto_fijo, monto_variable, unidad_medida, vigencia_inicio)
SELECT NULL, via.tipo_via, 'fija', via.monto, 0, 'semanal', date_trunc('month', now() AT TIME ZONE 'America/Lima')::date
FROM (VALUES ('asfaltada', 3), ('sin_asfaltar', 2)) AS via (tipo_via, monto)
WHERE NOT EXISTS (SELECT 1 FROM tarifas t WHERE t.rubro_id IS NULL AND t.tipo_via = via.tipo_via AND t.activo);

ALTER TABLE asistencias_feriales
  ADD COLUMN motivo TEXT CHECK (motivo IN ('no_salio', 'no_vendio', 'se_nego_a_pagar', 'otro')),
  ADD COLUMN observacion TEXT CHECK (char_length(observacion) <= 300);

CREATE INDEX idx_asistencias_observadas ON asistencias_feriales (fecha) WHERE motivo IS NOT NULL OR observacion IS NOT NULL;

COMMIT;
