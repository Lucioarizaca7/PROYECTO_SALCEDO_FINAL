-- El código del comerciante va en QR y recibos: no debe llevar el DNI/RUC completo (Ley 29733, proporcionalidad).
-- Se muestran solo los 3 últimos dígitos: COM-0004-LAC-COMI-***744-MCEN-ACT-20261016.
-- Los códigos con el documento completo pasan al historial para que los QR ya impresos sigan funcionando.

BEGIN;

CREATE OR REPLACE FUNCTION armar_codigo_comerciante(
  correlativo INTEGER, nombre TEXT, rubro_codigo TEXT, documento TEXT, zona_codigo TEXT, estado TEXT, creado_en TIMESTAMPTZ
) RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT concat_ws('-',
    'COM',
    lpad(correlativo::text, 4, '0'),
    iniciales_nombre(nombre),
    rubro_codigo,
    '***' || right(documento, 3),
    zona_codigo,
    abreviar_estado_comerciante(estado),
    to_char(creado_en AT TIME ZONE 'America/Lima', 'YYYYMMDD'))
$$;

-- El historial se escribe aquí con su motivo real; el trigger lo anotaría como cambio de rubro o zona.
ALTER TABLE comerciantes DISABLE TRIGGER trg_comerciantes_codigo_historial;
INSERT INTO comerciante_codigos_historicos (comerciante_id, codigo, motivo)
SELECT id, codigo, 'Se ocultó el DNI/RUC en el código' FROM comerciantes;
UPDATE comerciantes SET codigo = NULL;   -- el trigger lo vuelve a armar
ALTER TABLE comerciantes ENABLE TRIGGER trg_comerciantes_codigo_historial;

COMMIT;
