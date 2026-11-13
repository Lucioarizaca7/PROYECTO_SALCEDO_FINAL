-- El tipo de comerciante rige desde el día del cambio (decisión del usuario, 11/11/2026).
--
-- Antes cada mes se liquidaba con el tipo actual: pasar a un ferial o permanente a eventual borraba su deuda
-- atrasada entera (el eventual no acumula), y pasar un eventual a permanente le creaba deuda de los meses en que
-- era eventual. Ahora los meses pasados se liquidan con el tipo que tenían (calcularLiquidacion, tipoDelPeriodo).
--
--   comerciantes_tipo_cambios   cada cambio de tipo. Lo escribe un trigger, así ningún camino (pantalla,
--                               importación del padrón, SQL a mano) se lo salta.
--
-- Datos existentes: los cambios se reconstruyen de la auditoría (PUT /comerciantes guarda el estado previo). Un
-- cambio hecho fuera de la API no se puede reconstruir: esos meses siguen con el tipo actual, como antes.
BEGIN;

CREATE TABLE comerciantes_tipo_cambios (
  id BIGSERIAL PRIMARY KEY,
  comerciante_id BIGINT NOT NULL REFERENCES comerciantes(id),
  tipo_anterior TEXT NOT NULL CHECK (tipo_anterior IN ('eventual', 'permanente', 'ferial')),
  tipo_nuevo TEXT NOT NULL CHECK (tipo_nuevo IN ('eventual', 'permanente', 'ferial')),
  desde DATE NOT NULL,
  registrado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT comerciantes_tipo_cambios_distintos CHECK (tipo_anterior <> tipo_nuevo)
);
CREATE INDEX idx_comerciantes_tipo_cambios ON comerciantes_tipo_cambios (comerciante_id, desde);

-- La auditoría guarda el estado previo: el tipo nuevo de cada registro es el previo del siguiente o, en el
-- último, el actual del comerciante.
INSERT INTO comerciantes_tipo_cambios (comerciante_id, tipo_anterior, tipo_nuevo, desde, registrado_en)
SELECT cambio.comerciante_id, cambio.anterior, cambio.nuevo, (cambio.fecha AT TIME ZONE 'America/Lima')::date, cambio.fecha
FROM (
  SELECT c.id AS comerciante_id,
         l.payload_previo->>'tipo_comerciante' AS anterior,
         CASE WHEN LEAD(l.id) OVER w IS NULL THEN c.tipo_comerciante
              ELSE LEAD(l.payload_previo->>'tipo_comerciante') OVER w END AS nuevo,
         l.fecha
  FROM auditoria_logs l
  JOIN comerciantes c ON c.id::text = l.recurso_id
  WHERE l.entidad = 'comerciantes' AND l.payload_previo ? 'tipo_comerciante'
  WINDOW w AS (PARTITION BY c.id ORDER BY l.fecha, l.id)
) cambio
WHERE cambio.anterior IN ('eventual', 'permanente', 'ferial')
  AND cambio.nuevo IN ('eventual', 'permanente', 'ferial')
  AND cambio.anterior <> cambio.nuevo
ORDER BY cambio.fecha;

CREATE FUNCTION comerciante_cambia_tipo() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO comerciantes_tipo_cambios (comerciante_id, tipo_anterior, tipo_nuevo, desde)
  VALUES (NEW.id, OLD.tipo_comerciante, NEW.tipo_comerciante, (now() AT TIME ZONE 'America/Lima')::date);
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_comerciante_cambia_tipo AFTER UPDATE OF tipo_comerciante ON comerciantes
  FOR EACH ROW WHEN (OLD.tipo_comerciante IS DISTINCT FROM NEW.tipo_comerciante)
  EXECUTE FUNCTION comerciante_cambia_tipo();

COMMIT;
