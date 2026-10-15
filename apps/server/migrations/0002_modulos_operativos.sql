-- Módulos operativos que usa la API además de las 12 tablas núcleo:
-- calles, notificaciones, preferencias del comerciante y asistencias feriales.

BEGIN;

INSERT INTO roles (codigo, descripcion) VALUES
  ('super_admin', 'Administración total del sistema'),
  ('cobrador', 'Cobranza en campo'),
  ('auditor', 'Fiscalización y reportes'),
  ('comerciante', 'Consulta del propio estado de cuenta')
ON CONFLICT (codigo) DO NOTHING;

ALTER TABLE comerciantes  ADD COLUMN IF NOT EXISTS categoria TEXT;
ALTER TABLE auditoria_logs ADD COLUMN IF NOT EXISTS detalle TEXT;

CREATE TABLE calles (
  id          SERIAL PRIMARY KEY,
  nombre      TEXT NOT NULL,
  descripcion TEXT,
  zona_id     INTEGER NOT NULL REFERENCES zonas(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX uq_calles_zona_nombre ON calles (zona_id, lower(btrim(nombre)));

ALTER TABLE puestos ADD COLUMN IF NOT EXISTS calle_id INTEGER REFERENCES calles(id) ON DELETE SET NULL;

CREATE TABLE notificaciones (
  id             BIGSERIAL PRIMARY KEY,
  comerciante_id BIGINT NOT NULL REFERENCES comerciantes(id),
  tipo           TEXT NOT NULL,
  canal          TEXT NOT NULL CHECK (canal IN ('whatsapp','sms','email')),
  mensaje        TEXT NOT NULL,
  estado         TEXT NOT NULL DEFAULT 'pendiente',
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  enviado_en     TIMESTAMPTZ
);
CREATE INDEX idx_notificaciones_comerciante ON notificaciones(comerciante_id);

CREATE TABLE comerciante_preferencias (
  id             BIGSERIAL PRIMARY KEY,
  comerciante_id BIGINT NOT NULL REFERENCES comerciantes(id) ON DELETE CASCADE,
  clave          TEXT NOT NULL,
  valor          TEXT NOT NULL,
  UNIQUE (comerciante_id, clave)
);

CREATE TABLE asistencias_feriales (
  id           BIGSERIAL PRIMARY KEY,
  puesto_id    BIGINT NOT NULL REFERENCES puestos(id),
  fecha        DATE NOT NULL,
  sesion       TEXT NOT NULL DEFAULT '',
  marca        TEXT NOT NULL,
  fuente       TEXT NOT NULL,
  registrado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (puesto_id, fecha, sesion)
);

COMMIT;
