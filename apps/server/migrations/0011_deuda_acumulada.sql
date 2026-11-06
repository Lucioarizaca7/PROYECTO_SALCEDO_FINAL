-- Deuda acumulada: los meses impagos se suman desde el mes de alta del comerciante, pero nunca antes del
-- "inicio de cobro" que fija el administrador (así no aparece deuda de meses en que el sistema no existía).
--
--   parametros_sistema          valores que el administrador cambia sin tocar código (inicio_cobro = AAAA-MM).
--   transacciones.periodo_aplicado  mes al que se aplicó el cobro. Un pago hecho hoy puede cancelar un mes
--                               anterior. NULL = el mes (de Lima) en que se cobró, como hasta ahora.
--
-- Datos existentes: los cobros anteriores quedan con periodo_aplicado NULL, así que cuentan para el mes en
-- que se hicieron y ninguna liquidación cambia. inicio_cobro arranca en diciembre de 2026 (piloto).

BEGIN;

CREATE TABLE parametros_sistema (
  clave           TEXT PRIMARY KEY,
  valor           TEXT NOT NULL,
  descripcion     TEXT,
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_por BIGINT REFERENCES usuarios(id),
  CONSTRAINT parametros_inicio_cobro_valido CHECK (clave <> 'inicio_cobro' OR valor ~ '^\d{4}-(0[1-9]|1[0-2])$')
);

INSERT INTO parametros_sistema (clave, valor, descripcion)
VALUES ('inicio_cobro', '2026-12', 'Primer mes desde el que se suma la deuda acumulada (AAAA-MM)');

ALTER TABLE transacciones
  ADD COLUMN periodo_aplicado TEXT CHECK (periodo_aplicado ~ '^\d{4}-(0[1-9]|1[0-2])$');

CREATE INDEX idx_transacciones_periodo_aplicado ON transacciones (comerciante_id, periodo_aplicado);

COMMIT;
