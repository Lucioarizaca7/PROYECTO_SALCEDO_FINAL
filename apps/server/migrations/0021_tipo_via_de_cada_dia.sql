-- Cada día marcado guarda el tipo de vía que tenía su zona ese día (decisión del usuario, 11/11/2026).
--
-- Antes la liquidación tomaba el tipo de vía actual de la zona: si la calle se asfaltaba (S/ 2 -> S/ 3), los
-- días pasados se recalculaban a S/ 3, también los ya pagados. Ahora el tipo de vía nuevo rige desde el día
-- del cambio, igual que el cambio de zona de un puesto (0019).
--
--   zonas_via_cambios                    cada cambio de tipo de vía de una zona. Lo escribe un trigger, así
--                                        ningún camino (pantalla Zonas, SQL a mano) se lo salta.
--   via_de_zona(zona, fecha)             tipo de vía de la zona ese día.
--   asistencias_feriales.tipo_via        tipo de vía que cuenta para cobrar esa marca (NULL = zona sin tipo de
--                                        vía ese día: paga con la tarifa de su rubro).
--
-- Datos existentes: los cambios se reconstruyen de la auditoría (PUT /zonas guarda el estado previo) y cada marca
-- recibe el tipo de vía de su fecha. Un cambio hecho fuera de la API no se puede reconstruir: esa marca queda con
-- el tipo de vía actual, como antes.
BEGIN;

CREATE TABLE zonas_via_cambios (
  id BIGSERIAL PRIMARY KEY,
  zona_id INTEGER NOT NULL REFERENCES zonas(id),
  via_anterior TEXT CHECK (via_anterior IN ('asfaltada', 'sin_asfaltar')),
  via_nueva TEXT CHECK (via_nueva IN ('asfaltada', 'sin_asfaltar')),
  desde DATE NOT NULL,
  registrado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT zonas_via_cambios_distintas CHECK (via_anterior IS DISTINCT FROM via_nueva)
);
CREATE INDEX idx_zonas_via_cambios ON zonas_via_cambios (zona_id, desde);

-- La auditoría guarda el estado previo: el tipo de vía nuevo de cada registro es el previo del siguiente o, en
-- el último, el actual de la zona. (Con LEAD sobre el id se distingue "no hay siguiente" de "el siguiente era NULL".)
INSERT INTO zonas_via_cambios (zona_id, via_anterior, via_nueva, desde, registrado_en)
SELECT cambio.zona_id, cambio.anterior, cambio.nueva, (cambio.fecha AT TIME ZONE 'America/Lima')::date, cambio.fecha
FROM (
  SELECT z.id AS zona_id,
         NULLIF(l.payload_previo->>'tipo_via', '') AS anterior,
         CASE WHEN LEAD(l.id) OVER w IS NULL THEN z.tipo_via
              ELSE NULLIF(LEAD(l.payload_previo->>'tipo_via') OVER w, '') END AS nueva,
         l.fecha
  FROM auditoria_logs l
  JOIN zonas z ON z.id::text = l.recurso_id
  WHERE l.entidad = 'zonas' AND l.payload_previo ? 'tipo_via'
  WINDOW w AS (PARTITION BY z.id ORDER BY l.fecha, l.id)
) cambio
WHERE cambio.anterior IS DISTINCT FROM cambio.nueva
  AND (cambio.anterior IS NULL OR cambio.anterior IN ('asfaltada', 'sin_asfaltar'))
  AND (cambio.nueva IS NULL OR cambio.nueva IN ('asfaltada', 'sin_asfaltar'))
ORDER BY cambio.fecha;

-- El tipo de vía de una zona un día: el anterior del primer cambio posterior a ese día o, si no hubo, el actual.
CREATE FUNCTION via_de_zona(p_zona_id INTEGER, p_fecha DATE) RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN c.id IS NOT NULL THEN c.via_anterior ELSE (SELECT z.tipo_via FROM zonas z WHERE z.id = p_zona_id) END
  FROM (SELECT 1) AS uno
  LEFT JOIN LATERAL (
    SELECT id, via_anterior FROM zonas_via_cambios
    WHERE zona_id = p_zona_id AND desde > p_fecha
    ORDER BY desde, id LIMIT 1
  ) c ON TRUE
$$;

ALTER TABLE asistencias_feriales ADD COLUMN tipo_via TEXT CHECK (tipo_via IN ('asfaltada', 'sin_asfaltar'));
UPDATE asistencias_feriales SET tipo_via = via_de_zona(zona_id, fecha);

-- Se calcula siempre en la base (nunca lo manda la app). El nombre ordena este trigger después de
-- trg_asistencia_zona, que pone zona_id; en UPDATE sigue a la zona cuando el puesto cambia de zona (0019).
CREATE FUNCTION asistencia_tipo_via() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.tipo_via := via_de_zona(NEW.zona_id, NEW.fecha);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_asistencia_zona_via BEFORE INSERT OR UPDATE OF zona_id, fecha ON asistencias_feriales
  FOR EACH ROW EXECUTE FUNCTION asistencia_tipo_via();

CREATE FUNCTION zona_cambia_via() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  hoy DATE := (now() AT TIME ZONE 'America/Lima')::date;
BEGIN
  INSERT INTO zonas_via_cambios (zona_id, via_anterior, via_nueva, desde)
  VALUES (NEW.id, OLD.tipo_via, NEW.tipo_via, hoy);

  -- El tipo de vía nuevo rige desde hoy, también para una marca de hoy que ya estaba registrada.
  UPDATE asistencias_feriales SET tipo_via = NEW.tipo_via WHERE zona_id = NEW.id AND fecha >= hoy;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_zona_cambia_via AFTER UPDATE OF tipo_via ON zonas
  FOR EACH ROW WHEN (OLD.tipo_via IS DISTINCT FROM NEW.tipo_via)
  EXECUTE FUNCTION zona_cambia_via();

COMMIT;
