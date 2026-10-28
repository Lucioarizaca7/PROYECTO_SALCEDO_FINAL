# SISREC Salcedo

## Sistema de Gestión de Recaudación y Fiscalización Municipal

SISREC Salcedo es una solución web orientada a la gestión de recaudación, cobro y fiscalización tributaria en el Centro Poblado de Salcedo. El proyecto busca apoyar la administración municipal en la operación diaria de comerciantes, pagos, deuda, control territorial y análisis de cumplimiento tributario, con especial consideración de la conectividad limitada y la atención en campo.

El sistema está diseñado para ser funcional, trazable y usable en escenarios operativos reales, con un enfoque en la digitalización del proceso de recaudación, la reducción de fricción en cobranza y la mejora de la gestión de información para la autoridad local.

## Objetivo del proyecto

Desarrollar una plataforma de gestión municipal para apoyar:
- la administración del padrón de comerciantes,
- el registro y validación de pagos,
- la priorización de fiscalización,
- la supervisión territorial de puestos y zonas,
- la trazabilidad de cobros y auditoría,
- y la operación en condiciones de conectividad intermitente.

## Enfoque técnico y normativo

El proyecto incorpora una lógica de inteligencia operativa orientada a la priorización de intervención fiscal, no a la evaluación de solvencia crediticia. En este contexto, la analítica se utiliza como herramienta de apoyo para la planificación y fiscalización tributaria, respetando la finalidad administrativa y la normativa de protección de datos personales.

En particular, el diseño del sistema considera principios de:
- finalidad administrativa y tributaria,
- proporcionalidad del tratamiento de datos,
- trazabilidad de operaciones,
- transparencia y control interno,
- y respeto a la Ley N° 29733, Ley de Protección de Datos Personales, así como al marco normativo municipal aplicable al cobro de arbitrios y tasas.

## Arquitectura del sistema

La solución se organiza en capas complementarias:

1. Frontend y experiencia de usuario
   - React + Vite + Tailwind CSS
   - Interfaz operativa para administración y cobranza
   - Modo offline con IndexedDB
   - Mapa geográfico 2D (Leaflet) y 2.5D (mapbox-gl) con el plano municipal de Salcedo
   - Escaneo QR con html5-qrcode

2. Backend y lógica de negocio
   - Node.js + Express 5 + TypeScript
   - API REST para administración, cobros, comercio y control
   - Gestión de usuarios, roles (JWT + RBAC), auditoría encadenada y datos operativos
   - Base de datos: PostgreSQL 16 con migraciones versionadas (`apps/server/migrations`)

3. Analítica y apoyo a la decisión
   - Proyección y análisis de recaudación
   - Evaluación de patrones de cumplimiento y riesgo operativamente relevante
   - Priorización de atención fiscal sobre la base de comportamiento histórico

## Estructura del repositorio

```text
Proyecto_Final_Salcedo_Rentas/
├── apps/
│   ├── client/              # Frontend (React + Vite) y su Dockerfile (Caddy)
│   ├── server/              # API (Express + PostgreSQL) y su Dockerfile
│   │   ├── src/             # config.ts, index.ts, auth.ts, db.js, pg.js…
│   │   ├── src/cli/         # crear-admin.ts
│   │   ├── migrations/      # esquema SQL versionado
│   │   ├── scripts/         # migración desde SQLite, plano DXF → GeoJSON, semillas
│   │   └── tests/           # pruebas con node:test
│   └── analytics/           # Microservicio analítico (FastAPI) y su Dockerfile
├── docs/
├── docker-compose.yml       # PostgreSQL para desarrollo (puerto 5433)
├── docker-compose.prod.yml  # Servidor: Caddy + API + analítica + PostgreSQL
├── Caddyfile                # HTTPS automático y proxy /api → API
├── .env.example             # Variables de desarrollo
└── .env.production.example  # Variables del servidor
```

## Stack tecnológico actual

### Frontend
- React
- Vite
- Tailwind CSS
- Leaflet
- html5-qrcode
- IndexedDB

### Backend
- Node.js 22+
- Express 5 + TypeScript
- PostgreSQL 16 (`pg`)
- JWT + bcryptjs
- helmet, CORS y límites de peticiones (express-rate-limit)

