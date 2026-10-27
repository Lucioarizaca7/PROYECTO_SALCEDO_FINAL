// Plantilla oficial del padrón: Excel con los encabezados que reconoce padronImport.js y listas desplegables
// tomadas del catálogo (zonas, rubros), para que el padrón llegue sin alias aproximados ni nombres mal escritos.
import ExcelJS from 'exceljs';

import { getRubros, getZonas } from './db.js';
import { HOJA_LISTAS_PLANTILLA } from './padronImport.js';

// Filas con lista desplegable y formato de texto en el DNI; alcanza para el padrón de una feria.
const FILAS_PLANTILLA = 3000;
const TIPOS_COMERCIANTE = ['ferial', 'permanente', 'eventual'];
const ESTADOS_FILA = ['Presente', 'Ausente'];

const COLUMNAS = [
  { header: 'DNI/RUC', width: 14, nota: 'DNI de 8 dígitos o RUC de 11. Se guarda como texto para no perder ceros. Si falta, el titular entra como pendiente de regularización y paga igual; al registrar su DNI se regulariza.' },
  { header: 'Titular', width: 34, nota: 'Obligatorio. Nombre completo o razón social. Varias filas con el mismo DNI y el mismo nombre son un titular con varios puestos.' },
  { header: 'Código Puesto', width: 16, nota: 'Único en todo el padrón. Si lo dejas vacío se genera uno con el nombre de la hoja.' },
  { header: 'Sector', width: 22, nota: 'Bloque, tramo o ubicación. Si lo dejas vacío se usa el nombre de la hoja.' },
  { header: 'Zona', width: 22, nota: 'Elige una zona de la lista. Su tipo de vía define el cobro por día: S/ 3 asfaltada, S/ 2 sin asfaltar.' },
  { header: 'Tipo Comerciante', width: 17, nota: 'ferial, permanente o eventual.' },
  { header: 'Rubro', width: 16, nota: 'Elige un rubro de la lista.' },
  { header: 'Metraje m2', width: 12, nota: 'Opcional si la zona tiene tipo de vía (el cobro por día no usa metros); obligatorio si no lo tiene.' },
  { header: 'Estado', width: 12, nota: 'Presente o Ausente. Un ferial ausente conserva su puesto y no devenga.' }
];

const columna = (indice) => String.fromCharCode(65 + indice);
const rangoLista = (letra, cantidad) => `${HOJA_LISTAS_PLANTILLA}!$${letra}$1:$${letra}$${Math.max(cantidad, 1)}`;

export async function buildPadronTemplate(db) {
  const [rubros, zonas] = await Promise.all([getRubros(db), getZonas(db)]);
  const libro = new ExcelJS.Workbook();
  libro.creator = 'SISREC Salcedo';
  const hoja = libro.addWorksheet('PADRON', { views: [{ state: 'frozen', ySplit: 1 }] });
  // Las listas van en una hoja oculta: no tienen el límite de 255 caracteres de una lista escrita en la regla.
  const listas = libro.addWorksheet(HOJA_LISTAS_PLANTILLA, { state: 'veryHidden' });
  zonas.forEach((zona, indice) => { listas.getCell(`A${indice + 1}`).value = zona.nombre; });
  rubros.forEach((rubro, indice) => { listas.getCell(`B${indice + 1}`).value = rubro.nombre; });
  TIPOS_COMERCIANTE.forEach((tipo, indice) => { listas.getCell(`C${indice + 1}`).value = tipo; });
  ESTADOS_FILA.forEach((estado, indice) => { listas.getCell(`D${indice + 1}`).value = estado; });

  hoja.columns = COLUMNAS.map(({ header, width }) => ({ header, width }));
  COLUMNAS.forEach(({ nota }, indice) => { hoja.getCell(1, indice + 1).note = nota; });
  const encabezado = hoja.getRow(1);
  encabezado.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  encabezado.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7A1F2B' } };

  const ultima = FILAS_PLANTILLA + 1;
  const indice = (header) => COLUMNAS.findIndex((item) => item.header === header);
  hoja.getColumn(indice('DNI/RUC') + 1).numFmt = '@';
  const lista = (header, letra, cantidad, mensaje) => {
    hoja.dataValidations.add(`${columna(indice(header))}2:${columna(indice(header))}${ultima}`, {
      type: 'list', allowBlank: true, formulae: [rangoLista(letra, cantidad)],
      showErrorMessage: true, errorTitle: 'Valor no válido', error: mensaje
    });
  };
  lista('Zona', 'A', zonas.length, 'Elige una zona de la lista.');
  lista('Rubro', 'B', rubros.length, 'Elige un rubro de la lista.');
  lista('Tipo Comerciante', 'C', TIPOS_COMERCIANTE.length, 'Elige ferial, permanente o eventual.');
  lista('Estado', 'D', ESTADOS_FILA.length, 'Elige Presente o Ausente.');
  hoja.dataValidations.add(`${columna(indice('Metraje m2'))}2:${columna(indice('Metraje m2'))}${ultima}`, {
    type: 'decimal', operator: 'greaterThan', allowBlank: true, formulae: [0],
    showErrorMessage: true, errorTitle: 'Metraje no válido', error: 'El metraje debe ser un número mayor que cero.'
  });

  return Buffer.from(await libro.xlsx.writeBuffer());
}
