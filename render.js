const { exec } = require('child_process');
const path = require('path');

// Establecer explícitamente las variables de entorno para evitar el problema de rutas
const env = {
  ...process.env,
  TMP: 'D:\\temp',
  TEMP: 'D:\\temp',
  // Asegurarnos de que HyperFrames use el directorio correcto
  HYPERFRAMES_TEMP_DIR: 'D:\\temp'
};

console.log('Variables de entorno:');
console.log('TMP:', env.TMP);
console.log('TEMP:', env.TEMP);
console.log('HYPERFRAMES_TEMP_DIR:', env.HYPERFRAMES_TEMP_DIR);

// Ejecutar hyperframes render usando npm exec
const command = `npm exec -- hyperframes@0.8.125 render --composition index_motion_graphics.html`;

console.log('Ejecutando comando:', command);

exec(command, {
  env: env,
  cwd: path.resolve('D:\\visual_code\\Proyecto_Final_Salcedo_Rentas')
}, (error, stdout, stderr) => {
  if (error) {
    console.error(`Error al ejecutar HyperFrames: ${error}`);
    return;
  }

  console.log('Salida estándar:');
  console.log(stdout);

  console.error('Salida de error:');
  console.error(stderr);

  console.log('Proceso de HyperFrames completado');
});