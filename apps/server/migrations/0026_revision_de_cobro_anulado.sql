-- Un cobro anulado cierra su revisión pendiente (revisión del 11/11/2026).
--
-- Antes, anular desde la lista de cobros un cobro sin señal que estaba observado dejaba su revisión pendiente
-- para siempre: anularla respondía 409 ("El cobro ya estaba anulado") y aceptarla lo dejaba como pago válido.
-- Ahora anularCobro la cierra con el mismo motivo y quien lo anuló.
--
-- Datos existentes: las revisiones pendientes de cobros ya anulados se cierran igual, con el motivo, el
-- responsable y la hora de la anulación.
BEGIN;

UPDATE cobros_observados ob
SET estado = 'anulado',
    resolucion = COALESCE(t.motivo_anulacion, 'Cobro anulado'),
    revisado_por = t.anulado_por,
    revisado_en = COALESCE(t.anulado_en, now())
FROM transacciones t
WHERE t.id = ob.transaccion_id AND ob.estado = 'pendiente' AND t.estado = 'anulado';

COMMIT;
