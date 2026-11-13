-- Cada cobro guarda la zona y el rubro que tenía el comerciante el día del cobro (revisión del 11/11/2026,
-- la misma decisión "rige desde el cambio" que la 0025).
--
-- La liquidación ya usa la historia (0025), pero el panel, los reportes y la proyección agrupaban cada cobro
-- con la zona y el rubro de HOY: mover a un comerciante de zona cambiaba la recaudación ya cerrada de los
-- meses pasados (el panel de octubre pasaba sus cobros a la zona nueva y el filtro del reporte dejaba de
-- traerlos). La foto queda en la fila del cobro, así los informes son una columna simple y no una consulta
-- por fila sobre la tabla de cambios (una función por fila multiplicaba por 50 el tiempo de la proyección).
--
-- Datos existentes: se rellenan con comerciantes_datos_cambios (0025), que reconstruyó la historia desde la
-- auditoría. Una fila que quede NULL (escrita fuera de la API) cae al valor actual del comerciante al leer.
BEGIN;

ALTER TABLE transacciones
  ADD COLUMN zona_cobro_id INTEGER REFERENCES zonas(id),
  ADD COLUMN rubro_cobro_id INTEGER REFERENCES rubros(id);

UPDATE transacciones t
SET zona_cobro_id = COALESCE(
      (SELECT d.valor_anterior FROM comerciantes_datos_cambios d
        WHERE d.comerciante_id = t.comerciante_id AND d.campo = 'zona_id'
          AND d.desde > (t.fecha_cobro_cliente AT TIME ZONE 'America/Lima')::date
        ORDER BY d.desde, d.id LIMIT 1), c.zona_id),
    rubro_cobro_id = COALESCE(
      (SELECT d.valor_anterior FROM comerciantes_datos_cambios d
        WHERE d.comerciante_id = t.comerciante_id AND d.campo = 'rubro_id'
          AND d.desde > (t.fecha_cobro_cliente AT TIME ZONE 'America/Lima')::date
        ORDER BY d.desde, d.id LIMIT 1), c.rubro_id)
FROM comerciantes c
WHERE c.id = t.comerciante_id;

COMMIT;
