-- La marca de asistencia es del titular que tenía el puesto ese día, no del que lo tiene hoy.
--
-- Antes la liquidación buscaba los días cobrados por el titular actual del puesto: si el puesto pasaba de
-- A a B, los días que A ya tenía marcados se le cobraban a B (y A dejaba de deberlos); si el puesto se
-- liberaba, esos días no los debía nadie.
--
--   asistencias_feriales.comerciante_id  titular del puesto el día de la marca. Lo llena un trigger al
--                                        insertar, así ningún camino (app, cobro, Excel, semilla) se lo salta.
--   titular_de_asistencia(puesto, fecha)  quién tenía el puesto ese día según la auditoría: el titular previo
--                                        del primer cambio del puesto registrado después de ese día
--                                        (ACTUALIZAR_PUESTO_MAPA, LIBERAR_PUESTO, DAR_DE_BAJA_PUESTO_MAPA
--                                        guardan el estado previo); sin cambios posteriores, el titular actual.
--
-- Datos existentes: cada marca recibe el titular que da titular_de_asistencia. Las de un puesto liberado
-- sin rastro en la auditoría quedan sin titular y siguen sin cobrarse, como hasta ahora. Un cambio hecho
-- fuera de las rutas (sin auditoría) no se puede reconstruir: esa marca queda del titular actual. El CHECK
-- es NOT VALID: obliga en las marcas nuevas sin rechazar esas.
-- Límite conocido: si el puesto cambia de titular el mismo día de la marca, la marca de ese día queda del
-- titular nuevo (UNIQUE (puesto_id, fecha, sesion) admite una sola marca por puesto y día).
BEGIN;

ALTER TABLE asistencias_feriales ADD COLUMN comerciante_id BIGINT REFERENCES comerciantes(id);

CREATE FUNCTION titular_de_asistencia(p_puesto_id BIGINT, p_fecha DATE) RETURNS BIGINT
LANGUAGE sql STABLE AS $$
  -- Si hay un cambio posterior, manda su titular previo aunque sea NULL (el puesto estaba libre ese día).
  SELECT CASE WHEN cambio.hay THEN cambio.titular ELSE p.comerciante_id END
  FROM puestos p
  LEFT JOIN LATERAL (
    SELECT TRUE AS hay, (l.payload_previo->>'comerciante_id')::bigint AS titular
    FROM auditoria_logs l
    WHERE l.entidad = 'puestos' AND l.recurso_id = p_puesto_id::text
      AND (l.fecha AT TIME ZONE 'America/Lima')::date > p_fecha
      AND l.payload_previo ? 'comerciante_id'
    ORDER BY l.fecha, l.id
    LIMIT 1
  ) cambio ON TRUE
  WHERE p.id = p_puesto_id
$$;

UPDATE asistencias_feriales SET comerciante_id = titular_de_asistencia(puesto_id, fecha);

CREATE FUNCTION asistencia_titular() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.comerciante_id IS NULL THEN
    SELECT comerciante_id INTO NEW.comerciante_id FROM puestos WHERE id = NEW.puesto_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_asistencia_titular BEFORE INSERT ON asistencias_feriales
  FOR EACH ROW EXECUTE FUNCTION asistencia_titular();

ALTER TABLE asistencias_feriales
  ADD CONSTRAINT asistencias_con_titular CHECK (comerciante_id IS NOT NULL) NOT VALID;

CREATE INDEX idx_asistencias_titular ON asistencias_feriales (comerciante_id, fecha);

COMMIT;
