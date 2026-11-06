-- Puesto importado del padrón sin zona, o con una zona que no está registrada (decisión del usuario, 28/10/2026).
-- Antes el importador lo mandaba a la primera zona sin avisar. Ahora sigue quedando en la primera zona y paga
-- con su tarifa (la zona es obligatoria en puestos y comerciantes), pero queda marcado para que la oficina le
-- asigne su zona real:
--   NULL  zona confirmada (todos los puestos existentes);
--   ''    el padrón no traía zona;
--   texto la zona que traía el padrón y no está registrada (para saber a cuál iba).
-- La marca se borra al guardar el puesto con una zona (formulario de Sitios) o al reimportarlo con una zona válida.

BEGIN;

ALTER TABLE puestos ADD COLUMN zona_por_regularizar TEXT;

COMMENT ON COLUMN puestos.zona_por_regularizar IS 'NULL = zona confirmada; '''' = el padrón no traía zona; texto = zona del padrón no registrada';

COMMIT;
