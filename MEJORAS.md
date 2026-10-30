# Plan: entregar el contenido de `MEJORAS.md`

## Contexto
Auditoría técnica tras la Sesión 1 (B0–B4 cerrados, B4.5 sin commitear). Se pide un único `MEJORAS.md` con dos secciones. Restricción: **no modificar ningún archivo del repositorio**; el output es solo el contenido, listo para guardar.

## Acción al aprobar
Devolver en la respuesta el bloque de abajo (entre marcas), tal cual. No se escribe ningún archivo del repo.

## Verificación
`git status` idéntico al de inicio de sesión.

---8<--- INICIO MEJORAS.md ---8<---

# MEJORAS — Kaizen App

> Revisión de `main` (`ee731e1`) + working tree de B4.5. Los bugs ya listados en `TRASPASO.md` §4 no se repiten salvo cuando la mejora propuesta los elimina por diseño.

## Sección 1: Optimización de Código y Flujo

### 1.1 Un único helper de transacción RLS — **Impacto: Alto**
- **Afecta**: `src/middleware/auth.js` (`withRlsContext`), `src/services/mfa.js` (`withRlsSelf`), `src/services/profile.js`, `src/services/auth.js` (`createUser`), `scripts/test-rls.js` (`withCtx`), `scripts/test-mfa.js`.
- **Problema**: el patrón `connect → BEGIN → set_config×2 → fn → COMMIT/ROLLBACK → release` está copiado **6 veces**, con variaciones (unas validan `uid/role`, otras no; `withRlsContext` hace `connect()` fuera del `try`). Cada bloque nuevo (B5–B17) añadirá otra copia.
- **Solución**: `src/db/rls.js` → `withRls({ uid, role }, fn, { pool = appPool, commit = true } = {})`. Valida contexto (500 `rls_context_missing`), un solo `set_config` con dos llamadas en la misma sentencia (`SELECT set_config(...), set_config(...)`: 1 round-trip menos por petición), `connect()` dentro del `try`. `withRlsContext` queda en 5 líneas encima de él; los tests usan `commit: false` para el rollback forzado.

### 1.2 Servicios que reciben `client`, no que abren transacción — **Impacto: Alto**
- **Afecta**: `src/services/profile.js`, `src/services/mfa.js` (`getMfaStatus` vs `getMfaStatusWithClient`), futuro `requireCompleteProfile` montado en B7/B10.
- **Problema**: cada servicio abre su propia transacción. En B7 una reserva hará `requireCompleteProfile` (transacción 1) + handler en `withRlsContext` (transacción 2) = 2 conexiones del pool y 2×(BEGIN+set_config+COMMIT) por petición. Ya existe el par duplicado `getMfaStatus`/`getMfaStatusWithClient` como síntoma.
- **Solución**: convención única: **todo servicio con identidad recibe `client` como primer argumento** (`getProfileStatus(client, profileId, role)`, `getMfaStatus(client, profileId)`). Quien orquesta (ruta vía `withRlsContext`, o login vía `withRls`) abre la transacción. `requireCompleteProfile` pasa a ser un *guard* que se ejecuta **dentro** de `withRlsContext` (p. ej. `withRlsContext(handler, { guards: [profileComplete] })`) y reutiliza el mismo `client`. Elimina las variantes `*WithClient`.

### 1.3 `withRlsContext`: contrato de respuesta explícito — **Impacto: Alto**
- **Afecta**: `src/middleware/auth.js:60`, `src/routes/me.js` (5 `return res.status(...)`), `src/middleware/errorHandler.js`.
- **Problema**: "si devuelves algo se serializa" mezclado con `res.status().json()` dentro de la transacción es el origen del bug de `res.json(res)`, y además **responde antes del COMMIT** en los caminos de error (el cliente puede ver 200/409 de una transacción que luego falla).
- **Solución**: los handlers nunca tocan `res` para errores: **lanzan `httpError`** (ver 1.4). Éxito: `return body` o `return { status: 201, body }`. `withRlsContext` responde siempre tras `COMMIT`. Añadir `if (res.headersSent) return next(err)` en `errorHandler` como red de seguridad. Validación de entrada (400) fuera de la transacción, antes de pedir conexión.

