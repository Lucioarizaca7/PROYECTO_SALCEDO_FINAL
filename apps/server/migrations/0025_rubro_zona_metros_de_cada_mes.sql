-- El rubro y la zona del comerciante y los metros de cada puesto rigen desde el día del cambio (revisión del
-- 11/11/2026, la misma decisión que la zona del puesto en la 0019, el tipo de vía en la 0021 y el tipo de
-- comerciante en la 0023).
--
-- Antes un mes pasado se liquidaba con el rubro, la zona y los metros de hoy: corregir un rubro, mover al
-- comerciante de zona o cambiar el metraje recalculaba todos los meses, también los pagados. Ahora un mes pasado
-- usa los valores del día 1 de ese mes (calcularLiquidacion, comercianteDelMes, que lee comerciantes_datos_cambios
-- con subconsultas directas: una función SQL por mes de cada comerciante hacía más lento el recálculo del riesgo).
--
--   comerciantes_datos_cambios         cada cambio de rubro_id o zona_id de un comerciante (trigger).
--   puestos_metros_cambios             cada cambio de metros_cuadrados de un puesto (trigger).
--   metros_de_puesto(id, f)            metros del puesto ese día.
--
-- Datos existentes: los cambios se reconstruyen de la auditoría (PUT /comerciantes y PUT /puestos-mapa guardan el
-- estado previo). Lo cambiado fuera de la API (la importación del padrón antes de esta migración) no se puede
-- reconstruir: esos meses siguen con el valor actual, como antes.
BEGIN;

CREATE TABLE comerciantes_datos_cambios (
  id BIGSERIAL PRIMARY KEY,
  comerciante_id BIGINT NOT NULL REFERENCES comerciantes(id),
  campo TEXT NOT NULL CHECK (campo IN ('rubro_id', 'zona_id')),
  valor_anterior INTEGER NOT NULL,
  valor_nuevo INTEGER NOT NULL,
  desde DATE NOT NULL,
  registrado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT comerciantes_datos_cambios_distintos CHECK (valor_anterior <> valor_nuevo)
);
CREATE INDEX idx_comerciantes_datos_cambios ON comerciantes_datos_cambios (comerciante_id, campo, desde);

CREATE TABLE puestos_metros_cambios (
  id BIGSERIAL PRIMARY KEY,
  puesto_id BIGINT NOT NULL REFERENCES puestos(id),
  metros_anterior NUMERIC(10,2),
  metros_nuevo NUMERIC(10,2),
  desde DATE NOT NULL,
  registrado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT puestos_metros_cambios_distintos CHECK (metros_anterior IS DISTINCT FROM metros_nuevo)
);
CREATE INDEX idx_puestos_metros_cambios ON puestos_metros_cambios (puesto_id, desde);

-- Reconstrucción: el valor nuevo de cada registro de auditoría es el previo del siguiente o, en el último, el
-- actual. Solo los registros cuyo estado previo trae el campo.
INSERT INTO comerciantes_datos_cambios (comerciante_id, campo, valor_anterior, valor_nuevo, desde, registrado_en)
SELECT cambio.comerciante_id, cambio.campo, cambio.anterior, cambio.nuevo, (cambio.fecha AT TIME ZONE 'America/Lima')::date, cambio.fecha
FROM (
  SELECT c.id AS comerciante_id, campos.campo, (l.payload_previo->>campos.campo)::int AS anterior,
         CASE WHEN LEAD(l.id) OVER w IS NULL
              THEN CASE campos.campo WHEN 'rubro_id' THEN c.rubro_id ELSE c.zona_id END
              ELSE (LEAD(l.payload_previo->>campos.campo) OVER w)::int END AS nuevo,
         l.fecha
  FROM auditoria_logs l
  JOIN comerciantes c ON c.id::text = l.recurso_id
  CROSS JOIN (VALUES ('rubro_id'), ('zona_id')) AS campos(campo)
  WHERE l.entidad = 'comerciantes' AND l.payload_previo->>campos.campo ~ '^[0-9]+$'
  WINDOW w AS (PARTITION BY c.id, campos.campo ORDER BY l.fecha, l.id)
) cambio
WHERE cambio.nuevo IS NOT NULL AND cambio.anterior <> cambio.nuevo
ORDER BY cambio.fecha;

