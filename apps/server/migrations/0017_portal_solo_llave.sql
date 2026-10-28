-- El portal del comerciante se abre solo con la llave del carnet (decisión del usuario, 28/10/2026, como la
-- pantalla P3 del Penpot). El PIN de 6 dígitos de la 0007 deja de existir: ya no hay ruta que lo genere ni
-- login que lo acepte.
--
-- Datos existentes: quien solo tenía PIN pierde el acceso (su fila se borra) y debe pedir su carnet; quien
-- tenía PIN y llave conserva la llave. Se borra el hash del PIN porque ya no sirve (Ley 29733: no se guarda
-- un dato personal que no se usa). Volver atrás requiere el respaldo de la base, no esta migración.

BEGIN;

DELETE FROM comerciante_portal_acceso WHERE llave_hash IS NULL;

ALTER TABLE comerciante_portal_acceso
  DROP CONSTRAINT portal_acceso_con_credencial,
  DROP COLUMN pin_hash,
  ALTER COLUMN llave_hash SET NOT NULL;

COMMENT ON TABLE comerciante_portal_acceso IS 'Llave del carnet del comerciante (huella SHA-256) y bloqueo del portal por intentos fallidos';
COMMENT ON COLUMN comerciante_portal_acceso.bloqueado_hasta IS 'Tras 5 llaves erradas seguidas, 15 minutos sin poder entrar';

COMMIT;
