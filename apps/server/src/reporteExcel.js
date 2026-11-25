// Reporte de cobros en Excel (24/11/2026): el CSV se abría en Excel en una sola columna (Excel en español separa
// con «;») y con las tildes rotas. El .xlsx sale como tabla de Excel: encabezados, filtros, anchos y montos en soles.
// Mismas filas y filtros que GET /reportes (getReportRows); la fórmula de lo cobrado es la de la pantalla:
// solo los cobros confirmados suman.
import ExcelJS from 'exceljs';

import { getReportRows, textoTicketsCobro } from './db.js';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const METODOS = { efectivo: 'Efectivo', yape: 'Yape', plin: 'Plin', pos: 'POS' };
const FORMATO_SOLES = '"S/" #,##0.00';
const VERDE = 'FF0B5D3B';

/** «del día 23/11/2026», «de noviembre de 2026» o «de todo el registro» (como el título de la vista previa). */
export function textoPeriodoReporte(periodo) {
  const [anio, mes, dia] = String(periodo || '').split('-');
  if (!anio || !mes) return 'de todo el registro';
  if (dia) return `del día ${dia}/${mes}/${anio}`;
  return `de ${MESES[Number(mes) - 1]} de ${anio}`;
}

// La fecha del reporte ya viene en hora de Lima ('AAAA-MM-DD HH:MM:SS'). Se guarda como fecha de Excel (se puede
// ordenar y filtrar) armándola en UTC: Excel no tiene zona horaria y muestra la hora tal cual.
function fechaExcel(texto) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(texto || ''));
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])) : null;
}

const COLUMNAS = [
  { titulo: 'Fecha', ancho: 17, valor: (f) => fechaExcel(f.fecha), formato: 'dd/mm/yyyy hh:mm' },
  // El código del comerciante es largo (COM-0059-DPA-OTRO-***050-MCEN-ACT-20261118): en una línea.
  { titulo: 'Código', ancho: 46, valor: (f) => f.comerciante_codigo || '' },
  { titulo: 'Comerciante', ancho: 30, valor: (f) => f.comerciante || '', envolver: true },
  { titulo: 'Rubro', ancho: 14, valor: (f) => f.rubro || '' },
  { titulo: 'Zona', ancho: 22, valor: (f) => f.zona || '' },
  { titulo: 'Cobrador', ancho: 22, valor: (f) => f.cobrador || '' },
  { titulo: 'Monto', ancho: 11, valor: (f) => Number(f.monto || 0), formato: FORMATO_SOLES },
  { titulo: 'Método', ancho: 10, valor: (f) => METODOS[f.metodo_pago] || f.metodo_pago || '' },
  { titulo: 'Estado', ancho: 12, valor: (f) => f.estado || '' },
  { titulo: 'Recibo', ancho: 11, valor: (f) => f.comprobante || '' },
  { titulo: 'Tickets', ancho: 14, valor: (f) => textoTicketsCobro(f.tickets), envolver: true },
  { titulo: 'Nota del cobrador', ancho: 34, valor: (f) => f.observaciones || '', envolver: true },
  { titulo: 'Motivo de anulación', ancho: 34, valor: (f) => f.motivo_anulacion || '', envolver: true }
];

async function nombreDe(db, tabla, id) {
  if (!id) return null;
  // Solo estas tablas: el nombre de la tabla no viene del usuario, pero así no puede llegar otro.
  if (!['zonas', 'rubros', 'usuarios'].includes(tabla)) throw new Error(`Tabla no permitida: ${tabla}`);
  const { rows } = await db.query(`SELECT nombre FROM ${tabla} WHERE id = $1`, [Number(id)]);
  return rows[0]?.nombre || null;
}

