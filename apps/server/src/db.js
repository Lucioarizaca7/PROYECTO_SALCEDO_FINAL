import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

import { pool, withTransaction, closePool, testSchema } from './pg.js';
import { config } from './config.js';
import { ValidationError, NotFoundError, ConflictError } from './errors.js';
import { pronosticarSeries } from './prediccion.js';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

// Las fechas se guardan en UTC (TIMESTAMPTZ); se muestran y agrupan por día y mes de Lima,
// así un cobro de las 19:30 del 31 en Salcedo no cuenta para el mes siguiente.
const LOCAL = (column) => `(${column} AT TIME ZONE '${config.timeZone}')`;
const TS = (column) => `to_char(${LOCAL(column)}, 'YYYY-MM-DD HH24:MI:SS')`;
const DAY = (column) => `to_char(${column}, 'YYYY-MM-DD')`; // solo para columnas DATE

const rows = async (db, text, params = []) => (await db.query(text, params)).rows;
const first = async (db, text, params = []) => (await rows(db, text, params))[0] ?? null;
const cleanText = (value, max) => String(value ?? '').trim().slice(0, max) || null;

function toJson(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return JSON.stringify(value);
  try {
    JSON.parse(value);
    return value;
  } catch {
    return JSON.stringify({ raw: value });
  }
}

const limaDate = new Intl.DateTimeFormat('en-CA', { timeZone: config.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });

// Fecha (AAAA-MM-DD) y periodo (AAAA-MM) según el calendario de Salcedo, no el de UTC.
export const todayInLima = (date = new Date()) => limaDate.format(date);
export const currentPeriod = (date = new Date()) => todayInLima(date).slice(0, 7);

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// ---------------------------------------------------------------------------
// Inicialización: migraciones versionadas + datos base
// ---------------------------------------------------------------------------

async function runMigrations() {
  if (testSchema) {
    // Limpia esquemas de ejecuciones de prueba anteriores cuyo proceso ya terminó.
    const stale = await rows(pool, `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'sisrec\\_test\\_%'`);
    for (const { schema_name: name } of stale) {
      const pid = Number(name.replace('sisrec_test_', ''));
      let alive = false;
      try { process.kill(pid, 0); alive = true; } catch { alive = false; }
      if (!alive && name !== testSchema) await pool.query(`DROP SCHEMA IF EXISTS ${name} CASCADE`);
    }
    await pool.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE`);
    await pool.query(`CREATE SCHEMA ${testSchema}`);
  }

  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now())');
  const files = readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();
  const applied = new Set((await rows(pool, 'SELECT name FROM schema_migrations')).map((row) => row.name));

  // Base creada antes del registro de migraciones (script migrate-sqlite-to-pg).
  if (!applied.size) {
    const legacy = await first(pool, `SELECT to_regclass(current_schema() || '.comerciantes') AS t`);
    if (legacy?.t) {
      await pool.query(`INSERT INTO schema_migrations(name) VALUES ('0001_esquema_sisrec.sql') ON CONFLICT DO NOTHING`);
      applied.add('0001_esquema_sisrec.sql');
    }
  }

  for (const file of files) {
    if (applied.has(file)) continue;
    await pool.query(readFileSync(join(migrationsDir, file), 'utf8'));
    await pool.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
  }
}

// Catálogo de rubros: hace falta en cualquier entorno para registrar comerciantes.
async function seedCatalogs() {
  const rubros = [
    ['comida', 'Comida y venta de alimentos'],
    ['ropa', 'Venta de ropa y textiles'],
    ['zapatillas', 'Calzado y zapatillas'],
    ['otros', 'Otros rubros']
  ];
  for (const [nombre, descripcion] of rubros) {
    await pool.query('INSERT INTO rubros (nombre, descripcion) VALUES ($1, $2) ON CONFLICT (nombre) DO NOTHING', [nombre, descripcion]);
  }
}

// Usuarios con claves conocidas y datos de ejemplo: nunca en producción.
// En producción el primer administrador se crea con `npm run crear-admin`.
async function seedDemoData() {
  const hasUsers = await first(pool, 'SELECT 1 AS ok FROM usuarios LIMIT 1');
  if (config.isProduction) {
    if (!hasUsers) console.warn('No hay usuarios. Cree el primer administrador con: npm run crear-admin');
    return;
  }
  if (hasUsers) return;

  await withTransaction(async (client) => {
    const roleRows = await rows(client, 'SELECT id, codigo FROM roles');
    const roleId = Object.fromEntries(roleRows.map((row) => [row.codigo, row.id]));
    const demoUsers = [
      ['Administrador', 'admin@salcedo.gob.pe', 'admin123', 'super_admin'],
      ['Cobrador Principal', 'cobrador@salcedo.gob.pe', 'cobro123', 'cobrador'],
      ['Auditor Municipal', 'auditor@salcedo.gob.pe', 'audit123', 'auditor'],
      ['Comerciante Demo', 'comerciante@salcedo.gob.pe', 'comercio123', 'comerciante']
    ];
    for (const [nombre, email, password, rol] of demoUsers) {
      await client.query(
        'INSERT INTO usuarios (nombre, email, password_hash, rol_id) VALUES ($1, $2, $3, $4)',
        [nombre, email, bcrypt.hashSync(password, config.bcryptSaltRounds), roleId[rol]]
      );
    }

    const zonas = [
      ['Mercado Central', 'Zona central del mercado'],
      ['Parque Principal', 'Zona comercial del parque'],
      ['Zona Norte', 'Sector norte del centro poblado']
    ];
    for (const [nombre, descripcion] of zonas) {
      await client.query('INSERT INTO zonas (nombre, descripcion) VALUES ($1, $2) ON CONFLICT (nombre) DO NOTHING', [nombre, descripcion]);
    }

    const zonaId = async (nombre) => (await first(client, 'SELECT id FROM zonas WHERE nombre = $1', [nombre])).id;
    const rubroId = async (nombre) => (await first(client, 'SELECT id FROM rubros WHERE nombre = $1', [nombre])).id;

    const calles = [
      ['Jr. Lima', 'Calle principal del mercado', 'Mercado Central'],
      ['Av. Salcedo', 'Avenida central de la ciudad', 'Mercado Central'],
      ['Pasaje los Sauces', 'Pasaje residencial', 'Parque Principal'],
      ['Calle Comercio', 'Zona de locales comerciales', 'Parque Principal'],
      ['Av. del Norte', 'Avenida de acceso al norte', 'Zona Norte'],
      ['Jr. los Álamos', 'Calle residencial norte', 'Zona Norte']
    ];
    for (const [nombre, descripcion, zona] of calles) {
      await client.query('INSERT INTO calles (nombre, descripcion, zona_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [nombre, descripcion, await zonaId(zona)]);
    }

    const tarifas = [
      ['comida', 18, 'diaria'],
      ['ropa', 14, 'diaria'],
      ['zapatillas', 6, 'diaria'],
      ['otros', 90, 'mensual']
    ];
    for (const [rubro, monto, unidad] of tarifas) {
      await client.query(
        `INSERT INTO tarifas (rubro_id, tipo_tarifa, monto_fijo, monto_variable, unidad_medida, vigencia_inicio)
         VALUES ($1, 'fija', $2, 0, $3, '2026-01-01')`,
        [await rubroId(rubro), monto, unidad]
      );
    }

    const admin = await first(client, `SELECT id FROM usuarios WHERE email = 'admin@salcedo.gob.pe'`);
    const demo = await first(client, `
      INSERT INTO comerciantes (dni_ruc, nombre, rubro_id, zona_id, tipo_comerciante, estado, usuario_creador_id)
      VALUES ('20123456780', 'Comerciante Demo', $1, $2, 'permanente', 'activo', $3) RETURNING id`,
    [await rubroId('comida'), await zonaId('Mercado Central'), admin.id]);
    await client.query(
      `INSERT INTO puestos (comerciante_id, zona_id, codigo_puesto, direccion, metros_cuadrados, estado, latitud, longitud)
       VALUES ($1, $2, 'S-001', 'Mercado Central - Local 1', 12, 'ocupado', -15.8997, -70.5881)`,
      [demo.id, await zonaId('Mercado Central')]
    );
    await client.query(
      `INSERT INTO comerciante_preferencias (comerciante_id, clave, valor) VALUES ($1, 'notificaciones_activadas', 'true'), ($1, 'moneda_preferida', 'PEN')`,
      [demo.id]
    );
  });
}

// La pantalla de acceso del cliente anuncia admin@sisrec.demo; solo existe fuera de producción.
async function ensureDemoAdmin() {
  if (config.isProduction) return;
  await pool.query(`
    INSERT INTO usuarios (nombre, email, password_hash, rol_id)
    SELECT 'Administrador Demo', 'admin@sisrec.demo', $1, r.id FROM roles r WHERE r.codigo = 'super_admin'
    ON CONFLICT (email) DO NOTHING`, [bcrypt.hashSync('sisrec2026', config.bcryptSaltRounds)]);
}

export async function initializeDatabase({ seed = true } = {}) {
  await runMigrations();
  await seedCatalogs();
  if (seed) {
    await seedDemoData();
    await ensureDemoAdmin();
  }
  return pool;
}

// Cuentas reales del personal (en producción no hay semilla): super_admin, cobrador o auditor.
const ROLES_PERSONAL = ['super_admin', 'cobrador', 'auditor'];

export async function createUser({ nombre, email, password, rol = 'cobrador' }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanName = String(nombre || '').trim();
  const cleanRol = String(rol || '').trim();
  if (!ROLES_PERSONAL.includes(cleanRol)) throw new ValidationError(`El rol debe ser uno de: ${ROLES_PERSONAL.join(', ')}`);
  if (!cleanName) throw new ValidationError('El nombre es obligatorio');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw new ValidationError('Correo no válido');
  if (String(password || '').length < 10) throw new ValidationError('La contraseña debe tener al menos 10 caracteres');

  const created = await first(pool, `
    INSERT INTO usuarios (nombre, email, password_hash, rol_id)
    SELECT $1, $2, $3, r.id FROM roles r WHERE r.codigo = $4
    ON CONFLICT (email) DO NOTHING
    RETURNING id`, [cleanName, cleanEmail, bcrypt.hashSync(String(password), config.bcryptSaltRounds), cleanRol]);
  if (!created) throw new ConflictError(`Ya existe un usuario con el correo ${cleanEmail}`);
  return { id: Number(created.id), nombre: cleanName, email: cleanEmail, rol: cleanRol };
}

export async function createAdminUser({ nombre, email, password }) {
  return createUser({ nombre, email, password, rol: 'super_admin' });
}

// Puestos con coordenadas lejos del centro de Salcedo (p. ej. S-001 de la semilla, a ~60 km): casi
// siempre un error al cargar el padrón o al ubicar el puesto en el mapa.
const CENTRO_SALCEDO = { lat: -15.8740, lng: -69.9966 };

export function distanciaKm(a, b) {
  const rad = (grados) => (grados * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

export async function puestosLejosDelCentro(db = pool, { maxKm = 2 } = {}) {
  const puestos = await rows(db, `
    SELECT p.id, p.codigo_puesto, p.direccion, p.latitud, p.longitud, p.estado, c.nombre AS comerciante
    FROM puestos p LEFT JOIN comerciantes c ON c.id = p.comerciante_id
    WHERE p.latitud IS NOT NULL AND p.longitud IS NOT NULL AND p.estado <> 'inactivo'`);
  return puestos
    .map((p) => ({ ...p, id: Number(p.id), latitud: Number(p.latitud), longitud: Number(p.longitud),
      distancia_km: Number(distanciaKm(CENTRO_SALCEDO, { lat: Number(p.latitud), lng: Number(p.longitud) }).toFixed(2)) }))
    .filter((p) => p.distancia_km > maxKm)
    .sort((a, b) => b.distancia_km - a.distancia_km);
}

// Con PostgreSQL cada mutación ya es durable; se conserva por compatibilidad.
export async function persistDatabase() {
  return undefined;
}

export async function closeDatabase() {
  await closePool();
}

export async function dropTestSchema() {
  if (testSchema) await pool.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE`);
}

export async function getDbStats(db) {
  const row = await first(db, `
    SELECT
      (SELECT COUNT(*) FROM usuarios) AS usuarios,
      (SELECT COUNT(*) FROM zonas) AS zonas,
      (SELECT COUNT(*) FROM rubros) AS rubros,
      (SELECT COUNT(*) FROM comerciantes) AS comerciantes,
      (SELECT COUNT(*) FROM tarifas) AS tarifas,
      (SELECT COUNT(*) FROM transacciones) AS cobros,
      (SELECT COUNT(*) FROM auditoria_logs) AS auditoria
  `);
  return {
    totalUsuarios: Number(row.usuarios),
    totalZonas: Number(row.zonas),
    totalRubros: Number(row.rubros),
    totalComerciantes: Number(row.comerciantes),
    totalTarifas: Number(row.tarifas),
    totalCobros: Number(row.cobros),
    totalEventosAuditoria: Number(row.auditoria)
  };
}

// ---------------------------------------------------------------------------
// Auditoría (solo anexado, con cadena de hash)
// ---------------------------------------------------------------------------

export async function recordAudit(_db, {
  usuarioId = 1,
  usuarioRol = 'anonimo',
  rolUsuario = null,
  entidad,
  accion,
  detalle = '',
  metodoHttp = 'POST',
  ipOrigen = 'unknown',
  rutaEndpoint = null,
  recursoId = null,
  payloadPrevio = null,
  payloadNuevo = null
}) {
  await withTransaction((client) => appendAudit(client, {
    usuarioId, usuarioRol, rolUsuario, entidad, accion, detalle, metodoHttp, ipOrigen, rutaEndpoint, recursoId, payloadPrevio, payloadNuevo
  }));
}

// Anexa un evento de auditoría dentro de la transacción del llamador (client).
async function appendAudit(client, {
  usuarioId = 1,
  usuarioRol = 'anonimo',
  rolUsuario = null,
  entidad,
  accion,
  detalle = '',
  metodoHttp = 'POST',
  ipOrigen = 'unknown',
  rutaEndpoint = null,
  recursoId = null,
  payloadPrevio = null,
  payloadNuevo = null
}) {
  const ip = /^[0-9a-fA-F:.]+$/.test(String(ipOrigen || '')) ? String(ipOrigen) : null;
  const rol = String(rolUsuario || usuarioRol || 'anonimo');

  {
    await client.query('SELECT pg_advisory_xact_lock(7001)');
    const last = await first(client, 'SELECT hash_actual FROM auditoria_logs ORDER BY id DESC LIMIT 1');
    const hashPrev = last?.hash_actual ?? null;
    const body = JSON.stringify([usuarioId, rol, entidad, accion, detalle, metodoHttp, rutaEndpoint, recursoId, toJson(payloadPrevio), toJson(payloadNuevo), Date.now()]);
    const hashActual = createHash('sha256').update(`${hashPrev || ''}${body}`).digest('hex');

    const user = await first(client, 'SELECT id FROM usuarios WHERE id = $1', [Number(usuarioId)]);
    await client.query(
      `INSERT INTO auditoria_logs
         (usuario_id, rol, entidad, accion, detalle, metodo_http, ip_origen, ruta, recurso_id, payload_previo, payload_nuevo, hash_prev, hash_actual)
       VALUES ($1,$2,$3,$4,$5,$6,$7::inet,$8,$9,$10::jsonb,$11::jsonb,$12,$13)`,
      [
        user ? Number(usuarioId) : null, rol, entidad, accion, detalle, metodoHttp, ip,
        rutaEndpoint === null || rutaEndpoint === undefined ? null : String(rutaEndpoint),
        recursoId === null || recursoId === undefined ? null : String(recursoId),
        toJson(payloadPrevio), toJson(payloadNuevo), hashPrev, hashActual
      ]
    );
  }
}

export async function getAuditTrail(db, options = {}) {
  const comercianteId = Number(options.comerciante_id || 0);
  const entidad = String(options.entidad || '').trim();
  const conditions = [];
  const params = [];
  if (comercianteId) {
    // Por id exacto (con LIKE, el 3 coincidiría con el 13): el comerciante en sí (recurso_id, o el id
    // del alta, que no tiene :id en la ruta) y lo que lo referencia, como cobros y puestos.
    params.push(String(comercianteId));
    const n = `$${params.length}`;
    conditions.push(`(
      (a.recurso_id = ${n} AND a.entidad IN ('comerciantes', 'comerciante_preferencias', 'comerciante_portal_acceso'))
      OR (a.entidad = 'comerciantes' AND a.payload_nuevo->>'id' = ${n})
      OR a.payload_nuevo->>'comerciante_id' = ${n}
      OR a.payload_previo->>'comerciante_id' = ${n})`);
  }
  if (entidad) {
    params.push(entidad);
    conditions.push(`a.entidad = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return rows(db, `
    SELECT a.id, a.usuario_id, u.nombre AS usuario, a.entidad, a.accion, a.detalle,
           a.metodo_http, host(a.ip_origen) AS ip_origen, a.ruta AS ruta_endpoint,
           a.rol AS usuario_rol, a.rol AS rol_usuario, ${TS('a.fecha')} AS fecha
    FROM auditoria_logs a LEFT JOIN usuarios u ON u.id = a.usuario_id
    ${where} ORDER BY a.id DESC LIMIT 200
  `, params);
}

export async function verifyAuditChain(db) {
  const all = await rows(db, 'SELECT id, hash_prev, hash_actual FROM auditoria_logs ORDER BY id');
  let previous = null;
  for (const entry of all) {
    if ((entry.hash_prev ?? null) !== previous) return { valid: false, broken_at: entry.id };
    previous = entry.hash_actual;
  }
  return { valid: true, total: all.length };
}

// ---------------------------------------------------------------------------
// Dashboard, analítica y reportes
// ---------------------------------------------------------------------------

const PAYMENT_DAY = TS('co.fecha_cobro_cliente');

export async function getOperationalDashboard(db, options = {}) {
  const period = String(options.periodo || currentPeriod());
  const like = `${period}%`;
  const totals = await first(db, `
    SELECT COALESCE(SUM(co.monto), 0) AS total, COUNT(*) AS cantidad
    FROM transacciones co WHERE co.estado = 'confirmado' AND ${PAYMENT_DAY} LIKE $1`, [like]);
  const byZone = await rows(db, `
    SELECT z.nombre AS zona, COUNT(DISTINCT c.id) AS comerciantes, COALESCE(SUM(co.monto), 0) AS recaudado
    FROM zonas z LEFT JOIN comerciantes c ON c.zona_id = z.id
    LEFT JOIN transacciones co ON co.comerciante_id = c.id AND co.estado = 'confirmado' AND ${PAYMENT_DAY} LIKE $1
    GROUP BY z.id, z.nombre ORDER BY recaudado DESC`, [like]);
  const byCategory = await rows(db, `
    SELECT r.nombre AS rubro, COALESCE(SUM(co.monto), 0) AS recaudado, COUNT(co.id) AS pagos
    FROM rubros r LEFT JOIN comerciantes c ON c.rubro_id = r.id
    LEFT JOIN transacciones co ON co.comerciante_id = c.id AND co.estado = 'confirmado' AND ${PAYMENT_DAY} LIKE $1
    GROUP BY r.id, r.nombre ORDER BY recaudado DESC`, [like]);
  const byCollector = await rows(db, `
    SELECT COALESCE(u.nombre, 'Sin asignar') AS cobrador, COALESCE(SUM(co.monto), 0) AS recaudado, COUNT(co.id) AS pagos
    FROM transacciones co LEFT JOIN usuarios u ON u.id = co.cobrador_id
    WHERE co.estado = 'confirmado' AND ${PAYMENT_DAY} LIKE $1
    GROUP BY co.cobrador_id, u.nombre ORDER BY recaudado DESC`, [like]);
  const active = await first(db, `SELECT COUNT(*) AS total FROM comerciantes WHERE estado = 'activo'`);

  return {
    periodo: period,
    recaudacion: Number(totals.total),
    pagos: Number(totals.cantidad),
    deudaPendiente: await getPendingDebt(db, period),
    comerciantesActivos: Number(active.total),
    porZona: byZone,
    porRubro: byCategory,
    porCobrador: byCollector
  };
}

// La deuda se devenga por liquidación (tarifa vigente - cobros del periodo).
export async function getPendingDebt(db, period = currentPeriod(), maxMerchants = 300) {
  const merchants = await rows(db, `SELECT id FROM comerciantes WHERE estado = 'activo' ORDER BY id LIMIT $1`, [maxMerchants]);
  let total = 0;
  for (const merchant of merchants) {
    try {
      const liquidation = await calcularLiquidacion(db, merchant.id, period);
      if (!liquidation.cobro_diario) total += Number(liquidation.saldo || 0);
    } catch {
      // sin tarifa vigente: no devenga
    }
  }
  return Number(total.toFixed(2));
}

// Proyección de recaudación: series mensuales reales (cobros confirmados, meses de Lima, sin el mes en
// curso) y suavizado exponencial con su error medido. La calcula el microservicio Python; si no responde
// en 3 s, el respaldo local con el mismo algoritmo (prediccion.js). Nada de factores fijos.
const MESES_HISTORIA = 12;

async function proyectarSeries(series, horizonteMeses) {
  if (config.analyticsUrl) {
    try {
      const response = await fetch(`${config.analyticsUrl}/api/recaudacion/proyeccion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ series, horizonte_meses: horizonteMeses }),
        signal: AbortSignal.timeout(3000)
      });
      if (response.ok) {
        const body = await response.json();
        if (body?.resultados) return { resultados: body.resultados, fuente: 'analytics' };
      }
      console.warn(`Analítica respondió ${response.status}; se usa el respaldo local`);
    } catch (error) {
      console.warn(`Analítica no disponible (${error.message}); se usa el respaldo local`);
    }
  }
  return { resultados: pronosticarSeries(series, horizonteMeses), fuente: 'respaldo_local' };
}

