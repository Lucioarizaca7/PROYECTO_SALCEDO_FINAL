@echo off
setlocal

:: Establecer variables de entorno para directorios temporales
set TMP=D:\temp
set TEMP=D:\temp

:: Crear el directorio temporal si no existe
if not exist "%TMP%" mkdir "%TMP%"

:: Cambiar al directorio del proyecto
cd /d "D:\visual_code\Proyecto_Final_Salcedo_Rentas"

:: Mostrar las variables para debugging
echo TMP=%TMP%
echo TEMP=%TEMP%
echo CD=%CD%

:: Intentar el render con Docker
npx hyperframes@0.8.125 render --composition index_motion_graphics.html --docker

endlocal