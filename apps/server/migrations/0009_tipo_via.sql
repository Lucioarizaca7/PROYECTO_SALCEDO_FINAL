-- Tarifa por tipo de vía: en Salcedo la vía asfaltada cobra distinto que la vía sin asfaltar
-- (S/ 3 y S/ 2 por día según el Capítulo II; los montos vigentes los fija la ordenanza).
--
-- El tipo de vía es un atributo de la zona. Una tarifa puede ser para una zona concreta, para un tipo
-- de vía o general del rubro; al liquidar gana la más específica: zona > tipo de vía > general.
-- Una tarifa no puede ser a la vez de una zona y de un tipo de vía.
--
-- Datos existentes: ninguna zona tiene tipo de vía todavía (NULL = sin dato) y las tarifas actuales
-- siguen siendo de zona o generales, así que ninguna liquidación cambia hasta que se carguen.

BEGIN;

ALTER TABLE zonas
  ADD COLUMN tipo_via TEXT CHECK (tipo_via IN ('asfaltada', 'sin_asfaltar'));

ALTER TABLE tarifas
  ADD COLUMN tipo_via TEXT CHECK (tipo_via IN ('asfaltada', 'sin_asfaltar')),
  ADD CONSTRAINT tarifas_zona_o_tipo_via CHECK (zona_id IS NULL OR tipo_via IS NULL);

COMMIT;
