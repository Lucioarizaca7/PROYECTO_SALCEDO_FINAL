-- Tickets preimpresos de cobro: el comerciante recibe un ticket de papel numerado por cada puesto y día
-- cobrado. Hay una serie por tipo de vía (S/ 3 asfaltada, S/ 2 sin asfaltar). El administrador entrega a
-- cada cobrador un rango de números (lote) y el celular le indica qué número entregar.
--
--   ticket_series        una serie por tipo de vía, con el valor impreso en el ticket.
--   ticket_lotes         rango de números entregado a un cobrador (o recibido por reasignación).
--   tickets              cada número: disponible, usado (con su cobro), anulado (con motivo) o devuelto.
--                        UNIQUE (serie, numero): un número existe una sola vez, así dos lotes de la misma
--                        serie no pueden cruzarse. Al reasignar, el ticket cambia de lote.
--   transacciones.tickets  los tickets que declaró el cobrador, también si no pasaron la validación
--                        (el cobro sin señal queda observado y la revisión ve qué número dijo).
--   cierres_caja.tickets   resumen de tickets del día al cerrar la caja.
--
-- Datos existentes: no hay lotes; un cobrador sin tickets asignados sigue cobrando sin ticket.

BEGIN;

CREATE TABLE ticket_series (
  codigo    TEXT PRIMARY KEY,
  valor     NUMERIC(8,2) NOT NULL CHECK (valor > 0),
  tipo_via  TEXT NOT NULL UNIQUE CHECK (tipo_via IN ('asfaltada', 'sin_asfaltar')),
  activa    BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO ticket_series (codigo, valor, tipo_via) VALUES ('S3', 3, 'asfaltada'), ('S2', 2, 'sin_asfaltar');

CREATE TABLE ticket_lotes (
  id              BIGSERIAL PRIMARY KEY,
  serie           TEXT NOT NULL REFERENCES ticket_series(codigo),
  numero_desde    INTEGER NOT NULL CHECK (numero_desde > 0),
  numero_hasta    INTEGER NOT NULL,
  cobrador_id     BIGINT NOT NULL REFERENCES usuarios(id),
  asignado_por    BIGINT REFERENCES usuarios(id),
  asignado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  estado          TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'cerrado')),
  lote_origen_id  BIGINT REFERENCES ticket_lotes(id),
  observacion     TEXT CHECK (char_length(observacion) <= 300),
  CONSTRAINT ticket_lotes_rango CHECK (numero_hasta >= numero_desde AND numero_hasta - numero_desde < 5000)
);

CREATE INDEX idx_ticket_lotes_cobrador ON ticket_lotes (cobrador_id, estado);

CREATE TABLE tickets (
  id                BIGSERIAL PRIMARY KEY,
  serie             TEXT NOT NULL REFERENCES ticket_series(codigo),
  numero            INTEGER NOT NULL,
  lote_id           BIGINT NOT NULL REFERENCES ticket_lotes(id),
  estado            TEXT NOT NULL DEFAULT 'disponible' CHECK (estado IN ('disponible', 'usado', 'anulado', 'devuelto')),
  transaccion_id    BIGINT REFERENCES transacciones(id),
  motivo            TEXT CHECK (char_length(motivo) <= 300),  -- por qué se anuló o se devolvió
  usado_en          TIMESTAMPTZ,                              -- hora del cobro (la del celular)
  baja_en           TIMESTAMPTZ,                              -- hora de la anulación o la devolución
  registrado_por    BIGINT REFERENCES usuarios(id),
  CONSTRAINT tickets_numero_unico UNIQUE (serie, numero),
  CONSTRAINT tickets_usado_con_cobro CHECK (estado <> 'usado' OR transaccion_id IS NOT NULL),
  CONSTRAINT tickets_baja_con_motivo CHECK (estado NOT IN ('anulado', 'devuelto') OR motivo IS NOT NULL)
);

CREATE INDEX idx_tickets_lote_estado ON tickets (lote_id, estado);
CREATE INDEX idx_tickets_transaccion ON tickets (transaccion_id) WHERE transaccion_id IS NOT NULL;

ALTER TABLE transacciones ADD COLUMN tickets JSONB;
ALTER TABLE cierres_caja ADD COLUMN tickets JSONB;

INSERT INTO parametros_sistema (clave, valor, descripcion)
VALUES ('tickets_umbral_aviso', '20', 'Cantidad de tickets de una serie desde la que se avisa al cobrador que le quedan pocos')
ON CONFLICT (clave) DO NOTHING;

COMMIT;
