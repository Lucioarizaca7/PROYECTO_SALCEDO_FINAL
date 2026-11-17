-- Etapa 4 del plan de reglas (decisiones del usuario, 15/11/2026): RN-06, RN-15 y RN-64.
--
--   tarifas.norma            cada precio nuevo lleva la ordenanza o resolución que lo respalda (RN-15). Los
--                            precios que ya existían quedan sin norma hasta que el super_admin la escriba.
--   cobrador_zonas           zonas asignadas a cada cobrador (RN-64). Un cobrador sin zonas asignadas cobra
--                            en todas. Cobrar fuera de las suyas no se impide: la marca queda señalada.
--   asistencias_feriales.fuera_de_asignacion
--                            la marca se hizo en una zona que el cobrador no tenía asignada ese día. Se guarda
--                            en la marca porque la asignación cambia con el tiempo y lo pasado no cambia.
--   zona del comerciante     es siempre la de su puesto principal (RN-06): la base la sigue sola. Solo se
--                            edita a mano la de quien no tiene puesto (el eventual sin puesto).
--
-- Datos existentes: los comerciantes cuya zona no coincide con la de su puesto principal pasan a la zona del
-- puesto. El cambio rige desde hoy (queda en comerciantes_cambios, 0025): los meses pasados no cambian. Su
-- código se vuelve a armar con la zona nueva; el anterior sigue sirviendo para buscarlo (0004).
BEGIN;

-- RN-15 -----------------------------------------------------------------------------------------------------
ALTER TABLE tarifas ADD COLUMN norma TEXT CHECK (char_length(btrim(norma)) BETWEEN 3 AND 120);
COMMENT ON COLUMN tarifas.norma IS 'Ordenanza o resolución que respalda el precio. Obligatoria en los precios creados desde la migración 0036.';

-- Obligatoria solo para los precios nuevos que rigen (activos). No se usa NOT VALID: un precio viejo se actualiza al cerrarse
-- (vigencia_fin) y la restricción lo rechazaría.
DO $$
DECLARE ultimo INTEGER;
BEGIN
  SELECT COALESCE(max(id), 0) INTO ultimo FROM tarifas;
  EXECUTE format('ALTER TABLE tarifas ADD CONSTRAINT tarifas_con_norma CHECK (NOT activo OR norma IS NOT NULL OR id <= %s)', ultimo);
END $$;

-- RN-64 -----------------------------------------------------------------------------------------------------
CREATE TABLE cobrador_zonas (
  cobrador_id  BIGINT NOT NULL REFERENCES usuarios(id),
  zona_id      INTEGER NOT NULL REFERENCES zonas(id),
  asignado_por BIGINT NOT NULL REFERENCES usuarios(id),
  asignado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cobrador_id, zona_id)
);

ALTER TABLE asistencias_feriales ADD COLUMN fuera_de_asignacion BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX idx_asistencias_fuera_de_asignacion ON asistencias_feriales (fecha) WHERE fuera_de_asignacion;

-- RN-06 -----------------------------------------------------------------------------------------------------
-- El puesto principal es el de menor id entre los que tiene en uso (el mismo criterio de findMerchantPost).
CREATE FUNCTION zona_del_puesto_principal(el_comerciante BIGINT) RETURNS INTEGER LANGUAGE sql STABLE AS $$
  SELECT zona_id FROM puestos
  WHERE comerciante_id = el_comerciante AND estado NOT IN ('disponible', 'inactivo')
  ORDER BY id LIMIT 1
$$;

-- Al guardar un comerciante que tiene puesto, su zona es la del puesto principal, venga lo que venga.
-- El nombre lo pone antes de trg_comerciantes_codigo, para que el código se arme con la zona ya corregida.
CREATE FUNCTION comerciante_en_zona_de_su_puesto() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE zona INTEGER := zona_del_puesto_principal(NEW.id);
BEGIN
  IF zona IS NOT NULL THEN NEW.zona_id := zona; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_comerciantes_a_zona_de_puesto BEFORE UPDATE OF zona_id ON comerciantes
  FOR EACH ROW EXECUTE FUNCTION comerciante_en_zona_de_su_puesto();

-- Al cambiar un puesto de zona, de titular o de estado, el comerciante (el de antes y el de ahora) sigue a su
-- puesto principal.
CREATE FUNCTION puesto_mueve_al_comerciante() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.comerciante_id IS NOT NULL AND OLD.comerciante_id IS DISTINCT FROM NEW.comerciante_id THEN
    UPDATE comerciantes SET zona_id = zona_del_puesto_principal(id)
    WHERE id = OLD.comerciante_id AND zona_id IS DISTINCT FROM zona_del_puesto_principal(id) AND zona_del_puesto_principal(id) IS NOT NULL;
  END IF;
  IF NEW.comerciante_id IS NOT NULL THEN
    UPDATE comerciantes SET zona_id = zona_del_puesto_principal(id)
    WHERE id = NEW.comerciante_id AND zona_id IS DISTINCT FROM zona_del_puesto_principal(id) AND zona_del_puesto_principal(id) IS NOT NULL;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_puesto_mueve_al_comerciante AFTER INSERT OR UPDATE OF zona_id, comerciante_id, estado ON puestos
  FOR EACH ROW EXECUTE FUNCTION puesto_mueve_al_comerciante();

-- Los que hoy no coinciden.
UPDATE comerciantes SET zona_id = zona_del_puesto_principal(id)
WHERE zona_del_puesto_principal(id) IS NOT NULL AND zona_id IS DISTINCT FROM zona_del_puesto_principal(id);

COMMIT;
