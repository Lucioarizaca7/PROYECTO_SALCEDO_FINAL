-- Carnet del comerciante con llave de acceso al portal (rediseño de Penpot, pantalla "Emitir carnet").
-- La llave (XXXX-XXXX-XX) va impresa en el reverso del carnet junto a un QR que la trae; convive con
-- el PIN de 6 dígitos de la 0007: el comerciante entra con cualquiera de los dos.
--
-- Va en comerciante_portal_acceso, como el PIN, para que no salga en los SELECT del padrón ni en el
-- estado previo que guarda la auditoría (Ley 29733). Se guarda solo su huella SHA-256: el QR trae la
-- llave sola, sin DNI, y hay que poder buscarla por su huella (con bcrypt no se podría).
--
-- Datos existentes: quien tiene PIN lo sigue usando; nadie tiene llave hasta que se le emita el carnet.

BEGIN;

ALTER TABLE comerciante_portal_acceso
  ALTER COLUMN pin_hash DROP NOT NULL,
  ADD COLUMN llave_hash        TEXT,                                -- SHA-256 de la llave sin guiones
  ADD COLUMN llave_emitida_en  TIMESTAMPTZ,
  ADD COLUMN llave_emitida_por INTEGER REFERENCES usuarios(id),
  ADD CONSTRAINT portal_acceso_con_credencial CHECK (pin_hash IS NOT NULL OR llave_hash IS NOT NULL);

CREATE UNIQUE INDEX portal_acceso_llave_uq ON comerciante_portal_acceso (llave_hash) WHERE llave_hash IS NOT NULL;

COMMENT ON TABLE comerciante_portal_acceso IS 'Credenciales del portal del comerciante (PIN y/o llave del carnet) y bloqueo por intentos fallidos';

COMMIT;
