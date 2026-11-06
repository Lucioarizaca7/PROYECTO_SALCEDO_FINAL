/**
 * Crea un usuario super_admin. Es la forma de dar de alta al primer administrador en producción,
 * donde la semilla de usuarios demo no se ejecuta.
 *
 *   npm run crear-admin                                  (pregunta nombre, correo y clave)
 *   ADMIN_NOMBRE=… ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run crear-admin   (sin preguntas)
 *   docker compose exec api node dist/cli/crear-admin.js  (en el servidor)
 */
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

// @ts-ignore
import { initializeDatabase, createAdminUser, closeDatabase } from '../db.js';

function ask(question: string, { hidden = false } = {}): Promise<string> {
  return new Promise((resolve) => {
    let muted = false;
    const output = new Writable({
      write(chunk, encoding, callback) {
        if (!muted) process.stdout.write(chunk, encoding);
        callback();
      }
    });
    const rl = createInterface({ input: process.stdin, output, terminal: Boolean(process.stdin.isTTY) });
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
    muted = hidden; // lo que se escriba después de la pregunta no se muestra
  });
}

async function main() {
  const nombre = process.env.ADMIN_NOMBRE || await ask('Nombre completo: ');
  const email = process.env.ADMIN_EMAIL || await ask('Correo: ');
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = await ask('Contraseña (mínimo 10 caracteres): ', { hidden: true });
    const confirmation = await ask('Repita la contraseña: ', { hidden: true });
    if (password !== confirmation) throw new Error('Las contraseñas no coinciden');
  }

  await initializeDatabase({ seed: false });
  const user = await createAdminUser({ nombre, email, password });
  console.log(`Administrador creado: ${user.email} (id ${user.id})`);
}

main()
  .catch((error) => {
    console.error(`No se pudo crear el administrador: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
