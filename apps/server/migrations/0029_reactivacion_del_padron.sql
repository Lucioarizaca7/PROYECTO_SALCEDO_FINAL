-- Reactivaciones de la importación del padrón que no quedaron en la historia de estados (revisión del 12/11/2026).
--
-- La importación del padrón reactiva a un dado de baja sin un registro propio en la auditoría: solo queda la fila
-- IMPORTAR_PADRON_EXCEL con el número de reactivados, no quiénes. La 0027 reconstruyó la historia desde la
-- auditoría y esas reactivaciones se perdieron: la historia termina en "inactivo" aunque el comerciante esté activo,
-- y sus meses de baja se cobraban (ESTADO_EN_MES_SQL cae al estado de hoy). Desde la 0027 el trigger registra
-- cada cambio; esto solo repara los datos anteriores.
--
-- Hueco: una fila que deja "inactivo" y lo que sigue no es inactivo (el estado_anterior de la fila siguiente o,
-- si es la última, el estado de hoy). Decisión del usuario (12/11/2026): la reactivación rige desde la primera
-- importación con reactivados posterior a la baja (y anterior a la fila siguiente). Si no hubo ninguna, desde el
-- día en que se sabe con seguridad que estaba activo: el de la fila siguiente para un hueco en medio, el día en
-- que se aplicó la 0027 para el hueco final.
--
-- Idempotente: con la fila insertada ya no hay hueco. No toca una baja sin registrar (ningún camino la da sin
-- auditar).
BEGIN;

WITH historia AS (
  SELECT e.comerciante_id, e.estado_nuevo, e.desde, e.registrado_en,
         LEAD(e.estado_anterior) OVER w AS siguiente_anterior,
         LEAD(e.desde) OVER w AS siguiente_desde,
         LEAD(e.registrado_en) OVER w AS siguiente_en
  FROM comerciantes_estado_cambios e
  WINDOW w AS (PARTITION BY e.comerciante_id ORDER BY e.desde, e.registrado_en, e.id)
), hueco AS (
  SELECT h.comerciante_id, h.desde AS baja_desde, h.registrado_en AS baja_en,
         COALESCE(h.siguiente_anterior, c.estado) AS estado_nuevo, h.siguiente_desde, h.siguiente_en
  FROM historia h
  JOIN comerciantes c ON c.id = h.comerciante_id
  WHERE h.estado_nuevo = 'inactivo' AND COALESCE(h.siguiente_anterior, c.estado) <> 'inactivo'
), reactivacion AS (
  SELECT hueco.*, GREATEST(COALESCE(
           (SELECT MIN(l.fecha) FROM auditoria_logs l
             WHERE l.accion = 'IMPORTAR_PADRON_EXCEL'
               AND l.payload_nuevo->>'reactivatedMerchants' ~ '^[0-9]+$'
               AND (l.payload_nuevo->>'reactivatedMerchants')::int > 0
               AND l.fecha > hueco.baja_en
               AND (hueco.siguiente_en IS NULL OR l.fecha < hueco.siguiente_en)),
           hueco.siguiente_en - interval '1 microsecond',
           (SELECT aplicada_en FROM schema_migrations WHERE name = '0027_baja_de_cada_mes.sql'),
           now()), hueco.baja_en + interval '1 microsecond') AS fecha
  FROM hueco
)
INSERT INTO comerciantes_estado_cambios (comerciante_id, estado_anterior, estado_nuevo, desde, registrado_en)
SELECT comerciante_id, 'inactivo', estado_nuevo,
       LEAST(GREATEST(baja_desde, (fecha AT TIME ZONE 'America/Lima')::date), COALESCE(siguiente_desde, 'infinity'::date)),
       fecha
FROM reactivacion;

COMMIT;
