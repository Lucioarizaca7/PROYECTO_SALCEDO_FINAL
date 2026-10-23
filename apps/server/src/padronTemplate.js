import ExcelJS from 'exceljs';

import { getRubros, getZonas } from './db.js';
import { TEMPLATE_LISTS_SHEET } from './padronImport.js';

const TEMPLATE_ROWS = 2000;
const TIPOS = ['permanente', 'ferial', 'eventual'];
const ESTADOS = ['Presente', 'Ausente'];

// Encabezados que reconoce padronImport.js sin depender de alias aproximados.
const COLUMNS = [
  { header: 'DNI/RUC', width: 14, note: 'Obligatorio. DNI de 8 dígitos o RUC de 11 que empiece con 10, 15, 17 o 20. Se guarda como texto para no perder ceros.' },
  { header: 'Titular', width: 34, note: 'Obligatorio. Nombre completo o razón social.' },
  { header: 'Código Puesto', width: 15, note: 'Único en todo el padrón. Si lo dejas vacío se genera uno con el nombre de la hoja.' },
  { header: 'Sector', width: 22, note: 'Bloque, tramo o ubicación. Si lo dejas vacío se usa el nombre de la hoja.' },
  { header: 'Zona', width: 20, note: 'Elige una zona de la lista (catálogo actual del sistema).' },
  { header: 'Tipo Comerciante', width: 17, note: 'permanente, ferial o eventual.' },
  { header: 'Rubro', width: 14, note: 'Elige un rubro de la lista; define la tarifa que se cobra.' },
  { header: 'Metraje m2', width: 12, note: 'Obligatorio. Número mayor que 0.' },
  { header: 'Estado', width: 11, note: 'Presente o Ausente.' }
];

function listRange(column, count) {
  return `${TEMPLATE_LISTS_SHEET}!$${column}$1:$${column}$${Math.max(count, 1)}`;
}

export async function buildPadronTemplate(db) {
  const [rubros, zonas] = await Promise.all([getRubros(db), getZonas(db)]);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SISREC Salcedo';
  const sheet = workbook.addWorksheet('PADRON', { views: [{ state: 'frozen', ySplit: 1 }] });
  const lists = workbook.addWorksheet(TEMPLATE_LISTS_SHEET, { state: 'veryHidden' });

  // Listas en una hoja oculta: no tienen el límite de 255 caracteres de una lista escrita en la regla.
  zonas.forEach((zona, index) => { lists.getCell(`A${index + 1}`).value = zona.nombre; });
  rubros.forEach((rubro, index) => { lists.getCell(`B${index + 1}`).value = rubro.nombre; });
  TIPOS.forEach((tipo, index) => { lists.getCell(`C${index + 1}`).value = tipo; });
  ESTADOS.forEach((estado, index) => { lists.getCell(`D${index + 1}`).value = estado; });

  sheet.columns = COLUMNS.map(({ header, width }) => ({ header, width }));
  COLUMNS.forEach(({ note }, index) => {
    const cell = sheet.getRow(1).getCell(index + 1);
    cell.note = note;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
    cell.alignment = { horizontal: 'center' };
  });
  sheet.getColumn(1).numFmt = '@';

  const listRule = (formula, title) => ({
    type: 'list', allowBlank: true, formulae: [formula],
    showErrorMessage: true, errorStyle: 'stop', errorTitle: title, error: 'Elige un valor de la lista.'
  });
  const rules = {
    A: {
      type: 'custom', allowBlank: true, formulae: ['OR(LEN(A2)=8,LEN(A2)=11)'],
      showErrorMessage: true, errorTitle: 'DNI/RUC', error: 'El DNI tiene 8 dígitos y el RUC 11.'
    },
    E: listRule(listRange('A', zonas.length), 'Zona'),
    F: listRule(listRange('C', TIPOS.length), 'Tipo de comerciante'),
    G: listRule(listRange('B', rubros.length), 'Rubro'),
    H: {
      type: 'decimal', operator: 'greaterThan', allowBlank: true, formulae: [0],
      showErrorMessage: true, errorTitle: 'Metraje', error: 'El metraje debe ser un número mayor que 0.'
    },
    I: listRule(listRange('D', ESTADOS.length), 'Estado')
  };
  for (let row = 2; row <= TEMPLATE_ROWS + 1; row += 1) {
    for (const [column, rule] of Object.entries(rules)) sheet.getCell(`${column}${row}`).dataValidation = rule;
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
