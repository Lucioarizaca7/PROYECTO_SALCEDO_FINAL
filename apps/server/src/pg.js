import pg from 'pg';

import { config } from './config.js';

// NUMERIC y BIGINT llegan como número JS (dinero con 2 decimales, ids/conteos pequeños).
pg.types.setTypeParser(1700, (value) => (value === null ? null : parseFloat(value)));
pg.types.setTypeParser(20, (value) => (value === null ? null : parseInt(value, 10)));

export function isTestRun() {
  return process.env.NODE_ENV === 'test'
    || process.argv.includes('--test')
    || Boolean(process.env.VITEST)
    || process.argv.some((arg) => /(?:^|[\\/])tests?[\\/]|\.test\.[cm]?[jt]s$/.test(arg));
}

// En pruebas cada proceso trabaja en su propio esquema para no tocar los datos reales.
export const testSchema = isTestRun() ? `sisrec_test_${process.pid}` : null;

const connectionString = config.databaseUrl;

// Se guarda y se lee en UTC; los reportes agrupan por día y mes de Lima con AT TIME ZONE (ver db.js).
const sessionOptions = ['-c timezone=UTC'];
if (testSchema) sessionOptions.push(`-c search_path=${testSchema},public`);

export const pool = new pg.Pool({ connectionString, max: 10, options: sessionOptions.join(' ') });

export const query = (text, params) => pool.query(text, params);

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool() {
  await pool.end();
}