### Despliegue
- Docker Compose
- Caddy (HTTPS automático con Let's Encrypt)

### Funcionalidades relacionadas
- impresión térmica con Bluetooth
- generación de recibos y hashes transaccionales
- almacenamiento local para operación desconectada

## Requisitos para ejecutar el proyecto

- Node.js 22 o superior y npm
- Docker (para PostgreSQL)
- Navegador moderno con soporte para APIs Web

## Instalación y ejecución en desarrollo

Desde la raíz del proyecto:

```bash
docker compose up -d postgres
cp .env.example .env        # y definir JWT_SECRET
npm install
npm run dev
```

Esto levanta la aplicación con:
- Frontend: http://localhost:5173
- API: http://localhost:3003 (variable `PORT`)

Todas las variables se leen y validan en `apps/server/src/config.ts`: si falta `JWT_SECRET` (o `DATABASE_URL` en producción) el servidor no arranca y explica qué falta.

### Scripts disponibles

```bash
npm run dev          # inicia frontend y backend simultáneamente
npm run dev:server   # solo backend
npm run dev:client   # solo frontend
npm run build        # compila la API (dist/) y el cliente
npm test             # pruebas del servidor (PostgreSQL) y del cliente
npm run crear-admin  # crea un usuario super_admin pidiendo la clave
```

Las pruebas del servidor usan un esquema propio (`sisrec_test_<pid>`) y no tocan los datos de desarrollo.

## Verificación de salud del backend

```bash
curl http://localhost:3003/api/v1/health
```

## Despliegue en un servidor

Un VPS con Docker Compose y cuatro contenedores: Caddy (único expuesto, puertos 80 y 443), API, analítica y PostgreSQL.

```bash
cp .env.production.example .env.production   # DOMAIN, POSTGRES_PASSWORD y JWT_SECRET
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml exec api node dist/cli/crear-admin.js
```

- El dominio debe apuntar a la IP del servidor antes de levantar Caddy, que obtiene el certificado solo.
  Para un servidor de pruebas sin dominio sirve `<ip-con-guiones>.sslip.io`.
- En producción no se crean usuarios demo; el primer administrador se crea con `crear-admin`.
- Para probar el stack en la propia PC: `DOMAIN=localhost`, `HTTP_PORT=8080`, `HTTPS_PORT=8443` y abrir https://localhost:8443.

## Seguridad

- Todas las rutas GET de la API exigen token, salvo `/api/v1/health` y `/api/v1/publico/resumen` (cifras agregadas sin datos personales). La prueba `tests/api-seguridad.test.js` falla si una ruta nueva queda abierta.
- El cobrador de un cobro se toma del token; comprobante, cobro y auditoría se graban en una sola transacción.
- Límite general de peticiones por IP real (detrás de Caddy, `TRUST_PROXY=1`) y límite estricto en los accesos.
- helmet y HSTS en producción; errores de la API capturados por un manejador global.
- Los reportes agrupan por día y mes de Lima (`America/Lima`), aunque las fechas se guardan en UTC.

## Funcionalidades implementadas

### 1. Dashboard operativo
- Resumen de recaudación diaria y semanal.
- Indicadores clave de pagos, deuda pendiente, ocupación y desempeño operativo.
- Visibilidad por zona y rubro.
- Alertas y actividad reciente.

### 2. Gestión del padrón de comerciantes
- Registro, edición y consulta de comerciantes.
- Búsqueda por documento, nombre, puesto o código.
- Importación masiva desde archivos Excel para carga inicial.
- Estado de registro y relación con zonas y puestos.

### 3. Cobranza y liquidación
- Consulta de deuda por comerciante.
- Cálculo del saldo pendiente y liquidación.
- Registro de pagos con distintos medios: efectivo, Yape, Plin y POS.
- Validación de comprobantes y hash de idempotencia para evitar duplicidad.
- Emisión de recibos y trazabilidad del cobro.

### 4. Impresión y compartición de comprobantes
- Impresión térmica mediante Bluetooth con fallback a impresión del navegador.
- Cola de impresión para escenarios offline.
- Compartición por WhatsApp y otros mecanismos del navegador.

### 5. Mapa de sitios y distribución territorial
- Registro y mantenimiento de puestos de venta.
- Visualización geográfica por zona y estado.
- Gestión de alta, edición y baja de sitios.
- Integración del mapa con la operación de cobro.

### 6. Tarifas y configuración institucional
- Administración de tarifas por rubro y tipo de prueba o cobro.
- Configuración de montos, vigencias y unidades de medida.
- Soporte a distintos conceptos de tributación.

### 7. Inteligencia operativa y priorización de fiscalización
- Proyección de recaudación esperada por período.
- Índice de Prioridad de Fiscalización (IPF), entendido como una herramienta de apoyo para la asignación de recursos de control y supervisión, no como una evaluación crediticia ni un juicio de solvencia.
- Panel de seguimiento por zona, rubro y comportamiento histórico.
- Identificación de patrones de cumplimiento y riesgo operativo asociado a falta de pago o incumplimiento formal.

> El IPF no constituye una calificación financiera ni un indicador de capacidad de pago. Su finalidad es apoyar la priorización de acciones de fiscalización, inspección y atención institucional.

### 8. Auditoría y trazabilidad
- Registro de eventos críticos por usuario, entidad y acción.
- Historial de operaciones sensibles.
- Control por perfiles y responsabilidades.

### 9. Modo offline-first
- Almacenamiento local con IndexedDB.
- Registro de operaciones pendientes sin conexión.
- Cola de sincronización y gestión de estado de conectividad.
- Soporte operativo en territorios con baja disponibilidad de red.

### 10. Autenticación y roles
- Inicio de sesión con distintos perfiles.
- Roles incluidos: super admin, cobrador, auditor y comerciante.
- Usuarios de demostración solo en desarrollo; en producción el primer administrador se crea con `npm run crear-admin`.

## Credenciales de demostración (solo desarrollo)

Fuera de producción el sistema crea usuarios de prueba para validar el flujo funcional.
Con `NODE_ENV=production` no se crean y la pantalla de acceso no muestra ninguna cuenta.

```text
admin@sisrec.demo / sisrec2026
admin@salcedo.gob.pe / admin123
cobrador@salcedo.gob.pe / cobro123
auditor@salcedo.gob.pe / audit123
comerciante@salcedo.gob.pe / comercio123
```

## Carga inicial de datos

El proyecto incluye un seed útil para pruebas y validación del padrón:

```bash
npm run seed:feria-zapatillas --workspace apps/server
```

## Consideraciones de protección de datos

El sistema maneja información personal y tributaria, por lo que la implementación debe mantener un enfoque responsable en protección de datos, especialmente respecto a:
- DNI, nombre, ubicación y actividad del comerciante,
- trazabilidad de cobros,
- y uso de reportes analíticos.

Se recomienda reforzar, en fases posteriores, medidas como:
- masking de datos en reportes analíticos,
- control de acceso por roles y auditoría completa,
- limitación de finalidad del tratamiento,
- y mecanismos de ejercicio de derechos ARCO para quienes intervienen en el sistema.

## Gobernanza y control interno

Se recomienda incorporar en evolución del proyecto:
- protocolo de resolución de conflictos para operaciones offline,
- registros de auditoría más estrictos,
- versión de reglas de priorización y fiscalización,
- y un esquema de aprobación y trazabilidad de decisiones operativas relevantes.

## Estado del proyecto

El repositorio representa una versión funcional y operativa del sistema de gestión recaudatoria con enfoque en cobranza, fiscalización y control territorial. No se trata únicamente de una base conceptual; incorpora flujos reales de administración, atención en campo, impresión, mapa y analítica aplicada al contexto municipal.

## Siguientes mejoras recomendadas

- reforzar las reglas de sincronización offline,
- mejorar la validación de entradas y del flujo de transacciones,
- separar aún más lógica de negocio y acceso a datos,
- extender la cobertura de pruebas automatizadas,
- y fortalecer la alineación con estándares de protección de datos y gobierno digital.

## Conclusión

SISREC Salcedo busca ser una herramienta útil para la gestión municipal de recaudación y fiscalización, gestionando información de forma operativa, segura y trazable, con un balance entre innovación tecnológica y pertinencia institucional.

El proyecto tiene una base sólida para continuar su evolución hacia una solución más robusta, gobernable y alineada con las necesidades del servicio público.