export async function generateForecastProjection(db, options = {}) {
  const period = PERIODO_RE.test(String(options.period || '')) ? String(options.period) : currentPeriod();
  const horizonDays = Math.min(Math.max(Number(options.horizonteDias || options.horizonDays || 90), 1), 365);
  const horizonteMeses = Math.max(1, Math.ceil(horizonDays / 30));

  // Meses de historia: los MESES_HISTORIA anteriores al periodo, pero no antes del primer cobro.
  const meses = [];
  let mes = period;
  for (let i = 0; i < MESES_HISTORIA; i += 1) {
    const [anio, m] = mes.split('-').map(Number);
    mes = m === 1 ? `${anio - 1}-12` : `${anio}-${String(m - 1).padStart(2, '0')}`;
    meses.unshift(mes);
  }
  const filas = await rows(db, `
    SELECT to_char(${LOCAL('co.fecha_cobro_cliente')}, 'YYYY-MM') AS mes, c.zona_id, z.nombre AS zona, c.rubro_id, r.nombre AS rubro,
           SUM(co.monto) AS monto
    FROM transacciones co
    JOIN comerciantes c ON c.id = co.comerciante_id
    LEFT JOIN zonas z ON z.id = c.zona_id
    LEFT JOIN rubros r ON r.id = c.rubro_id
    WHERE co.estado = 'confirmado' AND to_char(${LOCAL('co.fecha_cobro_cliente')}, 'YYYY-MM') BETWEEN $1 AND $2
    GROUP BY 1, 2, 3, 4, 5`, [meses[0], meses[meses.length - 1]]);
  const primerMes = filas.reduce((min, fila) => (fila.mes < min ? fila.mes : min), meses[meses.length - 1]);
  const usados = filas.length ? meses.filter((item) => item >= primerMes) : [];

  const series = { total: usados.map(() => 0) };
  const nombres = {};
  for (const fila of filas) {
    const indice = usados.indexOf(fila.mes);
    if (indice < 0) continue;
    const monto = Number(fila.monto);
    series.total[indice] += monto;
    for (const [clave, nombre] of [[`zona:${fila.zona_id}`, fila.zona], [`rubro:${fila.rubro_id}`, fila.rubro]]) {
      series[clave] = series[clave] || usados.map(() => 0);
      series[clave][indice] += monto;
      nombres[clave] = nombre || 'Sin nombre';
    }
  }
  for (const clave of Object.keys(series)) series[clave] = series[clave].map((valor) => Number(valor.toFixed(2)));

  const { resultados, fuente } = await proyectarSeries(series, horizonteMeses);
  const total = resultados.total;
  // La proyección es mensual; se lleva al horizonte en días pedido.
  const alHorizonte = (resultado) => Number(((resultado?.total || 0) * (horizonDays / (horizonteMeses * 30))).toFixed(2));
  const sumar = (lista) => Number(lista.reduce((a, b) => a + b, 0).toFixed(2));
  const desglose = (prefijo, campoId, campoNombre) => Object.keys(series)
    .filter((clave) => clave.startsWith(prefijo))
    .map((clave) => ({
      [campoId]: Number(clave.slice(prefijo.length)),
      [campoNombre]: nombres[clave],
      recaudado: sumar(series[clave]),
      proyectado: alHorizonte(resultados[clave]),
      mape: resultados[clave]?.mape ?? null
    }))
    .sort((a, b) => b.proyectado - a.proyectado);

  const totalProyectado = alHorizonte(total);
  const result = {
    periodo: period,
    horizonte_dias: horizonDays,
    totalHistorico: sumar(series.total),
    totalProyectado,
    promedioDiario: Number((totalProyectado / horizonDays).toFixed(2)),
    modelo: {
      nombre: total?.modelo || 'sin_datos',
      alpha: total?.alpha ?? null,
      beta: total?.beta ?? null,
      // Error porcentual medio de los pronósticos a un mes sobre la historia (walk-forward). null = poca historia.
      mape: total?.mape ?? null,
      meses_historia: usados.length,
      desde: usados[0] ?? null,
      hasta: usados[usados.length - 1] ?? null,
      fuente
    },
    serie: usados.map((periodo, i) => ({ periodo, monto: series.total[i] })),
    proyeccion_mensual: total?.proyeccion_mensual || [],
    porZona: desglose('zona:', 'zona_id', 'zona'),
    porRubro: desglose('rubro:', 'rubro_id', 'rubro')
  };

  await db.query(
    `INSERT INTO modelos_ia_metricas (modelo, version, entidad_tipo, periodo, valor_predicho, valor_real, metricas)
     VALUES ('proyeccion_ingresos', $1, 'global', $2, $3, $4, $5::jsonb)`,
    [`${result.modelo.nombre}-v2`, period, result.totalProyectado, result.totalHistorico,
      JSON.stringify({ horizonte_dias: horizonDays, mape: result.modelo.mape, alpha: result.modelo.alpha, beta: result.modelo.beta, meses_historia: usados.length, fuente })]
  );

  return result;
}

export async function scoreMorosidadComerciante(db, comercianteId) {
  const merchant = await findComerciante(db, comercianteId);
  if (!merchant) throw new NotFoundError('Comerciante no encontrado');

  let deudaTotal = 0;
  try {
    const liquidation = await calcularLiquidacion(db, merchant.id);
    deudaTotal = liquidation.cobro_diario ? 0 : Number(liquidation.saldo || 0);
  } catch {
    deudaTotal = 0;
  }

  const pagos = await first(db, `
    SELECT COUNT(*) AS total_pagos, COALESCE(SUM(monto), 0) AS monto_pagado,
           to_char(MAX(fecha_cobro_cliente), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS ultima_fecha
    FROM transacciones WHERE comerciante_id = $1 AND estado = 'confirmado'`, [merchant.id]);

  const totalPagos = Number(pagos.total_pagos);
  const montoPagado = Number(pagos.monto_pagado);
  const ultimaFecha = pagos.ultima_fecha ? new Date(pagos.ultima_fecha) : null;
  const diasSinPago = ultimaFecha ? Math.max(0, (Date.now() - ultimaFecha.getTime()) / 86400000) : 90;
  const deudaRatio = deudaTotal > 0 ? clamp(deudaTotal / Math.max(1, montoPagado + deudaTotal), 0, 1) : 0;
  const cumplimiento = totalPagos > 0 ? clamp(montoPagado / Math.max(1, deudaTotal + montoPagado), 0, 1) : 0.45;
  const recencyPenalty = clamp(diasSinPago / 90, 0, 1);
  const estadoPenalty = merchant.estado === 'pendiente' ? 0.2 : merchant.estado === 'inactivo' ? 0.3 : 0;

  const score = clamp(0.45 * deudaRatio + 0.25 * (1 - cumplimiento) + 0.20 * recencyPenalty + 0.10 * estadoPenalty, 0, 1);
  let nivel = 'bajo';
  if (score > 0.85) nivel = 'critico';
  else if (score > 0.66) nivel = 'alto';
  else if (score > 0.33) nivel = 'medio';

  let motivo = 'Pago regular y cumplimiento estable';
  if (deudaTotal > 0 && score >= 0.5) motivo = 'Existe deuda pendiente acumulada con historial de pagos intermitentes';
  else if (diasSinPago > 45) motivo = 'No registra pagos recientes en la última ventana de cobranza';
  else if (merchant.estado === 'pendiente') motivo = 'El comerciante requiere seguimiento por estado de padrón';

  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO modelos_ia_metricas (modelo, version, entidad_tipo, entidad_id, periodo, score, nivel, metricas)
     VALUES ('riesgo_morosidad', 'heuristico-v1', 'comerciante', $1, $2, $3, $4, $5::jsonb)`,
    [merchant.id, now.slice(0, 7), Number(score.toFixed(4)), nivel, JSON.stringify({
      motivo_principal: motivo,
      deuda_total: deudaTotal,
      alerta: ['alto', 'critico'].includes(nivel)
    })]
  );

  return {
    comerciante_id: merchant.id,
    nombre: merchant.nombre,
    score: Number(score.toFixed(4)),
    nivel,
    motivo_principal: motivo,
    fecha_calculo: now,
    deuda_total: Number(deudaTotal.toFixed(2))
  };
}

export async function getRiskDashboard(db, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit || 5), 1), 20);
  const records = await rows(db, `
    SELECT * FROM (
      SELECT DISTINCT ON (m.entidad_id)
             m.id, m.entidad_id AS comerciante_id, c.nombre, c.dni_ruc,
             m.score AS score_riesgo, m.nivel AS nivel_riesgo,
             m.metricas->>'motivo_principal' AS motivo_principal,
             ${TS('m.generado_en')} AS fecha_calculo
      FROM modelos_ia_metricas m
      JOIN comerciantes c ON c.id = m.entidad_id
      WHERE m.modelo = 'riesgo_morosidad' AND m.entidad_tipo = 'comerciante'
      ORDER BY m.entidad_id, m.generado_en DESC, m.id DESC
    ) latest
    ORDER BY score_riesgo DESC, id DESC
    LIMIT $1`, [limit]);

  if (records.length) {
    return {
      summary: {
        total: records.length,
        bajo: records.filter((item) => item.nivel_riesgo === 'bajo').length,
        medio: records.filter((item) => item.nivel_riesgo === 'medio').length,
        alto: records.filter((item) => item.nivel_riesgo === 'alto').length,
        critico: records.filter((item) => item.nivel_riesgo === 'critico').length
      },
      records: records.map(({ id, ...item }) => ({
        ...item,
        score_riesgo: Number(item.score_riesgo || 0),
        nivel_riesgo: String(item.nivel_riesgo || 'bajo')
      }))
    };
  }

  const merchants = await getComerciantes(db, { includeInactive: true, limit: 1000 });
  const computed = [];
  for (const merchant of merchants.slice(0, limit)) {
    computed.push(await scoreMorosidadComerciante(db, merchant.id));
  }
  return {
    summary: {
      total: computed.length,
      bajo: computed.filter((item) => item.nivel === 'bajo').length,
      medio: computed.filter((item) => item.nivel === 'medio').length,
      alto: computed.filter((item) => item.nivel === 'alto').length,
      critico: computed.filter((item) => item.nivel === 'critico').length
    },
    records: computed
  };
}

export async function getReportRows(db, options = {}) {
  const conditions = [];
  const params = [];
  const period = String(options.periodo || '').trim();
  if (period) { params.push(`${period}%`); conditions.push(`${PAYMENT_DAY} LIKE $${params.length}`); }
  if (options.zona_id) { params.push(Number(options.zona_id)); conditions.push(`c.zona_id = $${params.length}`); }
  if (options.rubro_id) { params.push(Number(options.rubro_id)); conditions.push(`c.rubro_id = $${params.length}`); }
  if (options.cobrador_id) { params.push(Number(options.cobrador_id)); conditions.push(`co.cobrador_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return rows(db, `
    SELECT co.id, ${PAYMENT_DAY} AS fecha, c.codigo AS comerciante_codigo,
      c.nombre AS comerciante, r.nombre AS rubro, z.nombre AS zona, u.nombre AS cobrador,
      co.monto, co.metodo_pago, co.estado, cp.numero_correlativo AS comprobante
    FROM transacciones co JOIN comerciantes c ON c.id = co.comerciante_id
      JOIN rubros r ON r.id = c.rubro_id JOIN zonas z ON z.id = c.zona_id
      LEFT JOIN usuarios u ON u.id = co.cobrador_id LEFT JOIN comprobantes cp ON cp.id = co.comprobante_id
    ${where} ORDER BY co.fecha_cobro_cliente DESC`, params);
}

/**
 * Una celda del CSV. Un texto que empieza con = + - @ (o tabulación / retorno) Excel lo ejecuta como fórmula:
 * un nombre de comerciante como =HYPERLINK(...) se activaría al abrir el reporte. Se le antepone ' para que
 * quede como texto. Los montos (números) no se tocan.
 */
