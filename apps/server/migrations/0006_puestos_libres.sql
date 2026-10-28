-- Un puesto físico puede quedar libre (sin titular) y volver a asignarse.
-- ocupado = siempre con comerciante; disponible = libre (sin comerciante) o ferial ausente que conserva su puesto
-- (así lo deja la importación del padrón); reservado puede tener o no; inactivo conserva el último titular.

BEGIN;

ALTER TABLE puestos ALTER COLUMN comerciante_id DROP NOT NULL;

ALTER TABLE puestos ADD CONSTRAINT puestos_ocupado_con_titular CHECK (estado <> 'ocupado' OR comerciante_id IS NOT NULL);

COMMIT;
