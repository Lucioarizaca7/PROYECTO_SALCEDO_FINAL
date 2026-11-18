-- Anulación con un solo super administrador activo (decisión del usuario, 18/11/2026; RN-38 y RN-61).
--
-- Desde la 0035, un cobro de otro día o de una caja ya cerrada no lo anula una sola persona: uno pide y el otro
-- super administrador aprueba. Con un solo super administrador activo (por ejemplo en el piloto, antes de que
-- se designe al suplente) esa anulación quedaba pendiente para siempre.
--
-- Ahora, si quien anula es el único super administrador activo, anula él solo con motivo. La anulación queda
-- escrita en anulaciones_solicitadas como aprobada por él mismo y señalada (sin_segundo_admin), y sale en la
-- revisión mensual hasta que otro super administrador la marque revisada.
--
--   sin_segundo_admin   la anuló una sola persona porque no había otro super administrador activo.
--   revisada_por/_en    quien la revisó después (nunca quien la anuló) y cuándo.
--   revision            lo que anotó al revisarla.
--
-- Datos existentes: ninguna fila cambia; las anulaciones anteriores quedan con sin_segundo_admin = false.
-- Se migra después de la 0037 (solo efectivo) o antes: no dependen una de otra.
BEGIN;

ALTER TABLE anulaciones_solicitadas
  ADD COLUMN sin_segundo_admin BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN revisada_por      BIGINT REFERENCES usuarios(id),
  ADD COLUMN revisada_en       TIMESTAMPTZ,
  ADD COLUMN revision          TEXT CHECK (char_length(revision) <= 300);

-- Antes nadie resolvía lo que él mismo pidió. La única excepción es la anulación sin segundo administrador, que
-- además nace aprobada por quien la hizo.
ALTER TABLE anulaciones_solicitadas DROP CONSTRAINT anulaciones_otro_resuelve;
ALTER TABLE anulaciones_solicitadas ADD CONSTRAINT anulaciones_otro_resuelve
  CHECK (resuelto_por IS NULL OR resuelto_por <> solicitado_por OR sin_segundo_admin);
ALTER TABLE anulaciones_solicitadas ADD CONSTRAINT anulaciones_sin_segundo_completa
  CHECK (NOT sin_segundo_admin OR (estado = 'aprobada' AND resuelto_por = solicitado_por));

-- Solo se revisa una anulación señalada, la revisa otra persona y la revisión queda completa.
ALTER TABLE anulaciones_solicitadas ADD CONSTRAINT anulaciones_revision_completa
  CHECK ((revisada_por IS NULL) = (revisada_en IS NULL)
         AND (revisada_por IS NULL OR (sin_segundo_admin AND revisada_por <> solicitado_por)));

CREATE INDEX idx_anulaciones_sin_revisar ON anulaciones_solicitadas (id) WHERE sin_segundo_admin AND revisada_por IS NULL;

COMMIT;
