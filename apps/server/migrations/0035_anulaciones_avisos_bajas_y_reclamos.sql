-- Deuda, anulaciones y reclamos (decisiones del usuario, 15/11/2026; RN-27, RN-38, RN-53 y RN-54 del plan
-- de reglas).
--
-- Hasta hoy un super_admin anulaba cualquier cobro, de cualquier fecha, solo con un motivo; la deuda se
-- acumulaba sin aviso ni forma de darla de baja; y un reclamo del comerciante no quedaba escrito en ningún lado.
--
--   anulaciones_solicitadas  un cobro de un día anterior, o de una caja ya cerrada, no lo anula una sola
--                            persona: un super_admin la pide y otro la aprueba o la rechaza.
--   avisos_deuda             aviso formal a quien debe un día cobrado desde hace 30 días o más. Un aviso por
--                            comerciante y por día impago más antiguo.
--   deuda_bajas              deuda de meses pasados dada de baja con una resolución. No borra los días
--                            cobrados: la liquidación resta la baja, como resta lo pagado.
--   reclamos_dia             reclamo de un día marcado («ese día no vine», «ya pagué»), hasta 7 días después.
--                            Lo registra y lo resuelve el super_admin.
--
-- Datos existentes: no cambia ningún cobro, marca ni deuda. Las cuatro tablas nacen vacías.
BEGIN;

CREATE TABLE anulaciones_solicitadas (
  id             BIGSERIAL PRIMARY KEY,
  transaccion_id BIGINT NOT NULL REFERENCES transacciones(id),
  motivo         TEXT NOT NULL CHECK (char_length(btrim(motivo)) BETWEEN 5 AND 300),
  solicitado_por BIGINT NOT NULL REFERENCES usuarios(id),
  solicitado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  estado         TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobada', 'rechazada')),
  resuelto_por   BIGINT REFERENCES usuarios(id),
  resuelto_en    TIMESTAMPTZ,
  resolucion     TEXT CHECK (char_length(resolucion) <= 300),
  -- Nadie aprueba lo que él mismo pidió.
  CONSTRAINT anulaciones_otro_resuelve CHECK (resuelto_por IS NULL OR resuelto_por <> solicitado_por),
  CONSTRAINT anulaciones_resuelta_completa CHECK ((estado = 'pendiente') = (resuelto_por IS NULL))
);

-- Un cobro tiene a lo más una anulación esperando respuesta.
CREATE UNIQUE INDEX anulaciones_una_pendiente ON anulaciones_solicitadas (transaccion_id) WHERE estado = 'pendiente';
CREATE INDEX idx_anulaciones_estado ON anulaciones_solicitadas (estado, id);

CREATE TABLE avisos_deuda (
  id             BIGSERIAL PRIMARY KEY,
  comerciante_id BIGINT NOT NULL REFERENCES comerciantes(id),
  deuda          NUMERIC(12,2) NOT NULL CHECK (deuda > 0),   -- deuda total el día del aviso
  dia_impago     DATE NOT NULL,                              -- el día cobrado sin pagar más antiguo
  emitido_por    BIGINT NOT NULL REFERENCES usuarios(id),
  emitido_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  observaciones  TEXT CHECK (char_length(observaciones) <= 500),
  CONSTRAINT avisos_deuda_uno_por_dia UNIQUE (comerciante_id, dia_impago)
);

CREATE TABLE deuda_bajas (
  id             BIGSERIAL PRIMARY KEY,
  comerciante_id BIGINT NOT NULL REFERENCES comerciantes(id),
  periodo        TEXT NOT NULL CHECK (periodo ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  monto          NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  resolucion     TEXT NOT NULL CHECK (char_length(btrim(resolucion)) BETWEEN 3 AND 80),   -- número de la resolución
  motivo         TEXT NOT NULL CHECK (char_length(btrim(motivo)) BETWEEN 5 AND 500),
  registrado_por BIGINT NOT NULL REFERENCES usuarios(id),
  registrado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_deuda_bajas_comerciante ON deuda_bajas (comerciante_id, periodo);

CREATE TABLE reclamos_dia (
  id             BIGSERIAL PRIMARY KEY,
  comerciante_id BIGINT NOT NULL REFERENCES comerciantes(id),
  fecha          DATE NOT NULL,                              -- el día marcado que se reclama
  tipo           TEXT NOT NULL CHECK (tipo IN ('no_asistio', 'ya_pago')),
  detalle        TEXT NOT NULL CHECK (char_length(btrim(detalle)) BETWEEN 5 AND 500),
  registrado_por BIGINT NOT NULL REFERENCES usuarios(id),
  registrado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  estado         TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'procedente', 'no_procedente')),
  resolucion     TEXT CHECK (char_length(resolucion) <= 500),
  resuelto_por   BIGINT REFERENCES usuarios(id),
  resuelto_en    TIMESTAMPTZ,
  CONSTRAINT reclamos_resuelto_completo CHECK ((estado = 'pendiente') = (resuelto_por IS NULL)),
  -- El plazo también lo cuida la base: el día reclamado no es futuro ni tiene más de 7 días (calendario de Lima).
  CONSTRAINT reclamos_dentro_del_plazo CHECK (
    fecha <= (registrado_en AT TIME ZONE 'America/Lima')::date
    AND fecha >= (registrado_en AT TIME ZONE 'America/Lima')::date - 7)
);

-- Un día de un comerciante tiene a lo más un reclamo esperando respuesta.
CREATE UNIQUE INDEX reclamos_uno_pendiente ON reclamos_dia (comerciante_id, fecha) WHERE estado = 'pendiente';
CREATE INDEX idx_reclamos_estado ON reclamos_dia (estado, id);

COMMIT;