INSERT INTO puestos_metros_cambios (puesto_id, metros_anterior, metros_nuevo, desde, registrado_en)
SELECT cambio.puesto_id, cambio.anterior, cambio.nuevo, (cambio.fecha AT TIME ZONE 'America/Lima')::date, cambio.fecha
FROM (
  SELECT p.id AS puesto_id, NULLIF(l.payload_previo->>'metros_cuadrados', '')::numeric AS anterior,
         CASE WHEN LEAD(l.id) OVER w IS NULL THEN p.metros_cuadrados
              ELSE NULLIF(LEAD(l.payload_previo->>'metros_cuadrados') OVER w, '')::numeric END AS nuevo,
         l.fecha
  FROM auditoria_logs l
  JOIN puestos p ON p.id::text = l.recurso_id
  WHERE l.entidad = 'puestos' AND l.payload_previo ? 'metros_cuadrados'
    AND (l.payload_previo->>'metros_cuadrados' IS NULL OR l.payload_previo->>'metros_cuadrados' ~ '^[0-9]+(\.[0-9]+)?$')
  WINDOW w AS (PARTITION BY p.id ORDER BY l.fecha, l.id)
) cambio
WHERE cambio.anterior IS DISTINCT FROM cambio.nuevo
ORDER BY cambio.fecha;

-- Los metros de un puesto un día: los anteriores del primer cambio posterior a ese día o, si no hubo, los actuales.
-- Aquí NULL es un valor válido (puesto sin metraje), así que no sirve COALESCE.
CREATE FUNCTION metros_de_puesto(p_id BIGINT, p_fecha DATE) RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN c.id IS NOT NULL THEN c.metros_anterior ELSE (SELECT metros_cuadrados FROM puestos WHERE id = p_id) END
  FROM (SELECT 1) AS uno
  LEFT JOIN LATERAL (
    SELECT id, metros_anterior FROM puestos_metros_cambios WHERE puesto_id = p_id AND desde > p_fecha ORDER BY desde, id LIMIT 1
  ) c ON TRUE
$$;

CREATE FUNCTION comerciante_cambia_datos() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  hoy DATE := (now() AT TIME ZONE 'America/Lima')::date;
BEGIN
  IF OLD.rubro_id IS DISTINCT FROM NEW.rubro_id THEN
    INSERT INTO comerciantes_datos_cambios (comerciante_id, campo, valor_anterior, valor_nuevo, desde)
    VALUES (NEW.id, 'rubro_id', OLD.rubro_id, NEW.rubro_id, hoy);
  END IF;
  IF OLD.zona_id IS DISTINCT FROM NEW.zona_id THEN
    INSERT INTO comerciantes_datos_cambios (comerciante_id, campo, valor_anterior, valor_nuevo, desde)
    VALUES (NEW.id, 'zona_id', OLD.zona_id, NEW.zona_id, hoy);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_comerciante_cambia_datos AFTER UPDATE OF rubro_id, zona_id ON comerciantes
  FOR EACH ROW WHEN (OLD.rubro_id IS DISTINCT FROM NEW.rubro_id OR OLD.zona_id IS DISTINCT FROM NEW.zona_id)
  EXECUTE FUNCTION comerciante_cambia_datos();

CREATE FUNCTION puesto_cambia_metros() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO puestos_metros_cambios (puesto_id, metros_anterior, metros_nuevo, desde)
  VALUES (NEW.id, OLD.metros_cuadrados, NEW.metros_cuadrados, (now() AT TIME ZONE 'America/Lima')::date);
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_puesto_cambia_metros AFTER UPDATE OF metros_cuadrados ON puestos
  FOR EACH ROW WHEN (OLD.metros_cuadrados IS DISTINCT FROM NEW.metros_cuadrados)
  EXECUTE FUNCTION puesto_cambia_metros();

COMMIT;
