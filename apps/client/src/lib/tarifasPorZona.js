// Las fechas del servidor y la fecha de Lima se representan como AAAA-MM-DD.
export function estadoDeTarifa(tarifa, hoy) {
  if (!tarifa.estado) return 'Inactiva';
  if (tarifa.vigencia_inicio > hoy) return 'Programada';
  if (tarifa.vigencia_fin && tarifa.vigencia_fin < hoy) return 'Finalizada';
  return 'Vigente';
}
