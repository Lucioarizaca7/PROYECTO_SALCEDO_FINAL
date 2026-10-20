---
name: sisrec
description: "Skill único de SISREC (recaudación municipal de Salcedo): stack, arquitectura, base de datos PostgreSQL, reglas de negocio (cobro por día, tickets, offline, caja), seguridad y forma de trabajar. Úsala SIEMPRE antes de cambiar código en apps/server, apps/client o migrations, al crear o tocar endpoints /api/v1, al tocar cobros, deuda, puestos, tarifas, tickets, asistencia, caja, sesiones o roles, y para revisar un cambio antes de un commit. Para cambios solo visuales (colores, layout) usa además ui-ux-pro-max."
---

# SISREC: cómo trabajar en este proyecto sin romperlo

Esta skill existe para evitar los cinco fallos típicos del código hecho con IA:
**deuda técnica invisible, falta de comprensión, huecos de seguridad, costo de tokens y suposiciones sobre el negocio.**
Cada sección dice qué hacer y qué está prohibido. Si una regla choca con lo que pide el usuario, se le dice antes de escribir código.

## 0. El stack (no cambiarlo sin que el usuario lo pida)

| Parte | Tecnología | Dónde |
|---|---|---|
| API | Node + Express 5, ESM, TypeScript en rutas/arranque y **JavaScript en `db.js`**, ejecutado con `tsx` | `apps/server` |
| Base de datos | PostgreSQL 16 (Docker `sisrec-postgres`, puerto 5433), driver `pg`, SQL a mano (sin ORM) | `apps/server/migrations` |
| Web / celular | React 18 + Vite + PWA, React Router, IndexedDB para trabajo sin señal | `apps/client` |
| Analítica | Python + FastAPI (opcional; si no responde, la API usa `prediccion.js`) | `apps/analytics` |
| Pruebas | `node:test` + `assert/strict` (servidor con `tsx --test`, cliente con `node --test`); `pytest` en analítica | `tests/` de cada app |

- **No se agregan dependencias** (npm o pip), ORMs, gestores de estado ni librerías de UI sin preguntar. Primero se busca si el proyecto ya lo resuelve.
- Los nombres del dominio van **en español** y son los del glosario (`docs/glosario-dominio.md`): `comerciante`, `puesto`, `liquidación`, `cobro`, `ticket`, `lote`. Un término nuevo se agrega al glosario antes de usarlo en el código.
- Comentarios y mensajes al usuario, en español. Los comentarios explican **por qué**, no qué.

## 1. Antes de escribir: contexto del negocio (contra las suposiciones)

1. Leer lo que toca el cambio: `references/reglas-negocio.md` (la regla), `references/mapa-modulos.md` (dónde vive) y el glosario.
2. **Si la regla no está escrita, se pregunta; no se inventa.** Son decisiones del usuario, nunca de la IA:
   - montos, tarifas, redondeos y desde qué mes rige algo;
   - quién puede hacer qué (rol) y quién lo aprueba;
   - qué pasa sin señal y qué pasa con un conflicto al sincronizar;
   - si algo se borra, se anula o se da de baja (en SISREC casi nada se borra);
   - qué se le muestra al comerciante (Ley 29733: datos mínimos).
3. Las decisiones ya tomadas están en `reglas-negocio.md` con su fecha. No se reabren: se aplican.
4. Cuando el usuario decide algo nuevo, se escribe en `reglas-negocio.md` (con fecha) y, si hay término nuevo, en el glosario. Así la siguiente sesión no adivina.

Decisiones que más se olvidan:
- Cobro por **día cobrado**: S/ 3 vía asfaltada, S/ 2 sin asfaltar, **por puesto y por día**, para todos los rubros. Sin día cobrado no hay deuda. El tipo de vía es de la **zona**.
- Ferial paga por día asistido; eventual paga el día que se le encuentra; permanente por mes o por día cobrado según la tarifa de su zona.
- Deuda acumulada desde `max(mes de alta, inicio_cobro)`.
- Un ticket preimpreso por puesto y día cobrado (S3/S2); los lotes los asigna solo `super_admin`; el ticket convive con el recibo `R-`.
- Sin señal, un conflicto **nunca se descarta**: el cobro queda `OBSERVED` y va a revisión, porque el dinero ya se recibió.
- Un cobro no se borra: se **anula** con motivo y responsable (solo `super_admin`).

## 2. Arquitectura (contra la deuda técnica invisible)

```
PostgreSQL ─► db.js (reglas + SQL, recibe `db` primero) ─► routes/<modulo>.ts ─► { data, message?, total? } | { message }
           ─► authFetch (services/session.js) ─► hooks/use<Página>.js ─► pages/<Página>Page.jsx
```

