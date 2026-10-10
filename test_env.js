import { config } from 'dotenv';
import { resolve } from 'node:path';

console.log('process.cwd():', process.cwd());

// Cargar variables de entorno desde el directorio raíz
const envPath = resolve(process.cwd(), 'Proyecto_Final_Salcedo_Rentas', '.env');
console.log('Intentando cargar .env desde:', envPath);
const result = config({ path: envPath });
console.log('Resultado de dotenv config:', result);

console.log('JWT_SECRET:', process.env.JWT_SECRET);
console.log('PORT:', process.env.PORT);