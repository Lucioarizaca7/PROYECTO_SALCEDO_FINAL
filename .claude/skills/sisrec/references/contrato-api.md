# Contrato de la API y plantillas

## Forma de las respuestas

```js
// Éxito (200, o 201 al crear)
res.json({ data, message: 'Puesto liberado: queda disponible para otro comerciante' });
res.json({ data, total: data.length });

// Error
res.status(400).json({ message: 'Un puesto ocupado necesita un comerciante titular' });
```

| Código | Uso |
|---|---|
| 400 | datos inválidos o una regla de negocio rechazada |
| 401 | sin sesión o token vencido (`authFetch` intenta renovarlo) |
| 403 | el rol no tiene permiso (`requireRoles`) |
| 404 | el recurso no existe |
| 422 | importación del padrón sin filas válidas (devuelve `data` con la vista previa de errores) |
| 500 | error interno, con un mensaje genérico |

Los mensajes van en español y para el usuario final. No se reenvía un error crudo de PostgreSQL: se traduce o se responde con un mensaje genérico.

## Plantilla de una ruta que modifica datos

Copiar el patrón de `POST /api/v1/puestos/:id/liberar` en `apps/server/src/routes/puestos.ts`. Cada archivo de `routes/` declara la ruta completa y `app.ts` lo monta sin prefijo:

```ts
router.post('/api/v1/<recurso>/:id/<accion>',
  requireAuth,
  requireRoles(['super_admin', 'cobrador']),
  auditMutation({
    db,
    accion: 'ACCION_EN_MAYUSCULAS',
    entidad: '<tabla>',
    getPreviousState: async (req) => rowById('<tabla>', Number(req.params.id)),
    serializeResponse: (body) => body?.data ?? body
  }),
  async (req, res) => {
    return res.json({ data: await funcionDeDb(db, req.params.id, req.body), message: 'Texto de éxito' });
  }
);
```

- Sin `try/catch`: si `funcionDeDb` lanza un `NotFoundError`, `ValidationError` o `ConflictError`, el manejador de `http/errorHandler.ts` responde 404, 400 o 409 con su mensaje. Una respuesta de error no se audita.
- Solo se pone `try/catch` cuando la ruta hace algo distinto con el error. Ejemplos: la sincronización offline responde 503 si el error es temporal, y la importación del padrón responde 400 si el libro no se puede leer.
- `db` es `import { pool as db } from '../pg.js'`. Las piezas compartidas (`staffOnly`, `auditContext`, `rowById`, `loginLimiter`, `resolveComercianteParam`) vienen de `../http/comunes.js`.
- Si la ruta es un GET nuevo, hay que actualizar el número fijo de rutas en `tests/api-seguridad.test.js` (hoy son 39). Esa prueba comprueba que cada GET pida token.
- La regla de negocio va en `db.js`, no en la ruta. La ruta solo traduce la petición y la respuesta.
- Si la operación escribe en más de una tabla, se hace dentro de `withTransaction`.
- Para lecturas del personal se usa `...staffOnly` (que es `requireAuth` + `requireRoles(STAFF)`).

## Plantilla de una prueba

Estilo de `apps/server/tests/puestos.test.js`: `node:test` + `assert/strict`, funciones de `../src/db.js` y datos creados dentro de la propia prueba (documentos distintos en cada una).

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeDatabase, insertComerciante /* … */ } from '../src/db.js';

test('describe la regla en español', async () => {
  const db = await initializeDatabase();
  // preparar los datos → ejecutar la función → comprobar el resultado
  await assert.rejects(() => funcion(db, datosInvalidos), /mensaje esperado/);
});
```

Se ejecuta con `npm test --workspace apps/server`. El script es `tsx --test tests/*.test.js`.

En el cliente, la lógica pura (por ejemplo `sitesGeo.js` o `offlineQueue.js`) se prueba con `node --test tests/*.test.js` dentro de `apps/client`.

## Inconsistencias conocidas que no hay que copiar

- Hay dos endpoints para crear puestos (`POST /puestos` y `POST /puestos-mapa`) con lógica casi igual. No agregar un tercero.
- Muchas validaciones están en `db.js` y no en `validation.ts`. Para código nuevo, elegir un solo lugar y usarlo siempre.
- `src/utils/*.test.js` y `receiptFormatter.validation.js` del cliente no se ejecutan en ningún script.
