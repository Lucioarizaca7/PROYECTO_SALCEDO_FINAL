-- Código de negocio del comerciante (identificador de dominio autoexplicativo).
--
--   COM-{correlativo}-{iniciales}-{rubro}-{documento}-{zona}-{estado}-{AAAAMMDD}
--   COM-0004-LAC-COMI-75163744-MCEN-ACT-20261016   (0005 deja solo los 3 últimos dígitos del documento)
--
-- El correlativo nunca cambia; lo demás se recalcula al cambiar el nombre, el rubro, la zona o el estado.
-- Los códigos anteriores quedan en comerciante_codigos_historicos para que los QR y recibos impresos sigan
-- encontrando al comerciante. El código lo arma la base (trigger), así ningún INSERT/UPDATE se lo salta.

BEGIN;

-- Rubros y zonas: código corto para el código del comerciante ------------------------------------------

-- "Mercado Central" -> MCEN, "Zona Norte" -> ZNOR, "SALCEDO" -> SALC, "comida" -> COMI.
CREATE FUNCTION abreviar_catalogo(nombre TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  WITH limpio AS (
    SELECT regexp_split_to_array(
             btrim(regexp_replace(upper(translate(coalesce(nombre, ''), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')), '[^A-Z0-9]+', ' ', 'g')),
             ' ') AS palabras
  )
  SELECT CASE
           WHEN palabras[1] = '' THEN 'XXXX'
           WHEN array_length(palabras, 1) = 1 THEN left(palabras[1], 4)
           ELSE left(palabras[1], 1) || left(palabras[2], 3)
         END
  FROM limpio
$$;

-- Asigna un código libre en la tabla indicada (MCEN, MCEN2, MCEN3…).
CREATE FUNCTION codigo_catalogo_libre(tabla TEXT, base TEXT, propio_id INTEGER) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
  candidato TEXT := base;
  n INTEGER := 1;
  ocupado BOOLEAN;
BEGIN
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE codigo = $1 AND id IS DISTINCT FROM $2)', tabla)
      INTO ocupado USING candidato, propio_id;
    EXIT WHEN NOT ocupado;
    n := n + 1;
    candidato := base || n;
  END LOOP;
  RETURN candidato;
END $$;

CREATE FUNCTION asignar_codigo_catalogo() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.codigo IS NULL OR btrim(NEW.codigo) = '' THEN
    NEW.codigo := codigo_catalogo_libre(TG_TABLE_NAME, abreviar_catalogo(NEW.nombre), NEW.id);
  ELSE
    NEW.codigo := upper(regexp_replace(NEW.codigo, '[^A-Za-z0-9]', '', 'g'));
  END IF;
  RETURN NEW;
END $$;

ALTER TABLE rubros ADD COLUMN codigo TEXT;
ALTER TABLE zonas  ADD COLUMN codigo TEXT;
DO $$
DECLARE fila RECORD;
BEGIN
  FOR fila IN SELECT id, nombre FROM rubros ORDER BY id LOOP
    UPDATE rubros SET codigo = codigo_catalogo_libre('rubros', abreviar_catalogo(fila.nombre), fila.id) WHERE id = fila.id;
  END LOOP;
  FOR fila IN SELECT id, nombre FROM zonas ORDER BY id LOOP
    UPDATE zonas SET codigo = codigo_catalogo_libre('zonas', abreviar_catalogo(fila.nombre), fila.id) WHERE id = fila.id;
  END LOOP;
END $$;
ALTER TABLE rubros ALTER COLUMN codigo SET NOT NULL, ADD CONSTRAINT rubros_codigo_uq UNIQUE (codigo);
ALTER TABLE zonas  ALTER COLUMN codigo SET NOT NULL, ADD CONSTRAINT zonas_codigo_uq  UNIQUE (codigo);

CREATE TRIGGER trg_rubros_codigo BEFORE INSERT OR UPDATE OF codigo ON rubros FOR EACH ROW EXECUTE FUNCTION asignar_codigo_catalogo();
CREATE TRIGGER trg_zonas_codigo  BEFORE INSERT OR UPDATE OF codigo ON zonas  FOR EACH ROW EXECUTE FUNCTION asignar_codigo_catalogo();

-- Comerciantes -------------------------------------------------------------------------------------------

-- La categoría repetía el tipo de comerciante; queda solo tipo_comerciante.
UPDATE comerciantes SET tipo_comerciante = categoria
WHERE categoria IN ('eventual', 'permanente', 'ferial') AND categoria <> tipo_comerciante;
ALTER TABLE comerciantes DROP COLUMN categoria;

CREATE SEQUENCE comerciantes_correlativo_seq;
ALTER TABLE comerciantes ADD COLUMN correlativo INTEGER;
UPDATE comerciantes SET correlativo = id;
SELECT setval('comerciantes_correlativo_seq', GREATEST(COALESCE((SELECT MAX(correlativo) FROM comerciantes), 0), 1),
              (SELECT COUNT(*) > 0 FROM comerciantes));
ALTER TABLE comerciantes
  ALTER COLUMN correlativo SET DEFAULT nextval('comerciantes_correlativo_seq'),
  ALTER COLUMN correlativo SET NOT NULL,
  ADD CONSTRAINT comerciantes_correlativo_uq UNIQUE (correlativo);
ALTER SEQUENCE comerciantes_correlativo_seq OWNED BY comerciantes.correlativo;

-- "Lucio Arizaca Carrión" -> LAC, "Comercial Ñuñoa SAC" -> CNS, "SADASD" -> S.
CREATE FUNCTION iniciales_nombre(nombre TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(NULLIF(string_agg(left(palabra, 1), '' ORDER BY orden), ''), 'X')
  FROM unnest(regexp_split_to_array(
         btrim(regexp_replace(upper(translate(coalesce(nombre, ''), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')), '[^A-Z0-9]+', ' ', 'g')),
         ' ')) WITH ORDINALITY AS t(palabra, orden)
  WHERE palabra <> ''
$$;

CREATE FUNCTION abreviar_estado_comerciante(estado TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE estado WHEN 'activo' THEN 'ACT' WHEN 'inactivo' THEN 'INA' WHEN 'pendiente' THEN 'PEN' ELSE 'XXX' END
$$;

CREATE FUNCTION armar_codigo_comerciante(
  correlativo INTEGER, nombre TEXT, rubro_codigo TEXT, documento TEXT, zona_codigo TEXT, estado TEXT, creado_en TIMESTAMPTZ
) RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT concat_ws('-',
    'COM',
    lpad(correlativo::text, 4, '0'),
    iniciales_nombre(nombre),
    rubro_codigo,
    documento,
    zona_codigo,
    abreviar_estado_comerciante(estado),
    to_char(creado_en AT TIME ZONE 'America/Lima', 'YYYYMMDD'))
$$;

ALTER TABLE comerciantes ADD COLUMN codigo TEXT;

CREATE FUNCTION asignar_codigo_comerciante() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.codigo := armar_codigo_comerciante(
    NEW.correlativo, NEW.nombre,
    (SELECT codigo FROM rubros WHERE id = NEW.rubro_id),
    NEW.dni_ruc,
    (SELECT codigo FROM zonas WHERE id = NEW.zona_id),
    NEW.estado, NEW.creado_en);
  RETURN NEW;
END $$;

CREATE TRIGGER trg_comerciantes_codigo BEFORE INSERT OR UPDATE ON comerciantes
  FOR EACH ROW EXECUTE FUNCTION asignar_codigo_comerciante();

UPDATE comerciantes SET codigo = NULL;   -- dispara el trigger para los existentes
ALTER TABLE comerciantes ALTER COLUMN codigo SET NOT NULL, ADD CONSTRAINT comerciantes_codigo_uq UNIQUE (codigo);

-- Historial de códigos -----------------------------------------------------------------------------------

CREATE TABLE comerciante_codigos_historicos (
  id             BIGSERIAL PRIMARY KEY,
  comerciante_id BIGINT NOT NULL REFERENCES comerciantes(id) ON DELETE CASCADE,
  codigo         TEXT NOT NULL,
  reemplazado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  motivo         TEXT NOT NULL
);
CREATE INDEX idx_codigos_historicos_codigo ON comerciante_codigos_historicos (upper(codigo));
CREATE INDEX idx_codigos_historicos_comerciante ON comerciante_codigos_historicos (comerciante_id);

-- El código de antes (CM-004) sigue impreso en QR y recibos.
INSERT INTO comerciante_codigos_historicos (comerciante_id, codigo, motivo)
SELECT id, 'CM-' || lpad(id::text, 3, '0'), 'Código anterior al formato COM'
FROM comerciantes;

CREATE FUNCTION guardar_codigo_anterior() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cambios TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF OLD.codigo IS NOT DISTINCT FROM NEW.codigo THEN RETURN NEW; END IF;
  IF OLD.nombre   IS DISTINCT FROM NEW.nombre   THEN cambios := array_append(cambios, 'nombre'); END IF;
  IF OLD.rubro_id IS DISTINCT FROM NEW.rubro_id THEN cambios := array_append(cambios, 'rubro'); END IF;
  IF OLD.dni_ruc  IS DISTINCT FROM NEW.dni_ruc  THEN cambios := array_append(cambios, 'documento'); END IF;
  IF OLD.zona_id  IS DISTINCT FROM NEW.zona_id  THEN cambios := array_append(cambios, 'zona'); END IF;
  IF OLD.estado   IS DISTINCT FROM NEW.estado   THEN cambios := array_append(cambios, 'estado'); END IF;
  INSERT INTO comerciante_codigos_historicos (comerciante_id, codigo, motivo)
  VALUES (OLD.id, OLD.codigo,
          'Cambio de ' || COALESCE(NULLIF(array_to_string(cambios, ', '), ''), 'código de rubro o zona'));
  RETURN NEW;
END $$;

CREATE TRIGGER trg_comerciantes_codigo_historial AFTER UPDATE ON comerciantes
  FOR EACH ROW EXECUTE FUNCTION guardar_codigo_anterior();

-- Si cambia el código de un rubro o de una zona, se rearman los códigos de sus comerciantes.
CREATE FUNCTION recalcular_codigos_por_catalogo() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.codigo IS DISTINCT FROM NEW.codigo THEN
    IF TG_TABLE_NAME = 'rubros' THEN
      UPDATE comerciantes SET codigo = codigo WHERE rubro_id = NEW.id;
    ELSE
      UPDATE comerciantes SET codigo = codigo WHERE zona_id = NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_rubros_recalcular AFTER UPDATE OF codigo ON rubros FOR EACH ROW EXECUTE FUNCTION recalcular_codigos_por_catalogo();
CREATE TRIGGER trg_zonas_recalcular  AFTER UPDATE OF codigo ON zonas  FOR EACH ROW EXECUTE FUNCTION recalcular_codigos_por_catalogo();

COMMIT;