### 1.4 Un solo constructor de errores y un solo formato de error — **Impacto: Alto**
- **Afecta**: `src/services/auth.js` (`httpError` local), `src/services/mfa.js` (6 construcciones manuales), `src/services/profile.js`, `src/services/google.js`, `src/routes/auth.js` (`Object.assign`), todos los `res.status(4xx).json(...)` de middleware y rutas.
- **Problema**: dos contratos de error para el cliente (`{error:<code>, message}` vs `{error:<categoria>, code:<detalle>}`) y ~15 sitios que construyen errores a mano.
- **Solución**: `src/lib/errors.js` con `httpError(status, code, message, details?)`. `errorHandler` es el **único** que serializa errores: `{ error: <categoria derivada del status>, code, message, ...details }` (mantiene el formato que ya usan las rutas, que es el más rico). Middleware (`requireAuth`, `requireRole`, `requireMfaToken*`, `requireCompleteProfile`) hacen `next(httpError(...))`. `missing[]`, `allowed`, `expected` viajan en `details`.

### 1.5 Login: unificar la rama post-autenticación y saltarse MFA para no-admin — **Impacto: Medio**
- **Afecta**: `src/routes/auth.js` (`/login` y `/google`), `src/services/auth.js` (`loginLocal`, `loginGoogle`).
- **Problema**: el bloque "consultar MFA → `mfa_token` o JWT" está duplicado literal en las dos rutas. La lectura de rol (`SELECT role … ORDER BY id LIMIT 1`) está duplicada en `loginLocal` y `loginGoogle`. Cada login de alumno abre una transacción `appPool` para consultar MFA, que por regla de negocio **no puede tener**.
- **Solución**: `findPrimaryRole(profileId)` en `services/auth.js`; `issueSession({ profileId, email, role })` en `services/auth.js` que devuelve `{ token, user }` o `{ mfa_required, mfa_token }` y solo consulta `user_mfa` si `role === 'admin'`. Las dos rutas quedan en 3 líneas. Ahorra 1 conexión + 4 queries por login de alumno/profesor.

### 1.6 `createUser` no debe firmar token — **Impacto: Medio**
- **Afecta**: `src/services/auth.js` (`createUser`, `registerLocal`, `loginGoogle`).
- **Problema**: `createUser` firma un JWT que `loginGoogle` descarta y reconstruye; `registerLocal` hace `findCredentialsByEmail` previo **y** captura `23505`, comprobando lo mismo dos veces (la primera vía `servicePool`, sin necesidad).
- **Solución**: `createUser` devuelve `{ profileId, email, role }`; la firma la hace `issueSession` (1.5). En `registerLocal` dejar solo el `catch` de `23505` (libre de carreras). `google.js` debe devolver `name` y `emailVerified`, y `createUser` usar `emailVerified` real en vez de `googleSub ? true : false`.

### 1.7 Fuente única de "versión vigente" ya en B4.5 — **Impacto: Alto**
- **Afecta**: `src/services/profile.js`, `src/routes/me.js` (`POST /agreements`), `src/routes/agreements.js`, `src/config/agreements.js`.
- **Problema**: `CURRENT_AGREEMENT_VERSIONS` se lee directamente en 3 módulos. B4.5.1 tendrá que tocar los 3 y convertir lecturas síncronas en asíncronas.
- **Solución**: crear ya `src/services/agreements.js` con `getCurrentVersions(client)` (hoy devuelve la constante; en B4.5.1 consulta `agreement_documents`) y `signAgreement(client, { profileId, type, version, ip, userAgent })`. Rutas y `profile.js` solo llaman al servicio. B4.5.1 cambia **un** archivo. El bloque de validación de 25 líneas de `config/agreements.js` se reduce a un `Object.freeze` + una comprobación (desaparecerá en B4.5.1).

### 1.8 Rutas finas en `/me` — **Impacto: Medio**
- **Afecta**: `src/routes/me.js` (`POST /health`, `POST /agreements`).
- **Problema**: validación, construcción de SQL dinámico e inserción viven en la ruta, contra la convención "lógica en `services/`". `RETURNING *` devuelve todo el registro clínico.
- **Solución**: `services/profile.js#upsertHealthInfo(client, profileId, input)` con la lista `HEALTH_FIELDS` exportada (reutilizable en B19 admin y en la vista del profesor). La ruta: validar → `return { health: await upsertHealthInfo(...) }`. `RETURNING` con columnas explícitas.

### 1.9 `getProfileStatus` en una sola query — **Impacto: Bajo**
- **Afecta**: `src/services/profile.js`.
- **Problema**: 3 queries secuenciales por comprobación; en B7/B10 se ejecuta en cada reserva/checkout.
- **Solución**: una query con `LEFT JOIN student_health_info` + subselect `array_agg(type)` sobre `user_agreements` filtrado por `unnest(types, versions)`. Mismo contrato `{ ok, missing }`. Renombrar el servicio a `getProfileStatus` para no colisionar con el middleware `requireCompleteProfile` (hoy se importa con alias `checkProfileComplete`).

