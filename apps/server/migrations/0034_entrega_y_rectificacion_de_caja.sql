-- Caja: justificación de diferencias, entrega del dinero y rectificación del cierre
-- (decisiones del usuario, 15/11/2026; RN-41 a RN-44 del plan de reglas).
--
-- Hasta hoy el sistema sabía cuánto cobró cada cobrador y cuánto declaró, pero no quedaba registro de que el
-- dinero llegó a la municipalidad, una diferencia no pedía explicación y un cierre con un error no se podía
-- corregir.
--
--   cierres_caja.justificacion   obligatoria si hay faltante (cualquier monto) o un sobrante de S/ 5 o más.
--   entregas_caja                el super_admin registra que recibió el efectivo de un cierre: cuánto, quién
--                                y cuándo. Una entrega por cierre; los cobros que entran después del cierre
--                                (sincronizados tarde) se entregan aparte, como entrega complementaria.
--   cierres_caja_rectificaciones el cierre no se edita. Un error se corrige con una rectificación del
--                                super_admin, con los montos corregidos y el motivo. Vale la última.
--
-- Datos existentes: los cierres anteriores quedan como están. La regla de la justificación se crea NOT VALID:
-- rige para los cierres nuevos y no obliga a inventar una justificación para los viejos.
BEGIN;

ALTER TABLE cierres_caja
  ADD COLUMN justificacion TEXT CHECK (char_length(btrim(justificacion)) BETWEEN 5 AND 500);

ALTER TABLE cierres_caja
  ADD CONSTRAINT cierres_caja_diferencia_justificada
  CHECK (justificacion IS NOT NULL OR (diferencia >= 0 AND diferencia < 5)) NOT VALID;

CREATE TABLE entregas_caja (
  id            BIGSERIAL PRIMARY KEY,
  cierre_id     BIGINT NOT NULL REFERENCES cierres_caja(id),
  tipo          TEXT NOT NULL DEFAULT 'cierre' CHECK (tipo IN ('cierre', 'complementaria')),
  monto         NUMERIC(12,2) NOT NULL CHECK (monto >= 0),   -- efectivo recibido
  recibido_por  BIGINT NOT NULL REFERENCES usuarios(id),
  recibido_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  observaciones TEXT CHECK (char_length(observaciones) <= 500)
);

-- El efectivo de un cierre se entrega una sola vez; las complementarias pueden ser varias.
CREATE UNIQUE INDEX entregas_caja_una_por_cierre ON entregas_caja (cierre_id) WHERE tipo = 'cierre';
CREATE INDEX idx_entregas_caja_cierre ON entregas_caja (cierre_id);

CREATE TABLE cierres_caja_rectificaciones (
  id                 BIGSERIAL PRIMARY KEY,
  cierre_id          BIGINT NOT NULL REFERENCES cierres_caja(id),
  declarado_efectivo NUMERIC(12,2) NOT NULL CHECK (declarado_efectivo >= 0),
  declarado_yape     NUMERIC(12,2) NOT NULL CHECK (declarado_yape >= 0),
  declarado_plin     NUMERIC(12,2) NOT NULL CHECK (declarado_plin >= 0),
  declarado_pos      NUMERIC(12,2) NOT NULL CHECK (declarado_pos >= 0),
  motivo             TEXT NOT NULL CHECK (char_length(btrim(motivo)) BETWEEN 5 AND 500),
  rectificado_por    BIGINT NOT NULL REFERENCES usuarios(id),
  rectificado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rectificaciones_cierre ON cierres_caja_rectificaciones (cierre_id, id);

COMMIT;
