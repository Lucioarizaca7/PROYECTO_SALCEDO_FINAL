-- Un mes en que el comerciante estuvo de baja todo el mes no se cobra (revisión del 11/11/2026).
--
-- Antes la cuota mensual se cobraba todos los meses desde el alta: un comerciante dado de baja en julio y
-- reactivado en noviembre debía agosto, septiembre y octubre, y uno de baja hoy seguía mostrando la cuota del mes.
-- Ahora un mes se cobra si estuvo activo (o pendiente) algún día de ese mes, como el tipo de comerciante (0023):
-- el mes de la baja y el de la reactivación se cobran; los de en medio, no (calcularLiquidacion, comercianteDelMes).
-- Lo que se paga por día marcado no cambia: a un dado de baja no se le registra asistencia.
--
--   comerciantes_estado_cambios   cada cambio de estado de un comerciante (trigger: pantalla, baja, alta que
--                                 reactiva, importación del padrón).
--
-- Datos existentes: los cambios se reconstruyen de la auditoría (ACTUALIZAR guarda el estado previo y el nuevo,
-- DAR_DE_BAJA deja inactivo, CREAR puede reactivar). Un dado de baja hoy cuya baja no está en la auditoría toma
-- su fecha_baja.
BEGIN;

CREATE TABLE comerciantes_estado_cambios (
  id BIGSERIAL PRIMARY KEY,
  comerciante_id BIGINT NOT NULL REFERENCES comerciantes(id),
  estado_anterior TEXT NOT NULL CHECK (estado_anterior IN ('activo', 'inactivo', 'pendiente')),
  estado_nuevo TEXT NOT NULL CHECK (estado_nuevo IN ('activo', 'inactivo', 'pendiente')),
  desde DATE NOT NULL,
  registrado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT comerciantes_estado_cambios_distintos CHECK (estado_anterior <> estado_nuevo)
);
CREATE INDEX idx_comerciantes_estado_cambios ON comerciantes_estado_cambios (comerciante_id, desde);

-- El estado después de cada registro de auditoría; el de antes es el previo guardado o, si no hay (CREAR), el
-- que dejó el registro anterior.
INSERT INTO comerciantes_estado_cambios (comerciante_id, estado_anterior, estado_nuevo, desde, registrado_en)
SELECT cambio.comerciante_id, cambio.anterior, cambio.nuevo, (cambio.fecha AT TIME ZONE 'America/Lima')::date, cambio.fecha
FROM (
  SELECT evento.comerciante_id, evento.fecha, evento.nuevo,
         COALESCE(evento.previo, LAG(evento.nuevo) OVER (PARTITION BY evento.comerciante_id ORDER BY evento.fecha, evento.id)) AS anterior
  FROM (
    SELECT l.id, c.id AS comerciante_id, l.fecha, l.payload_previo->>'estado' AS previo,
           CASE WHEN l.accion = 'DAR_DE_BAJA_COMERCIANTE' THEN 'inactivo' ELSE l.payload_nuevo->>'estado' END AS nuevo
    FROM auditoria_logs l
    JOIN comerciantes c ON c.id::text = l.recurso_id
    WHERE l.entidad = 'comerciantes'
      AND (l.accion = 'DAR_DE_BAJA_COMERCIANTE' OR l.payload_nuevo->>'estado' IN ('activo', 'inactivo', 'pendiente'))
  ) evento
) cambio
WHERE cambio.anterior IN ('activo', 'inactivo', 'pendiente') AND cambio.anterior <> cambio.nuevo
ORDER BY cambio.fecha;

INSERT INTO comerciantes_estado_cambios (comerciante_id, estado_anterior, estado_nuevo, desde, registrado_en)
SELECT c.id, 'activo', 'inactivo', (c.fecha_baja AT TIME ZONE 'America/Lima')::date, c.fecha_baja
FROM comerciantes c
WHERE c.estado = 'inactivo' AND c.fecha_baja IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM comerciantes_estado_cambios e
                  WHERE e.comerciante_id = c.id AND e.estado_nuevo = 'inactivo'
                    AND e.desde >= (c.fecha_baja AT TIME ZONE 'America/Lima')::date);

CREATE FUNCTION comerciante_cambia_estado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO comerciantes_estado_cambios (comerciante_id, estado_anterior, estado_nuevo, desde)
  VALUES (NEW.id, OLD.estado, NEW.estado, (now() AT TIME ZONE 'America/Lima')::date);
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_comerciante_cambia_estado AFTER UPDATE OF estado ON comerciantes
  FOR EACH ROW WHEN (OLD.estado IS DISTINCT FROM NEW.estado)
  EXECUTE FUNCTION comerciante_cambia_estado();

COMMIT;
