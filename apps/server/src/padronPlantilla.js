// Plantilla oficial del padrón: Excel con los encabezados que reconoce padronImport.js y listas desplegables
// tomadas del catálogo (zonas, rubros), para que el padrón llegue sin alias aproximados ni nombres mal escritos.
import ExcelJS from 'exceljs';

import { getRubros, getZonas } from './db.js';
import { HOJA_LISTAS_PLANTILLA } from './padronImport.js';

// Sin columna de tipo de comerciante: hay un solo tipo desde el 23/11/2026 (0039).
// Filas con lista desplegable y formato de texto en el DNI; alcanza para el padrón de una feria.
const FILAS_PLANTILLA = 3000;
const ESTADOS_FILA = ['Presente', 'Ausente'];

const COLUMNAS = [
  { header: 'DNI/RUC', width: 14, nota: 'DNI de 8 dígitos o RUC de 11. Se guarda como texto para no perder ceros. Si falta, el titular entra como pendiente de regularización y paga igual; al registrar su DNI se regulariza.' },
  { header: 'Titular', width: 34, nota: 'Obligatorio. Nombre completo o razón social. Varias filas con el mismo DNI y el mismo nombre son un titular con varios puestos.' },
  // Notas al día con las reglas del 23/11/2026: el precio lo pone la zona, el metraje no cuenta y hay un solo tipo.
  { header: 'Código Puesto', width: 16, nota: 'El código del puesto en el mapa (S-001 a S-400). Si ya existe, se actualiza ese puesto y conserva su ubicación; si es nuevo, el puesto se crea sin ubicación y luego se ubica en el Mapa. Vacío: se genera uno con el nombre de la hoja.' },
  { header: 'Sector', width: 22, nota: 'Calle, tramo o lado (por ejemplo: Av. Sideral, carril norte). Si lo dejas vacío se usa el nombre de la hoja.' },
  { header: 'Zona', width: 22, nota: 'Elige una zona de la lista. El precio por día lo pone la zona (Zonas y tarifas), igual para todos los rubros. La zona del comerciante es la de su primer puesto.' },
  { header: 'Rubro', width: 16, nota: 'Elige un rubro de la lista. Solo describe lo que vende: no cambia lo que paga.' },
  { header: 'Metraje m2', width: 12, nota: 'Opcional: el cobro es por día y no usa metros. Si lo dejas vacío en un puesto que ya existe, se conserva el que tiene.' },
  { header: 'Estado', width: 12, nota: 'Presente o Ausente. Un comerciante ausente conserva su puesto y no paga mientras no se le marque presente.' }
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
  lista('Estado', 'D', ESTADOS_FILA.length, 'Elige Presente o Ausente.');
  hoja.dataValidations.add(`${columna(indice('Metraje m2'))}2:${columna(indice('Metraje m2'))}${ultima}`, {
    type: 'decimal', operator: 'greaterThan', allowBlank: true, formulae: [0],
    showErrorMessage: true, errorTitle: 'Metraje no válido', error: 'El metraje debe ser un número mayor que cero.'
  });

  return Buffer.from(await libro.xlsx.writeBuffer());
}
