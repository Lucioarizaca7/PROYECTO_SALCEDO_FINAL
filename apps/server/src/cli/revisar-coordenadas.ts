/**
 * Lista los puestos con coordenadas a más de N km del centro de Salcedo (por omisión 2 km). Sirve para
 * revisar el padrón real después de importarlo: un puesto a 60 km casi siempre es un error de carga.
 *
 *   npm run revisar-coordenadas                 (2 km)
 *   npm run revisar-coordenadas -- --km 5
 *   docker compose exec api node dist/cli/revisar-coordenadas.js
 */
// @ts-ignore
import { initializeDatabase, puestosLejosDelCentro, closeDatabase } from '../db.js';

async function main() {
  const indice = process.argv.indexOf('--km');
  const maxKm = indice >= 0 ? Number(process.argv[indice + 1]) : 2;
  if (!Number.isFinite(maxKm) || maxKm <= 0) throw new Error('--km debe ser un número mayor que cero');

  await initializeDatabase({ seed: false });
  const lejanos = await puestosLejosDelCentro(undefined, { maxKm });
  if (!lejanos.length) {
    console.log(`Todos los puestos con coordenadas están a menos de ${maxKm} km del centro de Salcedo.`);
    return;
  }
  console.log(`${lejanos.length} puesto(s) a más de ${maxKm} km del centro de Salcedo:`);
  console.table(lejanos.map((p) => ({
    puesto: p.codigo_puesto || `#${p.id}`, comerciante: p.comerciante || '—', direccion: p.direccion,
    latitud: p.latitud, longitud: p.longitud, km: p.distancia_km
  })));
  process.exitCode = 2; // para usarlo en scripts: distinto de 0 si hay algo que revisar
}

main()
  .catch((error) => {
    console.error(`No se pudo revisar las coordenadas: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
