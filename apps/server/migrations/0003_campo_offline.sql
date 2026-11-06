-- Fase 2: trabajo en campo y offline.
--  * sesiones_dispositivo: token de renovación (12 h) por celular, revocable desde el panel.
--  * cobros_observados: cobro offline aceptado que necesita revisión manual (p. ej. excede el saldo).

BEGIN;

CREATE TABLE sesiones_dispositivo (
  id             BIGSERIAL PRIMARY KEY,
  usuario_id     BIGINT NOT NULL REFERENCES usuarios(id),
  device_id      TEXT NOT NULL,
  device_nombre  TEXT,
  token_hash     TEXT NOT NULL UNIQUE,              -- sha256 del token de renovación; el token nunca se guarda
  ip_origen      TEXT,
  user_agent     TEXT,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_uso_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira_en      TIMESTAMPTZ NOT NULL,
  revocado_en    TIMESTAMPTZ,
  revocado_por   BIGINT REFERENCES usuarios(id),
  motivo_revocacion TEXT
);
CREATE INDEX idx_sesiones_usuario ON sesiones_dispositivo(usuario_id);
-- Un dispositivo tiene a lo sumo una sesión vigente por usuario.
CREATE UNIQUE INDEX uq_sesiones_dispositivo_activa
  ON sesiones_dispositivo(usuario_id, device_id) WHERE revocado_en IS NULL;

CREATE TABLE cobros_observados (
  id                   BIGSERIAL PRIMARY KEY,
  transaccion_id       BIGINT NOT NULL UNIQUE REFERENCES transacciones(id),
  motivo               TEXT NOT NULL,
  saldo_al_sincronizar NUMERIC(12,2) NOT NULL,
  monto                NUMERIC(12,2) NOT NULL,
  device_id            TEXT,
  estado               TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aceptado','anulado')),
  resolucion           TEXT,
  revisado_por         BIGINT REFERENCES usuarios(id),
  revisado_en          TIMESTAMPTZ,
  creado_en            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cobros_observados_estado ON cobros_observados(estado);

-- Nuevo estado de la cola del servidor: el cobro se aceptó pero quedó en revisión.
ALTER TABLE colas_sincronizacion DROP CONSTRAINT IF EXISTS colas_sincronizacion_estado_check;
ALTER TABLE colas_sincronizacion ADD CONSTRAINT colas_sincronizacion_estado_check
  CHECK (estado IN ('pendiente','procesado','duplicado','error','observado'));

COMMIT;
