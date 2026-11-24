-- Un solo tipo de comerciante (decisión del usuario, 23/11/2026; reemplaza RN-07 y RN-52).
--
-- A todos se les cobra el día que están presentes, y un día presente sin pagar queda como deuda. Ferial y
-- permanente ya se cobraban así; el eventual era la excepción: se le cobraba el día en que se le encontraba,
-- sin marca, y lo que no pagaba no quedaba como deuda. Ahora todos se guardan como 'ferial'.
--
-- Datos existentes:
--   - Eventuales y permanentes pasan a 'ferial'. El trigger de la 0023 escribe cada cambio en
--     comerciantes_tipo_cambios con la fecha de hoy, así los meses pasados se siguen liquidando con el tipo que
--     tenían: un mes en que alguien fue eventual sigue sin deuda.
--   - Lo que un eventual pagó en los días de este mes antes del cambio pagó ese día y no descuenta sus días
--     presentes después del cambio (paidInPeriod). No se crean marcas para esos días: el eventual podía cobrarse
--     sin puesto, y una marca necesita uno.
--
-- La base ya no acepta otro tipo. El historial (comerciantes_tipo_cambios) conserva los tres.
BEGIN;

UPDATE comerciantes SET tipo_comerciante = 'ferial' WHERE tipo_comerciante <> 'ferial';

ALTER TABLE comerciantes DROP CONSTRAINT comerciantes_tipo_comerciante_check;
ALTER TABLE comerciantes ADD CONSTRAINT comerciantes_un_solo_tipo CHECK (tipo_comerciante = 'ferial');

COMMIT;
