/**
 * Sesión compartida entre pestañas (src/services/sesionPestanas.js): la pestaña muestra siempre al usuario
 * de la cookie del navegador, no al que tenía en memoria.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { cambioDeSesion, leerUsuario } from '../src/services/sesionPestanas.js';

const admin = { id: 1, nombre: 'Administrador', email: 'admin@salcedo.gob.pe', rol: 'super_admin' };
const cobrador = { id: 2, nombre: 'Cobrador Principal', email: 'cobrador@salcedo.gob.pe', rol: 'cobrador' };

test('la misma cuenta no cambia nada, aunque llegue con otros datos o el id como texto', () => {
  assert.equal(cambioDeSesion(admin, { ...admin, nombre: 'Otro nombre' }), 'igual');
  assert.equal(cambioDeSesion(admin, { ...admin, id: '1' }), 'igual');
  assert.equal(cambioDeSesion(null, null), 'igual');
});

test('si en otra pestaña se entró con otra cuenta, esta pestaña pasa a esa cuenta', () => {
  assert.equal(cambioDeSesion(admin, cobrador), 'cambiar');
  // Mismo id con otro rol (cuenta cambiada de rol): también se actualiza, para no mostrar permisos que ya no tiene.
  assert.equal(cambioDeSesion(admin, { ...admin, rol: 'auditor' }), 'cambiar');
});

test('otra pestaña entra o sale', () => {
  assert.equal(cambioDeSesion(null, cobrador), 'entrar');
  assert.equal(cambioDeSesion(admin, null), 'cerrar');
});

test('el usuario guardado por otra pestaña se lee sin romper con datos extraños', () => {
  assert.deepEqual(leerUsuario(JSON.stringify(cobrador)), cobrador);
  assert.equal(leerUsuario(null), null);
  assert.equal(leerUsuario(''), null);
  assert.equal(leerUsuario('{no es json'), null);
  assert.equal(leerUsuario('"texto"'), null);
  assert.equal(leerUsuario('{"nombre":"sin id"}'), null);
});
