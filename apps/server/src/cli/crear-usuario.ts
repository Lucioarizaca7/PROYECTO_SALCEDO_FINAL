/**
 * Crea una cuenta real del personal (cobrador, auditor o super_admin) sin la semilla de usuarios demo.
 *
 *   npm run crear-usuario -- --rol cobrador                      (pregunta nombre, correo y clave)
 *   USUARIO_NOMBRE=… USUARIO_EMAIL=… USUARIO_PASSWORD=… npm run crear-usuario -- --rol auditor
 *   docker compose exec api node dist/cli/crear-usuario.js --rol cobrador   (en el servidor)
 *
 * La clave nunca se pasa como argumento (quedaría en el historial de la terminal).
 */
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

// @ts-ignore
import { initializeDatabase, createUser, closeDatabase } from '../db.js';

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
    muted = hidden;
  });
}

function argumento(nombre: string): string | undefined {
  const indice = process.argv.indexOf(`--${nombre}`);
  if (indice >= 0) return process.argv[indice + 1];
  return process.argv.find((arg) => arg.startsWith(`--${nombre}=`))?.split('=')[1];
}

async function main() {
  const rol = argumento('rol') || process.env.USUARIO_ROL || 'cobrador';
  const nombre = process.env.USUARIO_NOMBRE || await ask(`Nombre completo del ${rol}: `);
  const email = process.env.USUARIO_EMAIL || await ask('Correo: ');
  let password = process.env.USUARIO_PASSWORD;
  if (!password) {
    password = await ask('Contraseña (mínimo 10 caracteres): ', { hidden: true });
    const confirmation = await ask('Repita la contraseña: ', { hidden: true });
    if (password !== confirmation) throw new Error('Las contraseñas no coinciden');
  }

  await initializeDatabase({ seed: false });
  const user = await createUser({ nombre, email, password, rol });
  console.log(`Usuario creado: ${user.email} (${user.rol}, id ${user.id})`);
}

main()
  .catch((error) => {
    console.error(`No se pudo crear el usuario: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
