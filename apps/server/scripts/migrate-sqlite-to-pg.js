// Uso: node scripts/migrate-sqlite-to-pg.js [ruta.sqlite]
// Aplica migrations/*.sql si el esquema no existe y copia los datos de SQLite a PostgreSQL.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import bcrypt from 'bcryptjs';
import { pool, withTransaction, closePool } from '../src/pg.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sqlitePath = path.resolve(process.argv[2] || path.join(here, '..', 'data', 'sisrec.sqlite'));
const migrationsDir = path.join(here, '..', 'migrations');

const sha = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const day = (value) => (value ? String(value).slice(0, 10) : null);
const json = (value) => {
  if (value === null || value === undefined || value === '') return null;
  try { return JSON.parse(value); } catch { return { raw: String(value) }; }
};
const ip = (value) => (/^[0-9a-fA-F:.]+$/.test(String(value || '')) ? value : null);

function readRows(db, sql) {
  const result = db.exec(sql);
  if (!result.length) return [];
  const { columns, values } = result[0];
  return values.map((row) => Object.fromEntries(columns.map((c, i) => [c, row[i]])));
}

async function setSequence(client, table) {
  await client.query(
    `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, false)`
  );
}

async function main() {
  if (!fs.existsSync(sqlitePath)) throw new Error(`No existe ${sqlitePath}`);
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(sqlitePath));
  const has = (t) => readRows(db, `SELECT name FROM sqlite_master WHERE type='table' AND name='${t}'`).length > 0;
  const all = (t) => (has(t) ? readRows(db, `SELECT * FROM ${t} ORDER BY id`) : []);

  const exists = await pool.query(`SELECT to_regclass('public.comerciantes') AS t`);
  if (!exists.rows[0].t) {
    await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now())');
    for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
      await pool.query(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
      await pool.query('INSERT INTO schema_migrations(name) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
      console.log(`Migración aplicada: ${file}`);
    }
  }

  const counts = {};
  await withTransaction(async (c) => {
    const nonEmpty = await c.query('SELECT COUNT(*)::int AS n FROM comerciantes');
    if (nonEmpty.rows[0].n > 0) throw new Error('PostgreSQL ya contiene datos; abortando para no duplicar.');

    // roles
    const roleIds = {};
    for (const codigo of ['super_admin', 'cobrador', 'auditor', 'comerciante']) {
      const r = await c.query('INSERT INTO roles(codigo) VALUES ($1) ON CONFLICT (codigo) DO UPDATE SET codigo = EXCLUDED.codigo RETURNING id', [codigo]);
      roleIds[codigo] = r.rows[0].id;
    }

    const userIds = new Set();
    for (const u of all('usuarios')) {
      const hash = String(u.password_hash).startsWith('$2') ? u.password_hash : bcrypt.hashSync(String(u.password_hash), 10);
      await c.query(
        `INSERT INTO usuarios(id,nombre,email,password_hash,rol_id,activo,creado_en) VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz, now()))`,
        [u.id, u.nombre, u.email, hash, roleIds[u.rol], u.estado !== 0, u.fecha_creacion]
      );
      userIds.add(u.id);
    }
    counts.usuarios = userIds.size;

    const zonas = all('zonas');
    const seenZona = new Set();
    for (const z of zonas) {
      let name = String(z.nombre).trim();
      if (seenZona.has(name.toLowerCase())) name = `${name} (${z.id})`;
      seenZona.add(name.toLowerCase());
      await c.query('INSERT INTO zonas(id,nombre,descripcion) VALUES ($1,$2,$3)', [z.id, name, z.descripcion]);
    }
    counts.zonas = zonas.length;

    const zonaIds = new Set(zonas.map((z) => z.id));
    let callesN = 0;
    for (const k of all('calles')) {
      if (!zonaIds.has(k.zona_id)) continue;
      await c.query(
        'INSERT INTO calles(id,nombre,descripcion,zona_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [k.id, k.nombre, k.descripcion, k.zona_id]
      );
      callesN++;
    }
    counts.calles = callesN;

    const rubros = all('rubros');
    for (const r of rubros) {
      await c.query('INSERT INTO rubros(id,nombre,descripcion,activo) VALUES ($1,$2,$3,$4)', [r.id, r.nombre, r.descripcion, r.estado !== 0]);
    }
    counts.rubros = rubros.length;

    const comerciantes = all('comerciantes');
    for (const m of comerciantes) {
      await c.query(
        `INSERT INTO comerciantes(id,dni_ruc,nombre,rubro_id,zona_id,categoria,tipo_comerciante,estado,estado_empadronamiento,usuario_creador_id,creado_en)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11::timestamptz, now()))`,
        [m.id, m.dni_ruc, m.nombre, m.rubro_id, m.zona_id, m.categoria || m.tipo_comerciante, m.tipo_comerciante, m.estado,
         m.estado_empadronamiento, userIds.has(m.usuario_creador) ? m.usuario_creador : null, m.fecha_registro]
      );
    }
    counts.comerciantes = comerciantes.length;
    const merchantIds = new Set(comerciantes.map((m) => m.id));

    const usedCodes = new Set();
    let puestosN = 0;
    for (const p of all('puestos')) {
      if (!merchantIds.has(p.comerciante_id)) continue;
      let code = p.codigo_puesto || `S-${String(p.id).padStart(3, '0')}`;
      if (usedCodes.has(code)) code = `${code}-${p.id}`;
      usedCodes.add(code);
      await c.query(
        `INSERT INTO puestos(id,comerciante_id,zona_id,codigo_puesto,direccion,metros_cuadrados,estado,latitud,longitud)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [p.id, p.comerciante_id, p.zona_id, code, p.direccion, p.metros_cuadrados,
         ['ocupado', 'disponible', 'reservado', 'inactivo'].includes(p.estado) ? p.estado : 'ocupado', p.latitud, p.longitud]
      );
      puestosN++;
    }
    counts.puestos = puestosN;
    const postIds = new Set(all('puestos').map((p) => p.id));

    let prefsN = 0;
    for (const pref of all('comerciante_preferencias')) {
      if (!merchantIds.has(pref.comerciante_id) || !pref.clave) continue;
      await c.query(
        `INSERT INTO comerciante_preferencias(comerciante_id,clave,valor) VALUES ($1,$2,$3)
         ON CONFLICT (comerciante_id, clave) DO UPDATE SET valor = EXCLUDED.valor`,
        [pref.comerciante_id, pref.clave, pref.valor]
      );
      prefsN++;
    }
    counts.comerciante_preferencias = prefsN;

    let asistN = 0;
    for (const a of all('asistencias_feriales')) {
      if (!postIds.has(a.puesto_id) || !/^\d{4}-\d{2}-\d{2}/.test(String(a.fecha))) continue;
      await c.query(
        `INSERT INTO asistencias_feriales(puesto_id,fecha,sesion,marca,fuente) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (puesto_id, fecha, sesion) DO NOTHING`,
        [a.puesto_id, String(a.fecha).slice(0, 10), a.sesion || '', a.marca, a.fuente]
      );
      asistN++;
    }
    counts.asistencias_feriales = asistN;

    let notifN = 0;
    for (const n of all('notificaciones')) {
      if (!merchantIds.has(n.comerciante_id)) continue;
      await c.query(
        `INSERT INTO notificaciones(comerciante_id,tipo,canal,mensaje,estado,creado_en) VALUES ($1,$2,$3,$4,$5,COALESCE($6::timestamptz, now()))`,
        [n.comerciante_id, n.tipo, n.canal, n.mensaje, n.estado, n.fecha_creacion]
      );
      notifN++;
    }
    counts.notificaciones = notifN;

    const tarifas = all('tarifas');
    for (const t of tarifas) {
      await c.query(
        `INSERT INTO tarifas(id,rubro_id,tipo_tarifa,monto_fijo,monto_variable,unidad_medida,vigencia_inicio,vigencia_fin,activo,version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [t.id, t.rubro_id, t.tipo_tarifa, t.monto_fijo || 0, t.monto_variable || 0,
         ['diaria', 'semanal', 'mensual', 'metro_cuadrado'].includes(t.unidad_medida) ? t.unidad_medida : 'diaria',
         day(t.vigencia_inicio), day(t.vigencia_fin), t.estado !== 0, t.version || 1]
      );
    }
    counts.tarifas = tarifas.length;
    const tarifaIds = new Set(tarifas.map((t) => t.id));

    const comprobantes = all('comprobantes');
    for (const r of comprobantes) {
      await c.query(
        `INSERT INTO comprobantes(id,numero_correlativo,tipo,archivo_url,estado,emitido_en) VALUES ($1,$2,$3,$4,$5,COALESCE($6::timestamptz, now()))`,
        [r.id, r.numero_correlativo, r.tipo, r.archivo_url, r.estado, r.fecha_emision]
      );
    }
    counts.comprobantes = comprobantes.length;
    const comprobanteIds = new Set(comprobantes.map((r) => r.id));
    await c.query(`SELECT setval('comprobantes_recibo_seq', ${comprobantes.length + 1}, false)`);

    let cobrosN = 0;
    const skipped = [];
    const usedHash = new Set();
    for (const k of all('cobros')) {
      const valid = merchantIds.has(k.comerciante_id) && tarifaIds.has(k.tarifa_id) && userIds.has(k.cobrador_id) && k.monto > 0;
      if (!valid) { skipped.push(k.id); continue; }
      const metodo = ['efectivo', 'yape', 'plin', 'pos'].includes(k.metodo_pago) ? k.metodo_pago : 'efectivo';
      let hash = k.hash_transaccion || sha(`migracion|${k.id}|${k.comerciante_id}|${k.monto}|${k.fecha_cobro}`);
      if (usedHash.has(hash)) hash = sha(`${hash}|${k.id}`);
      usedHash.add(hash);
      const operacion = k.codigo_operacion || (metodo === 'efectivo' ? null : `MIG-${k.id}`);
      await c.query(
        `INSERT INTO transacciones(id,comerciante_id,tarifa_id,cobrador_id,comprobante_id,monto,concepto,metodo_pago,codigo_operacion,
           hash_transaccion,estado,observaciones,fecha_cobro_cliente,fecha_registro_servidor)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($13::timestamptz, now()),COALESCE($13::timestamptz, now()))`,
        [k.id, k.comerciante_id, k.tarifa_id, k.cobrador_id,
         comprobanteIds.has(k.comprobante_id) ? k.comprobante_id : null, k.monto, k.concepto, metodo, operacion,
         hash, k.estado === 'anulado' ? 'anulado' : 'confirmado', k.observaciones, k.fecha_cobro]
      );
      cobrosN++;
    }
    counts.transacciones = cobrosN;
    if (skipped.length) counts.cobros_omitidos = skipped;

    // auditoría con cadena de hash
    let prev = null;
    const audit = all('auditoria');
    for (const a of audit) {
      const body = JSON.stringify([a.usuario_id, a.entidad, a.accion, a.recurso_id, a.payload_previo, a.payload_nuevo, a.fecha]);
      const current = sha(`${prev || ''}${body}`);
      await c.query(
        `INSERT INTO auditoria_logs(usuario_id,rol,entidad,accion,detalle,recurso_id,metodo_http,ruta,ip_origen,payload_previo,payload_nuevo,hash_prev,hash_actual,fecha)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,COALESCE($14::timestamptz, now()))`,
        [userIds.has(a.usuario_id) ? a.usuario_id : null, a.usuario_rol || a.rol_usuario || 'anonimo', a.entidad, a.accion, a.detalle,
         a.recurso_id === null ? null : String(a.recurso_id), a.metodo_http, a.ruta_endpoint, ip(a.ip_origen),
         json(a.payload_previo), json(a.payload_nuevo), prev, current, a.fecha]
      );
      prev = current;
    }
    counts.auditoria_logs = audit.length;

    // métricas de riesgo -> modelos_ia_metricas
    const riesgo = all('riesgo_morosidad');
    for (const r of riesgo) {
      await c.query(
        `INSERT INTO modelos_ia_metricas(modelo,version,entidad_tipo,entidad_id,score,nivel,metricas,generado_en)
         VALUES ('riesgo_morosidad','heuristico-v1','comerciante',$1,$2,$3,$4,COALESCE($5::timestamptz, now()))`,
        [r.comerciante_id, r.score_riesgo, r.nivel_riesgo, { motivo_principal: r.motivo_principal, estado_alerta: r.estado_alerta }, r.fecha_calculo]
      );
    }
    counts.modelos_ia_metricas = riesgo.length;

    for (const t of ['usuarios', 'zonas', 'rubros', 'calles', 'comerciantes', 'puestos', 'tarifas', 'comprobantes', 'transacciones', 'notificaciones']) {
      await setSequence(c, t);
    }
  });

  console.log('Migración completada:', counts);
}

main()
  .catch((error) => { console.error('Error en migración:', error.message); process.exitCode = 1; })
  .finally(closePool);
