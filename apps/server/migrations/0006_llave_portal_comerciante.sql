-- Carnet del comerciante: una llave de acceso al portal, impresa en el carnet que se entrega en
-- caja. Solo se guarda su huella SHA-256; emitir un carnet nuevo anula la llave anterior y las
-- sesiones abiertas con ella (llave_version).

BEGIN;

ALTER TABLE comerciantes
  ADD COLUMN IF NOT EXISTS llave_hash            TEXT,
  ADD COLUMN IF NOT EXISTS llave_version         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS llave_emitida_en      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS llave_intentos        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS llave_bloqueada_hasta TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_comerciantes_llave_hash ON comerciantes (llave_hash) WHERE llave_hash IS NOT NULL;

COMMIT;
