// Calculadora pública de la página de inicio. Regla vigente (reglas-negocio.md): se cobra por puesto y por
// día cobrado, según el tipo de vía de la zona: S/ 3 en vía asfaltada y S/ 2 sin asfaltar, para todos los
// rubros. Sin día cobrado no hay deuda. La calculadora anterior usaba metros cuadrados, factores por giro y
// descuentos que ya no existen. Es solo una referencia: la liquidación oficial es calcularLiquidacion.
export const VIAS = [
  { value: 'asfaltada', label: 'Vía asfaltada', monto: 3, serie: 'S3' },
  { value: 'sin_asfaltar', label: 'Vía sin asfaltar', monto: 2, serie: 'S2' }
];

/** Lo que paga un comerciante: puestos × días cobrados × tarifa del día de la vía (un ticket por cada uno). */
export function calcularCobroFeria({ via = 'asfaltada', puestos = 1, dias = 1 } = {}) {
  const tarifa = VIAS.find((item) => item.value === via) || VIAS[0];
  const p = Math.max(1, Math.round(Number(puestos) || 1));
  const d = Math.max(0, Math.round(Number(dias) || 0));
  return { tarifa, puestos: p, dias: d, tickets: p * d, total: tarifa.monto * p * d };
}