### 1.10 Verificación de JWT en un solo sitio — **Impacto: Medio**
- **Afecta**: `src/middleware/auth.js` (`requireAuth`), `src/middleware/mfa.js` (`requireMfaToken`, `requireMfaTokenFromBody`, `signMfaToken`), `src/services/jwt.js`.
- **Problema**: el parseo de `Bearer` y `jwt.verify` + comprobación de claims está copiado 3 veces. `requireMfaToken` (header) y `verifyToken` no se usan. `signMfaToken` es emisión de tokens pero vive en `middleware/`.
- **Solución**: `services/jwt.js` con `signToken`, `signMfaToken`, `verifySession(token)` y `verifyMfaPending(token)` (lanzan `httpError` 401). Middleware: `bearer(req)` + una llamada. Borrar `requireMfaToken` y `verifyToken` sin uso.

### 1.11 MFA: decidir el camino por formato del código — **Impacto: Medio**
- **Afecta**: `src/services/mfa.js` (`verifyMfaCode`, `verifyAndEnableMfa`).
- **Problema**: un TOTP incorrecto dispara hasta 10 `argon2.verify` secuenciales (cientos de ms de CPU por intento, vector de abuso hasta B20). Descifrado + `buildTotp` + `validate` duplicado en dos funciones.
- **Solución**: `checkTotp(row, code)` compartido. Si `code` es `^\d{6}$` → solo TOTP; si es `^[A-Z2-7]{10}$` → solo recovery codes; otro formato → `false` sin tocar BD.

### 1.12 Configuración centralizada — **Impacto: Bajo**
- **Afecta**: `src/config/auth.js`, `src/config/mfa.js`, `src/config/database.js`, `src/index.js`, `.env.example`.
- **Problema**: `import 'dotenv/config'` en 4 sitios; cada módulo valida su variable y aborta en la primera que falta (arranques "a plazos"); `.env.example` desincronizado.
- **Solución**: `src/config/env.js` que carga dotenv una vez, valida todas las variables requeridas y lista **todas** las que faltan en un solo error. `.env.example` se genera/compara contra esa lista.

### 1.13 Harness de tests compartido y `node:test` — **Impacto: Medio**
- **Afecta**: `scripts/test-rls.js`, `scripts/test-mfa.js`.
- **Problema**: `run/ok/fail/assert`, `withCtx`, seed y cleanup duplicados entre ambos scripts; cada bloque futuro (B5–B17 piden "tests por rol") copiará el harness otra vez.
- **Solución**: adoptar ya `node:test` + `node:assert` (sin dependencias, Node 24) y `scripts/lib/db-fixtures.js` con `withRls(..., { commit:false })` (de 1.1), `seedUsers()` y `cleanup()`. Adelanta parte de B20 sin coste.

### 1.14 Limpieza de restos — **Impacto: Bajo**
- **Afecta**: `src/{middleware,routes,services}/index.js`, `src/routes/auth.js`, `src/services/auth.js`.
- **Problema**: barrels vacíos; `/auth/routes` usa `try/catch` manual mientras `asyncHandler` ya existe; `/auth/me` ejecuta una query de depuración (`rls_context`) en cada llamada; `loginGoogle` re-comprueba `email/sub` que `google.js` ya valida.
- **Solución**: borrar barrels; `asyncHandler` en todas las rutas no-RLS; `rls_context` solo si `NODE_ENV !== 'production'`; quitar la validación duplicada.

### 1.15 Flujo de identidad: `role` del JWT como fuente de RLS — **Impacto: Medio (decisión, no código)**
- **Afecta**: `src/services/auth.js` (login), `src/middleware/auth.js`.
- **Problema**: el rol del contexto RLS sale del JWT (7 días). Un admin degradado conserva permisos admin en RLS hasta que expira el token; el multi-rol (`ORDER BY id LIMIT 1`) no está definido.
- **Solución**: documentar en `contexto-proyecto.md` §5 una de dos: (a) `JWT_EXPIRES_IN` corto para admin/profesor, o (b) `withRls` relee `user_roles` por `servicePool` y verifica que el rol del JWT sigue asignado (1 query indexada). Recomendado (b) solo para `admin`.

### Orden sugerido
1.1 → 1.4 → 1.3 → 1.2 → 1.7/1.8/1.9 (cierra B4.5 sobre la base nueva) → 1.5/1.6/1.10/1.11 → 1.13 → resto. Todo antes de B5, para que los ~15 bloques restantes nazcan con el patrón correcto.

