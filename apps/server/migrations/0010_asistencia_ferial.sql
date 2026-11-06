-- Asistencia ferial por fecha: el ferial paga solo los días que asistió (días con asistencia × tarifa
-- diaria). Sin asistencias en el mes no devenga. Antes bastaba con que tuviera puesto.
--
-- La tabla asistencias_feriales ya existía (0002) y la llenaba la carga del padrón ferial con las marcas
-- del Excel tal cual ('P', 'F', 'N/S', 'P/1 MÑN'…). Se conservan; se agrega:
--   asistio        columna calculada: una marca que empieza con P es asistencia (P, P/1 MÑN…).
--                  La app del cobrador guarda 'P' (asistió) o 'F' (faltó).
--   registrado_por quién marcó en la app (NULL para lo importado del Excel).
--
-- Datos existentes: las marcas importadas pasan a contar como asistencia o falta según su letra.

BEGIN;

ALTER TABLE asistencias_feriales
  ADD COLUMN asistio BOOLEAN GENERATED ALWAYS AS (upper(btrim(marca)) LIKE 'P%') STORED,
  ADD COLUMN registrado_por BIGINT REFERENCES usuarios(id);

CREATE INDEX idx_asistencias_fecha ON asistencias_feriales (fecha);

COMMIT;
