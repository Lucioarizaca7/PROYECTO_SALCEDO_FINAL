-- Dos tarifas activas del mismo rubro, zona y tipo de vía no pueden cruzar sus fechas (decisión del usuario,
-- 02/11/2026). Antes findApplicableTariff elegía una sin avisar. Al crear una tarifa, insertTarifa cierra la
-- anterior si la nueva empieza después; si no, rechaza.
--
-- Datos existentes: se conserva la tarifa que ya se aplicaba en cada fecha (la de inicio más reciente y, a igual
-- inicio, la de id mayor). La anterior termina el día previo a la siguiente, o se desactiva si empiezan el mismo
-- día. Si la anterior seguía después de que termine la siguiente, ese tramo final se pierde.
--
-- Va con un trigger y no con EXCLUDE porque EXCLUDE con igualdad de enteros necesita la extensión btree_gist, que
-- es de toda la base y no de cada esquema: las pruebas corren a la vez con un esquema por archivo.
BEGIN;

DO $$
DECLARE
  actual RECORD;
  siguiente RECORD;
BEGIN
  FOR actual IN SELECT * FROM tarifas WHERE activo ORDER BY vigencia_inicio, id LOOP
    SELECT t.vigencia_inicio INTO siguiente FROM tarifas t
    WHERE t.activo AND t.id <> actual.id
      AND t.rubro_id IS NOT DISTINCT FROM actual.rubro_id
      AND t.zona_id IS NOT DISTINCT FROM actual.zona_id
      AND t.tipo_via IS NOT DISTINCT FROM actual.tipo_via
      AND (t.vigencia_inicio, t.id) > (actual.vigencia_inicio, actual.id)
      AND daterange(t.vigencia_inicio, t.vigencia_fin, '[]') && daterange(actual.vigencia_inicio, actual.vigencia_fin, '[]')
    ORDER BY t.vigencia_inicio, t.id LIMIT 1;

    IF FOUND THEN
      IF siguiente.vigencia_inicio = actual.vigencia_inicio THEN
        UPDATE tarifas SET activo = FALSE, version = version + 1 WHERE id = actual.id;
      ELSE
        UPDATE tarifas SET vigencia_fin = siguiente.vigencia_inicio - 1, version = version + 1 WHERE id = actual.id;
      END IF;
    END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION tarifa_sin_cruces() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT NEW.activo THEN
    RETURN NEW;
  END IF;
  -- Dos altas a la vez no se verían entre sí sin este bloqueo. Dura hasta el fin de la transacción.
  PERFORM pg_advisory_xact_lock(hashtextextended('sisrec:tarifas', 0));
  IF EXISTS (
    SELECT 1 FROM tarifas t
    WHERE t.activo AND t.id <> NEW.id
      AND t.rubro_id IS NOT DISTINCT FROM NEW.rubro_id
      AND t.zona_id IS NOT DISTINCT FROM NEW.zona_id
      AND t.tipo_via IS NOT DISTINCT FROM NEW.tipo_via
      AND daterange(t.vigencia_inicio, t.vigencia_fin, '[]') && daterange(NEW.vigencia_inicio, NEW.vigencia_fin, '[]')
  ) THEN
    RAISE EXCEPTION 'Las fechas de la tarifa se cruzan con otra activa del mismo rubro, zona y tipo de vía'
      USING ERRCODE = 'exclusion_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tarifa_sin_cruces BEFORE INSERT OR UPDATE ON tarifas
  FOR EACH ROW EXECUTE FUNCTION tarifa_sin_cruces();

COMMIT;