## Sección 2: Plan de `/grill-with-docs` por Bloque

Una sola sesión inicial (antes de cerrar B4.5) debería fijar el vocabulario transversal en `CONTEXT.md`: **usuario / perfil / alumno / profesor**, porque el esquema ya usa `user_id` (`user_roles`, `user_mfa`, `push_subscriptions`), `profile_id` (`auth_credentials`, `student_health_info`, `user_agreements`), `student_id` (`subscriptions`, `bookings`, `attendance`, `invoices`…), `trainer_id` (`class_sessions`) y `actor_id` (`audit_log`) para la misma entidad.

- **B0** [OMITIR] — Infra cerrada; sin lógica de dominio.
- **B1** [OMITIR] — Esqueleto técnico cerrado.
- **B2** [OMITIR] — Cerrado y sin ambigüedad de vocabulario; la política multi-rol pendiente se lleva a la sesión de B4.5.
- **B3** [OMITIR] — Políticas RLS ya tabuladas sin ambigüedad en `contexto-proyecto.md` §5.
- **B4** [OMITIR] — Cerrado; MFA con términos inequívocos (`mfa_token`, recovery code).
- **B4.5** [USAR] — Concentra los términos más confusos: *consentimiento / agreement / waiver / seguro* (y `subscription_agreements` huérfana con `insurance_type`), *firma*, *versión vigente*, *perfil completo*; el plan y el código discrepan (`SECURITY INVOKER`, `NOT NULL`, `missing`). Aquí también: identidad (`user/profile/student`) y multi-rol.
- **B4.5.1** [USAR] — Ciclo `created → published → retired` frente a "vigente", "documento" frente a "versión" y "re-firma": tres nombres para estados solapados que acabarán en endpoints y en la UI de B19.
- **B5** [USAR] — El CRUD es simple, pero aquí se fija qué es un *plan* (`billing_period`, `price_cents` vs Price de Stripe) y qué significa que un plan "cubre" una disciplina, algo de lo que dependen B7 y B10.5; el plan escribe `plan_disciplinas` y el esquema `plan_disciplines`.
- **B6** [USAR] — *Sesión / clase / evento* (existen `class_sessions` y `events` + `event_registrations`, estos últimos sin bloque en el plan); *profesor* vs `trainer_id`; papel del profesor sobre las sesiones sin definir; significado de `session_status = completed`.
- **B7** [USAR] — Lógica de negocio más compleja sin definir: aforo, lista de espera, promoción automática, plazo de cancelación, si reservar exige suscripción activa con la disciplina cubierta.
- **B8** [USAR] — *Asistencia* vs *reserva* (¿se puede asistir sin reserva?, ¿`absent` se genera solo?), qué es "sus sesiones" para un profesor, semántica de `corrected_at`/`correction_reason`, y el filtro de la vista de salud del profesor.
- **B9** [USAR] — *Check-in* vs *asistencia* (`method = qr`), *dispositivo/tablet*, *sesión activa*, ventana de check-in; rutas inconsistentes (`/tablet/*` en el plan, `/api/tablet/*` en el contexto); `device_tokens` sin esquema.
- **B10** [USAR] — `sub_status` (`cancelled`, `grace_period`, `pending_cash`, `incomplete`) no coincide con los estados de Stripe (`canceled`, `unpaid`, `incomplete_expired`…); hay que fijar el mapeo y los términos *suscripción / plan / checkout*. Incluir en la misma sesión `invoices` y *moroso*.
- **B10.1** [OMITIR] — Cubierto por la sesión de B10 (estados de `invoices` y definición de moroso); el resto es integración de webhook.
- **B10.2** [OMITIR] — Endpoint de lectura con un filtro ya definido en el contexto.
- **B10.5** [USAR] — *Upgrade / downgrade*, prorrateo, "disciplinas al instante / al transicionar" y la relación `subscription_disciplines` ↔ `plan_disciplines` (dos fuentes de verdad potenciales de "qué disciplinas tiene el alumno").
- **B10.6** [OMITIR] — Integración con un proveedor de email; el disparador (`invoice.payment_failed`) es inequívoco.
- **B11** [OMITIR] — Dos operaciones (`cancel-now`, `cancel-at-period-end`) ya definidas; el mapeo de estados queda fijado en B10.
- **B12** [ELIMINADO] — Absorbido por B4.5 (perfil completo) y B10.3 (seguro o `waiver`, ADR 0005).
- **B13** [USAR] — Privacidad: semántica de `is_public` + `visible_fields`, quién ve el directorio, qué ve el profesor (`profiles_select`) y la exclusión explícita de salud.
- **B14** [USAR] — *Racha* y *badge* sin definir (`student_stats_daily.streak_weeks` ya asume rachas semanales); *tabla opt-in* ambigua (¿ranking?, ¿feed? existe `activity_feed` sin bloque).
- **B15** [OMITIR] — Técnico (web-push); los eventos disparadores ya están listados en el plan.
- **B16** [USAR] — Las métricas ya tienen columnas pero no definición: *alumno activo*, *alumno nuevo*, *cancelado*, *MRR*, *ocupación*; un error aquí invalida todos los informes.
- **B17** [OMITIR] — Expone las métricas fijadas en B16; CRUD de lectura.
- **B18** [OMITIR] — Frontend/PWA, sin lógica de dominio nueva.
- **B19** [OMITIR] — Agrega endpoints y vocabulario ya definidos en bloques anteriores; mayoritariamente UI.
- **B20** [OMITIR] — Hardening técnico (rate limiting, backups, E2E), sin términos de dominio.

