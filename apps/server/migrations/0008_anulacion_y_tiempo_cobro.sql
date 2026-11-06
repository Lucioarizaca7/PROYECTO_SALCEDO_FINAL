-- Anulación de cobros con motivo y tiempo de atención de cada cobro.
--
-- Anulación: hasta ahora un cobro solo se anulaba desde la revisión de observados y no quedaba quién
-- ni por qué en la misma fila. Ahora todo cobro anulado guarda quién lo anuló, cuándo y el motivo.
-- Datos existentes: las anulaciones hechas en la revisión toman el motivo y el revisor de cobros_observados.
--
-- Tiempo de atención: inicio_atencion es la hora en que el cobrador abrió al comerciante (búsqueda o
-- escaneo del QR); con fecha_cobro_cliente da los segundos que tomó cada cobro (indicador de −50 %).
-- Los cobros anteriores no lo tienen y quedan en NULL.

BEGIN;

ALTER TABLE transacciones
  ADD COLUMN anulado_en       TIMESTAMPTZ,
  ADD COLUMN anulado_por      BIGINT REFERENCES usuarios(id),
  ADD COLUMN motivo_anulacion TEXT,
  ADD COLUMN inicio_atencion  TIMESTAMPTZ;

UPDATE transacciones t
SET anulado_en = COALESCE(ob.revisado_en, now()),
    anulado_por = ob.revisado_por,
    motivo_anulacion = COALESCE(NULLIF(btrim(ob.resolucion), ''), 'Anulado en revisión de cobro observado')
FROM cobros_observados ob
WHERE ob.transaccion_id = t.id AND t.estado = 'anulado';

UPDATE transacciones
SET anulado_en = COALESCE(anulado_en, fecha_registro_servidor),
    motivo_anulacion = COALESCE(motivo_anulacion, 'Anulado antes de registrar el motivo')
WHERE estado = 'anulado';

ALTER TABLE transacciones
  ADD CONSTRAINT transacciones_anulacion_con_motivo CHECK (
    estado <> 'anulado' OR (anulado_en IS NOT NULL AND length(btrim(coalesce(motivo_anulacion, ''))) >= 5)
  ),
  ADD CONSTRAINT transacciones_inicio_antes_del_cobro CHECK (
    inicio_atencion IS NULL OR inicio_atencion <= fecha_cobro_cliente
  );

COMMIT;