export function celdaCsv(value) {
  if (value === null || value === undefined) return '';
  let texto = String(value);
  if (typeof value !== 'number' && /^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
  return /[",\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

export async function buildReportCsv(db, options = {}) {
  const data = await getReportRows(db, options);
  const headers = ['fecha', 'comerciante_codigo', 'comerciante', 'rubro', 'zona', 'cobrador', 'monto', 'metodo_pago', 'estado', 'comprobante'];

  if (!data.length) return `${headers.join(',')}\n`;
  const lines = [headers.join(',')];
  for (const row of data) lines.push(headers.map((header) => celdaCsv(row[header])).join(','));
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Catálogos: rubros, zonas, calles
// ---------------------------------------------------------------------------

export async function getRubros(db) {
  return rows(db, 'SELECT id, codigo, nombre, descripcion FROM rubros WHERE activo ORDER BY nombre ASC');
}

export async function getZonas(db) {
  return rows(db, 'SELECT id, codigo, nombre, descripcion, tipo_via FROM zonas ORDER BY nombre ASC');
}

const TIPOS_VIA = ['asfaltada', 'sin_asfaltar'];

// '' o null = sin dato; cualquier otro valor debe ser asfaltada o sin_asfaltar.
function parseTipoVia(value) {
  if (value === undefined) return undefined;
  const tipo = String(value ?? '').trim().toLowerCase();
  if (!tipo) return null;
  if (!TIPOS_VIA.includes(tipo)) throw new ValidationError('El tipo de vía debe ser "asfaltada" o "sin_asfaltar"');
  return tipo;
}

export async function insertZona(db, payload) {
  const nombre = String(payload.nombre || '').trim();
  const descripcion = String(payload.descripcion || '').trim();
  const tipoVia = parseTipoVia(payload.tipo_via) ?? null;
  if (!nombre) throw new ValidationError('El nombre de la zona es obligatorio');

  const duplicate = await first(db, 'SELECT id FROM zonas WHERE lower(btrim(nombre)) = lower(btrim($1))', [nombre]);
  if (duplicate) throw new ConflictError('Ya existe una zona con ese nombre');

  return first(db, 'INSERT INTO zonas (nombre, descripcion, tipo_via) VALUES ($1, $2, $3) RETURNING id, codigo, nombre, descripcion, tipo_via', [nombre, descripcion, tipoVia]);
}

export async function updateZona(db, id, payload) {
  const current = await first(db, 'SELECT id, nombre, descripcion, tipo_via FROM zonas WHERE id = $1', [Number(id)]);
  if (!current) throw new NotFoundError('Zona no encontrada');

  const nombre = payload.nombre === undefined ? current.nombre : String(payload.nombre).trim();
  const descripcion = payload.descripcion === undefined ? current.descripcion : String(payload.descripcion).trim();
  const tipoVia = payload.tipo_via === undefined ? current.tipo_via : parseTipoVia(payload.tipo_via);
  if (!nombre) throw new ValidationError('El nombre de la zona es obligatorio');

  const duplicate = await first(db, 'SELECT id FROM zonas WHERE lower(btrim(nombre)) = lower(btrim($1)) AND id <> $2', [nombre, Number(id)]);
  if (duplicate) throw new ConflictError('Ya existe una zona con ese nombre');

  return first(db, 'UPDATE zonas SET nombre = $1, descripcion = $2, tipo_via = $3 WHERE id = $4 RETURNING id, codigo, nombre, descripcion, tipo_via', [nombre, descripcion, tipoVia, Number(id)]);
}

export async function deleteZona(db, id) {
  const zonaId = Number(id);
  const existing = await first(db, 'SELECT id FROM zonas WHERE id = $1', [zonaId]);
  if (!existing) throw new NotFoundError('Zona no encontrada');
  try {
    await db.query('DELETE FROM zonas WHERE id = $1', [zonaId]);
  } catch (error) {
    if (error.code === '23503') throw new ConflictError('No se puede eliminar la zona: tiene comerciantes, puestos o tarifas asociados');
    throw error;
  }
  return { id: zonaId, eliminado: true };
}

export async function getCalles(db, options = {}) {
  const zonaId = Number(options.zona_id || 0);
  return rows(db, `
    SELECT c.id, c.nombre, c.descripcion, c.zona_id, z.nombre AS zona
    FROM calles c JOIN zonas z ON z.id = c.zona_id
    ${zonaId ? 'WHERE c.zona_id = $1' : ''}
    ORDER BY c.nombre ASC`, zonaId ? [zonaId] : []);
}

async function findCalle(db, id) {
  return first(db, `
    SELECT c.id, c.nombre, c.descripcion, c.zona_id, z.nombre AS zona
    FROM calles c JOIN zonas z ON z.id = c.zona_id WHERE c.id = $1`, [Number(id)]);
}

export async function insertCalle(db, payload) {
  const nombre = String(payload.nombre || '').trim();
  const descripcion = String(payload.descripcion || '').trim();
  const zonaId = Number(payload.zona_id);
  if (!nombre || !zonaId) throw new ValidationError('Nombre y zona son obligatorios');

  if (!(await first(db, 'SELECT id FROM zonas WHERE id = $1', [zonaId]))) throw new ValidationError('La zona especificada no existe');
  const duplicate = await first(db, 'SELECT id FROM calles WHERE lower(btrim(nombre)) = lower(btrim($1)) AND zona_id = $2', [nombre, zonaId]);
  if (duplicate) throw new ConflictError('Ya existe una calle con ese nombre en la zona especificada');

  const created = await first(db, 'INSERT INTO calles (nombre, descripcion, zona_id) VALUES ($1, $2, $3) RETURNING id', [nombre, descripcion, zonaId]);
  return findCalle(db, created.id);
}

export async function updateCalle(db, id, payload) {
  const current = await findCalle(db, id);
  if (!current) throw new NotFoundError('Calle no encontrada');

  const nombre = payload.nombre === undefined ? current.nombre : String(payload.nombre).trim();
  const descripcion = payload.descripcion === undefined ? current.descripcion : String(payload.descripcion).trim();
  const zonaId = payload.zona_id === undefined ? current.zona_id : Number(payload.zona_id);
  if (!nombre || !zonaId) throw new ValidationError('Nombre y zona son obligatorios');

  if (!(await first(db, 'SELECT id FROM zonas WHERE id = $1', [zonaId]))) throw new ValidationError('La zona especificada no existe');
  const duplicate = await first(db, 'SELECT id FROM calles WHERE lower(btrim(nombre)) = lower(btrim($1)) AND zona_id = $2 AND id <> $3', [nombre, zonaId, Number(id)]);
  if (duplicate) throw new ConflictError('Ya existe una calle con ese nombre en la zona especificada');

  await db.query('UPDATE calles SET nombre = $1, descripcion = $2, zona_id = $3 WHERE id = $4', [nombre, descripcion, zonaId, Number(id)]);
  return findCalle(db, id);
}

export async function deleteCalle(db, id) {
  const calleId = Number(id);
  if (!(await first(db, 'SELECT id FROM calles WHERE id = $1', [calleId]))) throw new NotFoundError('Calle no encontrada');
  await db.query('DELETE FROM calles WHERE id = $1', [calleId]);
  return { id: calleId, eliminado: true };
}

// ---------------------------------------------------------------------------
// Preferencias del comerciante
// ---------------------------------------------------------------------------

export async function getComerciantePreferencias(db, comercianteId) {
  return rows(db, 'SELECT id, clave, valor FROM comerciante_preferencias WHERE comerciante_id = $1 ORDER BY id', [Number(comercianteId)]);
}

export async function updateComerciantePreferencias(db, comercianteId, payload) {
  await withTransaction(async (client) => {
    await client.query('DELETE FROM comerciante_preferencias WHERE comerciante_id = $1', [Number(comercianteId)]);
    for (const [clave, valor] of Object.entries(payload || {})) {
      await client.query(
        'INSERT INTO comerciante_preferencias (comerciante_id, clave, valor) VALUES ($1, $2, $3)',
        [Number(comercianteId), String(clave), String(valor)]
      );
    }
  });
  return getComerciantePreferencias(db, comercianteId);
}

// ---------------------------------------------------------------------------
// Comerciantes
// ---------------------------------------------------------------------------

const COMERCIANTE_COLUMNS = `
  c.id, c.correlativo, c.codigo, c.dni_ruc, c.nombre, c.tipo_comerciante AS categoria, c.tipo_comerciante,
  c.estado, c.estado_empadronamiento, ${TS('c.creado_en')} AS fecha_registro,
  c.rubro_id, c.zona_id, r.nombre AS rubro, z.nombre AS zona,
  'SISREC://comerciante/' || c.codigo AS qr_code`;

export async function findComerciante(db, id) {
  return first(db, `
    SELECT ${COMERCIANTE_COLUMNS}
    FROM comerciantes c JOIN rubros r ON r.id = c.rubro_id JOIN zonas z ON z.id = c.zona_id
    WHERE c.id = $1`, [Number(id)]);
}

function comercianteFilter(options, params) {
  const search = String(options.search || '').trim();
  const rubroId = Number(options.rubro_id || 0);
  const zonaId = Number(options.zona_id || 0);
  const conditions = [];

  if (options.includeInactive !== true) conditions.push("c.estado <> 'inactivo'");
  if (search) {
    params.push(`%${search}%`);
    const n = `$${params.length}`;
    conditions.push(`(c.nombre ILIKE ${n} OR c.dni_ruc ILIKE ${n} OR c.codigo ILIKE ${n} OR lpad(c.correlativo::text, 4, '0') LIKE ${n}
      OR EXISTS (SELECT 1 FROM comerciante_codigos_historicos h WHERE h.comerciante_id = c.id AND h.codigo ILIKE ${n}))`);
  }
  if (rubroId) { params.push(rubroId); conditions.push(`c.rubro_id = $${params.length}`); }
  if (zonaId) { params.push(zonaId); conditions.push(`c.zona_id = $${params.length}`); }
  return conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
}

export async function getComerciantes(db, options = {}) {
  const page = Math.max(Number(options.page || 1), 1);
  const limit = Math.min(Math.max(Number(options.limit || 10), 1), 1000);
  const params = [];
  const where = comercianteFilter(options, params);
  params.push(limit, (page - 1) * limit);
  return rows(db, `
    SELECT ${COMERCIANTE_COLUMNS}
    FROM comerciantes c JOIN rubros r ON r.id = c.rubro_id JOIN zonas z ON z.id = c.zona_id
    ${where}
    ORDER BY c.id DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
}

export async function countComerciantes(db, options = {}) {
  const params = [];
  const where = comercianteFilter(options, params);
  const result = await first(db, `SELECT COUNT(*) AS total FROM comerciantes c ${where}`, params);
  return Number(result.total);
}

export function validateDocument(value) {
  const document = String(value || '').trim();
  const isDni = /^\d{8}$/.test(document);
  const isRuc = /^(10|15|17|20)\d{9}$/.test(document);
  if (!isDni && !isRuc) {
    throw new ValidationError('DNI debe tener 8 dígitos o RUC debe tener 11 dígitos válido');
  }
  return document;
}

async function ensureUniqueActiveDocument(db, dniRuc, excludeId = null) {
  const result = excludeId
    ? await first(db, `SELECT id FROM comerciantes WHERE dni_ruc = $1 AND id <> $2 AND estado IN ('activo', 'pendiente')`, [dniRuc, Number(excludeId)])
    : await first(db, `SELECT id FROM comerciantes WHERE dni_ruc = $1 AND estado IN ('activo', 'pendiente')`, [dniRuc]);
  if (result) throw new ConflictError('Ya existe un comerciante activo con ese DNI/RUC');
}

const TIPOS_COMERCIANTE = ['eventual', 'permanente', 'ferial'];
const ESTADOS_COMERCIANTE = ['activo', 'inactivo', 'pendiente'];

export async function insertComerciante(db, payload) {
  const dniRuc = validateDocument(payload.dni_ruc);
  const nombre = String(payload.nombre || '').trim();
  const rubroId = Number(payload.rubro_id);
  const zonaId = Number(payload.zona_id);
  // "categoria" se acepta como sinónimo antiguo de tipo_comerciante.
  const tipoComerciante = String(payload.tipo_comerciante || payload.categoria || 'permanente').trim();
  const estado = String(payload.estado || 'activo').trim();
  const usuarioCreador = Number(payload.usuario_creador || 1);

  if (!dniRuc || !nombre || !rubroId || !zonaId) throw new ValidationError('DNI/RUC, nombre, rubro y zona son obligatorios');
  if (!TIPOS_COMERCIANTE.includes(tipoComerciante)) throw new ValidationError('Tipo de comerciante no válido');
  if (!ESTADOS_COMERCIANTE.includes(estado)) throw new ValidationError('Estado de comerciante no válido');

  await ensureUniqueActiveDocument(db, dniRuc);

  const creator = await first(db, 'SELECT id FROM usuarios WHERE id = $1', [usuarioCreador]);
  const creatorId = creator ? usuarioCreador : null;

  // La baja es lógica: si el documento pertenece a un comerciante dado de baja, se reactiva.
  const dormant = await first(db, `SELECT id FROM comerciantes WHERE dni_ruc = $1 AND estado = 'inactivo'`, [dniRuc]);
  let id;
  if (dormant) {
    await db.query(`
      UPDATE comerciantes
      SET nombre = $1, rubro_id = $2, zona_id = $3, tipo_comerciante = $4, estado = $5,
          usuario_creador_id = $6, fecha_baja = NULL
      WHERE id = $7`, [nombre, rubroId, zonaId, tipoComerciante, estado, creatorId, dormant.id]);
    id = dormant.id;
  } else {
    const created = await first(db, `
      INSERT INTO comerciantes (dni_ruc, nombre, rubro_id, zona_id, tipo_comerciante, estado, usuario_creador_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [dniRuc, nombre, rubroId, zonaId, tipoComerciante, estado, creatorId]);
    id = created.id;
  }

  const { codigo, correlativo } = await first(db, 'SELECT codigo, correlativo FROM comerciantes WHERE id = $1', [id]);
  return {
    id,
    correlativo,
    codigo,
    dni_ruc: dniRuc,
    nombre,
    rubro_id: rubroId,
    zona_id: zonaId,
    categoria: tipoComerciante,
    tipo_comerciante: tipoComerciante,
    estado,
    usuario_creador: usuarioCreador
  };
}

export async function updateComerciante(db, id, payload) {
  const current = await findComerciante(db, id);
  if (!current) throw new NotFoundError('Comerciante no encontrado');

  const dniRuc = payload.dni_ruc === undefined ? current.dni_ruc : validateDocument(payload.dni_ruc);
  const nombre = payload.nombre === undefined ? current.nombre : String(payload.nombre).trim();
  const rubroId = payload.rubro_id === undefined ? current.rubro_id : Number(payload.rubro_id);
  const zonaId = payload.zona_id === undefined ? current.zona_id : Number(payload.zona_id);
  const tipoComerciante = payload.tipo_comerciante === undefined
    ? (payload.categoria === undefined ? current.tipo_comerciante : String(payload.categoria).trim())
    : String(payload.tipo_comerciante).trim();
  const estado = payload.estado === undefined ? current.estado : String(payload.estado).trim();

  if (!nombre || !rubroId || !zonaId) throw new ValidationError('Nombre, rubro y zona son obligatorios');
  if (!TIPOS_COMERCIANTE.includes(tipoComerciante)) throw new ValidationError('Tipo de comerciante no válido');
  if (!ESTADOS_COMERCIANTE.includes(estado)) throw new ValidationError('Estado de comerciante no válido');

  await ensureUniqueActiveDocument(db, dniRuc, Number(id));

  await db.query(`
    UPDATE comerciantes
    SET dni_ruc = $1, nombre = $2, rubro_id = $3, zona_id = $4, tipo_comerciante = $5, estado = $6
    WHERE id = $7`, [dniRuc, nombre, rubroId, zonaId, tipoComerciante, estado, Number(id)]);

  // Pasar a inactivo editando el estado es una baja como la de deactivateComerciante: sus puestos dejan
  // de generar deuda. Al reactivarlo se limpia la fecha de baja; los puestos se vuelven a asignar.
  if (estado === 'inactivo' && current.estado !== 'inactivo') await darDeBajaComerciante(db, id);
  if (estado !== 'inactivo' && current.estado === 'inactivo') {
    await db.query('UPDATE comerciantes SET fecha_baja = NULL WHERE id = $1', [Number(id)]);
  }

  return findComerciante(db, id);
}

// Una sola sentencia: los puestos y el comerciante se dan de baja juntos aunque no haya transacción.
async function darDeBajaComerciante(db, id) {
  await db.query(`
    WITH baja AS (UPDATE puestos SET estado = 'inactivo' WHERE comerciante_id = $1)
    UPDATE comerciantes SET estado = 'inactivo', fecha_baja = now() WHERE id = $1`, [Number(id)]);
}

// Baja lógica: se conserva el historial de cobros y notificaciones.
export async function deactivateComerciante(db, id) {
  const merchantId = Number(id);
  if (!(await first(db, 'SELECT id FROM comerciantes WHERE id = $1', [merchantId]))) throw new NotFoundError('Comerciante no encontrado');
  await darDeBajaComerciante(db, merchantId);
  return { id: merchantId, eliminado: true };
}

// ---------------------------------------------------------------------------
// Puestos
// ---------------------------------------------------------------------------

const PUESTO_SELECT = `
  SELECT p.id, p.comerciante_id, c.nombre AS comerciante, c.estado AS comerciante_estado,
         p.zona_id, z.nombre AS zona, p.direccion, p.metros_cuadrados, p.estado,
         p.codigo_puesto AS codigo, p.latitud, p.longitud,
         c.tipo_comerciante AS categoria, c.tipo_comerciante, c.codigo AS comerciante_codigo
  FROM puestos p
  LEFT JOIN comerciantes c ON c.id = p.comerciante_id
  JOIN zonas z ON z.id = p.zona_id`;

// Estado de pago de cada puesto en el periodo. La deuda es del comerciante: se calcula con
// calcularLiquidacion (la misma de Pagos) y se muestra en su puesto principal, el de menor id
// entre los cobrables (mismo criterio que findMerchantPost); sus otros puestos salen "incluido".
async function withPaymentStatus(db, puestos, periodo = currentPeriod()) {
  const merchantIds = [...new Set(puestos.filter((p) => p.comerciante_id).map((p) => Number(p.comerciante_id)))];
  const principalPorComerciante = new Map(
    merchantIds.length
      ? (await rows(db, `
          SELECT DISTINCT ON (comerciante_id) comerciante_id, id, codigo_puesto
          FROM puestos
          WHERE comerciante_id = ANY($1::bigint[]) AND estado NOT IN ('disponible', 'inactivo')
          ORDER BY comerciante_id, id`, [merchantIds])).map((row) => [Number(row.comerciante_id), row])
      : []
  );

  const liquidaciones = new Map();
  for (const merchantId of principalPorComerciante.keys()) {
    try {
      liquidaciones.set(merchantId, await calcularLiquidacion(db, merchantId, periodo));
    } catch (error) {
      liquidaciones.set(merchantId, { error: error.message });
    }
  }

  return puestos.map((puesto) => {
    const result = { ...puesto, periodo, saldo_pendiente: 0, monto_total: 0, monto_pagado: 0, cobro_diario: false, puesto_principal: null, motivo: null };
    if (puesto.estado === 'inactivo') return { ...result, estado_pago: 'inactivo' };
    if (!puesto.comerciante_id) return { ...result, estado_pago: puesto.estado === 'reservado' ? 'reservado' : 'libre' };
    // Ferial ausente: el puesto queda disponible pero conserva a su titular; no devenga.
    if (puesto.estado === 'disponible') return { ...result, estado_pago: 'ausente' };

    const principal = principalPorComerciante.get(Number(puesto.comerciante_id));
    if (principal && Number(principal.id) !== Number(puesto.id)) {
      return { ...result, estado_pago: 'incluido', puesto_principal: principal.codigo_puesto };
    }
    const liquidacion = liquidaciones.get(Number(puesto.comerciante_id));
    if (!liquidacion || liquidacion.error) return { ...result, estado_pago: 'sin_tarifa', motivo: liquidacion?.error || null };
    const montos = {
      saldo_pendiente: Number(liquidacion.saldo || 0),
      monto_total: Number(liquidacion.monto_total || 0),
      monto_pagado: Number(liquidacion.monto_pagado || 0),
      cobro_diario: Boolean(liquidacion.cobro_diario)
    };
    if (liquidacion.no_devengo) return { ...result, ...montos, estado_pago: 'no_devenga', motivo: liquidacion.motivo || null };
    return { ...result, ...montos, estado_pago: montos.saldo_pendiente > 0 ? 'pendiente' : 'pagado' };
  });
}

// conPagos: false cuando solo hace falta contar o ubicar puestos (evita recorrer las liquidaciones).
export async function getPuestos(db, { incluirInactivos = false, conPagos = true, periodo } = {}) {
  const puestos = await rows(db, `${PUESTO_SELECT} ${incluirInactivos ? '' : `WHERE p.estado <> 'inactivo'`} ORDER BY p.id DESC`);
  return conPagos ? withPaymentStatus(db, puestos, periodo) : puestos;
}

async function findPuesto(db, id) {
  const puesto = await first(db, `${PUESTO_SELECT} WHERE p.id = $1`, [Number(id)]);
  return puesto ? (await withPaymentStatus(db, [puesto]))[0] : null;
}

// undefined = no se envió; null, '' o 0 = sin titular (puesto libre).
function parseComercianteId(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '' || Number(value) === 0) return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id < 0) throw new ValidationError('Comerciante no válido');
  return id;
}

// Coordenada del puesto: vacía (null, '' o no numérica) queda null; Number(null) daría 0 (golfo de Guinea).
function parseCoord(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function validatePuestoPlacement(db, { comercianteId, zonaId, direccion, estado, excludeId = null }) {
  if (!['ocupado', 'disponible', 'reservado', 'inactivo'].includes(estado)) throw new ValidationError('Estado de puesto no válido');
  if (estado === 'ocupado' && !comercianteId) throw new ValidationError('Un puesto ocupado necesita un comerciante titular');
  if (!(await first(db, 'SELECT id FROM zonas WHERE id = $1', [zonaId]))) throw new ValidationError('La zona elegida no existe');
  if (comercianteId) {
    const merchant = await first(db, `SELECT id FROM comerciantes WHERE id = $1 AND estado <> 'inactivo'`, [comercianteId]);
    if (!merchant) throw new ValidationError('El comerciante no existe o está inactivo');
  }
  // Un mismo lugar (zona + dirección) no puede tener puestos activos de titulares distintos.
  const duplicate = await first(db, `
    SELECT id FROM puestos
    WHERE zona_id = $1 AND lower(btrim(direccion)) = lower(btrim($2)) AND estado <> 'inactivo'
      AND comerciante_id IS DISTINCT FROM $3 AND ($4::bigint IS NULL OR id <> $4)`,
  [zonaId, direccion, comercianteId, excludeId]);
  if (duplicate) throw new ConflictError('El puesto físico ya está asignado a otro comerciante');
}

export async function insertPuesto(db, payload) {
  const comercianteId = parseComercianteId(payload.comerciante_id) ?? null;
  const zonaId = Number(payload.zona_id);
  const direccion = String(payload.direccion || '').trim();
  const metros = Number(payload.metros_cuadrados);
  const estado = String(payload.estado || (comercianteId ? 'ocupado' : 'disponible')).trim();
  const codigo = String(payload.codigo_puesto || payload.codigoPuesto || '').trim() || null;
  const latitud = parseCoord(payload.latitud);
  const longitud = parseCoord(payload.longitud);

  if (!zonaId || !direccion || !Number.isFinite(metros) || metros <= 0) {
    throw new ValidationError('Zona, dirección y metros cuadrados válidos son obligatorios');
  }
  if (estado === 'inactivo') throw new ValidationError('Estado de puesto no válido');
  await validatePuestoPlacement(db, { comercianteId, zonaId, direccion, estado });

  const next = await first(db, `SELECT nextval(pg_get_serial_sequence('puestos', 'id')) AS id`);
  const finalCode = codigo || `S-${String(next.id).padStart(3, '0')}`;
  try {
    await db.query(`
      INSERT INTO puestos (id, comerciante_id, zona_id, direccion, metros_cuadrados, estado, codigo_puesto, latitud, longitud)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [next.id, comercianteId, zonaId, direccion, metros, estado, finalCode, latitud, longitud]);
  } catch (error) {
    if (error.code === '23505') throw new ConflictError(`El código de puesto ${finalCode} ya está asignado`);
    throw error;
  }
  return findPuesto(db, next.id);
}

// Si se envía comerciante_id sin estado: con titular pasa a ocupado; con null queda libre (disponible).
export async function updatePuesto(db, id, payload) {
  const puestoId = Number(id);
  const current = await first(db, 'SELECT * FROM puestos WHERE id = $1', [puestoId]);
  if (!current) throw new NotFoundError('Puesto no encontrado');

  const requested = parseComercianteId(payload.comerciante_id);
  const comercianteId = requested === undefined ? current.comerciante_id : requested;
  const zonaId = Number(payload.zona_id ?? current.zona_id);
  const direccion = String(payload.direccion ?? current.direccion ?? '').trim();
  // Puestos del padrón ferial pueden no tener metraje todavía: se respeta mientras no se envíe uno.
  const metros = payload.metros_cuadrados === undefined ? current.metros_cuadrados : Number(payload.metros_cuadrados);
  const estado = String(payload.estado ?? (requested === undefined ? current.estado : requested ? 'ocupado' : 'disponible')).trim();
  // Sin coordenada en el pedido se conserva la actual (también si es null).
  const latitud = payload.latitud === undefined ? parseCoord(current.latitud) : parseCoord(payload.latitud);
  const longitud = payload.longitud === undefined ? parseCoord(current.longitud) : parseCoord(payload.longitud);

  if (!zonaId || !direccion || (metros !== null && (!Number.isFinite(metros) || metros <= 0))) {
    throw new ValidationError('Zona, dirección y metros cuadrados válidos son obligatorios');
  }
  await validatePuestoPlacement(db, { comercianteId, zonaId, direccion, estado, excludeId: puestoId });

  await db.query(`
    UPDATE puestos
    SET comerciante_id = $1, zona_id = $2, direccion = $3, metros_cuadrados = $4, estado = $5, latitud = $6, longitud = $7
    WHERE id = $8`,
  [comercianteId, zonaId, direccion, metros, estado, latitud, longitud, puestoId]);

  return findPuesto(db, puestoId);
}

// Deja el puesto físico sin titular para asignarlo a otro comerciante; los cobros pasados no cambian.
export async function liberarPuesto(db, id) {
  const puestoId = Number(id);
  const current = await first(db, 'SELECT estado FROM puestos WHERE id = $1', [puestoId]);
  if (!current) throw new NotFoundError('Puesto no encontrado');
  if (current.estado === 'inactivo') throw new ValidationError('El puesto está dado de baja');
  await db.query(`UPDATE puestos SET comerciante_id = NULL, estado = 'disponible' WHERE id = $1`, [puestoId]);
  return findPuesto(db, puestoId);
}

export async function deactivatePuesto(db, id) {
  const puestoId = Number(id);
  if (!(await first(db, 'SELECT id FROM puestos WHERE id = $1', [puestoId]))) throw new NotFoundError('Puesto no encontrado');
  await db.query(`UPDATE puestos SET estado = 'inactivo' WHERE id = $1`, [puestoId]);
  return findPuesto(db, puestoId);
}

// ---------------------------------------------------------------------------
// Tarifas y liquidación
// ---------------------------------------------------------------------------

const TARIFA_SELECT = `
  SELECT t.id, t.rubro_id, COALESCE(r.nombre, 'Todos los rubros') AS rubro, t.zona_id, t.tipo_via, t.tipo_tarifa, t.monto_fijo, t.monto_variable,
         t.unidad_medida, ${DAY('t.vigencia_inicio')} AS vigencia_inicio, ${DAY('t.vigencia_fin')} AS vigencia_fin,
         CASE WHEN t.activo THEN 1 ELSE 0 END AS estado, t.version
  FROM tarifas t LEFT JOIN rubros r ON r.id = t.rubro_id`;

export async function getTarifas(db, options = {}) {
  const rubroId = Number(options.rubro_id || 0);
  return rows(db, `${TARIFA_SELECT} ${rubroId ? 'WHERE t.rubro_id = $1' : ''} ORDER BY t.vigencia_inicio DESC, t.id DESC`, rubroId ? [rubroId] : []);
}

async function findTarifa(db, id) {
  return first(db, `${TARIFA_SELECT} WHERE t.id = $1`, [Number(id)]);
}

function validateTariff(payload) {
  // Sin rubro, la tarifa es para todos los rubros (como el cobro por día cobrado por tipo de vía).
  const rubroId = payload.rubro_id === undefined || payload.rubro_id === null || payload.rubro_id === '' ? null : Number(payload.rubro_id);
  const zonaId = payload.zona_id === undefined || payload.zona_id === null || payload.zona_id === '' ? null : Number(payload.zona_id);
  const tipoVia = parseTipoVia(payload.tipo_via ?? null);
  const tipoTarifa = String(payload.tipo_tarifa || 'fija').trim();
  const montoFijo = Number(payload.monto_fijo || 0);
  const montoVariable = Number(payload.monto_variable || 0);
  const unidadMedida = String(payload.unidad_medida || 'diaria').trim();
  const vigenciaInicio = String(payload.vigencia_inicio || '').trim();
  const vigenciaFin = payload.vigencia_fin ? String(payload.vigencia_fin).trim() : null;
  const version = Number(payload.version ?? 1);

  if (rubroId !== null && !(rubroId > 0)) throw new ValidationError('El rubro de la tarifa no es válido');
  if (!['fija', 'variable', 'mixta'].includes(tipoTarifa)) throw new ValidationError('El tipo de tarifa es obligatorio');
  if (!['diaria', 'semanal', 'mensual', 'metro_cuadrado'].includes(unidadMedida)) throw new ValidationError('Unidad de medida no válida');
  if (montoFijo < 0 || montoVariable < 0 || (montoFijo === 0 && montoVariable === 0)) throw new ValidationError('La tarifa debe tener un monto mayor que cero');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vigenciaInicio)) throw new ValidationError('La vigencia inicial debe usar formato AAAA-MM-DD');
  if (vigenciaFin && vigenciaFin < vigenciaInicio) throw new ValidationError('La vigencia final no puede ser anterior a la inicial');
  if (!Number.isFinite(version) || version < 1) throw new ValidationError('La versión de la tarifa no es válida');
  if (zonaId && tipoVia) throw new ValidationError('Una tarifa es para una zona o para un tipo de vía, no para ambos');

  return { rubroId, zonaId, tipoVia, tipoTarifa, montoFijo, montoVariable, unidadMedida, vigenciaInicio, vigenciaFin, version };
}

export async function insertTarifa(db, payload) {
  const tariff = validateTariff({ ...payload, version: payload.version ?? 1 });
  const created = await first(db, `
    INSERT INTO tarifas (rubro_id, zona_id, tipo_via, tipo_tarifa, monto_fijo, monto_variable, unidad_medida, vigencia_inicio, vigencia_fin, activo, version)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, $10) RETURNING id`,
  [tariff.rubroId, tariff.zonaId, tariff.tipoVia, tariff.tipoTarifa, tariff.montoFijo, tariff.montoVariable, tariff.unidadMedida, tariff.vigenciaInicio, tariff.vigenciaFin, tariff.version]);
  return findTarifa(db, created.id);
}

export async function updateTarifa(db, id, payload) {
  const current = await findTarifa(db, id);
  if (!current) throw new NotFoundError('Tarifa no encontrada');

  const receivedVersion = payload.version === undefined ? current.version : Number(payload.version);
  if (!Number.isFinite(receivedVersion) || receivedVersion !== current.version) {
    throw new ConflictError('La tarifa fue actualizada por otro usuario; recargue la versión antes de continuar');
  }

  const tariff = validateTariff({
    rubro_id: payload.rubro_id ?? current.rubro_id,
    zona_id: payload.zona_id === undefined ? current.zona_id : payload.zona_id,
    tipo_via: payload.tipo_via === undefined ? current.tipo_via : payload.tipo_via,
    tipo_tarifa: payload.tipo_tarifa ?? current.tipo_tarifa,
    monto_fijo: payload.monto_fijo ?? current.monto_fijo,
    monto_variable: payload.monto_variable ?? current.monto_variable,
    unidad_medida: payload.unidad_medida ?? current.unidad_medida,
    vigencia_inicio: payload.vigencia_inicio ?? current.vigencia_inicio,
    vigencia_fin: payload.vigencia_fin ?? current.vigencia_fin,
    version: current.version + 1
  });

  const updated = await db.query(`
    UPDATE tarifas
    SET rubro_id = $1, zona_id = $2, tipo_tarifa = $3, monto_fijo = $4, monto_variable = $5, unidad_medida = $6,
        vigencia_inicio = $7, vigencia_fin = $8, version = $9, tipo_via = $12
    WHERE id = $10 AND version = $11`,
  [tariff.rubroId, tariff.zonaId, tariff.tipoTarifa, tariff.montoFijo, tariff.montoVariable, tariff.unidadMedida,
    tariff.vigenciaInicio, tariff.vigenciaFin, tariff.version, Number(id), current.version, tariff.tipoVia]);
  if (!updated.rowCount) throw new ConflictError('La tarifa fue actualizada por otro usuario; recargue la versión antes de continuar');

  return findTarifa(db, id);
}

function periodMultiplier(periodo, unidad) {
  if (unidad === 'diaria' && /^\d{4}-\d{2}$/.test(periodo)) {
    const [year, month] = periodo.split('-').map(Number);
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }
  return 1;
}

async function findMerchantPost(db, merchantId) {
  return first(db, `
    SELECT id, metros_cuadrados, estado FROM puestos
    WHERE comerciante_id = $1 AND estado NOT IN ('disponible', 'inactivo')
    ORDER BY id LIMIT 1`, [merchantId]);
}

// Monto de un día de la tarifa: la diaria y la semanal (por día cobrado) tal cual; la mensual (o por m²)
// entre los días del mes.
function dailyTariffAmount(tarifa, dia, metros = 1) {
  const fijo = Number(tarifa.monto_fijo || 0);
  const variable = Number(tarifa.monto_variable || 0) * (tarifa.unidad_medida === 'metro_cuadrado' ? metros : 1);
  const total = fijo + variable;
  if (tarifa.unidad_medida === 'diaria' || tarifa.unidad_medida === 'semanal') return Number(total.toFixed(2));
  return Number((total / periodMultiplier(dia.slice(0, 7), 'diaria')).toFixed(2));
}

// Tarifa vigente en el periodo. Gana la más específica: la de la zona del comerciante, luego la del tipo
// de vía de esa zona (asfaltada / sin asfaltar), luego la del rubro y al final la de todos los rubros.
// Así la tarifa general por tipo de vía (cobro por día cobrado) gana a las del rubro en cuanto la zona
// tiene tipo de vía.
async function findApplicableTariff(db, merchant, periodo) {
  return first(db, `
    ${TARIFA_SELECT}
    LEFT JOIN zonas zc ON zc.id = $2
    WHERE (t.rubro_id = $1 OR t.rubro_id IS NULL) AND t.activo
      AND (t.zona_id IS NULL OR t.zona_id = $2)
      AND (t.tipo_via IS NULL OR t.tipo_via = zc.tipo_via)
      AND t.vigencia_inicio <= $3::date AND (t.vigencia_fin IS NULL OR t.vigencia_fin >= $3::date)
    ORDER BY (t.zona_id IS NOT NULL) DESC, (t.tipo_via IS NOT NULL) DESC, (t.rubro_id IS NOT NULL) DESC,
             t.vigencia_inicio DESC, t.id DESC LIMIT 1`,
  [merchant.rubro_id, merchant.zona_id, `${periodo}-01`]);
}

// Días con asistencia en el mes, por puesto: cada puesto marcado un día se cobra ese día (dos puestos el
// mismo día son dos cobros). Cuenta también el puesto que conserva como ausente. Varias marcas del mismo
// puesto y día cuentan una vez, y la marca de la app (sesion '') manda sobre las del Excel de ese puesto y
// día: si el cobrador marcó "no salió", la P importada no cuenta.
async function asistenciasPorPuesto(db, merchantId, periodo) {
  const data = await rows(db, `
    SELECT p.id AS puesto_id, p.codigo_puesto, p.zona_id, p.metros_cuadrados, COUNT(DISTINCT a.fecha)::int AS dias
    FROM asistencias_feriales a JOIN puestos p ON p.id = a.puesto_id
    WHERE p.comerciante_id = $1 AND a.asistio AND to_char(a.fecha, 'YYYY-MM') = $2
      AND (a.sesion = '' OR NOT EXISTS (
        SELECT 1 FROM asistencias_feriales app WHERE app.puesto_id = a.puesto_id AND app.fecha = a.fecha AND app.sesion = ''))
    GROUP BY p.id ORDER BY p.id`,
  [merchantId, periodo]);
  return data.map((fila) => ({ ...fila, puesto_id: Number(fila.puesto_id), zona_id: Number(fila.zona_id) }));
}

// Cobra por asistencia: el ferial siempre, y el permanente cuya tarifa es por día cobrado (semanal).
// Al eventual se le cobra el día en que se le encuentra, sin marca.
async function cobraPorAsistencia(db, merchant, periodo) {
  const tipo = String(merchant.tipo_comerciante || '').trim().toLowerCase();
  if (tipo === 'ferial') return true;
  if (tipo === 'eventual') return false;
  return (await findApplicableTariff(db, merchant, periodo))?.unidad_medida === 'semanal';
}

// Todo lo pagado en el mes cuenta, con la tarifa que fuera: si se registra una tarifa nueva
// vigente desde el día 1, lo ya cobrado sigue descontando del saldo.
// Un cobro cuenta para el mes al que se aplicó (periodo_aplicado) o, si no lo tiene, el mes en que se hizo.
async function paidInPeriod(db, merchantId, periodo) {
  const paid = await first(db, `
    SELECT COALESCE(SUM(monto), 0) AS pagado FROM transacciones
    WHERE comerciante_id = $1 AND estado = 'confirmado'
      AND COALESCE(periodo_aplicado, to_char(${LOCAL('fecha_cobro_cliente')}, 'YYYY-MM')) = $2`, [merchantId, periodo]);
  return Number(paid.pagado);
}

// ---------------------------------------------------------------------------
// Parámetros del sistema y deuda acumulada
// ---------------------------------------------------------------------------

const PERIODO_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_MESES_DEUDA = 60;

export async function getParametros(db) {
  return rows(db, `SELECT clave, valor, descripcion, ${TS('actualizado_en')} AS actualizado_en FROM parametros_sistema ORDER BY clave`);
}

export async function getInicioCobro(db) {
  const fila = await first(db, `SELECT valor FROM parametros_sistema WHERE clave = 'inicio_cobro'`);
  return fila?.valor || currentPeriod();
}

export async function setInicioCobro(db, valor, { usuarioId = null } = {}) {
  const periodo = String(valor || '').trim();
  if (!PERIODO_RE.test(periodo)) throw new ValidationError('El inicio de cobro debe tener formato AAAA-MM');
  if (periodo > currentPeriod()) throw new ValidationError('El inicio de cobro no puede ser un mes futuro');
  return first(db, `
    INSERT INTO parametros_sistema (clave, valor, actualizado_por) VALUES ('inicio_cobro', $1, $2)
    ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()
    RETURNING clave, valor, ${TS('actualizado_en')} AS actualizado_en`, [periodo, usuarioId ? Number(usuarioId) : null]);
}

function siguientePeriodo(periodo) {
  const [anio, mes] = periodo.split('-').map(Number);
  return mes === 12 ? `${anio + 1}-01` : `${anio}-${String(mes + 1).padStart(2, '0')}`;
}

// Meses impagos del comerciante: desde su mes de alta (nunca antes de inicio_cobro) hasta el actual.
// Cada mes se liquida con calcularLiquidacion, así la regla del cobro vive en un solo lugar.
// El eventual no acumula: paga el día en que se le encuentra.
export async function calcularDeudaAcumulada(db, comercianteId, { hasta = currentPeriod() } = {}) {
  const merchant = await findComerciante(db, comercianteId);
  if (!merchant) throw new NotFoundError('Comerciante no encontrado');
  const inicioCobro = await getInicioCobro(db);
  const alta = (await first(db, `SELECT to_char(${LOCAL('creado_en')}, 'YYYY-MM') AS mes FROM comerciantes WHERE id = $1`, [merchant.id])).mes;
  const tipo = String(merchant.tipo_comerciante || '').toLowerCase();

  let desde = alta > inicioCobro ? alta : inicioCobro;
  if (desde > hasta) desde = hasta;
  const periodos = [];
  if (tipo !== 'eventual') {
    let periodo = desde;
    // Si el rango es más largo que MAX_MESES_DEUDA, se toman los últimos meses.
    const meses = [];
    while (periodo <= hasta) { meses.push(periodo); periodo = siguientePeriodo(periodo); }
    for (const mes of meses.slice(-MAX_MESES_DEUDA)) {
      try {
        const liquidacion = await calcularLiquidacion(db, merchant.id, mes);
        if (liquidacion.no_devengo && !liquidacion.monto_pagado) continue;
        periodos.push({
          periodo: mes,
          monto_total: Number(liquidacion.monto_total || 0),
          monto_pagado: Number(liquidacion.monto_pagado || 0),
          saldo: Number(liquidacion.saldo || 0),
          vencida: mes < currentPeriod() && Number(liquidacion.saldo || 0) > 0,
          no_devengo: Boolean(liquidacion.no_devengo),
          dias_asistidos: liquidacion.dias_asistidos ?? null
        });
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
        periodos.push({ periodo: mes, monto_total: 0, monto_pagado: 0, saldo: 0, vencida: false, sin_tarifa: true });
      }
    }
  }
  const actual = currentPeriod();
  const suma = (lista) => Number(lista.reduce((total, item) => total + item.saldo, 0).toFixed(2));
  const impagos = periodos.filter((item) => item.saldo > 0);
  return {
    comerciante_id: Number(merchant.id),
    inicio_cobro: inicioCobro,
    desde,
    hasta,
    periodos,
    meses_impagos: impagos.map((item) => item.periodo),
    // El mes más antiguo con saldo: es el que se cobra primero.
    periodo_mas_antiguo: impagos[0]?.periodo ?? null,
    deuda_vencida: suma(periodos.filter((item) => item.periodo < actual)),
    deuda_mes: suma(periodos.filter((item) => item.periodo === actual)),
    deuda_total: suma(periodos)
  };
}

// Por cada puesto, sus días con asistencia × el monto de un día de la tarifa de la zona de ese puesto
// (ferial, o permanente con tarifa por día cobrado). Un puesto en vía asfaltada y otro sin asfaltar pagan
// S/ 3 y S/ 2 aunque sean del mismo comerciante.
async function liquidarPorAsistencia(db, { merchant, periodo, tarifa, puesto, asistencias }) {
  const metros = Number(puesto?.metros_cuadrados || 1);
  const puestosCobrados = [];
  for (const item of asistencias) {
    const tarifaPuesto = item.zona_id === Number(merchant.zona_id)
      ? tarifa
      : (await findApplicableTariff(db, { ...merchant, zona_id: item.zona_id }, periodo)) || tarifa;
    const montoDia = dailyTariffAmount(tarifaPuesto, `${periodo}-01`, Number(item.metros_cuadrados || 1));
    puestosCobrados.push({ puesto_id: item.puesto_id, codigo_puesto: item.codigo_puesto, dias: item.dias, monto_dia: montoDia, tarifa_id: tarifaPuesto.id });
  }
  const dias = puestosCobrados.reduce((total, item) => total + item.dias, 0);
  const montos = new Set(puestosCobrados.map((item) => item.monto_dia));
  // Con un solo monto por día se informa; con montos distintos por puesto, el detalle va en puestos_cobrados.
  const montoDia = montos.size === 1 ? [...montos][0] : null;
  const montoTotal = Number(puestosCobrados.reduce((total, item) => total + item.monto_dia * item.dias, 0).toFixed(2));
  const montoPagado = await paidInPeriod(db, merchant.id, periodo);
  const saldo = Number(Math.max(montoTotal - montoPagado, 0).toFixed(2));
  return {
    comerciante: merchant,
    tarifa,
    periodo,
    metros_cuadrados: metros,
    dias_asistidos: dias,
    puestos_cobrados: puestosCobrados,
    monto_dia: montoDia,
    monto_total: montoTotal,
    monto_pagado: montoPagado,
    saldo,
    estado: saldo === 0 ? 'pagado' : 'pendiente',
    vencida: saldo > 0 && periodo < currentPeriod(),
    no_devengo: false
  };
}

// Eventual: no tiene deuda mensual; se le cobra un día de la tarifa de su rubro el día en que el cobrador
// lo encuentra (dia, AAAA-MM-DD en Lima; por omisión hoy). En otro periodo no devenga.
export async function calcularLiquidacion(db, comercianteId, periodo, { dia = null } = {}) {
  periodo = periodo || (dia ? dia.slice(0, 7) : currentPeriod());
  const merchant = await findComerciante(db, comercianteId);
  if (!merchant) throw new NotFoundError('Comerciante no encontrado');

  const merchantType = String(merchant.tipo_comerciante || '').trim().toLowerCase();
  const pendingRegularization = String(merchant.estado_empadronamiento || '').toUpperCase() === 'PENDIENTE_REGULARIZACION';
  const puesto = await findMerchantPost(db, merchant.id);

  const noDevengo = (motivo, extra = {}) => ({
    comerciante: merchant,
    tarifa: null,
    periodo,
    metros_cuadrados: 0,
    monto_total: 0,
    monto_pagado: 0,
    saldo: 0,
    estado: 'pagado',
    vencida: false,
    no_devengo: true,
    motivo,
    ...extra
  });

  if (pendingRegularization && (!puesto || puesto.metros_cuadrados === null || puesto.metros_cuadrados === undefined)) {
    return noDevengo('pendiente_regularizacion_sin_metraje', { metros_cuadrados: null, estado: 'pendiente_regularizacion' });
  }
  if (merchantType === 'eventual') {
    const day = dia || todayInLima();
    if (day.slice(0, 7) !== periodo) return noDevengo('eventual');
    const tarifa = await findApplicableTariff(db, merchant, periodo);
    if (!tarifa) throw new ValidationError('No existe una tarifa vigente para el rubro y periodo indicado');
    const montoDia = dailyTariffAmount(tarifa, day, Number(puesto?.metros_cuadrados || 1));
    const paidToday = await first(db, `
      SELECT COALESCE(SUM(monto), 0) AS pagado FROM transacciones
      WHERE comerciante_id = $1 AND estado = 'confirmado'
        AND to_char(${LOCAL('fecha_cobro_cliente')}, 'YYYY-MM-DD') = $2`, [merchant.id, day]);
    const pagadoDia = Number(paidToday.pagado);
    const saldoDia = Number(Math.max(montoDia - pagadoDia, 0).toFixed(2));
    return {
      comerciante: merchant,
      tarifa,
      periodo,
      dia: day,
      cobro_diario: true,
      metros_cuadrados: Number(puesto?.metros_cuadrados || 1),
      monto_total: montoDia,
      monto_pagado: pagadoDia,
      saldo: saldoDia,
      estado: saldoDia === 0 ? 'pagado' : 'pendiente',
      vencida: false,
      no_devengo: false
    };
  }
  if (merchantType === 'ferial') {
    // Paga solo los días que asistió en el mes, en cualquiera de sus puestos (también el que conserva
    // como ausente). Varias marcas del mismo día cuentan una vez.
    const asistencias = await asistenciasPorPuesto(db, merchant.id, periodo);
    if (!asistencias.length) return noDevengo('ferial_sin_asistencia', { metros_cuadrados: 0, dias_asistidos: 0, monto_pagado: await paidInPeriod(db, merchant.id, periodo) });

    const tarifa = await findApplicableTariff(db, merchant, periodo);
    if (!tarifa) throw new ValidationError('No existe una tarifa vigente para el rubro y periodo indicado');
    return liquidarPorAsistencia(db, { merchant, periodo, tarifa, puesto, asistencias });
  }

  const tarifa = await findApplicableTariff(db, merchant, periodo);
  if (!tarifa) throw new ValidationError('No existe una tarifa vigente para el rubro y periodo indicado');

  // Tarifa por día cobrado: el permanente paga los días que el cobrador marcó; sin marcas no devenga.
  if (tarifa.unidad_medida === 'semanal') {
    const asistencias = await asistenciasPorPuesto(db, merchant.id, periodo);
    if (!asistencias.length) return noDevengo('sin_asistencia', { tarifa, metros_cuadrados: 0, dias_asistidos: 0, monto_pagado: await paidInPeriod(db, merchant.id, periodo) });
    return liquidarPorAsistencia(db, { merchant, periodo, tarifa, puesto, asistencias });
  }

  const metros = Number(puesto?.metros_cuadrados || 1);
  const multiplier = periodMultiplier(periodo, tarifa.unidad_medida);
  const base = Number(tarifa.monto_fijo) * multiplier;
  const variable = Number(tarifa.monto_variable) * (tarifa.unidad_medida === 'metro_cuadrado' ? metros : 1) * multiplier;
  const montoTotal = Number((base + variable).toFixed(2));
  const montoPagado = await paidInPeriod(db, merchant.id, periodo);
  const saldo = Number(Math.max(montoTotal - montoPagado, 0).toFixed(2));

  return {
    comerciante: merchant,
    tarifa,
    periodo,
    metros_cuadrados: metros,
    monto_total: montoTotal,
    monto_pagado: montoPagado,
    saldo,
    estado: saldo === 0 ? 'pagado' : 'pendiente',
    vencida: saldo > 0 && periodo < currentPeriod(),
    no_devengo: false
  };
}

// ---------------------------------------------------------------------------
// Cobros / transacciones
// ---------------------------------------------------------------------------

// Listado para las pantallas (cobros recientes, sugerencia express): los más recientes primero. Los totales y
// los reportes van por /reportes; sin tope, la respuesta crecería con cada cobro del año.
export const MAX_COBROS_LISTADO = 500;

/** cobradorId: solo los cobros de ese cobrador (el cobrador ve los suyos; decisión del usuario, 2026-10-22). */
export async function getCobros(db, { cobradorId = null, limit = MAX_COBROS_LISTADO } = {}) {
  const tope = Math.min(Math.max(Number(limit) || MAX_COBROS_LISTADO, 1), MAX_COBROS_LISTADO);
  const params = [tope];
  let filtro = '';
  if (cobradorId) { params.push(Number(cobradorId)); filtro = `WHERE co.cobrador_id = $${params.length}`; }
  return rows(db, `
    SELECT co.id, co.comerciante_id, c.nombre AS comerciante, co.tarifa_id, co.cobrador_id,
           co.monto, co.concepto, co.metodo_pago, co.codigo_operacion, co.observaciones,
           CASE WHEN ob.estado = 'pendiente' THEN 'observado' ELSE co.estado END AS estado, ob.motivo AS observacion,
           ${PAYMENT_DAY} AS fecha_cobro, cp.numero_correlativo AS comprobante,
           co.motivo_anulacion, ${TS('co.anulado_en')} AS fecha_anulacion, an.nombre AS anulado_por,
           EXTRACT(EPOCH FROM (co.fecha_cobro_cliente - co.inicio_atencion))::int AS segundos_atencion
    FROM transacciones co
    JOIN comerciantes c ON c.id = co.comerciante_id
    LEFT JOIN comprobantes cp ON cp.id = co.comprobante_id
    LEFT JOIN cobros_observados ob ON ob.transaccion_id = co.id
    LEFT JOIN usuarios an ON an.id = co.anulado_por
    ${filtro}
    ORDER BY co.id DESC
    LIMIT $1`, params);
}

// Tiempo de atención por cobro (indicador de −50 % frente a la línea base del DAP). Solo cobros con
// inicio_atencion; días en hora de Lima. Mediana y percentil 90 en segundos, por día y por cobrador.
export async function getTiemposCobro(db, { desde, hasta } = {}) {
  const hoy = todayInLima();
  const inicio = /^\d{4}-\d{2}-\d{2}$/.test(String(desde || '')) ? desde : `${hoy.slice(0, 7)}-01`;
  const fin = /^\d{4}-\d{2}-\d{2}$/.test(String(hasta || '')) ? hasta : hoy;
  if (inicio > fin) throw new ValidationError('La fecha inicial no puede ser posterior a la final');
  const filas = await rows(db, `
    WITH medidos AS (
      SELECT co.cobrador_id, u.nombre AS cobrador, to_char(${LOCAL('co.fecha_cobro_cliente')}, 'YYYY-MM-DD') AS dia,
             EXTRACT(EPOCH FROM (co.fecha_cobro_cliente - co.inicio_atencion)) AS segundos
      FROM transacciones co JOIN usuarios u ON u.id = co.cobrador_id
      WHERE co.inicio_atencion IS NOT NULL AND co.estado = 'confirmado'
        AND ${LOCAL('co.fecha_cobro_cliente')}::date BETWEEN $1::date AND $2::date
    )
    SELECT dia, cobrador_id, cobrador, COUNT(*)::int AS cobros,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY segundos))::int AS mediana_segundos,
           round(percentile_cont(0.9) WITHIN GROUP (ORDER BY segundos))::int AS p90_segundos,
           round(SUM(segundos))::int AS total_segundos
    FROM medidos GROUP BY dia, cobrador_id, cobrador ORDER BY dia, cobrador`, [inicio, fin]);
  const general = await first(db, `
    SELECT COUNT(*)::int AS cobros,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY s))::int AS mediana_segundos,
           round(percentile_cont(0.9) WITHIN GROUP (ORDER BY s))::int AS p90_segundos
    FROM (SELECT EXTRACT(EPOCH FROM (fecha_cobro_cliente - inicio_atencion)) AS s FROM transacciones
          WHERE inicio_atencion IS NOT NULL AND estado = 'confirmado'
            AND ${LOCAL('fecha_cobro_cliente')}::date BETWEEN $1::date AND $2::date) m`, [inicio, fin]);
  return {
    desde: inicio,
    hasta: fin,
    // Línea base del DAP: unos 240 minutos por jornada de ~120 comerciantes (2 min por comerciante).
    linea_base: { minutos_jornada: 240, comerciantes: 120, segundos_por_cobro: 120 },
    general: { ...general, cobros: Number(general?.cobros || 0) },
    detalle: filas.map((fila) => ({ ...fila, cobrador_id: Number(fila.cobrador_id) }))
  };
}

// ---------------------------------------------------------------------------
// Asistencia ferial
// ---------------------------------------------------------------------------

// Puestos de quienes cobran por día cobrado (el ferial, también el ausente que conserva su puesto, y el
// permanente con tarifa por día cobrado) y su marca del día, con la observación del cobrador.
export async function getAsistencias(db, { fecha } = {}) {
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(fecha || '')) ? fecha : todayInLima();
  const data = await rows(db, `
    SELECT p.id AS puesto_id, p.codigo_puesto, p.estado AS estado_puesto, c.id AS comerciante_id, c.nombre AS comerciante,
           c.codigo AS comerciante_codigo, c.tipo_comerciante, c.rubro_id, c.zona_id, z.nombre AS zona,
           a.marca, a.asistio, a.motivo, a.observacion, ${TS('a.registrado_en')} AS registrado_en, u.nombre AS registrado_por
    FROM puestos p
    JOIN comerciantes c ON c.id = p.comerciante_id
    LEFT JOIN zonas z ON z.id = p.zona_id
    LEFT JOIN asistencias_feriales a ON a.puesto_id = p.id AND a.fecha = $1::date AND a.sesion = ''
    LEFT JOIN usuarios u ON u.id = a.registrado_por
    WHERE c.tipo_comerciante IN ('ferial', 'permanente') AND c.estado <> 'inactivo' AND p.estado <> 'inactivo'
    ORDER BY z.nombre NULLS LAST, p.codigo_puesto NULLS LAST, p.id`, [dia]);
  // La tarifa depende del rubro y la zona: se consulta una vez por combinación.
  const porTarifa = new Map();
  const puestos = [];
  for (const { rubro_id: rubroId, zona_id: zonaId, ...fila } of data) {
    const clave = `${fila.tipo_comerciante}|${rubroId}|${zonaId}`;
    if (!porTarifa.has(clave)) {
      porTarifa.set(clave, await cobraPorAsistencia(db, { tipo_comerciante: fila.tipo_comerciante, rubro_id: rubroId, zona_id: zonaId }, dia.slice(0, 7)));
    }
    if (porTarifa.get(clave)) puestos.push({ ...fila, puesto_id: Number(fila.puesto_id), comerciante_id: Number(fila.comerciante_id) });
  }
  return { fecha: dia, puestos };
}

// Reporte del cobrador sobre el día. no_salio es una falta (no genera deuda); no_vendio y se_nego_a_pagar
// son asistencias: el comerciante estuvo y el día se debe aunque ponga una excusa. otro va con cualquier marca.
const MOTIVOS_ASISTENCIA = { no_salio: false, no_vendio: true, se_nego_a_pagar: true, otro: null };

function parseMarcaAsistencia(marca) {
  const motivo = marca?.motivo === undefined || marca?.motivo === null || marca?.motivo === '' ? null : String(marca.motivo).trim();
  if (motivo !== null && !Object.hasOwn(MOTIVOS_ASISTENCIA, motivo)) throw new ValidationError('El motivo de la observación no es válido');
  const implicada = motivo === null ? null : MOTIVOS_ASISTENCIA[motivo];
  let asistio = marca?.asistio;
  if (asistio === undefined && implicada !== null) asistio = implicada;
  if (typeof asistio !== 'boolean') throw new ValidationError('Indique si asistió (true) o faltó (false)');
  if (implicada !== null && implicada !== asistio) {
    throw new ValidationError(`El motivo ${motivo} corresponde a ${implicada ? 'una asistencia' : 'una falta'}`);
  }
  const observacion = marca?.observacion === undefined || marca?.observacion === null ? null : String(marca.observacion).trim();
  if (observacion && observacion.length > 300) throw new ValidationError('La observación no puede pasar de 300 caracteres');
  return { asistio, motivo, observacion: observacion || null };
}

// Marca asistencia (asistio: true) o falta de uno o varios puestos que cobran por día cobrado, con un
// motivo y una observación opcionales. Repetir la misma marca no duplica nada (upsert por puesto y fecha),
// así una marca hecha sin señal se puede reenviar sin riesgo. No se aceptan fechas futuras ni puestos de
// quien no cobra por día.
export async function marcarAsistencias(_db, marcas, { usuarioId = null, audit = null } = {}) {
  const lista = Array.isArray(marcas) ? marcas : [marcas];
  if (!lista.length || lista.length > 500) throw new ValidationError('Envíe entre 1 y 500 marcas de asistencia');
  const hoy = todayInLima();
  return withTransaction(async (client) => {
    const guardadas = [];
    for (const marca of lista) {
      const puestoId = Number(marca?.puesto_id ?? marca?.puestoId);
      const fecha = String(marca?.fecha || hoy);
      if (!puestoId) throw new ValidationError('Indique el puesto de la asistencia');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(fecha))) throw new ValidationError('La fecha de asistencia debe usar formato AAAA-MM-DD');
      if (fecha > hoy) throw new ValidationError('No se puede marcar asistencia de un día que todavía no llega');
      const { asistio, motivo, observacion } = parseMarcaAsistencia(marca);

      const puesto = await first(client, `
        SELECT p.id, c.tipo_comerciante, c.rubro_id, c.zona_id FROM puestos p JOIN comerciantes c ON c.id = p.comerciante_id WHERE p.id = $1`, [puestoId]);
      if (!puesto) throw new NotFoundError(`El puesto ${puestoId} no existe o no tiene titular`);
      if (!(await cobraPorAsistencia(client, puesto, fecha.slice(0, 7)))) {
        throw new ValidationError(`El puesto ${puestoId} no es de un comerciante ferial ni tiene tarifa por día cobrado`);
      }

      const fila = await first(client, `
        INSERT INTO asistencias_feriales (puesto_id, fecha, sesion, marca, fuente, registrado_por, motivo, observacion)
        VALUES ($1, $2, '', $3, 'app', $4, $5, $6)
        ON CONFLICT (puesto_id, fecha, sesion) DO UPDATE
          SET marca = EXCLUDED.marca, fuente = EXCLUDED.fuente, registrado_por = EXCLUDED.registrado_por, registrado_en = now(),
              motivo = EXCLUDED.motivo, observacion = EXCLUDED.observacion
        RETURNING id, puesto_id, ${DAY('fecha')} AS fecha, marca, asistio, motivo, observacion`,
      [puestoId, fecha, asistio ? 'P' : 'F', usuarioId ? Number(usuarioId) : null, motivo, observacion]);
      guardadas.push({ ...fila, id: Number(fila.id), puesto_id: Number(fila.puesto_id) });
    }
    if (audit) {
      await appendAudit(client, {
        ...audit,
        usuarioId: audit.usuarioId ?? usuarioId,
        entidad: 'asistencias_feriales',
        detalle: `${guardadas.length} marca(s) de asistencia: ${guardadas.filter((g) => g.asistio).length} asistió, ${guardadas.filter((g) => !g.asistio).length} faltó, ${guardadas.filter((g) => g.motivo || g.observacion).length} con observación`,
        recursoId: guardadas[0]?.id ?? null,
        payloadNuevo: guardadas
      });
    }
    return guardadas;
  });
}

// Observaciones de cobro: las marcas con motivo u observación entre dos fechas (por omisión, del día 1
// del mes a hoy). cobradorId limita a las que registró ese cobrador.
export async function getObservacionesCobro(db, { desde, hasta, comercianteId, cobradorId } = {}) {
  const hoy = todayInLima();
  const fin = hasta ? String(hasta) : hoy;
  const inicio = desde ? String(desde) : `${fin.slice(0, 7)}-01`;
  for (const fecha of [inicio, fin]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(fecha))) throw new ValidationError('Las fechas deben usar formato AAAA-MM-DD');
  }
  if (inicio > fin) throw new ValidationError('La fecha inicial no puede ser posterior a la final');
  const params = [inicio, fin];
  let filtros = '';
  if (Number(comercianteId)) { params.push(Number(comercianteId)); filtros += ` AND c.id = $${params.length}`; }
  if (Number(cobradorId)) { params.push(Number(cobradorId)); filtros += ` AND a.registrado_por = $${params.length}`; }
  const data = await rows(db, `
    SELECT a.id, ${DAY('a.fecha')} AS fecha, a.asistio, a.motivo, a.observacion,
           p.id AS puesto_id, p.codigo_puesto, c.id AS comerciante_id, c.nombre AS comerciante, c.codigo AS comerciante_codigo,
           z.nombre AS zona, u.nombre AS registrado_por, ${TS('a.registrado_en')} AS registrado_en
    FROM asistencias_feriales a
    JOIN puestos p ON p.id = a.puesto_id
    JOIN comerciantes c ON c.id = p.comerciante_id
    LEFT JOIN zonas z ON z.id = p.zona_id
    LEFT JOIN usuarios u ON u.id = a.registrado_por
    WHERE (a.motivo IS NOT NULL OR a.observacion IS NOT NULL) AND a.fecha BETWEEN $1::date AND $2::date${filtros}
    ORDER BY a.fecha DESC, a.id DESC LIMIT 500`, params);
  return {
    desde: inicio,
    hasta: fin,
    observaciones: data.map((fila) => ({ ...fila, id: Number(fila.id), puesto_id: Number(fila.puesto_id), comerciante_id: Number(fila.comerciante_id) }))
  };
}

// ---------------------------------------------------------------------------
// Cierre de caja diario
// ---------------------------------------------------------------------------

const METODOS_CAJA = ['efectivo', 'yape', 'plin', 'pos'];
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const dinero = (value) => Number(Number(value || 0).toFixed(2));

const CIERRE_SELECT = `
  SELECT cc.id, cc.cobrador_id, u.nombre AS cobrador, ${DAY('cc.fecha')} AS fecha, cc.cobros,
         cc.esperado_efectivo, cc.esperado_yape, cc.esperado_plin, cc.esperado_pos,
         cc.declarado_efectivo, cc.declarado_yape, cc.declarado_plin, cc.declarado_pos,
         cc.diferencia, cc.observaciones, cc.tickets, ${TS('cc.cerrado_en')} AS cerrado_en
  FROM cierres_caja cc JOIN usuarios u ON u.id = cc.cobrador_id`;

function normalizarCierre(fila) {
  if (!fila) return null;
  const out = { ...fila, id: Number(fila.id), cobrador_id: Number(fila.cobrador_id), cobros: Number(fila.cobros) };
  for (const clave of Object.keys(out)) if (/^(esperado|declarado)_|^diferencia$/.test(clave)) out[clave] = Number(out[clave]);
  return out;
}

// Lo que el cobrador debería tener el día indicado: sus cobros confirmados (día de Lima) por método.
// Si ya cerró, también los cobros que entraron después del cierre (p. ej. sincronizados tarde).
export async function resumenCaja(db, cobradorId, fecha) {
  const dia = FECHA_RE.test(String(fecha || '')) ? fecha : todayInLima();
  const porMetodo = await rows(db, `
    SELECT metodo_pago, COUNT(*)::int AS cobros, COALESCE(SUM(monto), 0) AS monto
    FROM transacciones
    WHERE cobrador_id = $1 AND estado = 'confirmado' AND ${LOCAL('fecha_cobro_cliente')}::date = $2::date
    GROUP BY metodo_pago`, [Number(cobradorId), dia]);
  const esperado = Object.fromEntries(METODOS_CAJA.map((metodo) => [metodo, 0]));
  let cobros = 0;
  for (const fila of porMetodo) { esperado[fila.metodo_pago] = dinero(fila.monto); cobros += fila.cobros; }

  const cierre = normalizarCierre(await first(db, `${CIERRE_SELECT} WHERE cc.cobrador_id = $1 AND cc.fecha = $2::date`, [Number(cobradorId), dia]));
  let posteriores = null;
  if (cierre) {
    const fila = await first(db, `
      SELECT COUNT(*)::int AS cobros, COALESCE(SUM(monto), 0) AS monto FROM transacciones
      WHERE cobrador_id = $1 AND estado = 'confirmado' AND ${LOCAL('fecha_cobro_cliente')}::date = $2::date
        AND fecha_registro_servidor > (SELECT cerrado_en FROM cierres_caja WHERE id = $3)`, [Number(cobradorId), dia, cierre.id]);
    posteriores = { cobros: fila.cobros, monto: dinero(fila.monto) };
  }
  return {
    cobrador_id: Number(cobradorId),
    fecha: dia,
    cobros,
    esperado,
    esperado_total: dinero(Object.values(esperado).reduce((a, b) => a + b, 0)),
    cierre,
    posteriores_al_cierre: posteriores,
    tickets: await resumenTickets(db, cobradorId, dia)
  };
}

// El cobrador declara lo que tiene por método. Lo esperado se calcula aquí, en la misma transacción.
export async function cerrarCaja(_db, cobradorId, payload = {}, { audit = null } = {}) {
  const dia = payload.fecha ? String(payload.fecha) : todayInLima();
  if (!FECHA_RE.test(dia)) throw new ValidationError('La fecha del cierre debe usar formato AAAA-MM-DD');
  if (dia > todayInLima()) throw new ValidationError('No se puede cerrar la caja de un día que todavía no llega');
  const declarado = {};
  for (const metodo of METODOS_CAJA) {
    const valor = Number(payload.declarado?.[metodo] ?? payload[`declarado_${metodo}`] ?? 0);
    if (!Number.isFinite(valor) || valor < 0) throw new ValidationError(`El monto declarado en ${metodo} no es válido`);
    declarado[metodo] = dinero(valor);
  }
  const observaciones = cleanText(payload.observaciones, 500) || null;

  return withTransaction(async (client) => {
    // Un cobrador no cierra dos veces el mismo día; el bloqueo evita dos cierres simultáneos.
    await client.query('SELECT id FROM usuarios WHERE id = $1 FOR UPDATE', [Number(cobradorId)]);
    if (await first(client, 'SELECT id FROM cierres_caja WHERE cobrador_id = $1 AND fecha = $2::date', [Number(cobradorId), dia])) {
      throw new ConflictError('La caja de ese día ya fue cerrada');
    }
    const resumen = await resumenCaja(client, cobradorId, dia);
    const creado = await first(client, `
      INSERT INTO cierres_caja (cobrador_id, fecha, cobros, esperado_efectivo, esperado_yape, esperado_plin, esperado_pos,
                                declarado_efectivo, declarado_yape, declarado_plin, declarado_pos, observaciones, tickets)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb) RETURNING id`,
    [Number(cobradorId), dia, resumen.cobros, resumen.esperado.efectivo, resumen.esperado.yape, resumen.esperado.plin, resumen.esperado.pos,
      declarado.efectivo, declarado.yape, declarado.plin, declarado.pos, observaciones,
      resumen.tickets.series.length ? JSON.stringify(resumen.tickets) : null]);
    const cierre = normalizarCierre(await first(client, `${CIERRE_SELECT} WHERE cc.id = $1`, [creado.id]));
    if (audit) {
      await appendAudit(client, {
        ...audit,
        usuarioId: audit.usuarioId ?? cobradorId,
        entidad: 'cierres_caja',
        detalle: `Cierre de caja ${dia}: esperado S/ ${resumen.esperado_total.toFixed(2)}, diferencia S/ ${cierre.diferencia.toFixed(2)}${resumen.tickets.series.length
          ? `; tickets usados ${resumen.tickets.series.map((item) => `${item.serie} ${item.usados}`).join(', ')}, alertas ${resumen.tickets.alertas}` : ''}`,
        recursoId: cierre.id,
        payloadNuevo: cierre
      });
    }
    return cierre;
  });
}

export async function getCierresCaja(db, { desde, hasta } = {}) {
  const hoy = todayInLima();
  const inicio = FECHA_RE.test(String(desde || '')) ? desde : `${hoy.slice(0, 7)}-01`;
  const fin = FECHA_RE.test(String(hasta || '')) ? hasta : hoy;
  return (await rows(db, `${CIERRE_SELECT} WHERE cc.fecha BETWEEN $1::date AND $2::date ORDER BY cc.fecha DESC, u.nombre`, [inicio, fin]))
    .map(normalizarCierre);
}

// Anula un cobro: deja de contar en la recaudación y en lo pagado del comerciante, pero no se borra.
// Solo el administrador (lo controla la ruta); el motivo y quién lo anuló quedan en la fila y en la auditoría.
// Si db ya es una conexión dentro de una transacción (revisión de observados) se reutiliza.
export async function anularCobro(db, id, { motivo, usuarioId, audit = null }) {
  if (typeof db?.release !== 'function') {
    return withTransaction((client) => anularCobro(client, id, { motivo, usuarioId, audit }));
  }
  const razon = String(motivo || '').trim();
  if (razon.length < 5) throw new ValidationError('Indique el motivo de la anulación (al menos 5 caracteres)');

  const previous = await first(db, 'SELECT * FROM transacciones WHERE id = $1 FOR UPDATE', [Number(id)]);
  if (!previous) throw new NotFoundError('Cobro no encontrado');
  if (previous.estado === 'anulado') throw new ConflictError('El cobro ya estaba anulado');

  const updated = await first(db, `
    UPDATE transacciones SET estado = 'anulado', anulado_en = now(), anulado_por = $2, motivo_anulacion = $3
    WHERE id = $1 RETURNING id, comerciante_id, monto, estado, motivo_anulacion, ${TS('anulado_en')} AS fecha_anulacion`,
  [Number(id), Number(usuarioId), razon]);
  const result = { ...updated, id: Number(updated.id), comerciante_id: Number(updated.comerciante_id), monto: Number(updated.monto) };
  // Los tickets entregados por ese cobro quedan anulados (no vuelven a estar disponibles).
  const ticketsAnulados = await rows(db, `
    UPDATE tickets SET estado = 'anulado', motivo = $2, baja_en = now(), registrado_por = $3
    WHERE transaccion_id = $1 AND estado = 'usado' RETURNING serie, numero`,
  [Number(id), `Cobro ${id} anulado: ${razon}`.slice(0, 300), Number(usuarioId)]);
  result.tickets_anulados = ticketsAnulados.map((item) => textoTicket(item.serie, item.numero));

  if (audit) {
    await appendAudit(db, {
      ...audit,
      usuarioId: audit.usuarioId ?? usuarioId,
      entidad: 'cobros',
      detalle: `Cobro ${id} por S/ ${result.monto.toFixed(2)} anulado: ${razon}`,
      recursoId: result.id,
      payloadPrevio: previous,
      payloadNuevo: result
    });
  }
  return result;
}

/**
 * Encuentra al comerciante por lo que la gente tiene a mano: su código actual (COM-0004-…), un código
 * anterior impreso en un QR o recibo (CM-004 o un COM-… previo), el correlativo (0004, CM-004) o el DNI/RUC.
 * Devuelve el id interno o null.
 */
export async function buscarComerciantePorCodigo(db, identifier) {
  const value = String(identifier || '').trim().replace(/^SISREC:\/\/comerciante\//i, '').toUpperCase();
  if (!value) return null;
  const correlativo = value.match(/^(?:CM-?|COM-)?0*(\d{1,7})$/)?.[1];
  const found = await first(db, `
    SELECT c.id FROM comerciantes c
    WHERE c.codigo = $1 OR c.dni_ruc = $1 OR c.correlativo = $2
       OR c.id IN (SELECT h.comerciante_id FROM comerciante_codigos_historicos h WHERE upper(h.codigo) = $1)
    ORDER BY (c.codigo = $1) DESC, (c.estado <> 'inactivo') DESC
    LIMIT 1`, [value, Number(correlativo) || 0]);
  return found ? Number(found.id) : null;
}

export async function obtenerPortalComerciante(db, identifier) {
  const id = await buscarComerciantePorCodigo(db, identifier);
  const merchant = id && await first(db, `
    SELECT c.id, c.correlativo, c.codigo, c.dni_ruc, c.nombre, c.tipo_comerciante AS categoria, c.tipo_comerciante, c.estado,
           ${TS('c.creado_en')} AS fecha_registro, r.nombre AS rubro, z.nombre AS zona
    FROM comerciantes c JOIN rubros r ON r.id = c.rubro_id JOIN zonas z ON z.id = c.zona_id
    WHERE c.id = $1 AND c.estado <> 'inactivo'`, [id]);
  if (!merchant) throw new NotFoundError('DNI o código de comerciante no encontrado');

  const payments = await rows(db, `
    SELECT co.id, ${PAYMENT_DAY} AS fecha, co.concepto, co.monto, co.metodo_pago, co.estado,
           cp.numero_correlativo AS comprobante
    FROM transacciones co LEFT JOIN comprobantes cp ON cp.id = co.comprobante_id
    WHERE co.comerciante_id = $1 ORDER BY co.fecha_cobro_cliente DESC`, [merchant.id]);
  const liquidation = await calcularLiquidacion(db, merchant.id);
  return { comerciante: merchant, pagos: payments, deuda: liquidation };
}

export async function createNotification(db, payload) {
  const merchantId = Number(payload.comerciante_id);
  const tipo = String(payload.tipo || 'recordatorio_deuda');
  const canal = String(payload.canal || 'whatsapp');
  const mensaje = String(payload.mensaje || '').trim();
  if (!merchantId || !mensaje || !['whatsapp', 'sms', 'email'].includes(canal)) {
    throw new ValidationError('Comerciante, canal y mensaje son obligatorios');
  }
  if (!(await first(db, 'SELECT id FROM comerciantes WHERE id = $1', [merchantId]))) throw new ValidationError('Comerciante no encontrado');
  const created = await first(db,
    `INSERT INTO notificaciones (comerciante_id, tipo, canal, mensaje, estado) VALUES ($1, $2, $3, $4, 'preparada') RETURNING id`,
    [merchantId, tipo, canal, mensaje]);
  return { id: Number(created.id), comerciante_id: merchantId, tipo, canal, mensaje, estado: 'preparada' };
}

export async function getNotifications(db, comercianteId) {
  return rows(db, `
    SELECT id, comerciante_id, tipo, canal, mensaje, estado,
           ${TS('creado_en')} AS fecha_creacion, ${TS('enviado_en')} AS fecha_envio
    FROM notificaciones WHERE comerciante_id = $1 ORDER BY id DESC`, [Number(comercianteId)]);
}

// Hora en que el cobrador abrió al comerciante. Solo se guarda si es creíble: antes del cobro y no más de
// 2 horas antes (un celular con la hora mal o una pantalla olvidada abierta no deben ensuciar el indicador).
const MAX_ATENCION_MS = 2 * 60 * 60 * 1000;
export function parseInicioAtencion(value, fechaCobro) {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  const inicio = new Date(value);
  const diff = fechaCobro.getTime() - inicio.getTime();
  return diff >= 0 && diff <= MAX_ATENCION_MS ? inicio : null;
}

// La fecha del cobro decide en qué caja diaria cuenta. Si el celular pudiera poner cualquier fecha, un cobro
// podría caer en un día sin cierre y su dinero no aparecería en ninguna caja.
// - Sin señal se acepta la hora del celular hasta DIAS_COBRO_SIN_SENAL días atrás (decisión del usuario,
//   2026-10-22) y hasta TOLERANCIA_RELOJ_MS en el futuro (relojes desfasados). Fuera de eso el cobro no se
//   descarta (el dinero ya se recibió): queda observado.
// - En línea manda la hora del servidor; la del celular solo se usa si difiere menos de TOLERANCIA_RELOJ_MS,
//   para que el tiempo de atención se mida con el mismo reloj que su inicio.
export const DIAS_COBRO_SIN_SENAL = 3;
const TOLERANCIA_RELOJ_MS = 5 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;

/** Motivo por el que la fecha de un cobro sin señal no es creíble, o null si está dentro del rango. */
export function fechaCobroFueraDeRango(fecha, ahora = new Date()) {
  const atraso = ahora.getTime() - fecha.getTime();
  if (atraso < -TOLERANCIA_RELOJ_MS) return 'la fecha del celular está en el futuro';
  if (atraso > DIAS_COBRO_SIN_SENAL * DIA_MS) return `la fecha del celular tiene más de ${DIAS_COBRO_SIN_SENAL} días`;
  return null;
}

/** Fecha (ISO) con la que se registra un cobro en línea. */
export function fechaCobroEnLinea(valor, ahora = new Date()) {
  const fecha = Date.parse(valor || '');
  return Number.isFinite(fecha) && Math.abs(ahora.getTime() - fecha) <= TOLERANCIA_RELOJ_MS
    ? new Date(fecha).toISOString()
    : ahora.toISOString();
}

function createTransactionHash({ comercianteId, cobradorId, monto, concepto, periodo, metodoPago, salt }) {
  const seed = [comercianteId, cobradorId, monto, concepto, periodo || 'sin-periodo', metodoPago, salt || Date.now()].join('|');
  return createHash('sha256').update(seed).digest('hex');
}

// Comprobante, transacción, notificación y auditoría se graban juntos o no se graba nada.
// Si db ya es una conexión dentro de una transacción (PoolClient) se reutiliza.
// allowExcess (cobros offline): el dinero ya se recibió en campo, así que un cobro que excede el saldo
// o cae en un periodo sin devengo no se rechaza: se registra y queda "observado" para revisión manual.
export async function registrarCobro(db, payload, { audit = null, allowExcess = false } = {}) {
  if (typeof db?.release !== 'function') {
    return withTransaction((client) => registrarCobro(client, payload, { audit, allowExcess }));
  }

  const comercianteId = Number(payload.comerciante_id);
  const cobradorId = Number(payload.cobrador_id);
  const monto = Number(payload.monto);
  const metodoPago = String(payload.metodo_pago || '').trim();
  const concepto = String(payload.concepto || 'Liquidación de deuda').trim();
  const codigoOperacion = String(payload.codigo_operacion || payload.idempotency_key || '').trim();
  const observaciones = String(payload.observaciones || '').trim();
  const allowedMethods = ['efectivo', 'yape', 'plin', 'pos'];

  if (!comercianteId || !cobradorId || !Number.isFinite(monto) || monto <= 0 || !allowedMethods.includes(metodoPago)) {
    throw new ValidationError('Comerciante, monto positivo y método de pago válido son obligatorios');
  }
  if (['yape', 'plin', 'pos'].includes(metodoPago) && !codigoOperacion) {
    throw new ValidationError('El código de operación es obligatorio para pagos digitales');
  }

  // Dos cobros a la vez del mismo comerciante (dos cobradores, doble toque, un lote offline que llega
  // mientras se cobra en línea) se atienden uno tras otro: el segundo ve el saldo que dejó el primero.
  // NO KEY UPDATE no bloquea a quien solo referencia al comerciante (puestos, notificaciones).
  await db.query('SELECT id FROM comerciantes WHERE id = $1 FOR NO KEY UPDATE', [comercianteId]);

  const uniqueCode = codigoOperacion || `COB-${Date.now()}-${comercianteId}-${Math.random().toString(16).slice(2, 10)}`;
  const hashTransaccion = payload.hash_transaccion || payload.hashTransaccion || createTransactionHash({
    comercianteId,
    cobradorId,
    monto,
    concepto,
    periodo: payload.periodo || currentPeriod(),
    metodoPago,
    salt: uniqueCode
  });

  const duplicate = await first(db,
    'SELECT id FROM transacciones WHERE codigo_operacion = $1 OR hash_transaccion = $2', [uniqueCode, hashTransaccion]);
  if (duplicate) throw new ConflictError('Ya existe un cobro registrado con ese código de operación o hash transaccional');

  const clientDate = payload.fecha_cobro && !Number.isNaN(Date.parse(payload.fecha_cobro)) ? new Date(payload.fecha_cobro) : new Date();
  const inicioAtencion = parseInicioAtencion(payload.inicio_atencion ?? payload.inicioAtencion, clientDate);
  if (payload.periodo && !PERIODO_RE.test(String(payload.periodo))) throw new ValidationError('El periodo debe tener formato AAAA-MM');
  await marcarDiaCobrado(db, comercianteId, cobradorId, todayInLima(clientDate), payload.periodo);
  const liquidation = await calcularLiquidacion(db, comercianteId, payload.periodo, { dia: todayInLima(clientDate) });
  // El mes al que se aplica el pago (puede ser uno anterior con deuda). El eventual paga el día: no lleva mes.
  const periodoAplicado = liquidation.cobro_diario ? null : liquidation.periodo;
  let observacion = null;
  let tarifaId = liquidation.tarifa?.id;
  if (monto > liquidation.saldo) {
    if (!allowExcess) throw new ValidationError(`El monto excede el saldo pendiente de S/ ${liquidation.saldo.toFixed(2)}`);
    observacion = liquidation.no_devengo
      ? `Cobro offline en un periodo sin devengo (${liquidation.motivo})`
      : `Cobro offline de S/ ${monto.toFixed(2)} excede el saldo pendiente de S/ ${liquidation.saldo.toFixed(2)}`;
    if (!tarifaId) {
      const tarifa = await findApplicableTariff(db, liquidation.comerciante, liquidation.periodo);
      if (!tarifa) throw new ValidationError('No existe una tarifa vigente para el rubro y periodo indicado');
      tarifaId = tarifa.id;
    }
  }

  // Tickets preimpresos: uno por puesto y día cobrado, de los lotes del cobrador; su suma es el monto.
  const ticketsDeclarados = parseTicketsDeclarados(payload.tickets);
  const tickets = await validarTicketsCobro(db, {
    merchant: liquidation.comerciante, cobradorId, periodo: liquidation.periodo, monto, declarados: ticketsDeclarados
  });
  if (tickets.problema) {
    if (!allowExcess) throw new ValidationError(tickets.problema);
    observacion = observacion ? `${observacion}. ${tickets.problema}` : `Cobro offline con tickets observados: ${tickets.problema}`;
  }
  // Solo sin señal la fecha viene del celular (en línea la fija fechaCobroEnLinea en la ruta).
  const fechaDudosa = allowExcess ? fechaCobroFueraDeRango(clientDate) : null;
  if (fechaDudosa) {
    observacion = observacion ? `${observacion}. Fecha fuera de rango: ${fechaDudosa}` : `Cobro offline con fecha fuera de rango: ${fechaDudosa}`;
  }

  const collector = await first(db, 'SELECT id FROM usuarios WHERE id = $1', [cobradorId]);
  if (!collector) throw new ValidationError('El cobrador indicado no existe');

  const sequence = await first(db, `SELECT nextval('comprobantes_recibo_seq') AS n`);
  const number = `R-${String(sequence.n).padStart(6, '0')}`;
  const comprobante = await first(db, `INSERT INTO comprobantes (numero_correlativo, tipo) VALUES ($1, 'recibo') RETURNING id`, [number]);

  const cobro = await first(db, `
    INSERT INTO transacciones
      (comerciante_id, tarifa_id, cobrador_id, comprobante_id, monto, concepto, metodo_pago, codigo_operacion,
       hash_transaccion, observaciones, estado, fecha_cobro_cliente, inicio_atencion, periodo_aplicado, tickets)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'confirmado', $11, $12, $13, $14::jsonb) RETURNING id`,
  [comercianteId, tarifaId, cobradorId, comprobante.id, monto, concepto, metodoPago, uniqueCode,
    hashTransaccion, observaciones || null, clientDate, inicioAtencion, periodoAplicado,
    ticketsDeclarados.length ? JSON.stringify(ticketsDeclarados) : null]);

  // Solo los tickets válidos quedan usados por este cobro; los observados los ve la revisión.
  if (tickets.validos.length) {
    const usados = await rows(db, `
      UPDATE tickets SET estado = 'usado', transaccion_id = $2, usado_en = $3, registrado_por = $4
      WHERE id = ANY($1::bigint[]) RETURNING lote_id`, [tickets.validos, cobro.id, clientDate, cobradorId]);
    await cerrarLotesAgotados(db, [...new Set(usados.map((fila) => Number(fila.lote_id)))]);
  }
  const textoTickets = ticketsDeclarados.map((item) => textoTicket(item.serie, item.numero)).join(', ');

  if (observacion) {
    await db.query(`
      INSERT INTO cobros_observados (transaccion_id, motivo, saldo_al_sincronizar, monto, device_id)
      VALUES ($1, $2, $3, $4, $5)`, [cobro.id, observacion, liquidation.saldo, monto, cleanText(payload.device_id, 100)]);
  }

  await createNotification(db, {
    comerciante_id: comercianteId,
    tipo: 'cobro_confirmado',
    canal: 'whatsapp',
    mensaje: `Cobro confirmado para ${liquidation.comerciante?.nombre || 'comerciante'} por S/ ${Number(monto).toFixed(2)}. Comprobante ${number}.${textoTickets ? ` Tickets ${textoTickets}.` : ''}`
  });

  const result = {
    id: Number(cobro.id),
    comprobante: number,
    comerciante_id: comercianteId,
    cobrador_id: cobradorId,
    monto,
    metodo_pago: metodoPago,
    codigo_operacion: uniqueCode,
    hash_transaccion: hashTransaccion,
    observaciones,
    periodo_aplicado: periodoAplicado,
    tickets: ticketsDeclarados.map((item) => ({ ...item, texto: textoTicket(item.serie, item.numero) })),
    estado: observacion ? 'observado' : 'confirmado',
    observacion,
    saldo_restante: Number(Math.max(liquidation.saldo - monto, 0).toFixed(2))
  };

  if (audit) {
    await appendAudit(db, {
      ...audit,
      usuarioId: audit.usuarioId ?? cobradorId,
      entidad: 'cobros',
      detalle: audit.detalle || `Cobro ${number} por S/ ${monto.toFixed(2)} al comerciante ${comercianteId}${textoTickets ? `, tickets ${textoTickets}` : ''}${observacion ? ` (observado: ${observacion})` : ''}`,
      recursoId: result.id,
      payloadNuevo: result
    });
  }
  return result;
}

// Cobrar a quien paga por día cobrado prueba que el cobrador lo encontró ese día: si nadie marcó el día
// en la app, el cobro lo marca como asistencia en su puesto principal. Así un cobro sin señal que llega
// antes que la marca no termina en revisión, y en línea no hace falta marcar antes de cobrar.
// No pisa una marca de la app (si dice "no salió", el cobro queda observado) y no marca nada cuando se
// paga un mes anterior. Va dentro de la transacción del cobro: si el cobro se rechaza, la marca no queda.
async function marcarDiaCobrado(db, comercianteId, cobradorId, dia, periodo) {
  if (periodo && periodo !== dia.slice(0, 7)) return;
  const merchant = await findComerciante(db, comercianteId);
  if (!merchant || !(await cobraPorAsistencia(db, merchant, dia.slice(0, 7)))) return;
  const marcado = await first(db, `
    SELECT 1 AS ok FROM asistencias_feriales a JOIN puestos p ON p.id = a.puesto_id
    WHERE p.comerciante_id = $1 AND a.fecha = $2::date AND a.sesion = '' LIMIT 1`, [comercianteId, dia]);
  if (marcado) return;
  await db.query(`
    INSERT INTO asistencias_feriales (puesto_id, fecha, sesion, marca, fuente, registrado_por)
    SELECT p.id, $2::date, '', 'P', 'cobro', $3 FROM puestos p
    WHERE p.comerciante_id = $1 AND p.estado <> 'inactivo' ORDER BY p.id LIMIT 1
    ON CONFLICT (puesto_id, fecha, sesion) DO NOTHING`, [comercianteId, dia, cobradorId]);
}

async function logSyncQueue({ deviceId, hash, payload, estado, error }) {
  try {
    await pool.query(`
      INSERT INTO colas_sincronizacion (device_id, entidad, hash_transaccion, payload, estado, intentos, error, procesado_en)
      VALUES ($1, 'transacciones', $2, $3::jsonb, $4, 1, $5, now())
      ON CONFLICT (hash_transaccion) DO UPDATE
        SET intentos = colas_sincronizacion.intentos + 1, estado = EXCLUDED.estado, error = EXCLUDED.error, procesado_en = now()`,
    [deviceId || 'api', hash, JSON.stringify(payload), estado, error || null]);
  } catch (logError) {
    console.error('No se pudo registrar la cola de sincronización:', logError.message);
  }
}

// Un error de datos (comerciante inexistente, método inválido, restricción de la base) no se arregla
// reintentando: es "permanente". Una caída de conexión o un fallo interno sí puede reintentarse.
function isPermanentSyncError(error) {
  const code = String(error?.code || '');
  if (!code) return true;
  return code.startsWith('22') || code.startsWith('23');
}

// Sincroniza un cobro hecho sin señal. Nunca rechaza un cobro válido por el saldo: si lo excede,
// lo registra como observado (status OBSERVED). Devuelve IGNORED si ya se había recibido (idempotencia).
export async function syncOfflineCobro(_db, payload, { audit = null } = {}) {
  const normalized = {
    ...payload,
    comerciante_id: Number(payload.comerciante_id ?? payload.comercianteId ?? 0),
    cobrador_id: Number(payload.cobrador_id ?? payload.cobradorId ?? 0),
    monto: Number(payload.monto ?? 0),
    metodo_pago: String(payload.metodo_pago ?? payload.metodoPago ?? 'efectivo').trim(),
    concepto: String(payload.concepto || 'Liquidación de deuda').trim(),
    codigo_operacion: String(payload.codigo_operacion || payload.idempotency_key || payload.codigoOperacion || '').trim(),
    hash_transaccion: String(payload.hash_transaccion || payload.hashTransaccion || '').trim(),
    fecha_cobro: payload.fecha_cobro || payload.fechaCobro || new Date().toISOString(),
    periodo: payload.periodo || currentPeriod(),
    device_id: payload.device_id || payload.deviceId || null
  };

  const hashValue = normalized.hash_transaccion || createTransactionHash({
    comercianteId: normalized.comerciante_id,
    cobradorId: normalized.cobrador_id,
    monto: normalized.monto,
    concepto: normalized.concepto,
    periodo: normalized.periodo,
    metodoPago: normalized.metodo_pago,
    salt: normalized.codigo_operacion || normalized.fecha_cobro
  });
  const deviceId = normalized.device_id;

  if (!normalized.comerciante_id || !normalized.cobrador_id || !Number.isFinite(normalized.monto) || normalized.monto <= 0) {
    const message = 'Cobro offline incompleto: faltan comerciante, cobrador o monto válido';
    await logSyncQueue({ deviceId, hash: hashValue, payload: normalized, estado: 'error', error: message });
    throw Object.assign(new Error(message), { permanent: true });
  }

  const ignored = (message = 'El cobro ya fue registrado anteriormente (idempotencia aplicada)') => ({
    status: 'IGNORED',
    message,
    hash_transaccion: hashValue
  });

  try {
    const result = await withTransaction(async (client) => {
      const duplicate = await first(client,
        'SELECT id FROM transacciones WHERE hash_transaccion = $1 OR codigo_operacion = $2',
        [hashValue, normalized.codigo_operacion || hashValue]);
      if (duplicate) return null;
      return registrarCobro(client, { ...normalized, hash_transaccion: hashValue }, { audit, allowExcess: true });
    });

    if (!result) {
      await logSyncQueue({ deviceId, hash: hashValue, payload: normalized, estado: 'duplicado' });
      return ignored();
    }
    if (result.estado === 'observado') {
      await logSyncQueue({ deviceId, hash: hashValue, payload: normalized, estado: 'observado', error: result.observacion });
      return { status: 'OBSERVED', message: `Cobro registrado y enviado a revisión: ${result.observacion}`, data: result };
    }
    await logSyncQueue({ deviceId, hash: hashValue, payload: normalized, estado: 'procesado' });
    return { status: 'SUCCESS', message: 'Cobro sincronizado correctamente', data: result };
  } catch (error) {
    const message = String(error.message || '');
    if (error.code === '23505' || /ya existe un cobro registrado/i.test(message)) {
      await logSyncQueue({ deviceId, hash: hashValue, payload: normalized, estado: 'duplicado' });
      return ignored();
    }
    await logSyncQueue({ deviceId, hash: hashValue, payload: normalized, estado: 'error', error: message });
    if (error.permanent === undefined) error.permanent = isPermanentSyncError(error);
    throw error;
  }
}

export const MAX_LOTE_COBROS = 100;

// Sube varios cobros offline en una petición. Cada cobro va en su propia transacción: uno que falla
// no detiene ni deshace a los demás. Se procesan en el orden en que se cobraron (hora del celular).
export async function syncOfflineBatch(db, cobros, { cobradorId = null, deviceId = null, audit = null } = {}) {
  if (!Array.isArray(cobros) || !cobros.length) throw new ValidationError('El lote no contiene cobros');
  if (cobros.length > MAX_LOTE_COBROS) throw new ValidationError(`El lote admite como máximo ${MAX_LOTE_COBROS} cobros`);

  const when = (cobro) => Date.parse(cobro.fecha_cobro || cobro.fechaCobro) || 0;
  const ordered = cobros
    .map((cobro, index) => ({ cobro: cobro && typeof cobro === 'object' ? cobro : {}, index }))
    .sort((a, b) => when(a.cobro) - when(b.cobro) || a.index - b.index);

  const resultados = new Array(cobros.length);
  for (const { cobro, index } of ordered) {
    const hash = String(cobro.hash_transaccion || cobro.hashTransaccion || '').trim() || null;
    try {
      const result = await syncOfflineCobro(db, {
        ...cobro,
        // El cobrador es quien inició sesión, nunca el que diga el celular.
        cobrador_id: cobradorId,
        device_id: deviceId || cobro.device_id || cobro.deviceId
      }, { audit });
      const estado = result.status === 'IGNORED' ? 'duplicado' : result.status === 'OBSERVED' ? 'observado' : 'sincronizado';
      resultados[index] = {
        hash_transaccion: result.hash_transaccion || result.data?.hash_transaccion || hash,
        estado,
        mensaje: result.message,
        comprobante: result.data?.comprobante ?? null,
        id: result.data?.id ?? null
      };
    } catch (error) {
      const temporal = error.permanent === false;
      if (temporal) console.error('Error temporal al sincronizar cobro offline:', error);
      resultados[index] = {
        hash_transaccion: hash,
        estado: temporal ? 'error' : 'rechazado',
        mensaje: temporal ? 'Error temporal del servidor; se reintentará' : String(error.message || 'Cobro rechazado')
      };
    }
  }

  const resumen = { total: resultados.length, sincronizado: 0, duplicado: 0, observado: 0, rechazado: 0, error: 0 };
  for (const item of resultados) resumen[item.estado] += 1;
  return { resultados, resumen };
}

// ---------------------------------------------------------------------------
// Revisión manual de cobros offline
// ---------------------------------------------------------------------------

export async function getCobrosObservados(db, { estado = 'pendiente' } = {}) {
  const params = [];
  let where = '';
  if (estado && estado !== 'todos') { params.push(String(estado)); where = 'WHERE ob.estado = $1'; }
  return rows(db, `
    SELECT ob.id, ob.transaccion_id, ob.motivo, ob.saldo_al_sincronizar, ob.monto, ob.device_id, ob.estado,
           ob.resolucion, ${TS('ob.creado_en')} AS fecha_observacion, ${TS('ob.revisado_en')} AS fecha_revision,
           rv.nombre AS revisado_por,
           co.comerciante_id, c.nombre AS comerciante, c.dni_ruc, co.metodo_pago, co.codigo_operacion,
           co.estado AS estado_cobro, ${TS('co.fecha_cobro_cliente')} AS fecha_cobro,
           cp.numero_correlativo AS comprobante, u.nombre AS cobrador
    FROM cobros_observados ob
    JOIN transacciones co ON co.id = ob.transaccion_id
    JOIN comerciantes c ON c.id = co.comerciante_id
    JOIN usuarios u ON u.id = co.cobrador_id
    LEFT JOIN comprobantes cp ON cp.id = co.comprobante_id
    LEFT JOIN usuarios rv ON rv.id = ob.revisado_por
    ${where}
    ORDER BY ob.id DESC LIMIT 500`, params);
}

// Aceptar deja el cobro como pago válido (p. ej. un adelanto); anular lo saca de la recaudación
// (se devuelve el dinero). La decisión y la auditoría se graban en la misma transacción.
export async function resolveCobroObservado(_db, id, { decision, resolucion, usuarioId, audit = null }) {
  if (!['aceptado', 'anulado'].includes(decision)) throw new ValidationError('La decisión debe ser "aceptado" o "anulado"');
  const nota = String(resolucion || '').trim();
  if (nota.length < 5) throw new ValidationError('Explique la decisión (al menos 5 caracteres)');

  return withTransaction(async (client) => {
    const previous = await first(client, 'SELECT * FROM cobros_observados WHERE id = $1 FOR UPDATE', [Number(id)]);
    if (!previous) throw new NotFoundError('Cobro observado no encontrado');
    if (previous.estado !== 'pendiente') throw new ConflictError(`El cobro ya fue revisado (${previous.estado})`);

    const updated = await first(client, `
      UPDATE cobros_observados SET estado = $2, resolucion = $3, revisado_por = $4, revisado_en = now()
      WHERE id = $1 RETURNING id, transaccion_id, estado, resolucion`, [Number(id), decision, nota, Number(usuarioId)]);
    if (decision === 'anulado') {
      await anularCobro(client, previous.transaccion_id, { motivo: nota, usuarioId });
    }
    if (audit) {
      await appendAudit(client, {
        ...audit,
        usuarioId: audit.usuarioId ?? usuarioId,
        entidad: 'cobros_observados',
        detalle: `Cobro observado ${id} (transacción ${previous.transaccion_id}) ${decision}: ${nota}`,
        recursoId: Number(id),
        payloadPrevio: previous,
        payloadNuevo: updated
      });
    }
    return { ...updated, id: Number(updated.id), transaccion_id: Number(updated.transaccion_id) };
  });
}

// Cobros offline que el servidor rechazó por datos inválidos: el dinero se cobró pero no entró al sistema.
export async function getSyncErrors(db) {
  return rows(db, `
    SELECT id, device_id, hash_transaccion, payload, error, intentos,
           ${TS('recibido_en')} AS recibido, ${TS('procesado_en')} AS procesado
    FROM colas_sincronizacion WHERE estado = 'error' ORDER BY procesado_en DESC NULLS LAST LIMIT 200`);
}

// ---------------------------------------------------------------------------
// Tickets preimpresos (migrations/0014_tickets_preimpresos.sql)
// ---------------------------------------------------------------------------

// El comerciante recibe un ticket de papel por cada puesto y día cobrado: S/ 3 (serie S3, vía asfaltada) o
// S/ 2 (serie S2, sin asfaltar). El administrador entrega rangos de números (lotes) a cada cobrador y el
// celular le indica qué número entregar. Un cobrador sin tickets asignados sigue cobrando sin ticket.

const MAX_TICKETS_LOTE = 5000;
const MAX_TICKETS_COBRO = 60;
export const MAX_LOTE_ANULACIONES = 100;

export const textoTicket = (serie, numero) => `${serie} N° ${String(numero).padStart(6, '0')}`;

function parseNumeroTicket(value) {
  const numero = Number(value);
  return Number.isInteger(numero) && numero > 0 && numero <= 2147483647 ? numero : null;
}

// Tickets que declaró el celular para un cobro: [{ serie, numero }], sin repetidos.
function parseTicketsDeclarados(value) {
  if (value === undefined || value === null || value === '') return [];
  if (!Array.isArray(value)) throw new ValidationError('Los tickets deben enviarse como una lista de { serie, numero }');
  if (value.length > MAX_TICKETS_COBRO) throw new ValidationError(`Un cobro admite como máximo ${MAX_TICKETS_COBRO} tickets`);
  const vistos = new Set();
  return value.map((item) => {
    const serie = String(item?.serie || '').trim().toUpperCase();
    const numero = parseNumeroTicket(item?.numero);
    if (!serie || !numero) throw new ValidationError('Cada ticket necesita su serie y su número');
    if (vistos.has(`${serie}-${numero}`)) throw new ValidationError(`El ticket ${textoTicket(serie, numero)} está repetido en el cobro`);
    vistos.add(`${serie}-${numero}`);
    return { serie, numero };
  });
}

async function getUmbralTickets(db) {
  const fila = await first(db, `SELECT valor FROM parametros_sistema WHERE clave = 'tickets_umbral_aviso'`);
  const umbral = Number(fila?.valor);
  return Number.isInteger(umbral) && umbral >= 0 ? umbral : 20;
}

// Series con las que se cobra al comerciante en el periodo: la de cada puesto cuya tarifa es por día cobrado
// con tipo de vía, siempre que el valor impreso en el ticket sea el monto del día de esa tarifa (si la
// ordenanza cambia el monto, los tickets viejos ya no sirven). Sin puestos (el eventual) cuenta la zona del
// comerciante. Una lista vacía significa que el cobro no lleva ticket.
export async function seriesDelComerciante(db, merchant, periodo = currentPeriod()) {
  const zonas = new Map((await rows(db, `
    SELECT zona_id, COUNT(*)::int AS puestos FROM puestos
    WHERE comerciante_id = $1 AND estado <> 'inactivo' AND zona_id IS NOT NULL GROUP BY zona_id`, [merchant.id]))
    .map((fila) => [Number(fila.zona_id), fila.puestos]));
  if (!zonas.size && merchant.zona_id) zonas.set(Number(merchant.zona_id), 1);
  const series = new Map();
  for (const [zonaId, puestos] of zonas) {
    const tarifa = await findApplicableTariff(db, { ...merchant, zona_id: zonaId }, periodo);
    if (tarifa?.unidad_medida !== 'semanal' || !tarifa.tipo_via) continue;
    const serie = await first(db, 'SELECT codigo, valor FROM ticket_series WHERE tipo_via = $1 AND activa', [tarifa.tipo_via]);
    if (!serie || Number(serie.valor) !== dailyTariffAmount(tarifa, `${periodo}-01`)) continue;
    const actual = series.get(serie.codigo) || { serie: serie.codigo, valor: Number(serie.valor), puestos: 0 };
    actual.puestos += puestos;
    series.set(serie.codigo, actual);
  }
  return [...series.values()];
}

// Valida los tickets de un cobro dentro de su transacción (bloquea cada ticket, así dos celulares que
// declaran el mismo número se atienden uno tras otro). Devuelve los ids de los tickets válidos, que se
// marcan usados, y el problema si algo no cuadra: en línea se rechaza el cobro; sin señal el dinero ya se
// recibió, así que el cobro se registra observado.
async function validarTicketsCobro(db, { merchant, cobradorId, periodo, monto, declarados }) {
  const series = await seriesDelComerciante(db, merchant, periodo);
  const problemas = [];
  const validos = [];
  const resultado = () => ({ validos, problema: problemas.join('; ') || null });

  if (!series.length) {
    if (declarados.length) problemas.push('Este cobro no lleva ticket: el comerciante no cobra por día cobrado con tipo de vía');
    return resultado();
  }
  if (!declarados.length) {
    const tieneLotes = await first(db, 'SELECT 1 AS ok FROM ticket_lotes WHERE cobrador_id = $1 AND serie = ANY($2::text[]) LIMIT 1',
      [cobradorId, series.map((item) => item.serie)]);
    if (tieneLotes) problemas.push(`Falta el ticket: el cobro de S/ ${monto.toFixed(2)} debe indicar los tickets entregados`);
    return resultado();
  }

  const valores = Object.fromEntries(series.map((item) => [item.serie, item.valor]));
  let suma = 0;
  for (const item of declarados) {
    const texto = textoTicket(item.serie, item.numero);
    if (!(item.serie in valores)) {
      problemas.push(`El ticket ${texto} es de una serie que no corresponde a los puestos del comerciante`);
      continue;
    }
    suma += valores[item.serie];
    const ticket = await first(db, `
      SELECT t.id, t.estado, t.transaccion_id, l.cobrador_id FROM tickets t JOIN ticket_lotes l ON l.id = t.lote_id
      WHERE t.serie = $1 AND t.numero = $2 FOR UPDATE OF t`, [item.serie, item.numero]);
    if (!ticket) problemas.push(`El ticket ${texto} no está asignado a ningún cobrador`);
    else if (Number(ticket.cobrador_id) !== cobradorId) problemas.push(`El ticket ${texto} no es del lote del cobrador`);
    else if (ticket.estado === 'usado') problemas.push(`El ticket ${texto} ya fue usado en el cobro ${ticket.transaccion_id}`);
    else if (ticket.estado !== 'disponible') problemas.push(`El ticket ${texto} está ${ticket.estado}`);
    else validos.push(Number(ticket.id));
  }
  if (Math.abs(dinero(suma) - monto) > 0.001) {
    problemas.push(`Los tickets suman S/ ${dinero(suma).toFixed(2)} y el cobro es de S/ ${monto.toFixed(2)}`);
  }
  return resultado();
}

async function cerrarLotesAgotados(db, loteIds) {
  if (!loteIds.length) return;
  await db.query(`
    UPDATE ticket_lotes l SET estado = 'cerrado'
    WHERE l.id = ANY($1::bigint[]) AND l.estado = 'activo'
      AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.lote_id = l.id AND t.estado = 'disponible')`, [loteIds.map(Number)]);
}

const LOTE_SELECT = `
  SELECT l.id, l.serie, s.valor, l.numero_desde, l.numero_hasta, l.cobrador_id, u.nombre AS cobrador,
         l.asignado_por, ua.nombre AS asignado_por_nombre, ${TS('l.asignado_en')} AS asignado_en, l.estado,
         l.lote_origen_id, l.observacion,
         COUNT(t.id)::int AS total,
         COUNT(t.id) FILTER (WHERE t.estado = 'disponible')::int AS disponibles,
         COUNT(t.id) FILTER (WHERE t.estado = 'usado')::int AS usados,
         COUNT(t.id) FILTER (WHERE t.estado = 'anulado')::int AS anulados,
         COUNT(t.id) FILTER (WHERE t.estado = 'devuelto')::int AS devueltos,
         MIN(t.numero) FILTER (WHERE t.estado = 'disponible') AS siguiente
  FROM ticket_lotes l
  JOIN ticket_series s ON s.codigo = l.serie
  JOIN usuarios u ON u.id = l.cobrador_id
  LEFT JOIN usuarios ua ON ua.id = l.asignado_por
  LEFT JOIN tickets t ON t.lote_id = l.id`;
const LOTE_GROUP = 'GROUP BY l.id, s.valor, u.nombre, ua.nombre';
const idONull = (value) => (value === null || value === undefined ? null : Number(value));

function normalizarLote(fila) {
  if (!fila) return null;
  return {
    ...fila,
    id: Number(fila.id),
    valor: Number(fila.valor),
    cobrador_id: Number(fila.cobrador_id),
    asignado_por: idONull(fila.asignado_por),
    lote_origen_id: idONull(fila.lote_origen_id),
    siguiente: idONull(fila.siguiente)
  };
}

const getLote = async (db, id) => normalizarLote(await first(db, `${LOTE_SELECT} WHERE l.id = $1 ${LOTE_GROUP}`, [Number(id)]));

export async function getLotes(db, { cobradorId = null, estado = null } = {}) {
  const params = [];
  const where = [];
  if (Number(cobradorId)) { params.push(Number(cobradorId)); where.push(`l.cobrador_id = $${params.length}`); }
  if (['activo', 'cerrado'].includes(estado)) { params.push(estado); where.push(`l.estado = $${params.length}`); }
  return (await rows(db, `${LOTE_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ${LOTE_GROUP}
    ORDER BY l.estado, l.serie, l.numero_desde`, params)).map(normalizarLote);
}

async function cobradorParaLote(db, value) {
  const cobrador = await first(db, `
    SELECT u.id, u.nombre FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = $1 AND r.codigo = 'cobrador'`, [Number(value) || 0]);
  if (!cobrador) throw new ValidationError('Los tickets se asignan a un usuario con rol cobrador');
  return { id: Number(cobrador.id), nombre: cobrador.nombre };
}

// Tramo de un lote para reasignar o devolver: por omisión, el lote entero.
function tramoDelLote(lote, payload) {
  const vacio = (value) => value === undefined || value === null || value === '';
  const desde = vacio(payload.numero_desde) ? Number(lote.numero_desde) : parseNumeroTicket(payload.numero_desde);
  const hasta = vacio(payload.numero_hasta) ? Number(lote.numero_hasta) : parseNumeroTicket(payload.numero_hasta);
  if (!desde || !hasta || hasta < desde) throw new ValidationError('Indique el tramo: número desde y hasta, de menor a mayor');
  if (desde < Number(lote.numero_desde) || hasta > Number(lote.numero_hasta)) {
    throw new ValidationError(`El tramo debe estar dentro del lote (${lote.numero_desde} a ${lote.numero_hasta})`);
  }
  return { desde, hasta };
}

// El administrador entrega un rango de números a un cobrador. Un número existe una sola vez por serie, así
// que un rango que se cruza con otro lote se rechaza.
export async function asignarLote(_db, payload = {}, { usuarioId = null, audit = null } = {}) {
  const serie = String(payload.serie || '').trim().toUpperCase();
  const desde = parseNumeroTicket(payload.numero_desde);
  const hasta = parseNumeroTicket(payload.numero_hasta);
  if (!desde || !hasta || hasta < desde) throw new ValidationError('Indique el rango de números: desde y hasta, de menor a mayor');
  if (hasta - desde >= MAX_TICKETS_LOTE) throw new ValidationError(`Un lote admite como máximo ${MAX_TICKETS_LOTE} tickets`);
  const observacion = cleanText(payload.observacion, 300);

  try {
    return await withTransaction(async (client) => {
      if (!(await first(client, 'SELECT 1 AS ok FROM ticket_series WHERE codigo = $1 AND activa', [serie]))) {
        throw new ValidationError('Serie de ticket no válida');
      }
      const cobrador = await cobradorParaLote(client, payload.cobrador_id);
      const cruce = await first(client, 'SELECT numero, lote_id FROM tickets WHERE serie = $1 AND numero BETWEEN $2 AND $3 ORDER BY numero LIMIT 1',
        [serie, desde, hasta]);
      if (cruce) throw new ConflictError(`El rango se cruza con el lote ${cruce.lote_id}: el ticket ${textoTicket(serie, cruce.numero)} ya existe`);

      const creado = await first(client, `
        INSERT INTO ticket_lotes (serie, numero_desde, numero_hasta, cobrador_id, asignado_por, observacion)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [serie, desde, hasta, cobrador.id, idONull(usuarioId), observacion]);
      await client.query('INSERT INTO tickets (serie, numero, lote_id) SELECT $1, n, $2 FROM generate_series($3::int, $4::int) AS n',
        [serie, creado.id, desde, hasta]);
      const lote = await getLote(client, creado.id);
      if (audit) {
        await appendAudit(client, {
          ...audit,
          usuarioId: audit.usuarioId ?? usuarioId,
          entidad: 'ticket_lotes',
          detalle: `Lote ${lote.id}: tickets ${textoTicket(serie, desde)} a ${textoTicket(serie, hasta)} asignados a ${cobrador.nombre}`,
          recursoId: lote.id,
          payloadNuevo: lote
        });
      }
      return lote;
    });
  } catch (error) {
    // Dos asignaciones a la vez con rangos que se cruzan: la segunda choca con el UNIQUE (serie, numero).
    if (error.code === '23505') throw new ConflictError('El rango se cruza con otro lote de la misma serie');
    throw error;
  }
}

