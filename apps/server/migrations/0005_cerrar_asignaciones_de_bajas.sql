-- Una baja o un puesto liberado cierra la asignación del puesto en esa fecha: deja de cobrarse
-- desde ahí y conserva lo devengado antes. Aquí se cierran las asignaciones de los puestos que
-- ya estaban liberados o dados de baja cuando se creó el historial (0004 las dejó abiertas).

BEGIN;

-- Puestos dados de baja con su comerciante: la fecha de baja del comerciante es el cierre.
WITH bajas AS (
  SELECT h.id, h.desde, c.fecha_baja::date AS baja
  FROM puestos_historial h
  JOIN puestos p ON p.id = h.puesto_id
  JOIN comerciantes c ON c.id = p.comerciante_id
  WHERE h.hasta IS NULL AND p.estado = 'inactivo' AND c.fecha_baja IS NOT NULL
)
UPDATE puestos_historial h SET hasta = b.baja - 1
FROM bajas b WHERE h.id = b.id AND b.baja > b.desde;

-- El resto (liberados o dados de baja sin fecha conocida, o con baja antes de la asignación) no
-- tiene un periodo cobrable conocido: antes no se les cobraba ningún mes y así se mantiene.
DELETE FROM puestos_historial h
USING puestos p
WHERE p.id = h.puesto_id AND h.hasta IS NULL AND p.estado IN ('disponible', 'inactivo');

COMMIT;
