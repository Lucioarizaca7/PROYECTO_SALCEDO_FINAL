-- SISREC Salcedo - esquema objetivo PostgreSQL 15+ (12 tablas del resumen ejecutivo)
-- Núcleo: comerciantes, puestos, tarifas, transacciones
-- Seguridad: usuarios, roles, auditoria_logs
-- Soporte: colas_sincronizacion, modelos_ia_metricas
-- Catálogos: zonas, rubros, comprobantes

BEGIN;

CREATE TABLE roles (
  id          SMALLSERIAL PRIMARY KEY,
  codigo      TEXT NOT NULL UNIQUE CHECK (codigo IN ('super_admin','cobrador','auditor','comerciante')),
  descripcion TEXT,
  permisos    JSONB NOT NULL DEFAULT '[]'
);

CREATE TABLE usuarios (
  id             BIGSERIAL PRIMARY KEY,
  nombre         TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,                 -- bcrypt, nunca texto plano
  rol_id         SMALLINT NOT NULL REFERENCES roles(id),
  activo         BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE zonas (
  id          SERIAL PRIMARY KEY,
  nombre      TEXT NOT NULL,
  descripcion TEXT,
  CONSTRAINT zonas_nombre_uq UNIQUE (nombre)
);

CREATE TABLE rubros (
  id          SERIAL PRIMARY KEY,
  nombre      TEXT NOT NULL UNIQUE,
  descripcion TEXT,
  activo      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE comerciantes (
  id                       BIGSERIAL PRIMARY KEY,
  dni_ruc                  TEXT NOT NULL UNIQUE,
  nombre                   TEXT NOT NULL,
  rubro_id                 INTEGER NOT NULL REFERENCES rubros(id),
  zona_id                  INTEGER NOT NULL REFERENCES zonas(id),
  tipo_comerciante         TEXT NOT NULL CHECK (tipo_comerciante IN ('eventual','permanente','ferial')),
  estado                   TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','inactivo','pendiente')),
  estado_empadronamiento   TEXT NOT NULL DEFAULT 'REGULARIZADO'
                           CHECK (estado_empadronamiento IN ('REGULARIZADO','PENDIENTE_REGULARIZACION')),
  fecha_baja               TIMESTAMPTZ,          -- baja lógica, no DELETE
  usuario_creador_id       BIGINT REFERENCES usuarios(id),
  creado_en                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_comerciantes_estado ON comerciantes(estado);
CREATE INDEX idx_comerciantes_zona   ON comerciantes(zona_id);

CREATE TABLE puestos (
  id              BIGSERIAL PRIMARY KEY,
  comerciante_id  BIGINT NOT NULL REFERENCES comerciantes(id),
  zona_id         INTEGER NOT NULL REFERENCES zonas(id),
  codigo_puesto   TEXT NOT NULL UNIQUE,
  direccion       TEXT,
  metros_cuadrados NUMERIC(8,2),
  estado          TEXT NOT NULL DEFAULT 'ocupado'
                  CHECK (estado IN ('ocupado','disponible','reservado','inactivo')),
  latitud         NUMERIC(9,6),
  longitud        NUMERIC(9,6)
);
CREATE INDEX idx_puestos_comerciante ON puestos(comerciante_id);

CREATE TABLE tarifas (
  id              SERIAL PRIMARY KEY,
  rubro_id        INTEGER NOT NULL REFERENCES rubros(id),
  zona_id         INTEGER REFERENCES zonas(id),  -- NULL = aplica a todas las zonas
  tipo_tarifa     TEXT NOT NULL CHECK (tipo_tarifa IN ('fija','variable','mixta')),
  monto_fijo      NUMERIC(12,2) NOT NULL DEFAULT 0,
  monto_variable  NUMERIC(12,2) NOT NULL DEFAULT 0,
  unidad_medida   TEXT NOT NULL CHECK (unidad_medida IN ('diaria','semanal','mensual','metro_cuadrado')),
  vigencia_inicio DATE NOT NULL,
  vigencia_fin    DATE,
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  version         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_tarifas_busqueda ON tarifas(rubro_id, zona_id, vigencia_inicio);

CREATE TABLE comprobantes (
  id                  BIGSERIAL PRIMARY KEY,
  numero_correlativo  TEXT NOT NULL UNIQUE,
  tipo                TEXT NOT NULL CHECK (tipo IN ('boleta','recibo','pdf')),
  archivo_url         TEXT,
  estado              TEXT NOT NULL DEFAULT 'emitido',
  emitido_en          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE SEQUENCE comprobantes_recibo_seq;          -- correlativo sin COUNT(*)+1

CREATE TABLE transacciones (
  id                     BIGSERIAL PRIMARY KEY,
  comerciante_id         BIGINT NOT NULL REFERENCES comerciantes(id),
  tarifa_id              INTEGER NOT NULL REFERENCES tarifas(id),
  cobrador_id            BIGINT NOT NULL REFERENCES usuarios(id),
  comprobante_id         BIGINT REFERENCES comprobantes(id),
  monto                  NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  concepto               TEXT NOT NULL,
  metodo_pago            TEXT NOT NULL CHECK (metodo_pago IN ('efectivo','yape','plin','pos')),
  codigo_operacion       TEXT,
  hash_transaccion       TEXT NOT NULL UNIQUE,     -- idempotencia offline
  estado                 TEXT NOT NULL DEFAULT 'confirmado' CHECK (estado IN ('confirmado','anulado')),
  observaciones          TEXT,
  fecha_cobro_cliente    TIMESTAMPTZ NOT NULL,     -- momento real del cobro en campo
  fecha_registro_servidor TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT operacion_requerida CHECK (metodo_pago = 'efectivo' OR codigo_operacion IS NOT NULL)
);
CREATE UNIQUE INDEX uq_transacciones_operacion
  ON transacciones(metodo_pago, codigo_operacion) WHERE codigo_operacion IS NOT NULL;
CREATE INDEX idx_transacciones_fecha       ON transacciones(fecha_cobro_cliente);
CREATE INDEX idx_transacciones_comerciante ON transacciones(comerciante_id);
CREATE INDEX idx_transacciones_cobrador    ON transacciones(cobrador_id);

CREATE TABLE colas_sincronizacion (
  id               BIGSERIAL PRIMARY KEY,
  device_id        TEXT NOT NULL,
  entidad          TEXT NOT NULL,
  hash_transaccion TEXT NOT NULL UNIQUE,
  payload          JSONB NOT NULL,
  estado           TEXT NOT NULL DEFAULT 'pendiente'
                   CHECK (estado IN ('pendiente','procesado','duplicado','error')),
  intentos         SMALLINT NOT NULL DEFAULT 0,
  error            TEXT,
  recibido_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  procesado_en     TIMESTAMPTZ
);
CREATE INDEX idx_colas_estado ON colas_sincronizacion(estado);

CREATE TABLE auditoria_logs (
  id            BIGSERIAL PRIMARY KEY,
  usuario_id    BIGINT REFERENCES usuarios(id),
  rol           TEXT NOT NULL,
  entidad       TEXT NOT NULL,
  accion        TEXT NOT NULL,
  recurso_id    TEXT,
  metodo_http   TEXT,
  ruta          TEXT,
  ip_origen     INET,
  payload_previo JSONB,
  payload_nuevo  JSONB,
  hash_prev     TEXT,                              -- hash de la fila anterior
  hash_actual   TEXT NOT NULL,                     -- sha256(hash_prev || contenido)
  fecha         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_auditoria_entidad ON auditoria_logs(entidad, recurso_id);

CREATE FUNCTION auditoria_inmutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'auditoria_logs es de solo anexado';
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER auditoria_no_update BEFORE UPDATE OR DELETE ON auditoria_logs
  FOR EACH ROW EXECUTE FUNCTION auditoria_inmutable();

CREATE TABLE modelos_ia_metricas (
  id            BIGSERIAL PRIMARY KEY,
  modelo        TEXT NOT NULL,                     -- p.ej. 'riesgo_morosidad', 'proyeccion_ingresos'
  version       TEXT NOT NULL,
  entidad_tipo  TEXT NOT NULL,                     -- 'comerciante' | 'zona' | 'global'
  entidad_id    BIGINT,
  periodo       TEXT,
  score         NUMERIC(6,4),
  nivel         TEXT,
  valor_predicho NUMERIC(12,2),
  valor_real     NUMERIC(12,2),
  metricas      JSONB NOT NULL DEFAULT '{}',
  generado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ia_modelo ON modelos_ia_metricas(modelo, entidad_tipo, entidad_id, generado_en DESC);

COMMIT;
