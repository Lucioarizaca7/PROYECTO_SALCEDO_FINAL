-- Los reportes por zona cuentan cada cobro en la zona donde se vendió ese día (decisión del usuario, 14/11/2026).
--
-- transacciones.zona_cobro_id (0028) guardaba la zona del comerciante el día del cobro. Desde la zona del día
-- (0031) y el precio por zona (0032), un comerciante puede vender un día en otra zona y pagar el precio de esa
-- zona: el panel y los reportes sumaban ese cobro a su zona habitual, y la recaudación por zona no coincidía
-- con lo que se cobró en cada una.
--
-- Desde ahora registrarCobro guarda la zona de la marca de ese día (la que eligió el cobrador o la del puesto).
-- Sin marca ese día (pago de un mes atrasado, eventual, fecha fuera de rango) sigue la zona del comerciante.
--
-- Datos existentes: cada cobro toma la zona de la marca de su día, si la hay. Los demás no cambian.
-- Límite conocido: un cobro que paga días vendidos en zonas distintas cuenta entero en la zona del día del cobro.
BEGIN;

UPDATE transacciones t
SET zona_cobro_id = m.zona_id
FROM (
  SELECT t2.id,
         (SELECT a.zona_id FROM asistencias_feriales a
           WHERE a.comerciante_id = t2.comerciante_id
             AND a.fecha = (t2.fecha_cobro_cliente AT TIME ZONE 'America/Lima')::date
             AND a.sesion = '' AND a.asistio AND a.zona_id IS NOT NULL
           ORDER BY a.puesto_id LIMIT 1) AS zona_id
  FROM transacciones t2
) m
WHERE m.id = t.id AND m.zona_id IS NOT NULL AND t.zona_cobro_id IS DISTINCT FROM m.zona_id;

COMMIT;
