-- Cierre de caja diario por cobrador: al terminar la jornada el cobrador declara cuánto tiene por método
-- (efectivo, Yape, Plin, POS) y el sistema lo compara con lo que registró ese día. Un cierre por cobrador
-- y día; lo esperado lo calcula siempre el servidor, nunca el celular.
--
-- Datos existentes: no hay cierres anteriores; la tabla empieza vacía.

BEGIN;

CREATE TABLE cierres_caja (
  id                 BIGSERIAL PRIMARY KEY,
  cobrador_id        BIGINT NOT NULL REFERENCES usuarios(id),
  fecha              DATE NOT NULL,                       -- día de la jornada en hora de Lima
  esperado_efectivo  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (esperado_efectivo >= 0),
  esperado_yape      NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (esperado_yape >= 0),
  esperado_plin      NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (esperado_plin >= 0),
  esperado_pos       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (esperado_pos >= 0),
  declarado_efectivo NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (declarado_efectivo >= 0),
  declarado_yape     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (declarado_yape >= 0),
  declarado_plin     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (declarado_plin >= 0),
  declarado_pos      NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (declarado_pos >= 0),
  cobros             INTEGER NOT NULL DEFAULT 0 CHECK (cobros >= 0),
  -- declarado − esperado: positivo = sobra dinero; negativo = falta.
  diferencia         NUMERIC(12,2) GENERATED ALWAYS AS (
                       (declarado_efectivo + declarado_yape + declarado_plin + declarado_pos)
                       - (esperado_efectivo + esperado_yape + esperado_plin + esperado_pos)) STORED,
  observaciones      TEXT,
  cerrado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
  revisado_por       BIGINT REFERENCES usuarios(id),
  revisado_en        TIMESTAMPTZ,
  CONSTRAINT cierres_caja_uno_por_dia UNIQUE (cobrador_id, fecha)
);

CREATE INDEX idx_cierres_caja_fecha ON cierres_caja (fecha);

COMMIT;
