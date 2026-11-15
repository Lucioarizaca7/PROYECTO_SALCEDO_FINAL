/**
 * Ayudas de prueba para el cobro solo por día cobrado (decisión del usuario, 13/11/2026; migración 0032).
 * Ya no hay cuota mensual: la deuda sale de los días marcados × el precio por día de la zona. Las pruebas que
 * antes usaban la tarifa mensual de la semilla ("otros" S/ 90) arman aquí una deuda conocida.
 * No termina en .test.js: `npm test` no la corre sola.
 */
import { currentPeriod, insertComerciante, insertPuesto, insertTarifa, insertZona, todayInLima } from '../src/db.js';

let secuencia = 0;
const unico = () => `${process.pid}-${++secuencia}-${Date.now() % 1e6}`;

/** DNI de 8 dígitos que no choca entre archivos de prueba (cada uno corre en su esquema, pero por si acaso). */
export function dniDePrueba() {
  return `7${String(process.pid % 1000).padStart(3, '0')}${String(++secuencia % 10000).padStart(4, '0')}`;
}

/** Pone a la zona un precio por día vigente desde `desde` (por omisión, desde siempre). */
export async function precioDeZona(db, zonaId, precio, desde = '2020-01-01') {
  return insertTarifa(db, { zona_id: zonaId, monto_fijo: precio, vigencia_inicio: desde }, { permitirInicioPasado: true });
}

/**
 * insertZona + el precio por día que antes daba su tipo de vía (S/ 3 asfaltada, S/ 2 sin asfaltar, desde
 * siempre), como hizo la migración 0032 con las zonas que ya existían. Sin tipo de vía, la zona queda sin precio.
 */
export async function insertZonaConPrecio(db, payload) {
  const zona = await insertZona(db, payload);
  const precio = { asfaltada: 3, sin_asfaltar: 2 }[payload.tipo_via];
  if (precio) await precioDeZona(db, zona.id, precio);
  return zona;
}

/** Zona nueva con su precio por día. */
export async function zonaConPrecio(db, precio, { nombre = `Zona prueba ${unico()}`, tipo_via = null, desde } = {}) {
  const zona = await insertZona(db, { nombre, tipo_via });
  if (precio !== null) await precioDeZona(db, zona.id, precio, desde);
  return zona;
}

/** Marca `dias` días (del 1 en adelante) del periodo en el puesto, como la marca de la app. */
export async function marcarDias(db, puestoId, periodo = currentPeriod(), dias = 1, { desde = 1, zonaId = null } = {}) {
  for (let d = desde; d < desde + dias; d += 1) {
    await db.query(`
      INSERT INTO asistencias_feriales (puesto_id, fecha, marca, fuente${zonaId ? ', zona_id' : ''})
      VALUES ($1, $2::date, 'P', 'app'${zonaId ? ', $3' : ''})
      ON CONFLICT (puesto_id, fecha, sesion) DO UPDATE SET marca = 'P'`,
    zonaId ? [puestoId, `${periodo}-${String(d).padStart(2, '0')}`, zonaId] : [puestoId, `${periodo}-${String(d).padStart(2, '0')}`]);
  }
}

/**
 * Comerciante con deuda conocida en el periodo: un puesto en una zona propia de precio `precio` y `dias` días
 * marcados. Su saldo del periodo es precio × dias (por omisión 30 × 3 = 90, como la antigua cuota de "otros").
 */
export async function comercianteConDeuda(db, {
  periodo = currentPeriod(), precio = 30, dias = 3, tipo = 'permanente', rubroId = null, nombre = null, zona = null
} = {}) {
  const laZona = zona || await zonaConPrecio(db, precio);
  const rubro = rubroId ?? Number((await db.query(`SELECT id FROM rubros WHERE activo ORDER BY id LIMIT 1`)).rows[0].id);
  const merchant = await insertComerciante(db, {
    dni_ruc: dniDePrueba(), nombre: nombre || `Comerciante con deuda ${unico()}`, rubro_id: rubro, zona_id: laZona.id, tipo_comerciante: tipo
  });
  const puesto = await insertPuesto(db, { comerciante_id: merchant.id, zona_id: laZona.id, direccion: `Puesto ${unico()}` }, { devolver: false });
  // En el mes en curso los días marcados terminan hoy: cobrar hoy marca el día (marcarDiaCobrado) y, si hoy no
  // estuviera marcado, el cobro sumaría un día más a la deuda.
  const hoy = periodo === currentPeriod() ? Number(todayInLima().slice(8, 10)) : null;
  const desde = hoy ? Math.max(1, hoy - dias + 1) : 1;
  if (tipo !== 'eventual' && dias > 0) await marcarDias(db, puesto.id, periodo, dias, { desde });
  return { merchant, puesto, zona: laZona };
}
