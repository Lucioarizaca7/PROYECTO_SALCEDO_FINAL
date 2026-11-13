/**
 * Pantalla Usuarios (routes/usuarios.ts y la sección "Usuarios del personal" de db.js), con la API levantada:
 * solo el super_admin crea, desactiva o cambia claves; desactivar corta las sesiones al instante; nunca se
 * desactiva la propia cuenta ni al último super_admin; la clave no vuelve en la respuesta ni en la auditoría.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../src/index.ts';
import { loginUser } from '../src/auth.ts';
import { cambiarEstadoUsuario, closeDatabase, findUserByEmail } from '../src/db.js';
import { pool } from '../src/pg.js';

let server;
let baseUrl;
const tokens = {};
let adminId;
const unico = () => `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

before(async () => {
  server = await startServer(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  for (const [rol, email, password] of [
    ['admin', 'admin@salcedo.gob.pe', 'admin123'],
    ['cobrador', 'cobrador@salcedo.gob.pe', 'cobro123'],
    ['auditor', 'auditor@salcedo.gob.pe', 'audit123']
  ]) {
    tokens[rol] = (await loginUser({ email, password }, pool)).token;
  }
  adminId = Number((await findUserByEmail(pool, 'admin@salcedo.gob.pe')).id);
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closeDatabase();
});

const api = (token, method, path, body) => fetch(`${baseUrl}/api/v1${path}`, {
  method,
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body)
});

const entrar = async (email, password) => {
  const response = await api(null, 'POST', '/auth/login', { email, password });
  return { status: response.status, token: (await response.json().catch(() => ({}))).token };
};

const nuevo = async (rol = 'cobrador', password = 'clave-segura-123') => {
  const email = `usuario-${unico()}@prueba.pe`;
  const response = await api(tokens.admin, 'POST', '/usuarios', { nombre: `Persona ${rol}`, email, password, rol });
  assert.equal(response.status, 201);
  const { data } = await response.json();
  assert.ok(!('password' in data) && !('password_hash' in data), 'la respuesta no trae la clave');
  return { ...data, password };
};

// La auditoría se escribe justo después de responder: se espera a que aparezca.
async function auditoriaDe(accion, recursoId) {
  for (let intento = 0; intento < 40; intento += 1) {
    const { rows } = await pool.query(
      `SELECT payload_previo, payload_nuevo FROM auditoria_logs WHERE accion = $1 AND (payload_nuevo->>'id' = $2 OR recurso_id = $2) ORDER BY id DESC LIMIT 1`,
      [accion, String(recursoId)]
    );
    if (rows[0]) return rows[0];
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}

test('solo el super_admin ve, crea, desactiva y cambia claves', async () => {
  for (const rol of ['cobrador', 'auditor']) {
    assert.equal((await api(tokens[rol], 'GET', '/usuarios')).status, 403, `${rol} no ve la lista`);
    assert.equal((await api(tokens[rol], 'POST', '/usuarios', { nombre: 'X', email: `x-${unico()}@prueba.pe`, password: 'clave-segura-123', rol: 'super_admin' })).status, 403);
    assert.equal((await api(tokens[rol], 'PATCH', `/usuarios/${adminId}/estado`, { activo: false })).status, 403);
    assert.equal((await api(tokens[rol], 'PUT', `/usuarios/${adminId}/clave`, { password: 'otra-clave-123' })).status, 403);
  }
  assert.equal((await api(null, 'GET', '/usuarios')).status, 401);
  const lista = await (await api(tokens.admin, 'GET', '/usuarios')).json();
  assert.ok(lista.data.some((usuario) => usuario.id === adminId));
  assert.ok(lista.data.every((usuario) => !('password_hash' in usuario)), 'la lista nunca trae el hash de la clave');
});

test('crea super_admin, cobradores y auditores que pueden entrar; la clave no vuelve ni se audita', async () => {
  for (const rol of ['super_admin', 'cobrador', 'auditor']) {
    const usuario = await nuevo(rol);
    assert.equal(usuario.rol, rol);
    assert.equal(usuario.activo, true);
    assert.equal((await entrar(usuario.email, usuario.password)).status, 200, `el ${rol} nuevo entra`);
    const auditoria = await auditoriaDe('CREAR_USUARIO', usuario.id);
    assert.ok(auditoria, 'queda en la auditoría');
    assert.ok(!JSON.stringify(auditoria).includes(usuario.password), 'la clave no queda en la auditoría');
  }
});

test('datos inválidos: rol comerciante, correo repetido o clave corta', async () => {
  const usuario = await nuevo();
  const crear = (cambios) => api(tokens.admin, 'POST', '/usuarios', { nombre: 'Prueba', email: `otro-${unico()}@prueba.pe`, password: 'clave-segura-123', rol: 'cobrador', ...cambios });
  assert.equal((await crear({ rol: 'comerciante' })).status, 400);
  assert.equal((await crear({ email: usuario.email.toUpperCase() })).status, 409, 'el correo no distingue mayúsculas');
  assert.equal((await crear({ password: 'corta' })).status, 400);
});

test('desactivar corta la sesión al instante y bloquea el ingreso; reactivar lo devuelve', async () => {
  const cobrador = await nuevo('cobrador');
  const sesion = await entrar(cobrador.email, cobrador.password);
  assert.equal((await api(sesion.token, 'GET', '/tickets/mios')).status, 200);

  const desactivar = await api(tokens.admin, 'PATCH', `/usuarios/${cobrador.id}/estado`, { activo: false });
  assert.equal(desactivar.status, 200);
  assert.equal((await desactivar.json()).data.activo, false);
  assert.equal((await api(sesion.token, 'GET', '/tickets/mios')).status, 401, 'su token de acceso deja de valer');
  assert.equal((await entrar(cobrador.email, cobrador.password)).status, 401, 'no puede volver a entrar');
  const auditoria = await auditoriaDe('CAMBIAR_ESTADO_USUARIO', cobrador.id);
  assert.equal(auditoria.payload_previo.activo, true);
  assert.equal(auditoria.payload_nuevo.activo, false);

  assert.equal((await api(tokens.admin, 'PATCH', `/usuarios/${cobrador.id}/estado`, { activo: false })).status, 200, 'repetir no falla');
  assert.equal((await api(tokens.admin, 'PATCH', `/usuarios/${cobrador.id}/estado`, { activo: true })).status, 200);
  assert.equal((await entrar(cobrador.email, cobrador.password)).status, 200);
  assert.equal((await api(tokens.admin, 'PATCH', `/usuarios/${cobrador.id}/estado`, {})).status, 400, 'hay que decir activo o no');
});

test('nadie se desactiva a sí mismo', async () => {
  const response = await api(tokens.admin, 'PATCH', `/usuarios/${adminId}/estado`, { activo: false });
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /propia cuenta/);
});

test('la clave nueva vale sin pedir cambiarla y cierra las otras sesiones de esa persona', async () => {
  const auditor = await nuevo('auditor', 'clave-inicial-123');
  const sesion = await entrar(auditor.email, 'clave-inicial-123');
  const cambio = await api(tokens.admin, 'PUT', `/usuarios/${auditor.id}/clave`, { password: 'clave-nueva-456' });
  assert.equal(cambio.status, 200);
  assert.ok(!JSON.stringify(await cambio.json()).includes('clave-nueva-456'));
  assert.equal((await entrar(auditor.email, 'clave-inicial-123')).status, 401, 'la clave anterior ya no vale');
  assert.equal((await entrar(auditor.email, 'clave-nueva-456')).status, 200, 'entra con la nueva, sin otro paso');
  assert.equal((await api(sesion.token, 'GET', '/usuarios')).status, 401, 'la sesión abierta con la clave anterior se cerró');
  assert.equal((await api(tokens.admin, 'PUT', `/usuarios/${auditor.id}/clave`, { password: 'corta' })).status, 400);
  assert.equal((await api(tokens.admin, 'PUT', '/usuarios/999999/clave', { password: 'clave-nueva-456' })).status, 404);
  const auditoria = await auditoriaDe('CAMBIAR_CLAVE_USUARIO', auditor.id);
  assert.ok(auditoria && !JSON.stringify(auditoria).includes('clave-nueva-456'), 'la clave no queda en la auditoría');
});

test('el último super_admin activo no se puede desactivar', async () => {
  const ultimo = await nuevo('super_admin');
  const { rows: otros } = await pool.query(`
    SELECT u.id FROM usuarios u JOIN roles r ON r.id = u.rol_id
    WHERE r.codigo = 'super_admin' AND u.activo AND u.id <> $1`, [ultimo.id]);
  const ids = otros.map((row) => Number(row.id));
  await pool.query('UPDATE usuarios SET activo = false WHERE id = ANY($1)', [ids]);
  try {
    await assert.rejects(cambiarEstadoUsuario(pool, ultimo.id, false, { actorId: adminId }), /último super administrador/);
  } finally {
    await pool.query('UPDATE usuarios SET activo = true WHERE id = ANY($1)', [ids]);
  }
  assert.equal((await api(tokens.admin, 'PATCH', `/usuarios/${ultimo.id}/estado`, { activo: false })).status, 200, 'con otro super_admin activo sí se puede');
});

test('cobrador, auditor y super_admin nuevos cambian ellos mismos la clave que les dio el super_admin', async () => {
  for (const rol of ['cobrador', 'auditor', 'super_admin']) {
    const persona = await nuevo(rol, 'clave-del-admin-1');
    assert.equal((await api(tokens.admin, 'PUT', `/usuarios/${persona.id}/clave`, { password: 'clave-del-admin-2' })).status, 200);
    const enOtroCelular = await entrar(persona.email, 'clave-del-admin-2');
    const aqui = await entrar(persona.email, 'clave-del-admin-2');
    const cambiar = (body) => api(aqui.token, 'PUT', '/auth/mi-clave', body);

    const errada = await cambiar({ actual: 'no-es-la-clave', nueva: 'mi-clave-propia-1' });
    assert.equal(errada.status, 400, 'la actual errada no es 401: el cliente creería vencida la sesión');
    assert.match((await errada.json()).message, /actual no es correcta/);
    assert.equal((await cambiar({ actual: 'clave-del-admin-2', nueva: 'corta' })).status, 400);
    assert.equal((await cambiar({ actual: 'clave-del-admin-2', nueva: 'clave-del-admin-2' })).status, 400, 'debe ser otra');

    const bien = await cambiar({ actual: 'clave-del-admin-2', nueva: 'mi-clave-propia-1' });
    assert.equal(bien.status, 200, `el ${rol} cambia su clave`);
    assert.ok(!JSON.stringify(await bien.json()).includes('mi-clave-propia-1'));
    assert.equal((await entrar(persona.email, 'clave-del-admin-2')).status, 401, 'la clave que dio el admin ya no vale');
    assert.equal((await entrar(persona.email, 'mi-clave-propia-1')).status, 200);
    assert.equal((await api(enOtroCelular.token, 'PUT', '/auth/mi-clave', { actual: 'mi-clave-propia-1', nueva: 'otra-mas-123' })).status, 401, 'la sesión del otro dispositivo se cerró');
    assert.equal((await cambiar({ actual: 'mi-clave-propia-1', nueva: 'mi-clave-propia-2' })).status, 200, 'la sesión desde la que la cambió sigue');

    const auditoria = await auditoriaDe('CAMBIAR_MI_CLAVE', persona.id);
    assert.ok(auditoria, 'queda en la auditoría');
    assert.ok(!/mi-clave-propia|clave-del-admin/.test(JSON.stringify(auditoria)), 'ninguna clave queda en la auditoría');
  }
});

test('el comerciante y quien no inició sesión no usan el cambio de clave del personal', async () => {
  const comerciante = (await loginUser({ email: 'comerciante@salcedo.gob.pe', password: 'comercio123' }, pool)).token;
  assert.equal((await api(comerciante, 'PUT', '/auth/mi-clave', { actual: 'comercio123', nueva: 'otra-clave-123' })).status, 403);
  assert.equal((await api(null, 'PUT', '/auth/mi-clave', { actual: 'x', nueva: 'otra-clave-123' })).status, 401);
});