export async function buildReportXlsx(db, options = {}, { usuarioId = null } = {}) {
  const filas = await getReportRows(db, options);
  const [zona, rubro, emitidoPor] = await Promise.all([
    nombreDe(db, 'zonas', options.zona_id), nombreDe(db, 'rubros', options.rubro_id), nombreDe(db, 'usuarios', usuarioId)
  ]);
  const confirmadas = filas.filter((f) => f.estado === 'confirmado');
  const total = Number(confirmadas.reduce((suma, f) => suma + Number(f.monto || 0), 0).toFixed(2));

  const libro = new ExcelJS.Workbook();
  libro.creator = 'SISREC Salcedo';
  const hoja = libro.addWorksheet('Cobros', { views: [{ state: 'frozen', ySplit: 7 }], pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  hoja.columns = COLUMNAS.map(({ ancho }) => ({ width: ancho }));

  // Encabezado: quién emite, qué periodo y con qué filtros.
  hoja.getCell('A1').value = 'Municipalidad del Centro Poblado de Salcedo · Área de Rentas y Recaudación';
  hoja.getCell('A1').font = { bold: true, color: { argb: VERDE } };
  hoja.getCell('A2').value = `Reporte de cobros ${textoPeriodoReporte(options.periodo)}`;
  hoja.getCell('A2').font = { bold: true, size: 14 };
  hoja.getCell('A3').value = [zona ? `Zona: ${zona}` : 'Todas las zonas', rubro ? `Rubro: ${rubro}` : 'Todos los rubros', emitidoPor ? `Emitido por: ${emitidoPor}` : null].filter(Boolean).join(' · ');
  hoja.getCell('A3').font = { color: { argb: 'FF52514E' } };

  // Resumen: lo cobrado suma solo los confirmados, como la pantalla. Va como número y no como fórmula: con 0 la
  // fórmula se guardaba sin resultado y la celda salía vacía en los visores que no recalculan.
  const primera = 8;
  const ultima = primera + Math.max(filas.length, 1) - 1;
  hoja.getCell('A5').value = 'Total cobrado';
  hoja.getCell('B5').value = total;
  hoja.getCell('B5').numFmt = FORMATO_SOLES;
  hoja.getCell('C5').value = 'Cobros confirmados';
  hoja.getCell('D5').value = confirmadas.length;
  hoja.getCell('E5').value = 'Anulados u observados';
  hoja.getCell('F5').value = filas.length - confirmadas.length;
  hoja.getCell('A6').value = 'Los anulados y observados están en la tabla pero no suman al total cobrado.';
  hoja.getCell('A6').font = { italic: true, size: 9, color: { argb: 'FF52514E' } };
  for (const celda of ['A5', 'C5', 'E5']) hoja.getCell(celda).font = { color: { argb: 'FF52514E' } };
  for (const celda of ['B5', 'D5', 'F5']) hoja.getCell(celda).font = { bold: true };

  // La tabla de Excel (con filtros y filas alternadas). Sin filas, una vacía: Excel no admite tablas sin filas.
  hoja.addTable({
    name: 'TablaCobros',
    ref: `A${primera - 1}`,
    headerRow: true,
    // Medium4 es el verde del tema que escribe exceljs (el de Office 2007); Medium7 ahí es naranja.
    style: { theme: 'TableStyleMedium4', showRowStripes: true },
    columns: COLUMNAS.map(({ titulo }) => ({ name: titulo, filterButton: true })),
    rows: filas.length ? filas.map((fila) => COLUMNAS.map((c) => c.valor(fila))) : [COLUMNAS.map(() => null)]
  });
  COLUMNAS.forEach((c, i) => {
    if (!c.formato) return;
    for (let r = primera; r <= ultima; r += 1) hoja.getCell(r, i + 1).numFmt = c.formato;
  });
  // Solo los textos largos bajan de línea; el resto queda en una, arriba de la celda.
  COLUMNAS.forEach((c, i) => {
    for (let r = primera; r <= ultima; r += 1) hoja.getCell(r, i + 1).alignment = { vertical: 'top', wrapText: Boolean(c.envolver) };
  });

  return Buffer.from(await libro.xlsx.writeBuffer());
}
