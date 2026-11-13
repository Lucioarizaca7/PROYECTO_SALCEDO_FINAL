-- Un cobro sin señal con la fecha del celular fuera de rango ya no marca asistencia ese día (revisión del 12/11/2026,
-- registrarCobro). Antes la marca se ponía igual: un celular con la hora mal creaba un día cobrado en el futuro o
-- semanas atrás (deuda en un mes que no era), saltándose la ventana de 3 días de las marcas de la app (22/10/2026).
--
-- Datos existentes: se quita la marca que puso el propio cobro (fuente 'cobro', ese día, sin sesión) cuando su
-- revisión sigue pendiente por la fecha y ningún otro cobro confirmado del comerciante cae ese día. Las revisiones
-- ya resueltas por el administrador no se tocan: alguien ya miró ese cobro.
BEGIN;

DELETE FROM asistencias_feriales a
USING cobros_observados ob
JOIN transacciones t ON t.id = ob.transaccion_id
WHERE ob.estado = 'pendiente'
  AND ob.motivo ILIKE '%fecha fuera de rango%'
  AND a.comerciante_id = t.comerciante_id
  AND a.fecha = (t.fecha_cobro_cliente AT TIME ZONE 'America/Lima')::date
  AND a.sesion = ''
  AND a.fuente = 'cobro'
  AND NOT EXISTS (
    SELECT 1 FROM transacciones otro
    WHERE otro.comerciante_id = t.comerciante_id AND otro.id <> t.id AND otro.estado = 'confirmado'
      AND (otro.fecha_cobro_cliente AT TIME ZONE 'America/Lima')::date = a.fecha);

COMMIT;
