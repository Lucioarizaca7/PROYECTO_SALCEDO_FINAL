/**
 * Genera libros Excel de prueba para "Importar padrón" (POST /api/v1/comerciantes/importar-padron).
 * Traído de la rama claude/gifted-mendel-9fxas5 (allí en Python) y ajustado a las reglas de esta rama:
 * sin las columnas "Fecha Feria" ni "Tarifa" (aquí no existen) y con metraje en las zonas sin tipo de vía.
 *
 * Salida (datos-prueba/ en la raíz del proyecto):
 *   - padron-prueba-50.xlsx: 50 comerciantes válidos en dos hojas (BLOQUE A y BLOQUE B), 6 ausentes.
 *   - padron-prueba-errores.xlsx: una fila de control y filas con errores intencionales.
 *   - padron-prueba-casos.xlsx: titulares sin DNI (pendientes de regularización) y un titular con
 *     dos puestos en zonas distintas.
 *
 * Datos ficticios y reproducibles (semilla fija). Las zonas deben existir en la base (las de la semilla demo).
 * Uso, desde apps/server:  node scripts/generar-padron-prueba.js
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'datos-prueba');

// Encabezados reconocidos por los alias de src/padronImport.js.
const HEADER = ['N°', 'DNI/RUC', 'Titular', 'Código Puesto', 'Sector', 'Zona', 'Tipo Comerciante', 'Rubro', 'Metraje m2', 'Estado'];

const NOMBRES = ['Yolanda', 'Rosa', 'Juana', 'Nidia', 'Maribel', 'Elena', 'Lourdes', 'Gladys', 'Marina', 'Sonia',
  'Felicitas', 'Teodora', 'Ruth', 'Hilda', 'Delia', 'Vilma', 'Juan', 'Pedro', 'Mario', 'Rubén', 'Edwin', 'Wilber',
  'Percy', 'Fredy', 'Alberto', 'Raúl', 'Hugo', 'Néstor', 'Efraín', 'Roger', 'Germán', 'Santos'];
const APELLIDOS = ['Mamani', 'Quispe', 'Condori', 'Choque', 'Ticona', 'Apaza', 'Huanca', 'Cutipa', 'Layme', 'Pari',
  'Coaquira', 'Flores', 'Ramos', 'Chambi', 'Calsin', 'Ccama', 'Turpo', 'Aguilar', 'Vilca', 'Machaca', 'Pacompia',
  'Larico', 'Yupanqui', 'Atencio'];
const RUBROS = ['comida', 'ropa', 'zapatillas', 'otros'];
const TIPOS = ['Permanente', 'Ferial', 'Eventual'];
const METRAJES = [2, 2.5, 3, 3.5, 4, 4.5, 6, 8, 9, 12];
const BLOQUES = [
  ['BLOQUE A', 'A', ['Mercado Central']],
  ['BLOQUE B', 'B', ['Parque Principal', 'Zona Norte']]
];

// mulberry32: el mismo libro cada vez que se corre, sin depender de Math.random.
function generador(semilla) {
  let a = semilla >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    entero: (min, max) => min + Math.floor(next() * (max - min + 1)),
    elegir: (lista) => lista[Math.floor(next() * lista.length)],
    elegirPeso: (lista, pesos) => {
      let r = next() * pesos.reduce((s, p) => s + p, 0);
      for (let i = 0; i < lista.length; i += 1) { r -= pesos[i]; if (r < 0) return lista[i]; }
      return lista.at(-1);
    }
  };
}

// RUC 10 + DNI + dígito verificador (módulo 11 de SUNAT).
function rucPersonaNatural(dni) {
  const base = `10${dni}`;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const resto = [...base].reduce((s, d, i) => s + Number(d) * pesos[i], 0) % 11;
  return base + String((11 - resto) % 10);
}

function filasValidas(rng, porBloque = 25) {
  const usados = new Set();
  const hojas = {};
  for (const [hoja, letra, zonas] of BLOQUES) {
    hojas[hoja] = [];
    for (let i = 1; i <= porBloque; i += 1) {
      let dni;
      do { dni = String(rng.entero(1000000, 79999999)).padStart(8, '0'); } while (usados.has(dni));
      usados.add(dni);
      hojas[hoja].push({
        n: i,
        documento: rng.next() < 0.2 ? rucPersonaNatural(dni) : dni,
        titular: `${rng.elegir(NOMBRES)} ${rng.elegir(APELLIDOS)} ${rng.elegir(APELLIDOS)}`.toUpperCase(),
        codigo: `PRB-${letra}-${String(i).padStart(3, '0')}`,
        sector: `Bloque ${letra} - Fila ${Math.floor((i - 1) / 5) + 1}`,
        zona: zonas[(i - 1) % zonas.length],
        tipo: rng.elegirPeso(TIPOS, [5, 4, 1]),
        rubro: rng.elegirPeso(RUBROS, [3, 3, 3, 1]),
        metraje: rng.elegir(METRAJES),
        estado: 'Presente'
      });
    }
  }
  // 3 ausentes por bloque: en esta rama el ausente deja su puesto disponible.
  for (const filas of Object.values(hojas)) {
    for (let marcados = 0; marcados < 3;) {
      const fila = filas[rng.entero(0, filas.length - 1)];
      if (fila.estado !== 'Ausente') { fila.estado = 'Ausente'; marcados += 1; }
    }
  }
  return hojas;
}

function escribirHoja(libro, nombre, titulo, filas) {
  const hoja = libro.addWorksheet(nombre, { views: [{ state: 'frozen', ySplit: 2 }] });
  hoja.addRow([titulo]).font = { bold: true, size: 13 };
  const encabezado = hoja.addRow(HEADER);
  encabezado.eachCell((celda) => {
    celda.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF084A2F' } };
    celda.alignment = { horizontal: 'center' };
  });
  for (const f of filas) {
    hoja.addRow([f.n, f.documento, f.titular, f.codigo, f.sector, f.zona, f.tipo, f.rubro, f.metraje ?? null, f.estado]);
  }
  // El documento va como texto para conservar los ceros a la izquierda.
  hoja.getColumn(2).numFmt = '@';
  [5, 14, 34, 15, 22, 18, 17, 12, 11, 10].forEach((ancho, i) => { hoja.getColumn(i + 1).width = ancho; });
}

function libroValido() {
  const libro = new ExcelJS.Workbook();
  for (const [hoja, filas] of Object.entries(filasValidas(generador(2026)))) {
    escribirHoja(libro, hoja, `PADRÓN DE COMERCIANTES - FERIA SALCEDO 2026 - ${hoja} (DATOS DE PRUEBA)`, filas);
  }
  return libro;
}

function libroErrores() {
  const base = { sector: 'Bloque C - Fila 1', zona: 'Zona Norte', tipo: 'Ferial', rubro: 'ropa', estado: 'Presente', metraje: 3 };
  const casos = [
    { documento: '45871236', titular: 'CONTROL VALIDO QUISPE', codigo: 'ERR-C-001' },
    { documento: '1234567', titular: 'DNI CORTO CONDORI', codigo: 'ERR-C-003' },
    { documento: '30123456789', titular: 'RUC INVALIDO TICONA', codigo: 'ERR-C-004' },
    { documento: '45871237', titular: '', codigo: 'ERR-C-005' },
    { documento: '45871236', titular: 'DNI DUPLICADO CHOQUE', codigo: 'ERR-C-007' },
    { documento: '45871239', titular: 'CODIGO DUPLICADO HUANCA', codigo: 'ERR-C-001' },
    { documento: '45871240', titular: 'RUBRO INEXISTENTE PARI', codigo: 'ERR-C-009', rubro: 'ferreteria' },
    { documento: '45871241', titular: 'SIN METRAJE COAQUIRA', codigo: 'ERR-C-010', metraje: null }
  ];
  const libro = new ExcelJS.Workbook();
  escribirHoja(libro, 'BLOQUE C', 'PADRÓN DE PRUEBA CON ERRORES INTENCIONALES', casos.map((caso, i) => ({ ...base, ...caso, n: i + 1 })));
  return libro;
}

function libroCasos() {
  const base = { tipo: 'Ferial', rubro: 'ropa', estado: 'Presente', metraje: 3 };
  const casos = [
    // Sin DNI: se importan como pendientes de regularización con un documento temporal.
    { documento: '', titular: 'FELICITAS CHAMBI LARICO', codigo: 'CAS-D-001', sector: 'Bloque D - Fila 1', zona: 'Mercado Central' },
    { documento: '', titular: 'SANTOS CALSIN TURPO', codigo: 'CAS-D-002', sector: 'Bloque D - Fila 1', zona: 'Mercado Central' },
    // Un titular con dos puestos en zonas distintas: un solo comerciante, dos puestos.
    { documento: '47120356', titular: 'GERMAN YUPANQUI PACOMPIA', codigo: 'CAS-D-003', sector: 'Bloque D - Fila 2', zona: 'Mercado Central' },
    { documento: '47120356', titular: 'GERMAN YUPANQUI PACOMPIA', codigo: 'CAS-D-004', sector: 'Bloque D - Fila 2', zona: 'Zona Norte' }
  ];
  const libro = new ExcelJS.Workbook();
  escribirHoja(libro, 'BLOQUE D', 'PADRÓN DE PRUEBA: CASOS ESPECIALES', casos.map((caso, i) => ({ ...base, ...caso, n: i + 1 })));
  return libro;
}

mkdirSync(OUT_DIR, { recursive: true });
await libroValido().xlsx.writeFile(join(OUT_DIR, 'padron-prueba-50.xlsx'));
await libroErrores().xlsx.writeFile(join(OUT_DIR, 'padron-prueba-errores.xlsx'));
await libroCasos().xlsx.writeFile(join(OUT_DIR, 'padron-prueba-casos.xlsx'));
console.log(`Libros generados en ${OUT_DIR}`);
