-- Portal del comerciante con segundo factor: además del DNI o del código, un PIN de 6 dígitos
-- que la municipalidad imprime en el carnet QR. Antes bastaba conocer el DNI de alguien para ver
-- sus pagos y su deuda.
--
-- El PIN va en una tabla aparte (y no en comerciantes) para que no aparezca en los SELECT * del
-- padrón ni en el estado previo que guarda la auditoría.
--
-- Datos existentes: ningún comerciante tiene PIN todavía, así que el portal queda cerrado para todos
-- hasta que el personal genere el PIN de cada uno desde el carnet QR (Comerciantes → Ver QR).

BEGIN;

CREATE TABLE comerciante_portal_acceso (
  comerciante_id     INTEGER PRIMARY KEY REFERENCES comerciantes(id) ON DELETE CASCADE,
  pin_hash           TEXT NOT NULL,                       -- bcrypt; el PIN en claro se muestra una sola vez
  creado_en          TIMESTAMPTZ NOT NULL DEFAULT now(),
  creado_por         INTEGER REFERENCES usuarios(id),
  intentos_fallidos  INTEGER NOT NULL DEFAULT 0 CHECK (intentos_fallidos >= 0),
  bloqueado_hasta    TIMESTAMPTZ,                         -- tras 5 PIN errados seguidos, 15 minutos sin poder entrar
  ultimo_ingreso     TIMESTAMPTZ
);

COMMENT ON TABLE comerciante_portal_acceso IS 'PIN del portal del comerciante (segundo factor) y bloqueo por intentos fallidos';

COMMIT;