**Dónde va cada cosa**
- Regla de negocio → función en `apps/server/src/db.js` (sección de su módulo). Nunca en la ruta ni en el cliente.
- Ruta → `apps/server/src/routes/<modulo>.ts`, montada en `app.ts`. Nunca en `index.ts`.
- Error de negocio → `ValidationError` / `NotFoundError` / `ConflictError` (`errors.js`). Nunca `new Error`, nunca `try/catch` solo para responder.
- Página → `pages/<Nombre>Page.jsx` + `hooks/use<Nombre>.js` + entrada en `app/navegacion.js` (ruta y roles).
- Lógica pura del cliente (offline, formatos, mapa) → `services/` o `features/`, **con prueba** en `apps/client/tests`.

**Fuentes únicas (no se duplican nunca)**

| Qué | Única función | Prohibido |
|---|---|---|
| Deuda de un mes | `calcularLiquidacion(db, comercianteId, periodo)` | recalcular en el cliente o con SQL suelto |
| Deuda acumulada | `calcularDeudaAcumulada` (llama a la anterior) | otra fórmula |
| Escribir un cobro | `registrarCobro` (transacción + `codigo_operacion`) | `INSERT INTO transacciones` directo |
| Tarifa aplicable | `findApplicableTariff` | elegir tarifa a mano |
| Tickets de un cobro | `seriesDelComerciante` + `validarTicketsCobro` | validar tickets en la ruta |
| Fecha y periodo | `todayInLima()` / `currentPeriod()`; en el cliente `periodoEnLima()` | `new Date().toISOString().slice(…)` |
| Llamadas HTTP del cliente | `authFetch` | `fetch` con el token a mano, otro cliente HTTP |

Una versión en lote de una función única solo se acepta con una prueba que compare sus resultados con la original.

**Antes de cambiar una función, mirar quién la usa** (es lo que evita que "arreglar algo rompa otra cosa"):
```bash
grep -rn "nombreFuncion(" apps/server/src apps/client/src
```
`calcularLiquidacion` la usan Pagos, mapa, Sitios, panel, portal, jornada, riesgo y deuda acumulada: un cambio ahí se prueba con `logica-cobros`, `cobro-por-dia`, `deuda-acumulada` y `tickets`.

**Señales de deuda técnica que se frenan en el momento**
- Copiar y pegar una función para "una variante": se parametriza la existente.
- Un tercer endpoint para lo mismo (ya hay dos para crear puestos: no agregar otro).
- Un archivo nuevo de "utils" genérico: va en el módulo del dominio.
- Hacer crecer `db.js` sin sección: cada bloque nuevo va bajo su comentario de sección, como `// Tickets preimpresos (migrations/0014_tickets_preimpresos.sql)`. La separación en `repos/` y `services/` vive en la rama `claude/compassionate-hermann-e2df59` (ver `references/deuda-tecnica.md`).

## 3. Base de datos

- **Las migraciones solo se agregan**: `migrations/000N_nombre.sql` (la siguiente es la 0015), con `BEGIN; … COMMIT;`, comentarios en español, la corrección de los datos existentes y su prueba. Nunca se edita una que ya se aplicó.
- **La regla también va en la base**: CHECK, FK, UNIQUE (parcial si hace falta). El JS valida para dar un buen mensaje; la base impide el dato malo aunque entre por otro camino. Ejemplos: `puestos_ocupado_con_titular`, `tarifas_zona_o_tipo_via`, `UNIQUE (serie, numero)` de tickets.
- Dinero en `NUMERIC(12,2)`; se redondea solo al mostrar.
- Todo lo que escribe en más de una tabla va en `withTransaction`. Lo que lee un saldo para luego escribir **bloquea** (`FOR UPDATE` / `FOR NO KEY UPDATE`) para que dos cobros simultáneos no pasen del saldo.
- Toda operación que puede repetirse (sincronización, anulaciones) es **idempotente**: clave única o respuesta `ya_*`, nunca un duplicado.
- SQL siempre con parámetros (`$1, $2…`). Nunca se arma SQL concatenando datos del usuario.
- Un error 23505 (UNIQUE) se traduce a `ConflictError` con un mensaje claro.
- Pruebas: cada archivo usa su propio esquema y sus pruebas corren a la vez → cada prueba crea sus propios datos, con documentos distintos; las zonas se crean una por una (si no, choca `zonas_codigo_uq`).

## 4. Seguridad (no negociable)

Detalle y dónde vive cada control: `references/seguridad.md`. Lo mínimo en cada cambio:

- **Secretos**: solo por variables de entorno leídas en `config.ts` (ningún otro módulo lee `process.env`). Nada de claves, tokens ni contraseñas en el código, en pruebas que se commitean con valores reales, ni en el chat.
- Los usuarios demo existen **solo fuera de producción** (`config.isProduction` lo impide). No se agregan usuarios nuevos con clave en el código: en producción se usa `npm run crear-admin` / `crear-usuario`.
- **Rutas**: toda ruta privada lleva `requireAuth` + `requireRoles([...])` explícitos (o `...staffOnly`); si modifica datos, `auditMutation`. Una ruta GET nueva sube el conteo fijo de `tests/api-seguridad.test.js` (hoy 39) y se agrega una prueba de que un rol sin permiso recibe 403.
- **Sesión**: JWT de acceso corto en memoria; refresh en la cookie HttpOnly `sisrec_refresh`. Ningún token en `localStorage`/`sessionStorage`, en la URL ni en logs.
- **Contraseñas y PIN**: bcrypt; el PIN del portal se muestra una vez y nunca se audita en claro.
- **CORS**: lista blanca (`FRONTEND_URL`); jamás `origin: '*'` con `credentials`.
- **Datos personales (Ley 29733)**: el código del comerciante lleva solo 3 dígitos del DNI; el portal devuelve el documento oculto; nada de DNI completo en QR, recibos ni reportes públicos.
- **Errores**: el manejador global no reenvía mensajes crudos de PostgreSQL.
- El cliente nunca decide permisos ni saldos definitivos: ocultar un botón no es seguridad, el servidor vuelve a validar.

