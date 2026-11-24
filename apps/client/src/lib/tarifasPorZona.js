// Las fechas del servidor y la fecha de Lima se representan como AAAA-MM-DD.
export function estadoDeTarifa(tarifa, hoy) {
  if (!tarifa.estado) return 'Inactiva';
  if (tarifa.vigencia_inicio > hoy) return 'Programada';
  if (tarifa.vigencia_fin && tarifa.vigencia_fin < hoy) return 'Finalizada';
  return 'Vigente';
}

// Suma días a una fecha AAAA-MM-DD en UTC: la zona horaria del navegador no corre el día.
export function sumarDias(fecha, dias) {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia + dias)).toISOString().slice(0, 10);
}

const preciosActivosDeZona = (tarifas, zonaId) => tarifas
  .filter((tarifa) => tarifa.estado && tarifa.unidad_medida === 'dia' && String(tarifa.zona_id) === String(zonaId));

// Un precio nuevo cierra el anterior el día previo, pero el servidor rechaza uno que empiece el mismo día que otro
// precio activo de la zona, o antes (insertTarifa). Antes se proponía siempre hoy y chocaba con un precio puesto hoy
// o con uno programado (18/11/2026). El primer día posible es hoy o el siguiente al último inicio.
export function primerDiaDePrecioNuevo(tarifas, zonaId, hoy) {
  const ultimoInicio = preciosActivosDeZona(tarifas, zonaId)
    .reduce((ultimo, tarifa) => (tarifa.vigencia_inicio > ultimo ? tarifa.vigencia_inicio : ultimo), '');
  const siguiente = ultimoInicio ? sumarDias(ultimoInicio, 1) : hoy;
  return siguiente > hoy ? siguiente : hoy;
}

// Cerrar un precio con "Vigente hasta" deja la zona sin precio desde el día siguiente si ningún otro precio activo
// cubre ese día: sus cobros en línea se rechazan (RN-16). Mismo criterio que getZonas en el servidor.
export function zonaQuedaSinPrecio(tarifas, tarifa, vigenciaFin) {
  if (!tarifa || !vigenciaFin) return false;
  const dia = sumarDias(vigenciaFin, 1);
  return !preciosActivosDeZona(tarifas, tarifa.zona_id)
    .some((otra) => otra.id !== tarifa.id && otra.vigencia_inicio <= dia && (!otra.vigencia_fin || otra.vigencia_fin >= dia));
}
