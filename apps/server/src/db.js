import initSqlJs from 'sql.js';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const databasePath = resolve(process.cwd(), 'data', process.env.SISREC_DB_NAME || (shouldResetDatabaseForTests() ? `sisrec-test-${process.pid}.sqlite` : 'sisrec.sqlite'));

const schema = `
CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    rol TEXT NOT NULL CHECK (rol IN ('super_admin', 'cobrador', 'auditor', 'comerciante')),
    estado INTEGER DEFAULT 1,
    fecha_creacion TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS zonas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    descripcion TEXT
);

CREATE TABLE IF NOT EXISTS calles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    zona_id INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    descripcion TEXT,
    estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo')),
    orden INTEGER DEFAULT 1,
    fecha_creacion TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rubros (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    descripcion TEXT,
    estado INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS comerciantes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dni_ruc TEXT UNIQUE NOT NULL,
    nombre TEXT NOT NULL,
    rubro_id INTEGER NOT NULL,
    zona_id INTEGER NOT NULL,
    categoria TEXT,
    tipo_comerciante TEXT NOT NULL CHECK (tipo_comerciante IN ('eventual', 'permanente', 'ferial')),
    estado TEXT NOT NULL DEFAULT 'activo',
    estado_empadronamiento TEXT NOT NULL DEFAULT 'REGULARIZADO',
    fecha_registro TEXT DEFAULT CURRENT_TIMESTAMP,
    usuario_creador INTEGER
);

CREATE TABLE IF NOT EXISTS puestos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comerciante_id INTEGER NOT NULL,
    zona_id INTEGER NOT NULL,
    direccion TEXT,
    metros_cuadrados REAL,
  estado TEXT NOT NULL DEFAULT 'ocupado',
    codigo_puesto TEXT,
  latitud REAL,
  longitud REAL
);

CREATE TABLE IF NOT EXISTS asistencias_feriales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  puesto_id INTEGER NOT NULL,
  fecha TEXT NOT NULL,
  sesion TEXT NOT NULL DEFAULT '',
  marca TEXT NOT NULL,
  fuente TEXT NOT NULL,
  fecha_registro TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (puesto_id, fecha, sesion)
);

CREATE TABLE IF NOT EXISTS tarifas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rubro_id INTEGER NOT NULL,
    tipo_tarifa TEXT NOT NULL CHECK (tipo_tarifa IN ('fija', 'variable', 'mixta')),
    monto_fijo REAL DEFAULT 0,
    monto_variable REAL DEFAULT 0,
    unidad_medida TEXT,
    vigencia_inicio TEXT NOT NULL,
    vigencia_fin TEXT,
    estado INTEGER DEFAULT 1,
    version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS deudas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comerciante_id INTEGER NOT NULL,
    tarifa_id INTEGER NOT NULL,
    periodo TEXT NOT NULL,
    monto_total REAL NOT NULL,
    monto_pagado REAL DEFAULT 0,
    saldo REAL NOT NULL,
    fecha_vencimiento TEXT,
    estado TEXT NOT NULL DEFAULT 'pendiente'
);

CREATE TABLE IF NOT EXISTS comprobantes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero_correlativo TEXT UNIQUE NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('boleta', 'recibo', 'pdf')),
    archivo_url TEXT,
    fecha_emision TEXT DEFAULT CURRENT_TIMESTAMP,
    estado TEXT NOT NULL DEFAULT 'emitido'
);

CREATE TABLE IF NOT EXISTS cobros (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comerciante_id INTEGER NOT NULL,
    tarifa_id INTEGER NOT NULL,
    cobrador_id INTEGER NOT NULL,
    comprobante_id INTEGER,
    monto REAL NOT NULL,
    concepto TEXT NOT NULL,
    metodo_pago TEXT NOT NULL CHECK (metodo_pago IN ('efectivo', 'yape', 'plin', 'pos', 'manual')),
    codigo_operacion TEXT,
    hash_transaccion TEXT UNIQUE,
    observaciones TEXT,
    estado TEXT NOT NULL DEFAULT 'confirmado',
    fecha_cobro TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS comerciante_preferencias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comerciante_id INTEGER NOT NULL UNIQUE,
    monto_sugerido REAL NOT NULL DEFAULT 0,
    metodo_pago_preferido TEXT NOT NULL DEFAULT 'efectivo',
    ultimo_monto REAL NOT NULL DEFAULT 0,
    ultimo_metodo_pago TEXT,
    ultimo_cobro_fecha TEXT,
    total_cobros INTEGER NOT NULL DEFAULT 0,
    fecha_actualizacion TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auditoria (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    usuario_rol TEXT NOT NULL DEFAULT 'anonimo',
    rol_usuario TEXT,
    entidad TEXT NOT NULL,
    accion TEXT NOT NULL,
    detalle TEXT,
    metodo_http TEXT,
    ip_origen TEXT,
    ruta_endpoint TEXT,
    recurso_id TEXT,
    payload_previo TEXT,
    payload_nuevo TEXT,
    fecha TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS prediccion_recaudacion (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    zona_id INTEGER NOT NULL,
    rubro_id INTEGER NOT NULL,
    periodo TEXT NOT NULL,
    valor_predicho REAL NOT NULL,
    valor_real REAL DEFAULT 0,
    nivel_confianza REAL,
    fecha_generacion TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS riesgo_morosidad (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comerciante_id INTEGER NOT NULL,
    score_riesgo REAL NOT NULL,
    nivel_riesgo TEXT NOT NULL CHECK (nivel_riesgo IN ('bajo', 'medio', 'alto', 'critico')),
    motivo_principal TEXT,
    fecha_calculo TEXT DEFAULT CURRENT_TIMESTAMP,
    estado_alerta TEXT NOT NULL DEFAULT 'activo'
);

CREATE TABLE IF NOT EXISTS alertas_morosidad (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comerciante_id INTEGER NOT NULL,
    riesgo_id INTEGER NOT NULL,
    tipo_alerta TEXT NOT NULL,
    mensaje TEXT NOT NULL,
    enviado INTEGER DEFAULT 0,
    fecha_envio TEXT
);

CREATE TABLE IF NOT EXISTS sincronizacion_offline (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entidad TEXT NOT NULL,
    payload TEXT,
    estado TEXT NOT NULL DEFAULT 'pendiente',
    fecha_creacion TEXT DEFAULT CURRENT_TIMESTAMP,
    fecha_envio TEXT
);

  CREATE TABLE IF NOT EXISTS notificaciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comerciante_id INTEGER NOT NULL,
    tipo TEXT NOT NULL,
    canal TEXT NOT NULL CHECK (canal IN ('whatsapp', 'sms', 'email')),
    mensaje TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'pendiente',
    fecha_creacion TEXT DEFAULT CURRENT_TIMESTAMP,
    fecha_envio TEXT
  );
`;

function rowsToObjects(resultSet) {
  if (!resultSet || !resultSet[0]) return [];

  const columns = resultSet[0].columns;
  return resultSet[0].values.map((row) => {
    const item = {};
    columns.forEach((column, index) => {
      item[column] = row[index];
    });
    return item;
  });
}

