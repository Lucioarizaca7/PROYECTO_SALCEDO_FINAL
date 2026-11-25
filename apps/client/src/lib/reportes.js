// Filtro de Reportes por mes, por día o todo (24/11/2026). GET /reportes filtra por el inicio de la fecha del cobro:
// "2026-11" es el mes y "2026-11-23" es ese día, así que el mismo parámetro sirve para los dos. «Todo» no manda
// periodo: trae todos los cobros registrados (con los filtros de zona y rubro que haya).
export function periodoDelFiltro({ alcance, periodo, dia }) {
  if (alcance === 'todo') return '';
  return alcance === 'dia' ? dia : periodo;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** "del día 23/11/2026" o "de noviembre de 2026", para títulos y nombres de archivo legibles. */
export function textoDelPeriodo(valor) {
  const [anio, mes, dia] = String(valor || '').split('-');
  if (!anio || !mes) return 'de todo el registro';
  if (dia) return `del día ${dia}/${mes}/${anio}`;
  return `de ${MESES[Number(mes) - 1]} de ${anio}`;
}