// Pasa a otro cobrador los tickets disponibles del lote (entero o un tramo). Los usados, anulados y
// devueltos se quedan en el lote original.
export async function reasignarTickets(_db, loteId, payload = {}, { usuarioId = null, audit = null } = {}) {
  return withTransaction(async (client) => {
    const origen = await first(client, 'SELECT * FROM ticket_lotes WHERE id = $1 FOR UPDATE', [Number(loteId)]);
    if (!origen) throw new NotFoundError('Lote no encontrado');
    const cobrador = await cobradorParaLote(client, payload.cobrador_id);
    if (cobrador.id === Number(origen.cobrador_id)) throw new ValidationError('El lote ya es de ese cobrador');
    const { desde, hasta } = tramoDelLote(origen, payload);

    const movidos = await rows(client, `
      SELECT id, numero FROM tickets WHERE lote_id = $1 AND estado = 'disponible' AND numero BETWEEN $2 AND $3
      ORDER BY numero FOR UPDATE`, [origen.id, desde, hasta]);
    if (!movidos.length) throw new ValidationError('No hay tickets disponibles en ese tramo del lote');
    const primero = movidos[0].numero;
    const ultimo = movidos[movidos.length - 1].numero;

    const creado = await first(client, `
      INSERT INTO ticket_lotes (serie, numero_desde, numero_hasta, cobrador_id, asignado_por, lote_origen_id, observacion)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [origen.serie, primero, ultimo, cobrador.id, idONull(usuarioId), origen.id,
      cleanText(payload.observacion, 300) || `Reasignado desde el lote ${origen.id}`]);
    await client.query('UPDATE tickets SET lote_id = $2 WHERE id = ANY($1::bigint[])', [movidos.map((item) => Number(item.id)), creado.id]);
    await cerrarLotesAgotados(client, [origen.id]);

    const anterior = await getLote(client, origen.id);
    const nuevo = await getLote(client, creado.id);
    if (audit) {
      await appendAudit(client, {
        ...audit,
        usuarioId: audit.usuarioId ?? usuarioId,
        entidad: 'ticket_lotes',
        detalle: `${movidos.length} tickets (${textoTicket(origen.serie, primero)} a ${textoTicket(origen.serie, ultimo)}) del lote ${origen.id} reasignados a ${cobrador.nombre} en el lote ${nuevo.id}`,
        recursoId: Number(origen.id),
        payloadPrevio: origen,
        payloadNuevo: nuevo
      });
    }
    return { origen: anterior, nuevo, movidos: movidos.length };
  });
}

// El cobrador devuelve a la oficina los tickets que no usó: quedan como devueltos y ya no se pueden usar.
export async function devolverTickets(_db, loteId, payload = {}, { usuarioId = null, audit = null } = {}) {
  const motivo = String(payload.motivo || '').trim().slice(0, 300);
  if (motivo.length < 5) throw new ValidationError('Indique el motivo de la devolución (al menos 5 caracteres)');
  return withTransaction(async (client) => {
    const lote = await first(client, 'SELECT * FROM ticket_lotes WHERE id = $1 FOR UPDATE', [Number(loteId)]);
    if (!lote) throw new NotFoundError('Lote no encontrado');
    const { desde, hasta } = tramoDelLote(lote, payload);
    const devueltos = await rows(client, `
      UPDATE tickets SET estado = 'devuelto', motivo = $4, baja_en = now(), registrado_por = $5
      WHERE lote_id = $1 AND estado = 'disponible' AND numero BETWEEN $2 AND $3 RETURNING numero`,
    [lote.id, desde, hasta, motivo, idONull(usuarioId)]);
    if (!devueltos.length) throw new ValidationError('No hay tickets disponibles en ese tramo del lote');
    await cerrarLotesAgotados(client, [lote.id]);
    const actualizado = await getLote(client, lote.id);
    if (audit) {
      await appendAudit(client, {
        ...audit,
        usuarioId: audit.usuarioId ?? usuarioId,
        entidad: 'ticket_lotes',
        detalle: `${devueltos.length} tickets del lote ${lote.id} devueltos (${textoTicket(lote.serie, desde)} a ${textoTicket(lote.serie, hasta)}): ${motivo}`,
        recursoId: Number(lote.id),
        payloadPrevio: lote,
        payloadNuevo: actualizado
      });
    }
    return { lote: actualizado, devueltos: devueltos.length };
  });
}

// El cobrador anula un ticket dañado o mal cortado, con motivo, y el celular pasa al siguiente. Las
// anulaciones hechas sin señal llegan en lote: cada una va en su propia transacción y reenviar una que ya
// se hizo no falla. El cobrador solo anula tickets de sus lotes; el administrador, cualquiera disponible.
export async function anularTickets(_db, items, { usuarioId = null, rol = 'cobrador', audit = null } = {}) {
  const lista = Array.isArray(items) ? items : [items];
  if (!lista.length) throw new ValidationError('No hay tickets para anular');
  if (lista.length > MAX_LOTE_ANULACIONES) throw new ValidationError(`Se pueden anular como máximo ${MAX_LOTE_ANULACIONES} tickets por envío`);

  const resultados = [];
  for (const item of lista) {
    const serie = String(item?.serie || '').trim().toUpperCase();
    const numero = parseNumeroTicket(item?.numero);
    const motivo = String(item?.motivo || '').trim().slice(0, 300);
    const base = { serie, numero };
    if (!serie || !numero) { resultados.push({ ...base, estado: 'rechazado', mensaje: 'Falta la serie o el número del ticket' }); continue; }
    if (motivo.length < 5) { resultados.push({ ...base, estado: 'rechazado', mensaje: 'Indique el motivo de la anulación (al menos 5 caracteres)' }); continue; }
    // La hora del celular, si es creíble (no en el futuro).
    const hora = Date.parse(item?.fecha || '');
    const fecha = Number.isFinite(hora) && hora <= Date.now() + 5 * 60 * 1000 ? new Date(hora) : new Date();
    const texto = textoTicket(serie, numero);

    try {
      resultados.push({ ...base, ...(await withTransaction(async (client) => {
        const ticket = await first(client, `
          SELECT t.id, t.estado, t.transaccion_id, t.lote_id, l.cobrador_id FROM tickets t JOIN ticket_lotes l ON l.id = t.lote_id
          WHERE t.serie = $1 AND t.numero = $2 FOR UPDATE OF t`, [serie, numero]);
        if (!ticket) return { estado: 'rechazado', mensaje: `El ticket ${texto} no está asignado` };
        if (rol !== 'super_admin' && Number(ticket.cobrador_id) !== Number(usuarioId)) return { estado: 'rechazado', mensaje: `El ticket ${texto} no es de sus lotes` };
        if (ticket.estado === 'anulado') return { estado: 'ya_anulado', mensaje: `El ticket ${texto} ya estaba anulado` };
        if (ticket.estado !== 'disponible') {
          return { estado: 'rechazado', mensaje: ticket.estado === 'usado' ? `El ticket ${texto} ya se usó en el cobro ${ticket.transaccion_id}` : `El ticket ${texto} está ${ticket.estado}` };
        }
        await client.query(`UPDATE tickets SET estado = 'anulado', motivo = $2, baja_en = $3, registrado_por = $4 WHERE id = $1`,
          [ticket.id, motivo, fecha, Number(usuarioId)]);
        await cerrarLotesAgotados(client, [ticket.lote_id]);
        if (audit) {
          await appendAudit(client, {
            ...audit,
            usuarioId: audit.usuarioId ?? usuarioId,
            entidad: 'tickets',
            detalle: `Ticket ${texto} anulado: ${motivo}`,
            recursoId: Number(ticket.id),
            payloadNuevo: { serie, numero, motivo, fecha: fecha.toISOString() }
          });
        }
        return { estado: 'anulado', mensaje: `Ticket ${texto} anulado` };
      })) });
    } catch (error) {
      console.error('Error al anular ticket:', error);
      resultados.push({ ...base, estado: 'error', mensaje: 'Error temporal del servidor; se reintentará' });
    }
  }
  return { resultados };
}

// Lo que el celular del cobrador necesita para cobrar sin señal: por serie, los números disponibles en
// orden y si le quedan pocos.
export async function ticketsDelCobrador(db, cobradorId) {
  const umbral = await getUmbralTickets(db);
  const filas = await rows(db, `
    SELECT s.codigo AS serie, s.valor, s.tipo_via,
           COALESCE(array_agg(t.numero ORDER BY t.numero) FILTER (WHERE t.estado = 'disponible'), '{}') AS disponibles
    FROM ticket_series s
    JOIN ticket_lotes l ON l.serie = s.codigo AND l.cobrador_id = $1
    LEFT JOIN tickets t ON t.lote_id = l.id
    GROUP BY s.codigo, s.valor, s.tipo_via ORDER BY s.valor DESC`, [Number(cobradorId)]);
  return {
    cobrador_id: Number(cobradorId),
    umbral,
    generado_en: new Date().toISOString(),
    series: filas.map((fila) => {
      const disponibles = (fila.disponibles || []).map(Number);
      return { serie: fila.serie, valor: Number(fila.valor), tipo_via: fila.tipo_via, disponibles, quedan: disponibles.length, pocos: disponibles.length <= umbral };
    })
  };
}

// Cobradores a quienes se puede asignar un lote, con cuántos tickets disponibles tienen por serie.
export async function getCobradoresTickets(db) {
  return (await rows(db, `
    SELECT u.id, u.nombre,
           COUNT(t.id) FILTER (WHERE t.estado = 'disponible' AND t.serie = 'S3')::int AS disponibles_s3,
           COUNT(t.id) FILTER (WHERE t.estado = 'disponible' AND t.serie = 'S2')::int AS disponibles_s2
    FROM usuarios u JOIN roles r ON r.id = u.rol_id
    LEFT JOIN ticket_lotes l ON l.cobrador_id = u.id
    LEFT JOIN tickets t ON t.lote_id = l.id
    WHERE r.codigo = 'cobrador'
    GROUP BY u.id, u.nombre ORDER BY u.nombre`)).map((fila) => ({ ...fila, id: Number(fila.id) }));
}

export async function getSeriesTicket(db) {
  return (await rows(db, 'SELECT codigo AS serie, valor, tipo_via, activa FROM ticket_series ORDER BY valor DESC'))
    .map((fila) => ({ ...fila, valor: Number(fila.valor) }));
}

// Tickets del cobrador en el día (Lima), por serie, y lo que hay que revisar al cerrar la caja:
//   saltos      números anteriores al último usado que siguen disponibles: puede ser un ticket entregado
//               sin cobro registrado (o uno que falta anular).
//   observados  cobros del día observados por un ticket: repetido, de otro lote, faltante o que no cuadra.
//   diferencia  lo cobrado con ticket menos lo que valen los tickets usados (debe ser 0).
export async function resumenTickets(db, cobradorId, fecha) {
  const dia = FECHA_RE.test(String(fecha || '')) ? fecha : todayInLima();
  const cobrador = Number(cobradorId);
  const filas = await rows(db, `
    SELECT s.codigo AS serie, s.valor,
           COUNT(t.id)::int AS asignados,
           COUNT(t.id) FILTER (WHERE t.estado = 'disponible')::int AS disponibles,
           COUNT(t.id) FILTER (WHERE t.estado = 'usado' AND ${LOCAL('t.usado_en')}::date = $2::date)::int AS usados,
           COUNT(t.id) FILTER (WHERE t.estado = 'anulado' AND ${LOCAL('t.baja_en')}::date = $2::date)::int AS anulados,
           COUNT(t.id) FILTER (WHERE t.estado = 'devuelto' AND ${LOCAL('t.baja_en')}::date = $2::date)::int AS devueltos,
           MAX(t.numero) FILTER (WHERE t.estado = 'usado') AS ultimo_usado
    FROM ticket_series s
    JOIN ticket_lotes l ON l.serie = s.codigo AND l.cobrador_id = $1
    LEFT JOIN tickets t ON t.lote_id = l.id
    GROUP BY s.codigo, s.valor ORDER BY s.valor DESC`, [cobrador, dia]);

  const series = [];
  for (const fila of filas) {
    const saltos = fila.ultimo_usado === null ? [] : (await rows(db, `
      SELECT t.numero FROM tickets t JOIN ticket_lotes l ON l.id = t.lote_id
      WHERE l.cobrador_id = $1 AND t.serie = $2 AND t.estado = 'disponible' AND t.numero < $3
      ORDER BY t.numero LIMIT 50`, [cobrador, fila.serie, fila.ultimo_usado])).map((item) => Number(item.numero));
    const valor = Number(fila.valor);
    series.push({
      serie: fila.serie,
      valor,
      asignados: fila.asignados,
      disponibles: fila.disponibles,
      usados: fila.usados,
      anulados: fila.anulados,
      devueltos: fila.devueltos,
      monto_tickets: dinero(fila.usados * valor),
      ultimo_usado: idONull(fila.ultimo_usado),
      saltos
    });
  }

  const cobrado = await first(db, `
    SELECT COUNT(*)::int AS cobros, COALESCE(SUM(monto), 0) AS monto FROM transacciones
    WHERE cobrador_id = $1 AND estado = 'confirmado' AND tickets IS NOT NULL AND ${LOCAL('fecha_cobro_cliente')}::date = $2::date`,
  [cobrador, dia]);
  const observados = (await rows(db, `
    SELECT ob.id, ob.transaccion_id, ob.motivo, ob.estado, co.monto, co.tickets, c.nombre AS comerciante,
           ${TS('co.fecha_cobro_cliente')} AS fecha_cobro, cp.numero_correlativo AS comprobante
    FROM cobros_observados ob
    JOIN transacciones co ON co.id = ob.transaccion_id
    JOIN comerciantes c ON c.id = co.comerciante_id
    LEFT JOIN comprobantes cp ON cp.id = co.comprobante_id
    WHERE co.cobrador_id = $1 AND ${LOCAL('co.fecha_cobro_cliente')}::date = $2::date AND ob.motivo ILIKE '%ticket%'
    ORDER BY co.fecha_cobro_cliente`, [cobrador, dia]))
    .map((fila) => ({ ...fila, id: Number(fila.id), transaccion_id: Number(fila.transaccion_id), monto: Number(fila.monto) }));

  const montoTickets = dinero(series.reduce((total, item) => total + item.monto_tickets, 0));
  const cobradoConTicket = dinero(cobrado.monto);
  const diferencia = dinero(cobradoConTicket - montoTickets);
  const saltos = series.reduce((total, item) => total + item.saltos.length, 0);
  return {
    fecha: dia,
    series,
    monto_tickets: montoTickets,
    cobros_con_ticket: cobrado.cobros,
    cobrado_con_ticket: cobradoConTicket,
    diferencia,
    observados,
    alertas: saltos + observados.length + (diferencia === 0 ? 0 : 1)
  };
}

// ---------------------------------------------------------------------------
// Paquete de jornada: padrón, saldos y tarifas para buscar y cobrar sin señal
// ---------------------------------------------------------------------------

export async function getJornadaPackage(db, { periodo = currentPeriod() } = {}) {
  const merchants = await rows(db, `
    SELECT c.id, c.correlativo, c.codigo, c.dni_ruc, c.nombre, c.tipo_comerciante,
           ARRAY(SELECT h.codigo FROM comerciante_codigos_historicos h WHERE h.comerciante_id = c.id) AS codigos_anteriores,
           c.tipo_comerciante AS categoria, c.rubro_id, r.nombre AS rubro,
           c.zona_id, z.nombre AS zona,
           (SELECT p.codigo_puesto FROM puestos p
             WHERE p.comerciante_id = c.id AND p.estado NOT IN ('disponible', 'inactivo') ORDER BY p.id LIMIT 1) AS codigo_puesto,
           -- Puesto donde el cobrador marca la asistencia (también el que conserva como ausente). Solo se
           -- entrega a quien cobra por día cobrado: el ferial y el permanente con tarifa por día (más abajo).
           CASE WHEN c.tipo_comerciante <> 'eventual' THEN (SELECT p.id FROM puestos p
             WHERE p.comerciante_id = c.id AND p.estado <> 'inactivo' ORDER BY p.id LIMIT 1) END AS puesto_ferial_id
    FROM comerciantes c JOIN rubros r ON r.id = c.rubro_id JOIN zonas z ON z.id = c.zona_id
    WHERE c.estado = 'activo' ORDER BY c.nombre`);

  const comerciantes = [];
  for (const merchant of merchants) {
    let deuda = { monto_total: 0, monto_pagado: 0, saldo: 0, no_devengo: true, tarifa: null };
    let acumulada = null;
    try {
      deuda = await calcularLiquidacion(db, merchant.id, periodo);
      acumulada = await calcularDeudaAcumulada(db, merchant.id, { hasta: periodo });
    } catch {
      // Sin tarifa vigente: se descarga con saldo 0 (tampoco se podría cobrar en línea).
    }
    comerciantes.push({
      ...merchant,
      id: Number(merchant.id),
      periodo,
      tarifa_id: deuda.tarifa?.id ?? null,
      tarifa_monto_fijo: deuda.tarifa ? Number(deuda.tarifa.monto_fijo) : null,
      monto_total: Number(deuda.monto_total || 0),
      monto_pagado: Number(deuda.monto_pagado || 0),
      saldo: Number(deuda.saldo || 0),
      no_devengo: Boolean(deuda.no_devengo),
      cobro_diario: Boolean(deuda.cobro_diario),
      dia: deuda.dia ?? null,
      deuda_vencida: acumulada?.deuda_vencida ?? 0,
      meses_impagos: acumulada?.meses_impagos ?? [],
      puesto_ferial_id: merchant.puesto_ferial_id && (merchant.tipo_comerciante === 'ferial' || deuda.tarifa?.unidad_medida === 'semanal')
        ? Number(merchant.puesto_ferial_id) : null,
      dias_asistidos: deuda.dias_asistidos ?? null,
      // Series de ticket con las que se le cobra (un ticket por puesto y día cobrado); vacía = sin ticket.
      series_cobro: await seriesDelComerciante(db, merchant, periodo)
    });
  }

  return {
    generado_en: new Date().toISOString(),
    periodo,
    comerciantes,
    tarifas: await getTarifas(db),
    rubros: await getRubros(db),
    zonas: await getZonas(db)
  };
}

// ---------------------------------------------------------------------------
// Sesiones por dispositivo (token de renovación)
// ---------------------------------------------------------------------------

// Solo se guarda el sha256 del token: quien lea la tabla no puede usarlo.
const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');

const SESSION_SELECT = `
  SELECT s.id, s.usuario_id, u.nombre AS usuario, u.email, r.codigo AS rol, s.device_id, s.device_nombre,
         s.ip_origen, s.user_agent, s.creado_en, s.ultimo_uso_en, s.expira_en, s.revocado_en, s.motivo_revocacion,
         (s.revocado_en IS NULL AND s.expira_en > now()) AS activa
  FROM sesiones_dispositivo s
  JOIN usuarios u ON u.id = s.usuario_id
  JOIN roles r ON r.id = u.rol_id`;

// Abre una sesión para el dispositivo y cierra la anterior del mismo usuario en ese dispositivo.
export async function createDeviceSession(_db, { usuarioId, deviceId = null, deviceNombre = null, ip = null, userAgent = null, ttlHours = config.refreshTokenTtlHours }) {
  const refreshToken = randomBytes(32).toString('base64url');
  const device = cleanText(deviceId, 100) || `sin-id-${randomBytes(6).toString('hex')}`;
  return withTransaction(async (client) => {
    await client.query(`
      UPDATE sesiones_dispositivo SET revocado_en = now(), motivo_revocacion = 'Nuevo inicio de sesión en el dispositivo'
      WHERE usuario_id = $1 AND device_id = $2 AND revocado_en IS NULL`, [Number(usuarioId), device]);
    const created = await first(client, `
      INSERT INTO sesiones_dispositivo (usuario_id, device_id, device_nombre, token_hash, ip_origen, user_agent, expira_en)
      VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(hours => $7))
      RETURNING id, expira_en`,
    [Number(usuarioId), device, cleanText(deviceNombre, 120), hashToken(refreshToken), cleanText(ip, 60), cleanText(userAgent, 300), Number(ttlHours)]);
    return { id: Number(created.id), deviceId: device, refreshToken, expiraEn: created.expira_en };
  });
}

// Sesión vigente (no revocada, no vencida, usuario activo) a la que pertenece el token; marca el último uso.
export async function findActiveSessionByToken(db, refreshToken) {
  if (!refreshToken) return null;
  const session = await first(db, `
    UPDATE sesiones_dispositivo s SET ultimo_uso_en = now()
    FROM usuarios u JOIN roles r ON r.id = u.rol_id
    WHERE u.id = s.usuario_id AND u.activo
      AND s.token_hash = $1 AND s.revocado_en IS NULL AND s.expira_en > now()
    RETURNING s.id, s.usuario_id, s.device_id, s.expira_en, u.nombre, u.email, r.codigo AS rol`, [hashToken(refreshToken)]);
  return session;
}

export async function isSessionActive(db, sessionId) {
  const row = await first(db, `SELECT 1 AS ok FROM sesiones_dispositivo WHERE id = $1 AND revocado_en IS NULL AND expira_en > now()`, [Number(sessionId)]);
  return Boolean(row);
}

export async function getDeviceSessions(db, { usuarioId = null, soloActivas = true } = {}) {
  const params = [];
  const where = [];
  if (usuarioId) { params.push(Number(usuarioId)); where.push(`s.usuario_id = $${params.length}`); }
  if (soloActivas) where.push('s.revocado_en IS NULL AND s.expira_en > now()');
  return rows(db, `${SESSION_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.ultimo_uso_en DESC LIMIT 200`, params);
}

// Revoca una sesión. Devuelve la sesión revocada o null si no existía o ya estaba cerrada.
export async function revokeDeviceSession(db, { sessionId = null, refreshToken = null, revocadoPor = null, motivo = 'Revocada', usuarioId = null }) {
  const params = [revocadoPor ? Number(revocadoPor) : null, cleanText(motivo, 200)];
  let match;
  if (refreshToken) { params.push(hashToken(refreshToken)); match = `token_hash = $${params.length}`; }
  else { params.push(Number(sessionId)); match = `id = $${params.length}`; }
  if (usuarioId) { params.push(Number(usuarioId)); match += ` AND usuario_id = $${params.length}`; }
  return first(db, `
    UPDATE sesiones_dispositivo SET revocado_en = now(), revocado_por = $1, motivo_revocacion = $2
    WHERE ${match} AND revocado_en IS NULL
    RETURNING id, usuario_id, device_id, device_nombre, revocado_en`, params);
}

export async function findUserByEmail(db, email) {
  return first(db, `
    SELECT u.id, u.nombre, u.email, u.password_hash, r.codigo AS rol
    FROM usuarios u JOIN roles r ON r.id = u.rol_id
    WHERE lower(u.email) = lower($1) AND u.activo`, [String(email || '').trim()]);
}