## 5. Comprensión (que el usuario pueda explicar y reparar el sistema)

Cada cambio termina con una **nota de cambio** corta en el chat, en español claro:

```
Qué cambió: <la regla o comportamiento, en palabras del negocio>
Dónde: <archivo:línea de la función clave> (+ migración si hay)
Por qué así: <la decisión y la alternativa descartada>
Cómo puede fallar: <el caso borde y qué pasa entonces>
Cómo se comprueba: <la prueba que lo cubre y el comando>
```

- Si el usuario pregunta "¿cómo funciona X?", se responde con el recorrido real (BD → función → ruta → hook → pantalla) citando `archivo:línea`, no con una descripción genérica.
- Una regla nueva o cambiada se escribe en `references/reglas-negocio.md`; un problema conocido que queda, en `references/deuda-tecnica.md`. La documentación es parte del cambio, no un extra.
- Nada de "magia": no se esconden reglas en constantes sin nombre. `MAX_TICKETS_COBRO = 60` con su comentario, no un `60` suelto.

## 6. Costo y método (contra regenerar sin plan)

- **Plan antes que código** si el cambio toca más de 3 archivos o una regla de negocio: lista corta de archivos, función y prueba. Si falta una decisión, se pregunta una vez, con opciones.
- **Leer por partes**: `db.js` tiene ~3000 líneas. Se busca con `grep -n "function nombre"` y se lee ese rango; no se lee el archivo entero ni se reescribe.
- **Editar, no regenerar**: cambios con `Edit` sobre lo existente. Nunca se reescribe un archivo completo para cambiar unas líneas.
- **Copiar patrones del proyecto** (`references/contrato-api.md` tiene la plantilla de ruta y de prueba) en vez de inventar estructuras nuevas.
- **Probar de lo chico a lo grande**: primero el archivo de prueba afectado (`npx tsx --test tests/tickets.test.js` en `apps/server`), al final la batería completa.
- Si un arreglo falla dos veces, se para y se diagnostica la causa (leer el error, el dato real en la BD) antes de intentar otra variante.

## 7. Git y entorno

- Raíz git: `D:/visual_code`; el proyecto es `Proyecto_Final_Salcedo_Rentas`. El checkout principal está en `correccion/logica-cobros` con trabajo **sin commit** (migraciones 0008–0014).
- **No se commitea, no se hace push, no se une ramas ni se abre PR sin que el usuario lo pida.** Las ramas se dejan separadas: las revisa el usuario.
- Commits en español, sin `package.json`, `package-lock.json` ni `.claude/launch.json` si no son parte del trabajo.
- Base local: `docker start sisrec-postgres`.

## 8. Checklist antes de dar algo por terminado

- [ ] La regla está en `reglas-negocio.md` (o era una que ya estaba) y no se supuso nada que no esté escrito.
- [ ] No hay cálculo de deuda duplicado ni cobros escritos fuera de `registrarCobro`; se revisaron los llamadores de lo que cambió.
- [ ] Migración nueva (si aplica) con restricciones en la BD, corrección de datos y prueba.
- [ ] Rutas con roles, auditoría y mensajes en español; conteo de `api-seguridad.test.js` al día.
- [ ] Ningún secreto, token o contraseña en código, logs o chat.
- [ ] Pasan, en `apps/server`: `npm test` y `npx tsc --noEmit`; en `apps/client`: `node --test tests/*.test.js`; y el build de Vite (`npx vite build --outDir <carpeta temporal>`).
- [ ] Si cambió algo visible: comprobado en el navegador (servidores `api` y `web` de `.claude/launch.json`).
- [ ] Nota de cambio entregada al usuario.

## Referencias (leer solo la que haga falta)

- `references/reglas-negocio.md`: puestos, liquidación por tipo de comerciante, cobro por día, observaciones, tickets, offline, autenticación.
- `references/mapa-modulos.md`: capas, rutas por módulo con roles, tablas y migraciones.
- `references/contrato-api.md`: forma de las respuestas, plantilla de ruta y de prueba, inconsistencias que no se copian.
- `references/seguridad.md`: cada control de seguridad, dónde vive y las señales de alarma en una revisión.
- `references/deuda-tecnica.md`: problemas conocidos, estado de las ramas y orden de refactorización.
- `docs/glosario-dominio.md` (en la raíz del proyecto): términos del negocio con su tabla, API, código y pantalla.
