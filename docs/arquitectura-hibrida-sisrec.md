# Arquitectura híbrida desacoplada para SISREC Salcedo

## 1. Visión general

SISREC Salcedo no se implementa como una arquitectura monolítica única. La solución sigue un modelo híbrido y desacoplado con tres bloques separados:

1. Capa de presentación y cliente PWA.
2. API REST central de negocio y datos.
3. Microservicio analítico independiente.

Esto cumple con el SRS y el backlog técnico porque combina:

- resiliencia offline en campo,
- alta disponibilidad operativa del backend,
- trazabilidad fiscal y auditoría,
- y procesamiento analítico desacoplado sin bloquear la operación principal.

## 2. Capa de presentación y cliente PWA

### Patrón

React + Vite + Tailwind CSS ejecutándose como SPA/PWA.

### Requisitos del cliente

- UI responsive para operación con una sola mano.
- Registro de eventuales, permanentes y feriales.
- Almacenamiento local en IndexedDB.
- Service Worker para sincronización en segundo plano.
- Generación de recibos y notificaciones de cobro offline.

### Reglas de diseño

- La UI debe funcionar aunque no haya conectividad.
- Las transacciones locales deben registrarse con un identificador único de idempotencia.
- La sincronización en background se activa cuando la red vuelve.

## 3. Capa de negocio y datos central

### Patrón

API REST en Node.js/Express con diseño en capas.

### Capas sugeridas

- rutas / controladores
- servicios / casos de uso
- repositorios / acceso a datos
- middleware de autenticación, auditoría y RBAC

### Persistencia

- PostgreSQL 15+
- índices funcionales y B-tree
- restricciones CHECK, UNIQUE y FK
- auditoría inmutable para cambios sensibles.

## 4. Capa analítica independiente

### Patrón

Microservicio en Python con FastAPI.

### Responsabilidades

- cálculo de scoring de morosidad,
- proyección de recaudación,
- inferencia o modelado predictivo,
- procesamiento asíncrono en segundo plano.

Este servicio debe comunicarse con el backend por HTTP o cola de eventos, pero nunca depender del ciclo de vida del cliente móvil.

## 5. Diagrama conceptual

```text
[Cliente PWA React]
      | offline-first / IndexedDB / Service Worker
      v
[API REST central Node.js / Express]
      | JWT + RBAC + auditoría + sincronización
      v
[PostgreSQL]
      |
      +----> [Microservicio Python / FastAPI]
               ^
               | scoring y proyección
```

## 6. Requisitos de arquitectura cumplidos

- No se usa una sola arquitectura monolítica pura.
- El cliente tiene autonomía offline.
- El backend centraliza negocio y datos.
- El servicio analítico es independiente.
- La sincronización y la idempotencia se diseñan como concern separado.

## 7. Siguiente implementación recomendada

- registrar el Service Worker en la PWA,
- crear cola de sincronización con hash transaccional,
- implementar middleware de auditoría en Express,
- publicar el microservicio Python para scoring y proyección,
- desplegar PostgreSQL con índices y restricciones.