function ensureColumn(db, tableName, columnName, definition) {
  const info = db.exec(`PRAGMA table_info(${tableName})`);
  const columns = info[0]?.values?.map((row) => row[1]) ?? [];
  if (!columns.includes(columnName)) {
    db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function prepareDb(db) {
  db.run(schema);
  ensureColumn(db, 'cobros', 'codigo_operacion', 'TEXT');
  ensureColumn(db, 'cobros', 'hash_transaccion', 'TEXT');
  ensureColumn(db, 'cobros', 'observaciones', 'TEXT');
  ensureColumn(db, 'deudas', 'fecha_vencimiento', 'TEXT');
  ensureColumn(db, 'tarifas', 'version', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'comerciantes', 'estado_empadronamiento', "TEXT NOT NULL DEFAULT 'REGULARIZADO'");
  ensureAttendanceSessionSchema(db);
  ensureColumn(db, 'puestos', 'latitud', 'REAL');
  ensureColumn(db, 'puestos', 'longitud', 'REAL');
  ensureColumn(db, 'puestos', 'codigo_puesto', 'TEXT');
  ensureColumn(db, 'auditoria', 'usuario_rol', 'TEXT NOT NULL DEFAULT "anonimo"');
  ensureColumn(db, 'auditoria', 'rol_usuario', 'TEXT');
  ensureColumn(db, 'auditoria', 'metodo_http', 'TEXT');
  ensureColumn(db, 'auditoria', 'ip_origen', 'TEXT');
  ensureColumn(db, 'auditoria', 'ruta_endpoint', 'TEXT');
  ensureColumn(db, 'auditoria', 'recurso_id', 'TEXT');
  ensureColumn(db, 'auditoria', 'payload_previo', 'TEXT');
  ensureColumn(db, 'auditoria', 'payload_nuevo', 'TEXT');
  initializeComerciantePreferencias(db);
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_cobros_hash_transaccion ON cobros(hash_transaccion)');
  db.run(`CREATE TRIGGER IF NOT EXISTS auditoria_block_update BEFORE UPDATE ON auditoria BEGIN SELECT RAISE(ABORT, 'No se permite modificar registros de auditoría'); END;`);
  db.run(`CREATE TRIGGER IF NOT EXISTS auditoria_block_delete BEFORE DELETE ON auditoria BEGIN SELECT RAISE(ABORT, 'No se permite eliminar registros de auditoría'); END;`);

  db.run(`
    INSERT OR IGNORE INTO usuarios (id, nombre, email, password_hash, rol, estado)
    VALUES
      (1, 'Administrador', 'admin@salcedo.gob.pe', 'admin123', 'super_admin', 1),
      (2, 'Cobrador Principal', 'cobrador@salcedo.gob.pe', 'cobro123', 'cobrador', 1),
      (3, 'Auditor Municipal', 'auditor@salcedo.gob.pe', 'audit123', 'auditor', 1),
      (4, 'Comerciante Demo', 'comerciante@salcedo.gob.pe', 'comercio123', 'comerciante', 1)
  `);

  // Crear índices para mejorar el rendimiento de consultas frecuentes
  db.run('CREATE INDEX IF NOT EXISTS idx_cobros_fecha_cobro ON cobros(fecha_cobro)');
  db.run('CREATE INDEX IF NOT EXISTS idx_deudas_estado ON deudas(estado)');
  db.run('CREATE INDEX IF NOT EXISTS idx_comerciantes_estado ON comerciantes(estado)');
  db.run('CREATE INDEX IF NOT EXISTS idx_cobros_comerciante_id ON cobros(comerciante_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_cobros_cobrador_id ON cobros(cobrador_id)');

  const defaultRubros = [
    ['comida', 'Comida y venta de alimentos'],
    ['ropa', 'Venta de ropa y textiles'],
    ['zapatillas', 'Calzado y zapatillas'],
    ['otros', 'Otros rubros']
  ];

  for (const [nombre, descripcion] of defaultRubros) {
    db.run('INSERT INTO rubros (nombre, descripcion) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM rubros WHERE nombre = ?)', [nombre, descripcion, nombre]);
  }

  const defaultZonas = [
    ['Mercado Central', 'Zona central del mercado'],
    ['Parque Principal', 'Zona comercial del parque'],
    ['Zona Norte', 'Sector norte del centro poblado']
  ];

  for (const [nombre, descripcion] of defaultZonas) {
    db.run('INSERT INTO zonas (nombre, descripcion) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM zonas WHERE nombre = ?)', [nombre, descripcion, nombre]);
  }

  const defaultCalles = [
    ['Mercado Central', 'Jr. Lima'],
    ['Mercado Central', 'Jr. Puno'],
    ['Parque Principal', 'Av. Floral'],
    ['Zona Norte', 'Jr. Tacna']
  ];

  for (const [zonaNombre, nombre] of defaultCalles) {
    const zonaId = Number(db.exec('SELECT id FROM zonas WHERE LOWER(nombre) = LOWER(?) ORDER BY id LIMIT 1', [zonaNombre])[0]?.values?.[0]?.[0] || 0);
    if (!zonaId) continue;
    db.run('INSERT INTO calles (zona_id, nombre, descripcion, estado, orden) SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM calles WHERE zona_id = ? AND LOWER(nombre) = LOWER(?))', [zonaId, nombre, `Calle principal de ${zonaNombre}`, 'activo', 1, zonaId, nombre]);
  }

  db.run(`
    INSERT OR IGNORE INTO comerciantes (id, dni_ruc, nombre, rubro_id, zona_id, categoria, tipo_comerciante, estado, usuario_creador)
    VALUES (1, '20123456780', 'Comerciante Demo', 1, 1, 'permanente', 'permanente', 'activo', 1)
  `);

  db.run(`
    INSERT OR IGNORE INTO puestos (id, comerciante_id, zona_id, direccion, metros_cuadrados, estado)
    VALUES (1, 1, 1, 'Mercado Central - Local 1', 12, 'ocupado')
  `);
  db.run(`UPDATE puestos SET latitud = COALESCE(latitud, -15.8997), longitud = COALESCE(longitud, -70.5881) WHERE id = 1`);

  const defaultTarifas = [
    [1, 'fija', 18, 0, 'diaria', '2026-01-01', null],
    [2, 'fija', 14, 0, 'diaria', '2026-01-01', null],
    [3, 'fija', 40, 0, 'semanal', '2026-01-01', null],
    [4, 'fija', 90, 0, 'mensual', '2026-01-01', null]
  ];

  for (const [rubroId, tipoTarifa, montoFijo, montoVariable, unidadMedida, vigenciaInicio, vigenciaFin] of defaultTarifas) {
    db.run(
      `INSERT INTO tarifas (rubro_id, tipo_tarifa, monto_fijo, monto_variable, unidad_medida, vigencia_inicio, vigencia_fin)
       SELECT ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS
       (SELECT 1 FROM tarifas WHERE rubro_id = ? AND tipo_tarifa = ? AND monto_fijo = ? AND unidad_medida = ? AND vigencia_inicio = ?)`,
      [rubroId, tipoTarifa, montoFijo, montoVariable, unidadMedida, vigenciaInicio, vigenciaFin, rubroId, tipoTarifa, montoFijo, unidadMedida, vigenciaInicio]
    );
  }

  db.run('DELETE FROM zonas WHERE id NOT IN (SELECT MIN(id) FROM zonas GROUP BY nombre) AND id NOT IN (SELECT zona_id FROM comerciantes UNION SELECT zona_id FROM puestos)');
  db.run('DELETE FROM rubros WHERE id NOT IN (SELECT MIN(id) FROM rubros GROUP BY nombre) AND id NOT IN (SELECT rubro_id FROM comerciantes UNION SELECT rubro_id FROM tarifas)');
  db.run('DELETE FROM tarifas WHERE id NOT IN (SELECT MIN(id) FROM tarifas GROUP BY rubro_id, tipo_tarifa, monto_fijo, monto_variable, unidad_medida, vigencia_inicio, COALESCE(vigencia_fin, "")) AND id NOT IN (SELECT tarifa_id FROM cobros UNION SELECT tarifa_id FROM deudas)');
}

function ensureAttendanceSessionSchema(db) {
  const columns = db.exec('PRAGMA table_info(asistencias_feriales)')[0]?.values?.map((row) => row[1]) ?? [];
  if (!columns.length || columns.includes('sesion')) return;

  db.run('ALTER TABLE asistencias_feriales RENAME TO asistencias_feriales_legacy');
  db.run(`CREATE TABLE asistencias_feriales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    puesto_id INTEGER NOT NULL,
    fecha TEXT NOT NULL,
    sesion TEXT NOT NULL DEFAULT '',
    marca TEXT NOT NULL,
    fuente TEXT NOT NULL,
    fecha_registro TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (puesto_id, fecha, sesion)
  )`);
  db.run(`INSERT INTO asistencias_feriales (id, puesto_id, fecha, sesion, marca, fuente, fecha_registro)
    SELECT id, puesto_id, fecha, '', marca, fuente, fecha_registro FROM asistencias_feriales_legacy`);
  db.run('DROP TABLE asistencias_feriales_legacy');
}

function shouldResetDatabaseForTests() {
  return process.env.NODE_ENV === 'test'
    || process.argv.includes('--test')
    || process.argv.some((arg) => /(?:^|[\\/])tests?[\\/]|\.test\.[cm]?[jt]s$/.test(arg));
}

export async function initializeDatabase() {
  const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
  const SQL = await initSqlJs({
    locateFile: (file) => {
      if (file === 'sql-wasm.wasm') return wasmPath;
      return file;
    }
  });

  if (shouldResetDatabaseForTests() && existsSync(databasePath)) {
    unlinkSync(databasePath);
  }

  const db = existsSync(databasePath)
    ? new SQL.Database(new Uint8Array(readFileSync(databasePath)))
    : new SQL.Database();
  prepareDb(db);
  persistDatabase(db);
  return db;
}

export function persistDatabase(db) {
  mkdirSync(dirname(databasePath), { recursive: true });
  writeFileSync(databasePath, Buffer.from(db.export()));
}

export function getDbStats(db) {
  const usuarios = db.exec('SELECT COUNT(*) AS total FROM usuarios');
  const zonas = db.exec('SELECT COUNT(*) AS total FROM zonas');
  const rubros = db.exec('SELECT COUNT(*) AS total FROM rubros');
  const comerciantes = db.exec('SELECT COUNT(*) AS total FROM comerciantes');
  const tarifas = db.exec('SELECT COUNT(*) AS total FROM tarifas');
  const cobros = db.exec('SELECT COUNT(*) AS total FROM cobros');
  const auditoria = db.exec('SELECT COUNT(*) AS total FROM auditoria');

  return {
    totalUsuarios: Number(usuarios[0]?.values?.[0]?.[0] ?? 0),
    totalZonas: Number(zonas[0]?.values?.[0]?.[0] ?? 0),
    totalRubros: Number(rubros[0]?.values?.[0]?.[0] ?? 0),
    totalComerciantes: Number(comerciantes[0]?.values?.[0]?.[0] ?? 0),
    totalTarifas: Number(tarifas[0]?.values?.[0]?.[0] ?? 0),
    totalCobros: Number(cobros[0]?.values?.[0]?.[0] ?? 0),
    totalEventosAuditoria: Number(auditoria[0]?.values?.[0]?.[0] ?? 0)
  };
}

export function recordAudit(db, {
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
  const normalizedPrevio = payloadPrevio === null || payloadPrevio === undefined
    ? null
    : typeof payloadPrevio === 'string'
      ? payloadPrevio
      : JSON.stringify(payloadPrevio);

  const normalizedNuevo = payloadNuevo === null || payloadNuevo === undefined
    ? null
    : typeof payloadNuevo === 'string'
      ? payloadNuevo
      : JSON.stringify(payloadNuevo);

  db.run(
    `INSERT INTO auditoria (
      usuario_id, usuario_rol, rol_usuario, entidad, accion, detalle, metodo_http, ip_origen, ruta_endpoint, recurso_id, payload_previo, payload_nuevo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      Number(usuarioId),
      String(usuarioRol || 'anonimo'),
      rolUsuario ? String(rolUsuario) : (usuarioRol || 'anonimo'),
      entidad,
      accion,
      detalle,
      metodoHttp,
      ipOrigen,
      rutaEndpoint === undefined || rutaEndpoint === null ? null : String(rutaEndpoint),
      recursoId === undefined || recursoId === null ? null : String(recursoId),
      normalizedPrevio,
      normalizedNuevo
    ]
  );
}

export function getAuditTrail(db, options = {}) {
  const comercianteId = Number(options.comerciante_id || 0);
  const entidad = String(options.entidad || '').trim();
  const conditions = [];
  const parameters = [];
  if (comercianteId) {
    conditions.push("(a.entidad = 'comerciantes' AND a.detalle LIKE ?)");
    parameters.push(`%${comercianteId}%`);
  }
  if (entidad) {
    conditions.push('a.entidad = ?');
    parameters.push(entidad);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = db.exec(`
    SELECT a.id, a.usuario_id, u.nombre AS usuario, a.entidad, a.accion, a.detalle,
           a.metodo_http, a.ip_origen, a.ruta_endpoint, a.usuario_rol, a.rol_usuario, a.fecha
    FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
    ${where} ORDER BY a.id DESC LIMIT 200
  `, parameters);
  return rowsToObjects(result);
}

export function getOperationalDashboard(db, options = {}) {
  const period = String(options.periodo || new Date().toISOString().slice(0, 7));

  // Optimización: obtener múltiples métricas en una sola consulta donde sea posible
  const cobrosResult = db.exec(`SELECT COALESCE(SUM(monto), 0) AS total, COUNT(*) AS cantidad FROM cobros WHERE fecha_cobro LIKE ?`, [`${period}%`]);
  const pendingResult = db.exec(`SELECT COALESCE(SUM(saldo), 0) AS saldo FROM deudas WHERE estado <> 'pagado'`);
  const activosResult = db.exec("SELECT COUNT(*) FROM comerciantes WHERE estado = 'activo'");

  // Optimización: pre-compilar el patrón de fecha para reutilizarlo
  const periodPattern = `${period}%`;

  const byZone = db.exec(`
    SELECT z.nombre AS zona, COUNT(DISTINCT c.id) AS comerciantes, COALESCE(SUM(co.monto), 0) AS recaudado
    FROM zonas z
    LEFT JOIN comerciantes c ON c.zona_id = z.id
    LEFT JOIN cobros co ON co.comerciante_id = c.id AND co.fecha_cobro LIKE ?
    GROUP BY z.id
    ORDER BY recaudado DESC
  `, [periodPattern]);

  const byCategory = db.exec(`
    SELECT r.nombre AS rubro, COALESCE(SUM(co.monto), 0) AS recaudado, COUNT(co.id) AS pagos
    FROM rubros r
    LEFT JOIN comerciantes c ON c.rubro_id = r.id
    LEFT JOIN cobros co ON co.comerciante_id = c.id AND co.fecha_cobro LIKE ?
    GROUP BY r.id
    ORDER BY recaudado DESC
  `, [periodPattern]);

  const byCollector = db.exec(`
    SELECT COALESCE(u.nombre, 'Sin asignar') AS cobrador, COALESCE(SUM(co.monto), 0) AS recaudado, COUNT(co.id) AS pagos
    FROM cobros co
    LEFT JOIN usuarios u ON u.id = co.cobrador_id
    WHERE co.fecha_cobro LIKE ?
    GROUP BY co.cobrador_id
    ORDER BY recaudado DESC
  `, [periodPattern]);

  return {
    periodo: period,
    recaudacion: Number(cobrosResult[0]?.values?.[0]?.[0] ?? 0),
    pagos: Number(cobrosResult[0]?.values?.[0]?.[1] ?? 0),
    deudaPendiente: Number(pendingResult[0]?.values?.[0]?.[0] ?? 0),
    comerciantesActivos: Number(activosResult[0]?.values?.[0]?.[0] ?? 0),
    porZona: rowsToObjects(byZone),
    porRubro: rowsToObjects(byCategory),
    porCobrador: rowsToObjects(byCollector)
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function generateForecastProjection(db, options = {}) {
  const period = String(options.period || new Date().toISOString().slice(0, 7));
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

  // Optimización: obtener todos los datos necesarios en menos consultas
  const zoneMap = new Map();
  const rubroMap = new Map();

  // Pre-compilar patrones de fecha para reutilizar
  const monthPatterns = monthSequence.map(m => `${m}%`);

  // Obtener datos históricos de todas las zonas y rubros en una consulta por mes
  for (let i = 0; i < monthSequence.length; i++) {
    const monthValue = monthSequence[i];
    const monthPattern = monthPatterns[i];

    // Obtener recaudado por zona para este mes
    const zoneResults = db.exec(`
      SELECT c.zona_id, z.nombre AS zona, COALESCE(SUM(co.monto), 0) AS recaudado
      FROM comerciantes c
      JOIN zonas z ON z.id = c.zona_id
      LEFT JOIN cobros co ON co.comerciante_id = c.id AND co.fecha_cobro LIKE ?
      GROUP BY c.zona_id
    `, [monthPattern]);

    for (const row of rowsToObjects(zoneResults)) {
      const current = zoneMap.get(Number(row.zona_id)) || {
        zona_id: Number(row.zona_id),
        zona: row.zona || 'Sin zona',
        recaudado: 0
      };
      current.recaudado += Number(row.recaudado || 0);
      zoneMap.set(Number(row.zona_id), current);
    }

    // Obtener recaudado por rubro para este mes
    const rubroResults = db.exec(`
      SELECT c.rubro_id, r.nombre AS rubro, COALESCE(SUM(co.monto), 0) AS recaudado
      FROM comerciantes c
      JOIN rubros r ON r.id = c.rubro_id
      LEFT JOIN cobros co ON co.comerciante_id = c.id AND co.fecha_cobro LIKE ?
      GROUP BY c.rubro_id
    `, [monthPattern]);

    for (const row of rowsToObjects(rubroResults)) {
      const current = rubroMap.get(Number(row.rubro_id)) || {
        rubro_id: Number(row.rubro_id),
        rubro: row.rubro || 'Sin rubro',
        recaudado: 0
      };
      current.recaudado += Number(row.recaudado || 0);
      rubroMap.set(Number(row.rubro_id), current);
    }
  }

  // Obtener datos de comerciantes y tarifas baseline (una sola consulta)
  const merchantBaseline = db.exec(`
    SELECT c.zona_id, c.rubro_id, COALESCE(AVG(t.monto_fijo), 18) AS tarifa_promedio, COUNT(c.id) AS total_comerciantes
    FROM comerciantes c
    LEFT JOIN tarifas t ON t.rubro_id = c.rubro_id AND t.estado = 1
    WHERE c.estado = 'activo'
    GROUP BY c.zona_id, c.rubro_id
  `);

  for (const row of rowsToObjects(merchantBaseline)) {
    const zoneId = Number(row.zona_id || 0);
    const rubroId = Number(row.rubro_id || 0);
    const merchantCount = Number(row.total_comerciantes || 0);
    const tarifaPromedio = Number(row.tarifa_promedio || 0);

    if (zoneId) {
      const current = zoneMap.get(zoneId) || {
        zona_id: zoneId,
        zona: 'Sin zona',
        recaudado: 0
      };
      current.recaudado += merchantCount * tarifaPromedio;
      zoneMap.set(zoneId, current);
    }

    if (rubroId) {
      const current = rubroMap.get(rubroId) || {
        rubro_id: rubroId,
        rubro: 'Sin rubro',
        recaudado: 0
      };
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

  return {
    periodo: period,
    horizonte_dias: horizonDays,
    totalHistorico: Number(totalHistorico.toFixed(2)),
    totalProyectado: Number(totalProyectado.toFixed(2)),
    promedioDiario: Number((totalProyectado / Math.max(horizonDays, 1)).toFixed(2)),
    porZona: porZona.sort((a, b) => Number(b.proyectado || 0) - Number(a.proyectado || 0)),
    porRubro: porRubro.sort((a, b) => Number(b.proyectado || 0) - Number(a.proyectado || 0))
  };
}

export function scoreMorosidadComerciante(db, comercianteId) {
  const merchant = getComerciantes(db, { includeInactive: true, limit: 1000 }).find((item) => item.id === Number(comercianteId));
  if (!merchant) throw new Error('Comerciante no encontrado');

  const deudaQuery = db.exec(`
    SELECT COALESCE(SUM(saldo), 0) AS deuda, MAX(fecha_vencimiento) AS ultima_vencimiento
    FROM deudas
    WHERE comerciante_id = ? AND estado <> 'pagado'
  `, [Number(comercianteId)]);
  const deudaTotal = Number(deudaQuery[0]?.values?.[0]?.[0] ?? 0);

  const pagoQuery = db.exec(`
    SELECT COUNT(*) AS total_pagos, COALESCE(SUM(monto), 0) AS monto_pagado, MAX(fecha_cobro) AS ultima_fecha
    FROM cobros
    WHERE comerciante_id = ?
  `, [Number(comercianteId)]);

  const totalPagos = Number(pagoQuery[0]?.values?.[0]?.[0] ?? 0);
  const montoPagado = Number(pagoQuery[0]?.values?.[0]?.[1] ?? 0);
  const ultimaFecha = pagoQuery[0]?.values?.[0]?.[2] || null;
  const ultimaFechaDate = ultimaFecha ? new Date(ultimaFecha) : null;
  const diasSinPago = ultimaFechaDate ? Math.max(0, (Date.now() - ultimaFechaDate.getTime()) / 86400000) : 90;
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

  const existing = db.exec('SELECT id FROM riesgo_morosidad WHERE comerciante_id = ? ORDER BY id DESC LIMIT 1', [merchant.id]);
  const now = new Date().toISOString();

  if (existing[0]?.values?.length) {
    db.run(
      'UPDATE riesgo_morosidad SET score_riesgo = ?, nivel_riesgo = ?, motivo_principal = ?, fecha_calculo = ? WHERE comerciante_id = ?',
      [score, nivel, motivo, now, merchant.id]
    );
  } else {
    db.run(
      'INSERT INTO riesgo_morosidad (comerciante_id, score_riesgo, nivel_riesgo, motivo_principal, fecha_calculo, estado_alerta) VALUES (?, ?, ?, ?, ?, "activo")',
      [merchant.id, score, nivel, motivo, now]
    );
  }

  const persistedRisk = db.exec('SELECT id FROM riesgo_morosidad WHERE comerciante_id = ? ORDER BY id DESC LIMIT 1', [merchant.id]);
  const riesgoId = Number(persistedRisk[0]?.values?.[0]?.[0] ?? 0);

  if (riesgoId && ['alto', 'critico'].includes(nivel)) {
    const alert = db.exec('SELECT id FROM alertas_morosidad WHERE comerciante_id = ? AND riesgo_id = ? LIMIT 1', [merchant.id, riesgoId]);
    if (!alert[0]?.values?.length) {
      db.run(
        'INSERT INTO alertas_morosidad (comerciante_id, riesgo_id, tipo_alerta, mensaje, enviado, fecha_envio) VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP)',
        [merchant.id, riesgoId, 'morosidad', `Se detectó riesgo ${nivel} para ${merchant.nombre}. Prioridad de visita de cobranza.`]
      );
    }
  }

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

export function getRiskDashboard(db, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit || 5), 1), 20);
  const currentRows = db.exec(`
    SELECT rm.comerciante_id, c.nombre, c.dni_ruc, rm.score_riesgo, rm.nivel_riesgo, rm.motivo_principal, rm.fecha_calculo
    FROM riesgo_morosidad rm
    JOIN comerciantes c ON c.id = rm.comerciante_id
    ORDER BY rm.score_riesgo DESC, rm.id DESC
    LIMIT ?
  `, [limit]);

  const records = rowsToObjects(currentRows);
  if (records.length) {
    return {
      summary: {
        total: records.length,
        bajo: records.filter((item) => item.nivel_riesgo === 'bajo').length,
        medio: records.filter((item) => item.nivel_riesgo === 'medio').length,
        alto: records.filter((item) => item.nivel_riesgo === 'alto').length,
        critico: records.filter((item) => item.nivel_riesgo === 'critico').length
      },
      records: records.map((item) => ({
        ...item,
        score_riesgo: Number(item.score_riesgo || 0),
        nivel_riesgo: String(item.nivel_riesgo || 'bajo')
      }))
    };
  }

  const merchants = getComerciantes(db, { includeInactive: true, limit: 1000 });
  const computed = merchants.slice(0, limit).map((merchant) => scoreMorosidadComerciante(db, merchant.id));
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

export function getReportRows(db, options = {}) {
  const conditions = [];
  const parameters = [];
  const period = String(options.periodo || '').trim();
  if (period) { conditions.push('co.fecha_cobro LIKE ?'); parameters.push(`${period}%`); }
  if (options.zona_id) { conditions.push('c.zona_id = ?'); parameters.push(Number(options.zona_id)); }
  if (options.rubro_id) { conditions.push('c.rubro_id = ?'); parameters.push(Number(options.rubro_id)); }
  if (options.cobrador_id) { conditions.push('co.cobrador_id = ?'); parameters.push(Number(options.cobrador_id)); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = db.exec(`
    SELECT co.id, co.fecha_cobro AS fecha, 'CM-' || printf('%03d', c.id) AS comerciante_codigo,
      c.nombre AS comerciante, r.nombre AS rubro, z.nombre AS zona, u.nombre AS cobrador,
      co.monto, co.metodo_pago, co.estado, cp.numero_correlativo AS comprobante
    FROM cobros co JOIN comerciantes c ON c.id = co.comerciante_id
      JOIN rubros r ON r.id = c.rubro_id JOIN zonas z ON z.id = c.zona_id
      LEFT JOIN usuarios u ON u.id = co.cobrador_id LEFT JOIN comprobantes cp ON cp.id = co.comprobante_id
    ${where} ORDER BY co.fecha_cobro DESC
  `, parameters);
  return rowsToObjects(result);
}

export function buildReportCsv(db, options = {}) {
  const data = getReportRows(db, options);
  const headers = ['fecha', 'comerciante_codigo', 'comerciante', 'rubro', 'zona', 'cobrador', 'monto', 'metodo_pago', 'estado', 'comprobante'];
  const escapeValue = (value) => {
    const normalized = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(normalized) ? `"${normalized.replace(/"/g, '""')}"` : normalized;
  };

  const lines = [headers.join(',')];
  for (const row of data) {
    lines.push(headers.map((header) => escapeValue(row[header])).join(','));
  }

  if (!data.length) {
    return `${headers.join(',')}\n`;
  }

  return lines.join('\n');
}

export function getRubros(db) {
  const result = db.exec(`
    SELECT id, nombre, descripcion
    FROM rubros
    WHERE estado = 1
    ORDER BY nombre ASC
  `);

  return rowsToObjects(result);
}

export function getZonas(db) {
  const result = db.exec(`
    SELECT z.id, z.nombre, z.descripcion,
           COUNT(c.id) AS calles_count
    FROM zonas z
    LEFT JOIN calles c ON c.zona_id = z.id
    GROUP BY z.id, z.nombre, z.descripcion
    ORDER BY z.nombre ASC
  `);

  return rowsToObjects(result);
}

export function getCalles(db, options = {}) {
  const zonaId = Number(options.zona_id || 0);
  const search = String(options.search || '').trim();
  const conditions = [];
  const parameters = [];

  if (zonaId) {
    conditions.push('c.zona_id = ?');
    parameters.push(zonaId);
  }

  if (search) {
    conditions.push('(c.nombre LIKE ? OR c.descripcion LIKE ? OR z.nombre LIKE ?)');
    parameters.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = db.exec(`
    SELECT c.id, c.zona_id, z.nombre AS zona, c.nombre, c.descripcion, c.estado, c.orden, c.fecha_creacion
    FROM calles c
    LEFT JOIN zonas z ON z.id = c.zona_id
    ${where}
    ORDER BY z.nombre ASC, c.orden ASC, c.nombre ASC
  `, parameters);

  return rowsToObjects(result);
}

export function insertZona(db, payload = {}) {
  const nombre = String(payload.nombre || '').trim();
  if (!nombre) {
    throw new Error('El nombre de la zona es obligatorio');
  }

  const existing = db.exec('SELECT id FROM zonas WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(?)) LIMIT 1', [nombre]);
  if (existing[0]?.values?.length) {
    throw new Error(`La zona "${nombre}" ya existe`);
  }

  db.run('INSERT INTO zonas (nombre, descripcion) VALUES (?, ?)', [nombre, String(payload.descripcion || '').trim()]);

  const inserted = db.exec('SELECT id, nombre, descripcion FROM zonas WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(?)) ORDER BY id DESC LIMIT 1', [nombre]);
  return rowsToObjects(inserted)[0];
}

export function updateZona(db, id, payload = {}) {
  const zoneId = Number(id || 0);
  if (!zoneId) {
    throw new Error('La zona no es válida');
  }

  const existing = db.exec('SELECT id, nombre, descripcion FROM zonas WHERE id = ?', [zoneId]);
  if (!existing[0]?.values?.length) {
    throw new Error('Zona no encontrada');
  }

  const nombre = String(payload.nombre !== undefined ? payload.nombre : existing[0].values[0][1] || '').trim();
  const descripcion = String(payload.descripcion !== undefined ? payload.descripcion : existing[0].values[0][2] || '').trim();

  if (!nombre) {
    throw new Error('El nombre de la zona es obligatorio');
  }

  const duplicate = db.exec('SELECT id FROM zonas WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(?)) AND id <> ? LIMIT 1', [nombre, zoneId]);
  if (duplicate[0]?.values?.length) {
    throw new Error(`La zona "${nombre}" ya existe`);
  }

  db.run('UPDATE zonas SET nombre = ?, descripcion = ? WHERE id = ?', [nombre, descripcion, zoneId]);
  const updated = db.exec('SELECT id, nombre, descripcion FROM zonas WHERE id = ?', [zoneId]);
  return rowsToObjects(updated)[0];
}

export function deleteZona(db, id) {
  const zoneId = Number(id || 0);
  if (!zoneId) {
    throw new Error('La zona no es válida');
  }

  const inUse = db.exec('SELECT COUNT(*) AS total FROM comerciantes WHERE zona_id = ? UNION ALL SELECT COUNT(*) AS total FROM puestos WHERE zona_id = ?', [zoneId, zoneId]);
  const totalInUse = Number(inUse[0]?.values?.[0]?.[0] ?? 0) + Number(inUse[1]?.values?.[0]?.[0] ?? 0);
  if (totalInUse > 0) {
    throw new Error('No se puede eliminar la zona porque tiene comerciantes o puestos asociados');
  }

  db.run('DELETE FROM calles WHERE zona_id = ?', [zoneId]);
  db.run('DELETE FROM zonas WHERE id = ?', [zoneId]);
  return { id: zoneId, deleted: true };
}

export function insertCalle(db, payload = {}) {
  const zonaId = Number(payload.zona_id || 0);
  const nombre = String(payload.nombre || '').trim();
  if (!zonaId) {
    throw new Error('La zona es obligatoria');
  }

  const zoneExists = db.exec('SELECT id FROM zonas WHERE id = ?', [zonaId]);
  if (!zoneExists[0]?.values?.length) {
    throw new Error('La zona seleccionada no existe');
  }

  if (!nombre) {
    throw new Error('El nombre de la calle es obligatorio');
  }

  const duplicate = db.exec('SELECT id FROM calles WHERE zona_id = ? AND LOWER(TRIM(nombre)) = LOWER(TRIM(?)) LIMIT 1', [zonaId, nombre]);
  if (duplicate[0]?.values?.length) {
    throw new Error(`La calle "${nombre}" ya existe en esta zona`);
  }

  const orden = Number(payload.orden || 1);
  const estado = ['activo', 'inactivo'].includes(String(payload.estado || 'activo')) ? String(payload.estado || 'activo') : 'activo';
  db.run('INSERT INTO calles (zona_id, nombre, descripcion, estado, orden) VALUES (?, ?, ?, ?, ?)', [zonaId, nombre, String(payload.descripcion || '').trim(), estado, orden]);

  const inserted = db.exec('SELECT id, zona_id, nombre, descripcion, estado, orden, fecha_creacion FROM calles WHERE zona_id = ? AND LOWER(TRIM(nombre)) = LOWER(TRIM(?)) ORDER BY id DESC LIMIT 1', [zonaId, nombre]);
  return rowsToObjects(inserted)[0];
}

export function updateCalle(db, id, payload = {}) {
  const calleId = Number(id || 0);
  if (!calleId) {
    throw new Error('La calle no es válida');
  }

  const current = db.exec('SELECT id, zona_id, nombre, descripcion, estado, orden FROM calles WHERE id = ?', [calleId]);
  if (!current[0]?.values?.length) {
    throw new Error('Calle no encontrada');
  }

  const zonaId = Number(payload.zona_id ?? current[0].values[0][1]);
  const nombre = String(payload.nombre !== undefined ? payload.nombre : current[0].values[0][2] || '').trim();
  const descripcion = String(payload.descripcion !== undefined ? payload.descripcion : current[0].values[0][3] || '').trim();
  const estadoValue = payload.estado !== undefined ? payload.estado : current[0].values[0][4] || 'activo';
  const estado = ['activo', 'inactivo'].includes(String(estadoValue)) ? String(estadoValue) : 'activo';
  const orden = Number(payload.orden !== undefined ? payload.orden : current[0].values[0][5] ?? 1);

  if (!zonaId || !nombre) {
    throw new Error('La zona y el nombre de la calle son obligatorios');
  }

  const duplicate = db.exec('SELECT id FROM calles WHERE zona_id = ? AND LOWER(TRIM(nombre)) = LOWER(TRIM(?)) AND id <> ? LIMIT 1', [zonaId, nombre, calleId]);
  if (duplicate[0]?.values?.length) {
    throw new Error(`La calle "${nombre}" ya existe en esta zona`);
  }

  db.run('UPDATE calles SET zona_id = ?, nombre = ?, descripcion = ?, estado = ?, orden = ? WHERE id = ?', [zonaId, nombre, descripcion, estado, orden, calleId]);
  const updated = db.exec('SELECT c.id, c.zona_id, z.nombre AS zona, c.nombre, c.descripcion, c.estado, c.orden, c.fecha_creacion FROM calles c LEFT JOIN zonas z ON z.id = c.zona_id WHERE c.id = ?', [calleId]);
  return rowsToObjects(updated)[0];
}

export function deleteCalle(db, id) {
  const calleId = Number(id || 0);
  if (!calleId) {
    throw new Error('La calle no es válida');
  }

  db.run('DELETE FROM calles WHERE id = ?', [calleId]);
  return { id: calleId, deleted: true };
}

export function getComerciantes(db, options = {}) {
  const search = String(options.search || '').trim();
  const rubroId = Number(options.rubro_id || 0);
  const zonaId = Number(options.zona_id || 0);
  const includeInactive = options.includeInactive === true;
  const page = Math.max(Number(options.page || 1), 1);
  const limit = Math.min(Math.max(Number(options.limit || 10), 1), 100);
  const offset = (page - 1) * limit;
  const conditions = [];
  const parameters = [];

  if (!includeInactive) conditions.push("c.estado <> 'inactivo'");
  if (search) {
    conditions.push('(c.nombre LIKE ? OR c.dni_ruc LIKE ? OR CAST(c.id AS TEXT) LIKE ? OR (\'CM-\' || printf(\'%03d\', c.id)) LIKE ?)');
    parameters.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (rubroId) {
    conditions.push('c.rubro_id = ?');
    parameters.push(rubroId);
  }
  if (zonaId) {
    conditions.push('c.zona_id = ?');
    parameters.push(zonaId);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = db.exec(`
    SELECT c.id, c.dni_ruc, c.nombre, c.categoria, c.tipo_comerciante, c.estado, c.estado_empadronamiento, c.fecha_registro,
           c.rubro_id, c.zona_id, r.nombre AS rubro, z.nombre AS zona,
          'CM-' || printf('%03d', c.id) AS codigo,
          'SISREC://comerciante/' || c.id AS qr_code
    FROM comerciantes c
    JOIN rubros r ON r.id = c.rubro_id
    JOIN zonas z ON z.id = c.zona_id
    ${where}
    ORDER BY c.id DESC
    LIMIT ? OFFSET ?
  `, [...parameters, limit, offset]);

  return rowsToObjects(result);
}

export function initializeComerciantePreferencias(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS comerciante_preferencias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      comerciante_id INTEGER NOT NULL UNIQUE,
      monto_sugerido REAL NOT NULL DEFAULT 0,
      metodo_pago_preferido TEXT NOT NULL DEFAULT 'efectivo',
      ultimo_monto REAL NOT NULL DEFAULT 0,
      ultimo_metodo_pago TEXT,
      ultimo_cobro_fecha TEXT,
      total_cobros INTEGER NOT NULL DEFAULT 0,
      fecha_actualizacion TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  ensureColumn(db, 'comerciante_preferencias', 'monto_sugerido', 'REAL NOT NULL DEFAULT 0');
  ensureColumn(db, 'comerciante_preferencias', 'metodo_pago_preferido', "TEXT NOT NULL DEFAULT 'efectivo'");
  ensureColumn(db, 'comerciante_preferencias', 'ultimo_monto', 'REAL NOT NULL DEFAULT 0');
  ensureColumn(db, 'comerciante_preferencias', 'ultimo_metodo_pago', 'TEXT');
  ensureColumn(db, 'comerciante_preferencias', 'ultimo_cobro_fecha', 'TEXT');
  ensureColumn(db, 'comerciante_preferencias', 'total_cobros', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'comerciante_preferencias', 'fecha_actualizacion', 'TEXT DEFAULT CURRENT_TIMESTAMP');
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_comerciante_preferencias_comerciante_id ON comerciante_preferencias(comerciante_id)');
  return true;
}

export function getComerciantePreferencias(db, comercianteId) {
  const merchantId = Number(comercianteId || 0);
  const defaults = {
    id: null,
    comerciante_id: merchantId,
    monto_sugerido: 0,
    metodo_pago_preferido: 'efectivo',
    ultimo_monto: 0,
    ultimo_metodo_pago: null,
    ultimo_cobro_fecha: null,
    total_cobros: 0,
    fecha_actualizacion: null
  };

  if (!merchantId) return defaults;

  const result = db.exec('SELECT * FROM comerciante_preferencias WHERE comerciante_id = ? ORDER BY id DESC LIMIT 1', [merchantId]);
  const row = rowsToObjects(result)[0];
  if (!row) return defaults;

  return {
    ...defaults,
    ...row,
    comerciante_id: Number(row.comerciante_id ?? merchantId),
    monto_sugerido: Number(row.monto_sugerido ?? 0),
    ultimo_monto: Number(row.ultimo_monto ?? 0),
    total_cobros: Number(row.total_cobros ?? 0)
  };
}

export function updateComerciantePreferencias(db, comercianteId, payload = {}) {
  const merchantId = Number(comercianteId || 0);
  if (!merchantId) {
    throw new Error('Comerciante no válido');
  }

  const current = getComerciantePreferencias(db, merchantId);
  const next = {
    comerciante_id: merchantId,
    monto_sugerido: Number(payload.monto_sugerido ?? current.monto_sugerido ?? 0),
    metodo_pago_preferido: String(payload.metodo_pago_preferido ?? current.metodo_pago_preferido ?? 'efectivo').trim() || 'efectivo',
    ultimo_monto: Number(payload.ultimo_monto ?? current.ultimo_monto ?? 0),
    ultimo_metodo_pago: payload.ultimo_metodo_pago ?? current.ultimo_metodo_pago ?? null,
    ultimo_cobro_fecha: payload.ultimo_cobro_fecha ?? current.ultimo_cobro_fecha ?? null,
    total_cobros: Number(payload.total_cobros ?? current.total_cobros ?? 0),
    fecha_actualizacion: payload.fecha_actualizacion ?? new Date().toISOString()
  };

  db.run(`
    INSERT INTO comerciante_preferencias (
      comerciante_id, monto_sugerido, metodo_pago_preferido, ultimo_monto, ultimo_metodo_pago, ultimo_cobro_fecha, total_cobros, fecha_actualizacion
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(comerciante_id) DO UPDATE SET
      monto_sugerido = excluded.monto_sugerido,
      metodo_pago_preferido = excluded.metodo_pago_preferido,
      ultimo_monto = excluded.ultimo_monto,
      ultimo_metodo_pago = excluded.ultimo_metodo_pago,
      ultimo_cobro_fecha = excluded.ultimo_cobro_fecha,
      total_cobros = excluded.total_cobros,
      fecha_actualizacion = excluded.fecha_actualizacion
  `, [
    next.comerciante_id,
    next.monto_sugerido,
    next.metodo_pago_preferido,
    next.ultimo_monto,
    next.ultimo_metodo_pago,
    next.ultimo_cobro_fecha,
    next.total_cobros,
    next.fecha_actualizacion
  ]);

  return getComerciantePreferencias(db, merchantId);
}

export function countComerciantes(db, options = {}) {
  const search = String(options.search || '').trim();
  const rubroId = Number(options.rubro_id || 0);
  const zonaId = Number(options.zona_id || 0);
  const includeInactive = options.includeInactive === true;
  const conditions = [];
  const parameters = [];

  if (!includeInactive) conditions.push("estado <> 'inactivo'");
  if (search) {
    conditions.push('(nombre LIKE ? OR dni_ruc LIKE ? OR CAST(id AS TEXT) LIKE ?)');
    parameters.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (rubroId) {
    conditions.push('rubro_id = ?');
    parameters.push(rubroId);
  }
  if (zonaId) {
    conditions.push('zona_id = ?');
    parameters.push(zonaId);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = db.exec(`SELECT COUNT(*) AS total FROM comerciantes ${where}`, parameters);
  return Number(result[0]?.values?.[0]?.[0] ?? 0);
}

export function validateDocument(value) {
  const document = String(value || '').trim();
  const isDni = /^\d{8}$/.test(document);
  const isRuc = /^(10|15|17|20)\d{9}$/.test(document);

  if (!isDni && !isRuc) {
    throw new Error('DNI debe tener 8 dígitos o RUC debe tener 11 dígitos válido');
  }

  return document;
}

function ensureUniqueActiveDocument(db, dniRuc, excludeId = null) {
  const where = excludeId ? 'WHERE dni_ruc = ? AND id <> ? AND estado IN (?, ?)' : 'WHERE dni_ruc = ? AND estado IN (?, ?)';
  const params = excludeId ? [dniRuc, Number(excludeId), 'activo', 'pendiente'] : [dniRuc, 'activo', 'pendiente'];
  const result = db.exec(`SELECT id FROM comerciantes ${where}`, params);

  if (result[0]?.values?.length) {
    throw new Error('Ya existe un comerciante activo con ese DNI/RUC');
  }
}

export function insertComerciante(db, payload) {
  const dniRuc = validateDocument(payload.dni_ruc);
  const nombre = String(payload.nombre || '').trim();
  const rubroId = Number(payload.rubro_id);
  const zonaId = Number(payload.zona_id);
  const categoria = String(payload.categoria || payload.tipo_comerciante || 'permanente').trim();
  const tipoComerciante = String(payload.tipo_comerciante || payload.categoria || 'permanente').trim();
  const estado = String(payload.estado || 'activo').trim();
  const usuarioCreador = Number(payload.usuario_creador || 1);

  if (!dniRuc || !nombre || !rubroId || !zonaId) {
    throw new Error('DNI/RUC, nombre, rubro y zona son obligatorios');
  }

  if (!['eventual', 'permanente', 'ferial'].includes(tipoComerciante) || !['eventual', 'permanente', 'ferial'].includes(categoria)) {
    throw new Error('Tipo de comerciante no válido');
  }

  if (!['activo', 'inactivo', 'pendiente'].includes(estado)) {
    throw new Error('Estado de comerciante no válido');
  }

  ensureUniqueActiveDocument(db, dniRuc);

  db.run(
    `
      INSERT INTO comerciantes (dni_ruc, nombre, rubro_id, zona_id, categoria, tipo_comerciante, estado, usuario_creador)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [dniRuc, nombre, rubroId, zonaId, categoria, tipoComerciante, estado, usuarioCreador]
  );

  const lastIdResult = db.exec('SELECT last_insert_rowid() AS id');
  const id = Number(lastIdResult[0]?.values?.[0]?.[0] ?? 0);

  return {
    id,
    dni_ruc: dniRuc,
    nombre,
    rubro_id: rubroId,
    zona_id: zonaId,
    categoria,
    tipo_comerciante: tipoComerciante,
    estado,
    usuario_creador: usuarioCreador
  };
}

export function updateComerciante(db, id, payload) {
  const current = getComerciantes(db, { includeInactive: true, limit: 1000 }).find((item) => item.id === Number(id));
  if (!current) throw new Error('Comerciante no encontrado');

  const dniRuc = payload.dni_ruc === undefined ? current.dni_ruc : validateDocument(payload.dni_ruc);
  const nombre = payload.nombre === undefined ? current.nombre : String(payload.nombre).trim();
  const rubroId = payload.rubro_id === undefined ? current.rubro_id : Number(payload.rubro_id);
  const zonaId = payload.zona_id === undefined ? current.zona_id : Number(payload.zona_id);
  const categoria = payload.categoria === undefined ? (payload.tipo_comerciante === undefined ? current.categoria : String(payload.tipo_comerciante).trim()) : String(payload.categoria).trim();
  const tipoComerciante = payload.tipo_comerciante === undefined ? (payload.categoria === undefined ? current.tipo_comerciante : String(payload.categoria).trim()) : String(payload.tipo_comerciante).trim();
  const estado = payload.estado === undefined ? current.estado : String(payload.estado).trim();

  if (!nombre || !rubroId || !zonaId) throw new Error('Nombre, rubro y zona son obligatorios');
  if (!['eventual', 'permanente', 'ferial'].includes(tipoComerciante) || !['eventual', 'permanente', 'ferial'].includes(categoria)) throw new Error('Tipo de comerciante no válido');
  if (!['activo', 'inactivo', 'pendiente'].includes(estado)) throw new Error('Estado de comerciante no válido');

  ensureUniqueActiveDocument(db, dniRuc, Number(id));

  db.run(`
    UPDATE comerciantes
    SET dni_ruc = ?, nombre = ?, rubro_id = ?, zona_id = ?, categoria = ?, tipo_comerciante = ?, estado = ?
    WHERE id = ?
  `, [dniRuc, nombre, rubroId, zonaId, categoria, tipoComerciante, estado, Number(id)]);

  return getComerciantes(db, { search: String(id), includeInactive: true, limit: 1000 }).find((item) => item.id === Number(id));
}

export function deactivateComerciante(db, id) {
  const result = db.exec('SELECT id FROM comerciantes WHERE id = ?', [Number(id)]);
  if (!result[0]?.values?.length) throw new Error('Comerciante no encontrado');
  const merchantId = Number(id);
  db.run('DELETE FROM alertas_morosidad WHERE comerciante_id = ?', [merchantId]);
  db.run('DELETE FROM riesgo_morosidad WHERE comerciante_id = ?', [merchantId]);
  db.run('DELETE FROM sincronizacion_offline WHERE entidad = ? AND payload LIKE ?', ['comerciantes', `%${merchantId}%`]);
  db.run('DELETE FROM deudas WHERE comerciante_id = ?', [merchantId]);
  db.run('DELETE FROM puestos WHERE comerciante_id = ?', [merchantId]);
  db.run('DELETE FROM notificaciones WHERE comerciante_id = ?', [merchantId]);
  db.run('DELETE FROM comerciantes WHERE id = ?', [merchantId]);
  return { id: merchantId, eliminado: true };
}

export function getPuestos(db) {
  const result = db.exec(`
    SELECT p.id, 'S-' || printf('%03d', p.id) AS codigo, p.comerciante_id, c.nombre AS comerciante,
           p.zona_id, z.nombre AS zona, p.direccion, p.metros_cuadrados, p.estado,
           COALESCE(p.codigo_puesto, 'S-' || printf('%03d', p.id)) AS codigo,
           p.latitud, p.longitud,
           c.categoria, c.tipo_comerciante,
           COALESCE((SELECT d.saldo FROM deudas d WHERE d.comerciante_id = c.id ORDER BY d.id DESC LIMIT 1), 0) AS saldo_pendiente
    FROM puestos p
    JOIN comerciantes c ON c.id = p.comerciante_id
    JOIN zonas z ON z.id = p.zona_id
    ORDER BY p.id DESC
  `);
  return rowsToObjects(result);
}

export function insertPuesto(db, payload) {
  const comercianteId = Number(payload.comerciante_id);
  const zonaId = Number(payload.zona_id);
  const direccion = String(payload.direccion || '').trim();
  const metros = Number(payload.metros_cuadrados);
  const estado = String(payload.estado || 'ocupado').trim();
  const codigo = String(payload.codigo_puesto || payload.codigoPuesto || '').trim() || null;
  const latitud = Number(payload.latitud);
  const longitud = Number(payload.longitud);

  if (!comercianteId || !zonaId || !direccion || !Number.isFinite(metros) || metros <= 0) {
    throw new Error('Comerciante, zona, dirección y metros cuadrados válidos son obligatorios');
  }
  if (!['ocupado', 'disponible', 'reservado'].includes(estado)) throw new Error('Estado de puesto no válido');

  const merchant = db.exec("SELECT id FROM comerciantes WHERE id = ? AND estado <> 'inactivo'", [comercianteId]);
  if (!merchant[0]?.values?.length) throw new Error('El comerciante no existe o está inactivo');

  const duplicate = db.exec(
    `SELECT id FROM puestos WHERE zona_id = ? AND LOWER(TRIM(direccion)) = LOWER(TRIM(?)) AND comerciante_id <> ?`,
    [zonaId, direccion, comercianteId]
  );

  if (duplicate[0]?.values?.length) {
    throw new Error('El puesto físico ya está asignado a otro comerciante');
  }

  db.run(`
    INSERT INTO puestos (comerciante_id, zona_id, direccion, metros_cuadrados, estado, codigo_puesto, latitud, longitud)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [comercianteId, zonaId, direccion, metros, estado, codigo, Number.isFinite(latitud) ? latitud : null, Number.isFinite(longitud) ? longitud : null]);

  const result = db.exec('SELECT last_insert_rowid() AS id');
  return getPuestos(db).find((item) => item.id === Number(result[0]?.values?.[0]?.[0]));
}

export function updatePuesto(db, id, payload) {
  const puestoId = Number(id);
  const current = getPuestos(db).find((item) => item.id === puestoId);
  if (!current) throw new Error('Puesto no encontrado');

  const zonaId = Number(payload.zona_id ?? current.zona_id);
  const direccion = String(payload.direccion ?? current.direccion ?? '').trim();
  const metros = Number(payload.metros_cuadrados ?? current.metros_cuadrados);
  const estado = String(payload.estado ?? current.estado).trim();
  const latitud = Number(payload.latitud ?? current.latitud);
  const longitud = Number(payload.longitud ?? current.longitud);

  if (!zonaId || !direccion || !Number.isFinite(metros) || metros <= 0) {
    throw new Error('Zona, dirección y metros cuadrados válidos son obligatorios');
  }
  if (!['ocupado', 'disponible', 'reservado', 'inactivo'].includes(estado)) {
    throw new Error('Estado de puesto no válido');
  }

  db.run(`
    UPDATE puestos
    SET zona_id = ?, direccion = ?, metros_cuadrados = ?, estado = ?, latitud = ?, longitud = ?
    WHERE id = ?
  `, [zonaId, direccion, metros, estado, Number.isFinite(latitud) ? latitud : null, Number.isFinite(longitud) ? longitud : null, puestoId]);

  return getPuestos(db).find((item) => item.id === puestoId);
}

export function deactivatePuesto(db, id) {
  const puestoId = Number(id);
  const current = getPuestos(db).find((item) => item.id === puestoId);
  if (!current) throw new Error('Puesto no encontrado');

  db.run("UPDATE puestos SET estado = 'inactivo' WHERE id = ?", [puestoId]);
  return getPuestos(db).find((item) => item.id === puestoId);
}

export function getTarifas(db, options = {}) {
  const rubroId = Number(options.rubro_id || 0);
  const conditions = rubroId ? 'WHERE t.rubro_id = ?' : '';
  const parameters = rubroId ? [rubroId] : [];
  const result = db.exec(`
    SELECT t.id, t.rubro_id, r.nombre AS rubro, t.tipo_tarifa, t.monto_fijo, t.monto_variable,
           t.unidad_medida, t.vigencia_inicio, t.vigencia_fin, t.estado, t.version
    FROM tarifas t
    JOIN rubros r ON r.id = t.rubro_id
    ${conditions}
    ORDER BY t.vigencia_inicio DESC, t.id DESC
  `, parameters);
  return rowsToObjects(result);
}

function validateTariff(payload) {
  const rubroId = Number(payload.rubro_id);
  const tipoTarifa = String(payload.tipo_tarifa || 'fija').trim();
  const montoFijo = Number(payload.monto_fijo || 0);
  const montoVariable = Number(payload.monto_variable || 0);
  const unidadMedida = String(payload.unidad_medida || 'diaria').trim();
  const vigenciaInicio = String(payload.vigencia_inicio || '').trim();
  const vigenciaFin = payload.vigencia_fin ? String(payload.vigencia_fin).trim() : null;
  const version = Number(payload.version ?? 1);

  if (!rubroId || !['fija', 'variable', 'mixta'].includes(tipoTarifa)) throw new Error('Rubro y tipo de tarifa son obligatorios');
  if (!['diaria', 'semanal', 'mensual', 'metro_cuadrado'].includes(unidadMedida)) throw new Error('Unidad de medida no válida');
  if (montoFijo < 0 || montoVariable < 0 || (montoFijo === 0 && montoVariable === 0)) throw new Error('La tarifa debe tener un monto mayor que cero');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vigenciaInicio)) throw new Error('La vigencia inicial debe usar formato AAAA-MM-DD');
  if (vigenciaFin && vigenciaFin < vigenciaInicio) throw new Error('La vigencia final no puede ser anterior a la inicial');
  if (!Number.isFinite(version) || version < 1) throw new Error('La versión de la tarifa no es válida');

  return { rubroId, tipoTarifa, montoFijo, montoVariable, unidadMedida, vigenciaInicio, vigenciaFin, version };
}

export function insertTarifa(db, payload) {
  const tariff = validateTariff({ ...payload, version: payload.version ?? 1 });
  db.run(`
    INSERT INTO tarifas (rubro_id, tipo_tarifa, monto_fijo, monto_variable, unidad_medida, vigencia_inicio, vigencia_fin, estado, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
  `, [tariff.rubroId, tariff.tipoTarifa, tariff.montoFijo, tariff.montoVariable, tariff.unidadMedida, tariff.vigenciaInicio, tariff.vigenciaFin, tariff.version]);
  const result = db.exec('SELECT last_insert_rowid() AS id');
  return getTarifas(db).find((item) => item.id === Number(result[0]?.values?.[0]?.[0]));
}

export function updateTarifa(db, id, payload) {
  const current = getTarifas(db).find((item) => item.id === Number(id));
  if (!current) throw new Error('Tarifa no encontrada');

  const receivedVersion = payload.version === undefined ? current.version : Number(payload.version);
  if (!Number.isFinite(receivedVersion) || receivedVersion !== current.version) {
    throw new Error('La tarifa fue actualizada por otro usuario; recargue la versión antes de continuar');
  }

  const tariff = validateTariff({
    rubro_id: payload.rubro_id ?? current.rubro_id,
    tipo_tarifa: payload.tipo_tarifa ?? current.tipo_tarifa,
    monto_fijo: payload.monto_fijo ?? current.monto_fijo,
    monto_variable: payload.monto_variable ?? current.monto_variable,
    unidad_medida: payload.unidad_medida ?? current.unidad_medida,
    vigencia_inicio: payload.vigencia_inicio ?? current.vigencia_inicio,
    vigencia_fin: payload.vigencia_fin ?? current.vigencia_fin,
    version: current.version + 1
  });

  db.run(`
    UPDATE tarifas SET rubro_id = ?, tipo_tarifa = ?, monto_fijo = ?, monto_variable = ?, unidad_medida = ?, vigencia_inicio = ?, vigencia_fin = ?, version = ?
    WHERE id = ?
  `, [tariff.rubroId, tariff.tipoTarifa, tariff.montoFijo, tariff.montoVariable, tariff.unidadMedida, tariff.vigenciaInicio, tariff.vigenciaFin, tariff.version, Number(id)]);
  return getTarifas(db).find((item) => item.id === Number(id));
}

function periodMultiplier(periodo, unidad) {
  if (unidad === 'semanal') return 1;
  if (unidad === 'mensual') return 1;
  if (unidad === 'diaria') {
    if (/^\d{4}-\d{2}$/.test(periodo)) {
      const [year, month] = periodo.split('-').map(Number);
      return new Date(Date.UTC(year, month, 0)).getUTCDate();
    }
    return 1;
  }
  return 1;
}

export function calculateLiquidation(db, comercianteId, periodo = new Date().toISOString().slice(0, 7)) {
  const merchant = getComerciantes(db, { includeInactive: true, limit: 1000 }).find((item) => item.id === Number(comercianteId));
  if (!merchant) throw new Error('Comerciante no encontrado');

  const merchantType = String(merchant.tipo_comerciante || merchant.categoria || '').trim().toLowerCase();

  const pendingRegularization = String(merchant.estado_empadronamiento || '').toUpperCase() === 'PENDIENTE_REGULARIZACION';
  const merchantPost = getPuestos(db).find((item) => item.comerciante_id === merchant.id && item.estado !== 'disponible');
  if (pendingRegularization && (!merchantPost || merchantPost.metros_cuadrados === null || merchantPost.metros_cuadrados === undefined)) {
    return {
      comerciante: merchant,
      tarifa: null,
      periodo,
      metros_cuadrados: null,
      monto_total: 0,
      monto_pagado: 0,
      saldo: 0,
      estado: 'pendiente_regularizacion',
      vencida: false,
      no_devengo: true,
      motivo: 'pendiente_regularizacion_sin_metraje'
    };
  }

  if (merchantType === 'eventual') {
    return {
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
      motivo: 'eventual'
    };
  }

  const puesto = merchantPost || getPuestos(db).find((item) => item.comerciante_id === merchant.id && item.estado !== 'disponible');
  const isFerialSinAsistencia = merchantType === 'ferial' && (!puesto || puesto.estado === 'disponible');

  if (isFerialSinAsistencia) {
    return {
      comerciante: merchant,
      tarifa: null,
      periodo,
      metros_cuadrados: Number(puesto?.metros_cuadrados || 0),
      monto_total: 0,
      monto_pagado: 0,
      saldo: 0,
      estado: 'pagado',
      vencida: false,
      no_devengo: true,
      motivo: 'ferial_sin_asistencia'
    };
  }

  const tarifa = getTarifas(db).find((item) => item.rubro_id === merchant.rubro_id && item.vigencia_inicio <= `${periodo}-01` && (!item.vigencia_fin || item.vigencia_fin >= `${periodo}-01`));
  if (!tarifa) throw new Error('No existe una tarifa vigente para el rubro y periodo indicado');

  const metros = Number(puesto?.metros_cuadrados || 1);
  const base = Number(tarifa.monto_fijo) * periodMultiplier(periodo, tarifa.unidad_medida);
  const variable = Number(tarifa.monto_variable) * (tarifa.unidad_medida === 'metro_cuadrado' ? metros : 1) * periodMultiplier(periodo, tarifa.unidad_medida);
  const montoTotal = Number((base + variable).toFixed(2));
  const paidResult = db.exec('SELECT COALESCE(SUM(monto), 0) AS pagado FROM cobros WHERE comerciante_id = ? AND tarifa_id = ? AND fecha_cobro LIKE ?', [merchant.id, tarifa.id, `${periodo}%`]);
  const montoPagado = Number(paidResult[0]?.values?.[0]?.[0] ?? 0);
  const saldo = Number(Math.max(montoTotal - montoPagado, 0).toFixed(2));

  return { comerciante: merchant, tarifa, periodo, metros_cuadrados: metros, monto_total: montoTotal, monto_pagado: montoPagado, saldo, estado: saldo === 0 ? 'pagado' : 'pendiente', vencida: saldo > 0 && periodo < new Date().toISOString().slice(0, 7), no_devengo: false };
}

export function getCobros(db) {
  const result = db.exec(`
    SELECT co.id, co.comerciante_id, c.nombre AS comerciante, co.tarifa_id, co.cobrador_id,
           co.monto, co.concepto, co.metodo_pago, co.codigo_operacion, co.observaciones,
           co.estado, co.fecha_cobro, cp.numero_correlativo AS comprobante
    FROM cobros co
    JOIN comerciantes c ON c.id = co.comerciante_id
    LEFT JOIN comprobantes cp ON cp.id = co.comprobante_id
    ORDER BY co.id DESC
  `);
  return rowsToObjects(result);
}

export function getMerchantPortal(db, identifier) {
  const value = String(identifier || '').trim();
  const code = value.toUpperCase().replace(/^CM-/, '');
  const result = db.exec(`
    SELECT c.id, c.dni_ruc, c.nombre, c.categoria, c.tipo_comerciante, c.estado,
      c.fecha_registro, 'CM-' || printf('%03d', c.id) AS codigo, r.nombre AS rubro, z.nombre AS zona
    FROM comerciantes c JOIN rubros r ON r.id = c.rubro_id JOIN zonas z ON z.id = c.zona_id
    WHERE c.estado <> 'inactivo' AND (c.dni_ruc = ? OR c.id = ?)
    LIMIT 1
  `, [value, Number(code) || 0]);
  const merchant = rowsToObjects(result)[0];
  if (!merchant) throw new Error('DNI o código de comerciante no encontrado');
  const payments = rowsToObjects(db.exec(`
    SELECT co.id, co.fecha_cobro AS fecha, co.concepto, co.monto, co.metodo_pago, co.estado,
      cp.numero_correlativo AS comprobante
    FROM cobros co LEFT JOIN comprobantes cp ON cp.id = co.comprobante_id
    WHERE co.comerciante_id = ? ORDER BY co.fecha_cobro DESC
  `, [merchant.id]));
  const liquidation = calculateLiquidation(db, merchant.id);
  return { comerciante: merchant, pagos: payments, deuda: liquidation };
}

export function createNotification(db, payload) {
  const merchantId = Number(payload.comerciante_id);
  const tipo = String(payload.tipo || 'recordatorio_deuda');
  const canal = String(payload.canal || 'whatsapp');
  const mensaje = String(payload.mensaje || '').trim();
  if (!merchantId || !mensaje || !['whatsapp', 'sms', 'email'].includes(canal)) throw new Error('Comerciante, canal y mensaje son obligatorios');
  db.run('INSERT INTO notificaciones (comerciante_id, tipo, canal, mensaje, estado) VALUES (?, ?, ?, ?, ?)', [merchantId, tipo, canal, mensaje, 'preparada']);
  const id = db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0];
  return { id: Number(id), comerciante_id: merchantId, tipo, canal, mensaje, estado: 'preparada' };
}

export function getNotifications(db, comercianteId) {
  return rowsToObjects(db.exec('SELECT * FROM notificaciones WHERE comerciante_id = ? ORDER BY id DESC', [Number(comercianteId)]));
}

function createTransactionHash({ comercianteId, cobradorId, monto, concepto, periodo, metodoPago, salt }) {
  const seed = [comercianteId, cobradorId, monto, concepto, periodo || 'sin-periodo', metodoPago, salt || Date.now()].join('|');
  return createHash('sha256').update(seed).digest('hex');
}

export function insertCobro(db, payload) {
  const comercianteId = Number(payload.comerciante_id);
  const cobradorId = Number(payload.cobrador_id || 1);
  const monto = Number(payload.monto);
  const metodoPago = String(payload.metodo_pago || '').trim();
  const concepto = String(payload.concepto || 'Liquidación de deuda').trim();
  const codigoOperacion = String(payload.codigo_operacion || payload.idempotency_key || '').trim();
  const observaciones = String(payload.observaciones || '').trim();
  const allowedMethods = ['efectivo', 'yape', 'plin', 'pos', 'manual'];

  if (!comercianteId || !cobradorId || !Number.isFinite(monto) || monto <= 0 || !allowedMethods.includes(metodoPago)) {
    throw new Error('Comerciante, monto positivo y método de pago válido son obligatorios');
  }

  const uniqueCode = codigoOperacion || `COB-${Date.now()}-${comercianteId}-${Math.random().toString(16).slice(2, 10)}`;
  const hashTransaccion = payload.hash_transaccion || payload.hashTransaccion || createTransactionHash({
    comercianteId,
    cobradorId,
    monto,
    concepto,
    periodo: payload.periodo || new Date().toISOString().slice(0, 7),
    metodoPago,
    salt: uniqueCode
  });

  if (['yape', 'plin', 'pos'].includes(metodoPago) && !codigoOperacion) {
    throw new Error('El código de operación es obligatorio para pagos digitales');
  }

  const duplicate = db.exec('SELECT id FROM cobros WHERE (codigo_operacion = ? AND codigo_operacion IS NOT NULL) OR hash_transaccion = ?', [uniqueCode, hashTransaccion]);
  if (duplicate[0]?.values?.length) {
    throw new Error('Ya existe un cobro registrado con ese código de operación o hash transaccional');
  }

  const todayDuplicate = db.exec(
    'SELECT id FROM cobros WHERE comerciante_id = ? AND date(fecha_cobro) = date(CURRENT_TIMESTAMP) AND estado = ?',
    [comercianteId, 'confirmado']
  );
  if (todayDuplicate[0]?.values?.length) {
    throw new Error('Ya existe un cobro confirmado para este comerciante en la fecha actual');
  }

  const liquidation = calculateLiquidation(db, comercianteId, payload.periodo);
  if (monto > liquidation.saldo) throw new Error(`El monto excede el saldo pendiente de S/ ${liquidation.saldo.toFixed(2)}`);
  const next = db.exec("SELECT COUNT(*) + 1 AS next FROM comprobantes WHERE tipo = 'recibo'");
  const number = `R-${String(next[0]?.values?.[0]?.[0] ?? 1).padStart(6, '0')}`;
  db.run('INSERT INTO comprobantes (numero_correlativo, tipo) VALUES (?, ?)', [number, 'recibo']);
  const comprobante = db.exec('SELECT last_insert_rowid() AS id');
  db.run(`
    INSERT INTO cobros (comerciante_id, tarifa_id, cobrador_id, comprobante_id, monto, concepto, metodo_pago, codigo_operacion, hash_transaccion, observaciones, estado)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmado')
  `, [comercianteId, liquidation.tarifa?.id ?? 1, cobradorId, Number(comprobante[0].values[0][0]), monto, concepto, metodoPago, uniqueCode, hashTransaccion, observaciones || null]);
  const cobro = db.exec('SELECT last_insert_rowid() AS id');
  const insertedCobro = { id: Number(cobro[0].values[0][0]), comprobante: number, comerciante_id: comercianteId, monto, metodo_pago: metodoPago, codigo_operacion: uniqueCode, hash_transaccion: hashTransaccion, observaciones, estado: 'confirmado', saldo_restante: Number((liquidation.saldo - monto).toFixed(2)) };
  createNotification(db, {
    comerciante_id: comercianteId,
    tipo: 'cobro_confirmado',
    canal: 'whatsapp',
    mensaje: `Cobro confirmado para ${getComerciantes(db, { includeInactive: true, limit: 1000 }).find((item) => item.id === comercianteId)?.nombre || 'comerciante'} por S/ ${Number(monto).toFixed(2)}. Comprobante ${number}.`
  });
  return insertedCobro;
}

export function syncOfflineCobro(db, payload) {
  const normalizedPayload = {
    ...payload,
    comerciante_id: Number(payload.comerciante_id ?? payload.comercianteId ?? 0),
    cobrador_id: Number(payload.cobrador_id ?? payload.cobradorId ?? 1),
    monto: Number(payload.monto ?? 0),
    metodo_pago: String(payload.metodo_pago ?? payload.metodoPago ?? 'efectivo').trim(),
    concepto: String(payload.concepto || 'Liquidación de deuda').trim(),
    codigo_operacion: String(payload.codigo_operacion || payload.idempotency_key || payload.codigoOperacion || '').trim(),
    hash_transaccion: String(payload.hash_transaccion || payload.hashTransaccion || '').trim(),
    fecha_cobro: payload.fecha_cobro || payload.fechaCobro || new Date().toISOString(),
    periodo: payload.periodo || new Date().toISOString().slice(0, 7)
  };

  if (!normalizedPayload.comerciante_id || !normalizedPayload.cobrador_id || !Number.isFinite(normalizedPayload.monto) || normalizedPayload.monto <= 0) {
    throw new Error('Cobro offline incompleto: faltan comerciante, cobrador o monto válido');
  }

  db.run('BEGIN IMMEDIATE');

  try {
    const hashValue = normalizedPayload.hash_transaccion || createTransactionHash({
      comercianteId: normalizedPayload.comerciante_id,
      cobradorId: normalizedPayload.cobrador_id,
      monto: normalizedPayload.monto,
      concepto: normalizedPayload.concepto,
      periodo: normalizedPayload.periodo,
      metodoPago: normalizedPayload.metodo_pago,
      salt: normalizedPayload.codigo_operacion || normalizedPayload.fecha_cobro
    });

    const duplicate = db.exec('SELECT id FROM cobros WHERE hash_transaccion = ? OR (codigo_operacion = ? AND codigo_operacion IS NOT NULL)', [hashValue, normalizedPayload.codigo_operacion || hashValue]);
    if (duplicate[0]?.values?.length) {
      db.run('ROLLBACK');
      return {
        status: 'IGNORED',
        message: 'El cobro ya fue registrado anteriormente (idempotencia aplicada)',
        hash_transaccion: hashValue
      };
    }

    const result = insertCobro(db, { ...normalizedPayload, hash_transaccion: hashValue });
    db.run('COMMIT');
    return {
      status: 'SUCCESS',
      message: 'Cobro sincronizado correctamente',
      data: result
    };
  } catch (error) {
    db.run('ROLLBACK');
    const message = String(error.message || '');
    if (/ya existe un cobro registrado|hash transaccional|codigo de operación/i.test(message)) {
      return {
        status: 'IGNORED',
        message: 'El cobro ya fue registrado anteriormente (idempotencia aplicada)',
        hash_transaccion: normalizedPayload.hash_transaccion || null
      };
    }
    throw error;
  }
}
