-- Zona del día y cobro por puesto (decisiones del usuario del 12/11/2026).
--
-- 1. Zona del día: cuando faltan otros comerciantes, uno puede vender ese día en otra zona y se le cobra con la
--    tarifa de esa zona (asfaltada S/ 3, sin asfaltar S/ 2). El cobrador la elige al marcar o al cobrar
--    (asistencias_feriales.zona_id; el tipo de vía lo pone el trigger de la 0021). Al cambiar la zona de un puesto,
--    el trigger de la 0019 pasaba a la zona nueva todas sus marcas desde hoy y borraba la zona del día elegida a
--    mano: ahora solo mueve las marcas que estaban en la zona anterior del puesto.
--
-- 2. Puestos cobrados: la cuota mensual o diaria por rubro se paga por cada puesto desde noviembre de 2026
--    (COBRO_POR_PUESTO_DESDE en db.js). Para que un mes cerrado no cambie al ceder o liberar un puesto después,
--    se guarda qué puestos tuvo cada comerciante y cuándo:
--
--      puestos_tenencia   un tramo por puesto y titular (desde, hasta inclusive; hasta NULL = sigue). Cuenta
--                         mientras el puesto está ocupado o reservado con ese titular, el mismo criterio que la
--                         liquidación usa para el puesto principal. Lo mantiene un trigger: ningún camino
--                         (Sitios, mapa, padrón) se lo salta.
--
--    Datos existentes: un tramo abierto desde el 2026-11-01 por cada puesto que hoy cuenta. Lo cedido o liberado
--    antes de esta migración no se puede reconstruir.
BEGIN;

CREATE OR REPLACE FUNCTION puesto_cambia_zona() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  hoy DATE := (now() AT TIME ZONE 'America/Lima')::date;
  provisional BOOLEAN := OLD.zona_por_regularizar IS NOT NULL;
BEGIN
  INSERT INTO puestos_zona_cambios (puesto_id, zona_anterior_id, zona_nueva_id, desde, corrige_pasado)
  VALUES (NEW.id, OLD.zona_id, NEW.zona_id, hoy, provisional);

  -- La zona nueva rige desde hoy para las marcas que seguían al puesto; una zona del día elegida a mano se queda.
  UPDATE asistencias_feriales SET zona_id = NEW.zona_id
  WHERE puesto_id = NEW.id AND zona_id = OLD.zona_id AND (provisional OR fecha >= hoy);
  RETURN NULL;
END;
$$;

CREATE TABLE puestos_tenencia (
  id BIGSERIAL PRIMARY KEY,
  puesto_id BIGINT NOT NULL REFERENCES puestos(id),
  comerciante_id BIGINT NOT NULL REFERENCES comerciantes(id),
  desde DATE NOT NULL,
  hasta DATE,
  registrado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT puestos_tenencia_fechas CHECK (hasta IS NULL OR hasta >= desde)
);
CREATE INDEX idx_puestos_tenencia_comerciante ON puestos_tenencia (comerciante_id, desde);
-- Un puesto tiene a lo más un tramo abierto.
CREATE UNIQUE INDEX uq_puestos_tenencia_abierta ON puestos_tenencia (puesto_id) WHERE hasta IS NULL;

INSERT INTO puestos_tenencia (puesto_id, comerciante_id, desde)
SELECT id, comerciante_id, DATE '2026-11-01' FROM puestos
WHERE comerciante_id IS NOT NULL AND estado IN ('ocupado', 'reservado');

CREATE FUNCTION puesto_cambia_tenencia() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  hoy DATE := (now() AT TIME ZONE 'America/Lima')::date;
  contaba BOOLEAN := TG_OP = 'UPDATE' AND OLD.comerciante_id IS NOT NULL AND OLD.estado IN ('ocupado', 'reservado');
  cuenta BOOLEAN := NEW.comerciante_id IS NOT NULL AND NEW.estado IN ('ocupado', 'reservado');
  mismo BOOLEAN := TG_OP = 'UPDATE' AND OLD.comerciante_id IS NOT DISTINCT FROM NEW.comerciante_id;
BEGIN
  IF contaba AND (NOT cuenta OR NOT mismo) THEN
    -- El día en que se cede o se libera también lo tuvo: hasta es inclusive.
    UPDATE puestos_tenencia SET hasta = hoy WHERE puesto_id = NEW.id AND hasta IS NULL;
  END IF;
  IF cuenta AND NOT (contaba AND mismo) THEN
    INSERT INTO puestos_tenencia (puesto_id, comerciante_id, desde) VALUES (NEW.id, NEW.comerciante_id, hoy)
    ON CONFLICT (puesto_id) WHERE hasta IS NULL DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_puesto_tenencia_alta AFTER INSERT ON puestos
  FOR EACH ROW EXECUTE FUNCTION puesto_cambia_tenencia();
CREATE TRIGGER trg_puesto_tenencia_cambio AFTER UPDATE OF comerciante_id, estado ON puestos
  FOR EACH ROW WHEN (OLD.comerciante_id IS DISTINCT FROM NEW.comerciante_id OR OLD.estado IS DISTINCT FROM NEW.estado)
  EXECUTE FUNCTION puesto_cambia_tenencia();

COMMIT;
