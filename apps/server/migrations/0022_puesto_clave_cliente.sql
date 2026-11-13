-- Alta de puesto idempotente (revisión del 11/11/2026). El celular genera una clave por cada puesto nuevo y la
-- envía en línea y desde la cola del mapa sin señal. Si la primera petición llegó pero su respuesta se perdió,
-- el reenvío traía otro puesto igual (mismo titular y dirección, que validatePuestoPlacement permite). Con la
-- clave, el reenvío devuelve el puesto ya creado.
--
-- Datos existentes: quedan sin clave (NULL); el índice único solo cuenta las claves enviadas.
BEGIN;

ALTER TABLE puestos ADD COLUMN IF NOT EXISTS clave_cliente TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_puestos_clave_cliente ON puestos(clave_cliente) WHERE clave_cliente IS NOT NULL;

COMMIT;
