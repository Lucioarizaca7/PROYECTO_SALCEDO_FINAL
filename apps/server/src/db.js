import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

import { pool, withTransaction, closePool, testSchema } from './pg.js';
import { config } from './config.js';
import { ValidationError, NotFoundError, ConflictError } from './errors.js';

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
      ['zapatillas', 40, 'semanal'],
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

export async function createAdminUser({ nombre, email, password }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanName = String(nombre || '').trim();
  if (!cleanName) throw new ValidationError('El nombre es obligatorio');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw new ValidationError('Correo no válido');
  if (String(password || '').length < 10) throw new ValidationError('La contraseña debe tener al menos 10 caracteres');

  const created = await first(pool, `
    INSERT INTO usuarios (nombre, email, password_hash, rol_id)
    SELECT $1, $2, $3, r.id FROM roles r WHERE r.codigo = 'super_admin'
    ON CONFLICT (email) DO NOTHING
    RETURNING id`, [cleanName, cleanEmail, bcrypt.hashSync(String(password), config.bcryptSaltRounds)]);
  if (!created) throw new ConflictError(`Ya existe un usuario con el correo ${cleanEmail}`);
  return { id: Number(created.id), nombre: cleanName, email: cleanEmail, rol: 'super_admin' };
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
    params.push(`%${comercianteId}%`);
    conditions.push(`(a.entidad = 'comerciantes' AND a.detalle LIKE $${params.length})`);
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

export async function generateForecastProjection(db, options = {}) {
  const period = String(options.period || currentPeriod());
  const horizonDays = Number(options.horizonteDias || options.horizonDays || 90);
  const [year, month] = period.split('-').map(Number);
  const monthSequence = [];

  for (let offset = 0; offset < 3; offset += 1) {
    let currentMonth = month - offset;
    let currentYear = year;
    while (currentMonth <= 0) {
      currentMonth += 12;
      currentYear -= 1;
    }
    monthSequence.push(`${currentYear}-${String(currentMonth).padStart(2, '0')}`);
  }
  monthSequence.reverse();

  const zoneMap = new Map();
  const rubroMap = new Map();

  for (const monthValue of monthSequence) {
    const zoneRows = await rows(db, `
      SELECT c.zona_id, z.nombre AS zona, COALESCE(SUM(co.monto), 0) AS recaudado
      FROM comerciantes c
      JOIN zonas z ON z.id = c.zona_id
      LEFT JOIN transacciones co ON co.comerciante_id = c.id AND co.estado = 'confirmado' AND ${PAYMENT_DAY} LIKE $1
      GROUP BY c.zona_id, z.nombre`, [`${monthValue}%`]);
    for (const row of zoneRows) {
      const current = zoneMap.get(Number(row.zona_id)) || { zona_id: Number(row.zona_id), zona: row.zona || 'Sin zona', recaudado: 0 };
      current.recaudado += Number(row.recaudado || 0);
      zoneMap.set(Number(row.zona_id), current);
    }

    const rubroRows = await rows(db, `
      SELECT c.rubro_id, r.nombre AS rubro, COALESCE(SUM(co.monto), 0) AS recaudado
      FROM comerciantes c
      JOIN rubros r ON r.id = c.rubro_id
      LEFT JOIN transacciones co ON co.comerciante_id = c.id AND co.estado = 'confirmado' AND ${PAYMENT_DAY} LIKE $1
      GROUP BY c.rubro_id, r.nombre`, [`${monthValue}%`]);
    for (const row of rubroRows) {
      const current = rubroMap.get(Number(row.rubro_id)) || { rubro_id: Number(row.rubro_id), rubro: row.rubro || 'Sin rubro', recaudado: 0 };
      current.recaudado += Number(row.recaudado || 0);
      rubroMap.set(Number(row.rubro_id), current);
    }
  }

  const baseline = await rows(db, `
    SELECT c.zona_id, c.rubro_id, COALESCE(AVG(t.monto_fijo), 18) AS tarifa_promedio, COUNT(DISTINCT c.id) AS total_comerciantes
    FROM comerciantes c
    LEFT JOIN tarifas t ON t.rubro_id = c.rubro_id AND t.activo
    WHERE c.estado = 'activo'
    GROUP BY c.zona_id, c.rubro_id`);

  for (const row of baseline) {
    const zoneId = Number(row.zona_id || 0);
    const rubroId = Number(row.rubro_id || 0);
    const merchantCount = Number(row.total_comerciantes || 0);
    const tarifaPromedio = Number(row.tarifa_promedio || 0);

    if (zoneId) {
      const current = zoneMap.get(zoneId) || { zona_id: zoneId, zona: 'Sin zona', recaudado: 0 };
      current.recaudado += merchantCount * tarifaPromedio;
      zoneMap.set(zoneId, current);
    }
    if (rubroId) {
      const current = rubroMap.get(rubroId) || { rubro_id: rubroId, rubro: 'Sin rubro', recaudado: 0 };
      current.recaudado += merchantCount * tarifaPromedio;
      rubroMap.set(rubroId, current);
    }
  }

  const porZona = [...zoneMap.values()].map((row) => {
    const promedioMensual = Number((row.recaudado || 0) / Math.max(monthSequence.length, 1));
    const crecimiento = promedioMensual > 0 ? 1.12 : 1.02;
    const proyectado = promedioMensual * (horizonDays / 30) * crecimiento;
    return {
      zona_id: row.zona_id,
      zona: row.zona,
      recaudado: Number((row.recaudado || 0).toFixed(2)),
      proyectado: Number(proyectado.toFixed(2)),
      nivel_confianza: Number(clamp(0.72 + ((proyectado || 0) / Math.max(1, promedioMensual * 2)) * 0.18, 0.72, 0.97).toFixed(2))
    };
  });

  const porRubro = [...rubroMap.values()].map((row) => {
    const promedioMensual = Number((row.recaudado || 0) / Math.max(monthSequence.length, 1));
    const proyectado = promedioMensual * (horizonDays / 30) * (1.1 + (promedioMensual > 0 ? 0.08 : 0));
    return {
      rubro_id: row.rubro_id,
      rubro: row.rubro,
      recaudado: Number((row.recaudado || 0).toFixed(2)),
      proyectado: Number(proyectado.toFixed(2))
    };
  });

  const totalHistorico = porZona.reduce((sum, item) => sum + Number(item.recaudado || 0), 0);
  const totalProyectado = porZona.reduce((sum, item) => sum + Number(item.proyectado || 0), 0);

  const result = {
    periodo: period,
    horizonte_dias: horizonDays,
    totalHistorico: Number(totalHistorico.toFixed(2)),
    totalProyectado: Number(totalProyectado.toFixed(2)),
    promedioDiario: Number((totalProyectado / Math.max(horizonDays, 1)).toFixed(2)),
    porZona: porZona.sort((a, b) => Number(b.proyectado || 0) - Number(a.proyectado || 0)),
    porRubro: porRubro.sort((a, b) => Number(b.proyectado || 0) - Number(a.proyectado || 0))
  };

  await db.query(
    `INSERT INTO modelos_ia_metricas (modelo, version, entidad_tipo, periodo, valor_predicho, valor_real, metricas)
     VALUES ('proyeccion_ingresos', 'heuristico-v1', 'global', $1, $2, $3, $4::jsonb)`,
    [period, result.totalProyectado, result.totalHistorico, JSON.stringify({ horizonte_dias: horizonDays, promedioDiario: result.promedioDiario })]
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

export async function buildReportCsv(db, options = {}) {
  const data = await getReportRows(db, options);
  const headers = ['fecha', 'comerciante_codigo', 'comerciante', 'rubro', 'zona', 'cobrador', 'monto', 'metodo_pago', 'estado', 'comprobante'];
  const escapeValue = (value) => {
    const normalized = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(normalized) ? `"${normalized.replace(/"/g, '""')}"` : normalized;
  };

  if (!data.length) return `${headers.join(',')}\n`;
  const lines = [headers.join(',')];
  for (const row of data) lines.push(headers.map((header) => escapeValue(row[header])).join(','));
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Catálogos: rubros, zonas, calles
// ---------------------------------------------------------------------------

export async function getRubros(db) {
  return rows(db, 'SELECT id, codigo, nombre, descripcion FROM rubros WHERE activo ORDER BY nombre ASC');
}

export async function getZonas(db) {
  return rows(db, 'SELECT id, codigo, nombre, descripcion FROM zonas ORDER BY nombre ASC');
}

export async function insertZona(db, payload) {
  const nombre = String(payload.nombre || '').trim();
  const descripcion = String(payload.descripcion || '').trim();
  if (!nombre) throw new ValidationError('El nombre de la zona es obligatorio');

  const duplicate = await first(db, 'SELECT id FROM zonas WHERE lower(btrim(nombre)) = lower(btrim($1))', [nombre]);
  if (duplicate) throw new ConflictError('Ya existe una zona con ese nombre');

  return first(db, 'INSERT INTO zonas (nombre, descripcion) VALUES ($1, $2) RETURNING id, codigo, nombre, descripcion', [nombre, descripcion]);
}

export async function updateZona(db, id, payload) {
  const current = await first(db, 'SELECT id, nombre, descripcion FROM zonas WHERE id = $1', [Number(id)]);
  if (!current) throw new NotFoundError('Zona no encontrada');

  const nombre = payload.nombre === undefined ? current.nombre : String(payload.nombre).trim();
  const descripcion = payload.descripcion === undefined ? current.descripcion : String(payload.descripcion).trim();
  if (!nombre) throw new ValidationError('El nombre de la zona es obligatorio');

  const duplicate = await first(db, 'SELECT id FROM zonas WHERE lower(btrim(nombre)) = lower(btrim($1)) AND id <> $2', [nombre, Number(id)]);
  if (duplicate) throw new ConflictError('Ya existe una zona con ese nombre');

  return first(db, 'UPDATE zonas SET nombre = $1, descripcion = $2 WHERE id = $3 RETURNING id, codigo, nombre, descripcion', [nombre, descripcion, Number(id)]);
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

  return findComerciante(db, id);
}

// Baja lógica: se conserva el historial de cobros y notificaciones.
export async function deactivateComerciante(db, id) {
  const merchantId = Number(id);
  if (!(await first(db, 'SELECT id FROM comerciantes WHERE id = $1', [merchantId]))) throw new NotFoundError('Comerciante no encontrado');
  await db.query(`UPDATE puestos SET estado = 'inactivo' WHERE comerciante_id = $1`, [merchantId]);
  await db.query(`UPDATE comerciantes SET estado = 'inactivo', fecha_baja = now() WHERE id = $1`, [merchantId]);
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
  const latitud = Number(payload.latitud);
  const longitud = Number(payload.longitud);

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
    [next.id, comercianteId, zonaId, direccion, metros, estado, finalCode,
      Number.isFinite(latitud) ? latitud : null, Number.isFinite(longitud) ? longitud : null]);
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
  const latitud = Number(payload.latitud ?? current.latitud);
  const longitud = Number(payload.longitud ?? current.longitud);

  if (!zonaId || !direccion || (metros !== null && (!Number.isFinite(metros) || metros <= 0))) {
    throw new ValidationError('Zona, dirección y metros cuadrados válidos son obligatorios');
  }
  await validatePuestoPlacement(db, { comercianteId, zonaId, direccion, estado, excludeId: puestoId });

  await db.query(`
    UPDATE puestos
    SET comerciante_id = $1, zona_id = $2, direccion = $3, metros_cuadrados = $4, estado = $5, latitud = $6, longitud = $7
    WHERE id = $8`,
  [comercianteId, zonaId, direccion, metros, estado, Number.isFinite(latitud) ? latitud : null, Number.isFinite(longitud) ? longitud : null, puestoId]);

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
  SELECT t.id, t.rubro_id, r.nombre AS rubro, t.zona_id, t.tipo_tarifa, t.monto_fijo, t.monto_variable,
         t.unidad_medida, ${DAY('t.vigencia_inicio')} AS vigencia_inicio, ${DAY('t.vigencia_fin')} AS vigencia_fin,
         CASE WHEN t.activo THEN 1 ELSE 0 END AS estado, t.version
  FROM tarifas t JOIN rubros r ON r.id = t.rubro_id`;

export async function getTarifas(db, options = {}) {
  const rubroId = Number(options.rubro_id || 0);
  return rows(db, `${TARIFA_SELECT} ${rubroId ? 'WHERE t.rubro_id = $1' : ''} ORDER BY t.vigencia_inicio DESC, t.id DESC`, rubroId ? [rubroId] : []);
}

async function findTarifa(db, id) {
  return first(db, `${TARIFA_SELECT} WHERE t.id = $1`, [Number(id)]);
}

function validateTariff(payload) {
  const rubroId = Number(payload.rubro_id);
  const zonaId = payload.zona_id === undefined || payload.zona_id === null || payload.zona_id === '' ? null : Number(payload.zona_id);
  const tipoTarifa = String(payload.tipo_tarifa || 'fija').trim();
  const montoFijo = Number(payload.monto_fijo || 0);
  const montoVariable = Number(payload.monto_variable || 0);
  const unidadMedida = String(payload.unidad_medida || 'diaria').trim();
  const vigenciaInicio = String(payload.vigencia_inicio || '').trim();
  const vigenciaFin = payload.vigencia_fin ? String(payload.vigencia_fin).trim() : null;
  const version = Number(payload.version ?? 1);

  if (!rubroId || !['fija', 'variable', 'mixta'].includes(tipoTarifa)) throw new ValidationError('Rubro y tipo de tarifa son obligatorios');
  if (!['diaria', 'semanal', 'mensual', 'metro_cuadrado'].includes(unidadMedida)) throw new ValidationError('Unidad de medida no válida');
  if (montoFijo < 0 || montoVariable < 0 || (montoFijo === 0 && montoVariable === 0)) throw new ValidationError('La tarifa debe tener un monto mayor que cero');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vigenciaInicio)) throw new ValidationError('La vigencia inicial debe usar formato AAAA-MM-DD');
  if (vigenciaFin && vigenciaFin < vigenciaInicio) throw new ValidationError('La vigencia final no puede ser anterior a la inicial');
  if (!Number.isFinite(version) || version < 1) throw new ValidationError('La versión de la tarifa no es válida');

  return { rubroId, zonaId, tipoTarifa, montoFijo, montoVariable, unidadMedida, vigenciaInicio, vigenciaFin, version };
}

export async function insertTarifa(db, payload) {
  const tariff = validateTariff({ ...payload, version: payload.version ?? 1 });
  const created = await first(db, `
    INSERT INTO tarifas (rubro_id, zona_id, tipo_tarifa, monto_fijo, monto_variable, unidad_medida, vigencia_inicio, vigencia_fin, activo, version)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, $9) RETURNING id`,
  [tariff.rubroId, tariff.zonaId, tariff.tipoTarifa, tariff.montoFijo, tariff.montoVariable, tariff.unidadMedida, tariff.vigenciaInicio, tariff.vigenciaFin, tariff.version]);
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
        vigencia_inicio = $7, vigencia_fin = $8, version = $9
    WHERE id = $10 AND version = $11`,
  [tariff.rubroId, tariff.zonaId, tariff.tipoTarifa, tariff.montoFijo, tariff.montoVariable, tariff.unidadMedida,
    tariff.vigenciaInicio, tariff.vigenciaFin, tariff.version, Number(id), current.version]);
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

// Monto de un día de la tarifa: la diaria tal cual; la semanal entre 7; la mensual (o por m²) entre los días del mes.
function dailyTariffAmount(tarifa, dia, metros = 1) {
  const fijo = Number(tarifa.monto_fijo || 0);
  const variable = Number(tarifa.monto_variable || 0) * (tarifa.unidad_medida === 'metro_cuadrado' ? metros : 1);
  const total = fijo + variable;
  if (tarifa.unidad_medida === 'diaria') return Number(total.toFixed(2));
  if (tarifa.unidad_medida === 'semanal') return Number((total / 7).toFixed(2));
  return Number((total / periodMultiplier(dia.slice(0, 7), 'diaria')).toFixed(2));
}

// Tarifa vigente del rubro en el periodo; la de la zona del comerciante tiene prioridad sobre la general.
async function findApplicableTariff(db, merchant, periodo) {
  return first(db, `
    ${TARIFA_SELECT}
    WHERE t.rubro_id = $1 AND t.activo
      AND (t.zona_id IS NULL OR t.zona_id = $2)
      AND t.vigencia_inicio <= $3::date AND (t.vigencia_fin IS NULL OR t.vigencia_fin >= $3::date)
    ORDER BY (t.zona_id IS NOT NULL) DESC, t.vigencia_inicio DESC, t.id DESC LIMIT 1`,
  [merchant.rubro_id, merchant.zona_id, `${periodo}-01`]);
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
  if (merchantType === 'ferial' && !puesto) {
    return noDevengo('ferial_sin_asistencia', { metros_cuadrados: 0 });
  }

  const tarifa = await findApplicableTariff(db, merchant, periodo);
  if (!tarifa) throw new ValidationError('No existe una tarifa vigente para el rubro y periodo indicado');

  const metros = Number(puesto?.metros_cuadrados || 1);
  const multiplier = periodMultiplier(periodo, tarifa.unidad_medida);
  const base = Number(tarifa.monto_fijo) * multiplier;
  const variable = Number(tarifa.monto_variable) * (tarifa.unidad_medida === 'metro_cuadrado' ? metros : 1) * multiplier;
  const montoTotal = Number((base + variable).toFixed(2));
  const paid = await first(db, `
    SELECT COALESCE(SUM(monto), 0) AS pagado FROM transacciones
    WHERE comerciante_id = $1 AND tarifa_id = $2 AND estado = 'confirmado'
      AND to_char(${LOCAL('fecha_cobro_cliente')}, 'YYYY-MM') = $3`, [merchant.id, tarifa.id, periodo]);
  const montoPagado = Number(paid.pagado);
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

export async function getCobros(db) {
  return rows(db, `
    SELECT co.id, co.comerciante_id, c.nombre AS comerciante, co.tarifa_id, co.cobrador_id,
           co.monto, co.concepto, co.metodo_pago, co.codigo_operacion, co.observaciones,
           CASE WHEN ob.estado = 'pendiente' THEN 'observado' ELSE co.estado END AS estado, ob.motivo AS observacion,
           ${PAYMENT_DAY} AS fecha_cobro, cp.numero_correlativo AS comprobante
    FROM transacciones co
    JOIN comerciantes c ON c.id = co.comerciante_id
    LEFT JOIN comprobantes cp ON cp.id = co.comprobante_id
    LEFT JOIN cobros_observados ob ON ob.transaccion_id = co.id
    ORDER BY co.id DESC`);
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
  const liquidation = await calcularLiquidacion(db, comercianteId, payload.periodo, { dia: todayInLima(clientDate) });
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

  const collector = await first(db, 'SELECT id FROM usuarios WHERE id = $1', [cobradorId]);
  if (!collector) throw new ValidationError('El cobrador indicado no existe');

  const sequence = await first(db, `SELECT nextval('comprobantes_recibo_seq') AS n`);
  const number = `R-${String(sequence.n).padStart(6, '0')}`;
  const comprobante = await first(db, `INSERT INTO comprobantes (numero_correlativo, tipo) VALUES ($1, 'recibo') RETURNING id`, [number]);

  const cobro = await first(db, `
    INSERT INTO transacciones
      (comerciante_id, tarifa_id, cobrador_id, comprobante_id, monto, concepto, metodo_pago, codigo_operacion,
       hash_transaccion, observaciones, estado, fecha_cobro_cliente)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'confirmado', $11) RETURNING id`,
  [comercianteId, tarifaId, cobradorId, comprobante.id, monto, concepto, metodoPago, uniqueCode,
    hashTransaccion, observaciones || null, clientDate]);

  if (observacion) {
    await db.query(`
      INSERT INTO cobros_observados (transaccion_id, motivo, saldo_al_sincronizar, monto, device_id)
      VALUES ($1, $2, $3, $4, $5)`, [cobro.id, observacion, liquidation.saldo, monto, cleanText(payload.device_id, 100)]);
  }

  await createNotification(db, {
    comerciante_id: comercianteId,
    tipo: 'cobro_confirmado',
    canal: 'whatsapp',
    mensaje: `Cobro confirmado para ${liquidation.comerciante?.nombre || 'comerciante'} por S/ ${Number(monto).toFixed(2)}. Comprobante ${number}.`
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
    estado: observacion ? 'observado' : 'confirmado',
    observacion,
    saldo_restante: Number(Math.max(liquidation.saldo - monto, 0).toFixed(2))
  };

  if (audit) {
    await appendAudit(db, {
      ...audit,
      usuarioId: audit.usuarioId ?? cobradorId,
      entidad: 'cobros',
      detalle: audit.detalle || `Cobro ${number} por S/ ${monto.toFixed(2)} al comerciante ${comercianteId}${observacion ? ` (observado: ${observacion})` : ''}`,
      recursoId: result.id,
      payloadNuevo: result
    });
  }
  return result;
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
    if (!previous) throw Object.assign(new Error('Cobro observado no encontrado'), { status: 404 });
    if (previous.estado !== 'pendiente') throw new ConflictError(`El cobro ya fue revisado (${previous.estado})`);

    const updated = await first(client, `
      UPDATE cobros_observados SET estado = $2, resolucion = $3, revisado_por = $4, revisado_en = now()
      WHERE id = $1 RETURNING id, transaccion_id, estado, resolucion`, [Number(id), decision, nota, Number(usuarioId)]);
    if (decision === 'anulado') {
      await client.query(`UPDATE transacciones SET estado = 'anulado' WHERE id = $1`, [previous.transaccion_id]);
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
// Paquete de jornada: padrón, saldos y tarifas para buscar y cobrar sin señal
// ---------------------------------------------------------------------------

export async function getJornadaPackage(db, { periodo = currentPeriod() } = {}) {
  const merchants = await rows(db, `
    SELECT c.id, c.correlativo, c.codigo, c.dni_ruc, c.nombre, c.tipo_comerciante,
           ARRAY(SELECT h.codigo FROM comerciante_codigos_historicos h WHERE h.comerciante_id = c.id) AS codigos_anteriores,
           c.tipo_comerciante AS categoria, c.rubro_id, r.nombre AS rubro,
           c.zona_id, z.nombre AS zona,
           (SELECT p.codigo_puesto FROM puestos p
             WHERE p.comerciante_id = c.id AND p.estado NOT IN ('disponible', 'inactivo') ORDER BY p.id LIMIT 1) AS codigo_puesto
    FROM comerciantes c JOIN rubros r ON r.id = c.rubro_id JOIN zonas z ON z.id = c.zona_id
    WHERE c.estado = 'activo' ORDER BY c.nombre`);

  const comerciantes = [];
  for (const merchant of merchants) {
    let deuda = { monto_total: 0, monto_pagado: 0, saldo: 0, no_devengo: true, tarifa: null };
    try {
      deuda = await calcularLiquidacion(db, merchant.id, periodo);
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
      dia: deuda.dia ?? null
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