## Sección 3: Pendientes que salieron del diseño de B10

### 3.1 Domiciliación SEPA — **Impacto: Medio (mejora futura)**
- **Contexto**: B10 cobra solo con tarjeta (+ Apple Pay / Google Pay). La domiciliación reduce fallos por tarjeta caducada y comisiones.
- **Por resolver antes de activarla**: el primer cobro es asíncrono (días), así que haría falta un estado "pendiente de confirmación" (¿se puede reservar mientras tanto?); y las devoluciones de adeudo hasta 8 semanas después convierten un recibo pagado en impagado (otro camino a moroso).

### 3.2 Revisión legal con la gestoría — **Impacto: Alto (decisión, no código)**
- **`waiver` como alternativa al seguro** (ADR 0005): un `waiver` no exime de la negligencia propia ni sustituye a un seguro que exijan la póliza de RC o la federación.
- **Baja solo por el admin**: la normativa de consumo tiende a exigir que darse de baja sea tan fácil como darse de alta (online). Si aplica, hay que abrir la baja a final de periodo al pagador (portal de Stripe o desde la app). B11 la dejó solo para el admin (decidido 2026-10-30). Otro motivo para abrirla: quien no encuentra cómo darse de baja acaba disputando el cargo, y cada disputa cuesta 20 € en Stripe aunque se gane.
- **Factura legal (VeriFactu)**: los recibos de Stripe no son facturas. Elegir un servicio externo homologado; requisito: la factura se descarga desde la app.

## Sección 4: Pendientes que salieron del diseño de B13

### 4.1 Avatar del perfil público — **Impacto: Bajo (mejora futura)**
- **Contexto**: B13 deja `avatar_url` sin usar. Una URL externa filtra la IP de quien mira al servidor de terceros y no controla la imagen.
- **Por resolver antes de activarlo**: subida a `storage/` con límite de tamaño y tipo, **recodificar la imagen para quitar los EXIF** (una foto de móvil puede llevar la ubicación GPS de casa; pide una dependencia como `sharp`), servirla por un endpoint con sesión, *backups* (B20) y que nunca exista para un hijo.

### 4.2 Búsqueda del directorio sin acentos — **Impacto: Bajo**
- B13 busca con `ILIKE`. Con `unaccent` (extensión de PostgreSQL, la crea un superusuario) «Jose» encontraría a «José».

---8<--- FIN MEJORAS.md ---8<---

## Sección 5: Pendientes que salieron del diseño de B14

### 5.1 Más gamificación — **Impacto: Bajo (mejora futura)**
- **Feed de actividad** («Ana ha conseguido 100 h»): B14 borra `activity_feed`. Si vuelve, sería otra superficie pública con su propio opt-in y la regla de que un hijo nunca aparece.
- **Ranking general** (todas las horas del mes, con el sparring una vez), **badges por disciplina** y **«1.º del mes en X»**: este último obliga a calcular los rankings de todos los meses pasados.
- **Salto de semanas por disciplina**: hoy una semana solo se salta si la academia no celebró ninguna sesión (`shortcut:` en B14).

### 5.2 Grados (cinturones, *kruang*) — **Impacto: Medio (bloque propio)**
- No son badges: los otorga una persona, tienen historial, examen y quizá requisitos de horas. Por resolver: quién los da (admin, profesor de la disciplina), si son públicos (otro campo visible) y si un hijo los tiene.
