-- Cada día marcado guarda la zona que tenía el puesto ese día (decisión del usuario, 02/11/2026).
--
-- Antes la liquidación tomaba la zona actual del puesto: cambiarla recalculaba los meses pasados con la tarifa
-- de la zona nueva. Ahora la zona nueva rige desde el día del cambio y lo ya marcado conserva su zona.
-- Excepción: asignar una "zona por regularizar" (0018) corrige también lo pasado, porque esa zona era provisional.
--
--   puestos_zona_cambios                 cada cambio de zona de un puesto. Lo escribe un trigger, así ningún
--                                        camino (Sitios, mapa, padrón) se lo salta.
--   asistencias_feriales.zona_id         zona que cuenta para cobrar esa marca.
--   zona_de_asistencia(puesto, fecha)    zona del puesto ese día. Sirve también para una marca que llega
--                                        después del cambio (sin señal o desde un Excel).
--
-- Datos existentes: los cambios se reconstruyen de la auditoría y cada marca recibe la zona de su fecha. Un
-- cambio hecho fuera de las rutas (sin auditoría) no se puede reconstruir: esa marca queda con la zona actual.
-- La tarifa mensual no entra aquí: depende de la zona del comerciante, no de la del puesto.
BEGIN;

CREATE TABLE puestos_zona_cambios (
  id BIGSERIAL PRIMARY KEY,
  puesto_id BIGINT NOT NULL REFERENCES puestos(id),
  zona_anterior_id INTEGER NOT NULL REFERENCES zonas(id),
  zona_nueva_id INTEGER NOT NULL REFERENCES zonas(id),
  desde DATE NOT NULL,
  -- TRUE si la zona anterior era provisional: el cambio vale también para los días pasados.
  corrige_pasado BOOLEAN NOT NULL,
  registrado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT puestos_zona_cambios_distintas CHECK (zona_anterior_id <> zona_nueva_id)
);
CREATE INDEX idx_puestos_zona_cambios ON puestos_zona_cambios (puesto_id, desde);

-- La auditoría guarda el estado previo: la zona nueva de cada registro es la previa del siguiente, o la actual.
INSERT INTO puestos_zona_cambios (puesto_id, zona_anterior_id, zona_nueva_id, desde, corrige_pasado, registrado_en)
SELECT cambio.puesto_id, cambio.anterior, cambio.nueva, (cambio.fecha AT TIME ZONE 'America/Lima')::date, cambio.provisional, cambio.fecha
FROM (
  SELECT p.id AS puesto_id, (l.payload_previo->>'zona_id')::int AS anterior,
         COALESCE(LEAD((l.payload_previo->>'zona_id')::int) OVER (PARTITION BY p.id ORDER BY l.fecha, l.id), p.zona_id) AS nueva,
         l.payload_previo->>'zona_por_regularizar' IS NOT NULL AS provisional,
         l.fecha
  FROM auditoria_logs l
  JOIN puestos p ON p.id::text = l.recurso_id
  WHERE l.entidad = 'puestos' AND l.payload_previo->>'zona_id' IS NOT NULL
) cambio
JOIN zonas anterior ON anterior.id = cambio.anterior
WHERE cambio.anterior <> cambio.nueva
ORDER BY cambio.fecha;

CREATE FUNCTION zona_de_asistencia(p_puesto_id BIGINT, p_fecha DATE) RETURNS INTEGER
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT c.zona_anterior_id FROM puestos_zona_cambios c
     WHERE c.puesto_id = p_puesto_id AND c.desde > p_fecha AND NOT c.corrige_pasado
     ORDER BY c.desde, c.id LIMIT 1),
    (SELECT p.zona_id FROM puestos p WHERE p.id = p_puesto_id))
$$;

ALTER TABLE asistencias_feriales ADD COLUMN zona_id INTEGER REFERENCES zonas(id);
UPDATE asistencias_feriales SET zona_id = zona_de_asistencia(puesto_id, fecha);
ALTER TABLE asistencias_feriales ALTER COLUMN zona_id SET NOT NULL;

CREATE FUNCTION asistencia_zona() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.zona_id IS NULL THEN
    NEW.zona_id := zona_de_asistencia(NEW.puesto_id, NEW.fecha);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_asistencia_zona BEFORE INSERT ON asistencias_feriales
  FOR EACH ROW EXECUTE FUNCTION asistencia_zona();

CREATE FUNCTION puesto_cambia_zona() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  hoy DATE := (now() AT TIME ZONE 'America/Lima')::date;
  provisional BOOLEAN := OLD.zona_por_regularizar IS NOT NULL;
BEGIN
  INSERT INTO puestos_zona_cambios (puesto_id, zona_anterior_id, zona_nueva_id, desde, corrige_pasado)
  VALUES (NEW.id, OLD.zona_id, NEW.zona_id, hoy, provisional);

  -- La zona nueva rige desde hoy, también para una marca de hoy que ya estaba registrada.
  UPDATE asistencias_feriales SET zona_id = NEW.zona_id
  WHERE puesto_id = NEW.id AND (provisional OR fecha >= hoy);
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_puesto_cambia_zona AFTER UPDATE OF zona_id ON puestos
  FOR EACH ROW WHEN (OLD.zona_id IS DISTINCT FROM NEW.zona_id)
  EXECUTE FUNCTION puesto_cambia_zona();

COMMIT;
