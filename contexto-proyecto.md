# Kaizen App — Contexto del proyecto

> Documento vivo. Refleja **dónde estamos**. Se actualiza al cerrar cada bloque.
> La hoja de ruta completa está en `plan-de-bloques.md`.

Última actualización: cierre de B3 (RLS Fase 1 en 6 tablas + tests por rol + refactor de `createUser` y login).

---

## 0. Instrucciones para el agente de IA

Al terminar cada bloque:

1. **Devuelve `contexto-proyecto.md` completo actualizado**:
   - Mueve el bloque terminado de "EN CURSO" a "CERRADO" en §4.
   - Añade el detalle de lo implementado (archivos, endpoints, verificación manual).
   - Actualiza §6 si hay tablas/columnas nuevas (migraciones aplicadas).
   - Actualiza §8 (pendientes) y §9 (riesgos): tacha resueltos, añade nuevos.
   - Actualiza §5 si surgió alguna decisión de diseño nueva.
2. **Devuelve `plan-de-bloques.md` actualizado** solo si el bloque cambió su alcance
   (nuevos entregables, nuevas dependencias, nuevos sub-bloques). Si no cambió, dilo
   explícitamente y no lo reescribas.
3. **No avances al siguiente bloque** sin confirmación explícita del usuario.
4. **Formato de entrega**: dos bloques ```markdown ... ``` separados, uno por documento,
   listos para copiar/pegar. No reescribas los docs enteros desde cero: solo las secciones
   afectadas, manteniendo el resto idéntico.

---

## 1. Stack

- **Backend**: Node.js + Express **4.18.2**, **ESM** (`"type": "module"`). Sin `require`.
- **BD**: PostgreSQL 16 en Docker local (contenedor `kaizen-postgres`), puerto `5432` solo en `127.0.0.1`. Despliegue futuro en VPS propio.
- **Auth**: JWT propio (`sub` + `role`: `alumno | profesor | admin`). Middleware `SET LOCAL` para RLS.
- **Auth externa**: Google OIDC (Sign in with Google) — ID Token verificado en backend.
- **Pagos**: Stripe (solo tarjeta; efectivo reservado para futuro).
- **Email transaccional**: proveedor a decidir en B10.6 (Resend, Postmark o SMTP propio).
- **Migraciones**: `node-pg-migrate` + `dotenv-cli`.
- **Roles BD**: `migrator` (DDL), `app_user` (RLS, NOBYPASSRLS), `service_role` (BYPASSRLS).
- **Hash password**: `argon2` (argon2id).
- **JWT**: `jsonwebtoken`. **Google**: `google-auth-library`. **MFA admin (B4)**: `otpauth` (ya instalado). **Stripe (B10)**: `stripe`.

---

## 2. Convenciones

- ESM puro: `import` / `export`, nunca `require`.
- Estructura `src/`: `config/`, `middleware/`, `routes/`, `services/`.
- Rutas finas, lógica en `services/`.
- **Nunca** conectar con `DATABASE_URL` (migrator) desde la app. Solo `DATABASE_URL_APP` y `DATABASE_URL_SERVICE`.
- `SET LOCAL` **siempre** dentro de transacción (`BEGIN … COMMIT`), nunca `pool.query` suelto.
- Errores: lanzar objetos con `status`/`code`/`message`; `errorHandler` los formatea.
- **UUIDs**: `profiles.id` es `uuid` **sin default**. La app genera con `crypto.randomUUID()`.
- **Roles**: viven en `user_roles` (tabla separada), no en `profiles`. Se leen al emitir JWT.
- **Credenciales**: viven en `auth_credentials` (tabla separada, B2), no en `profiles`.
- **Express 4**: handlers async con `try/catch` o `asyncHandler(fn)` (helper ya creado en B2).
- **`servicePool` es excepción, no norma**: solo login (`findCredentialsByEmail`, `findCredentialsByGoogleSub`) y jobs administrativos explícitos. Todo lo demás va por `appPool` + `withRlsContext`.
- **Tras aplicar una migración que cambia el contrato con la app** (RLS, columnas nuevas, etc.), **reiniciar el servidor**. El proceso en memoria mantiene el código anterior y puede fallar con errores que parecen de BD.

---

## 3. Variables de entorno (`.env`, no versionado)

```
PORT=3000
DATABASE_URL=postgresql://migrator:...@localhost:5432/kaizen_db
DATABASE_URL_APP=postgresql://app_user:...@localhost:5432/kaizen_db
DATABASE_URL_SERVICE=postgresql://service_role:...@localhost:5432/kaizen_db
# B2 (configuradas y verificadas):
JWT_SECRET=...
JWT_EXPIRES_IN=7d
GOOGLE_CLIENT_ID=...
# GOOGLE_CLIENT_SECRET no hace falta para verificar ID tokens
# B10:
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
# B10.6:
EMAIL_PROVIDER_API_KEY=...
EMAIL_FROM=...
```

`.env.example` versionado con los nombres (sin valores). `.env` en `.gitignore`.

---

## 4. Estado actual

### B0 — CERRADO
- Docker + PostgreSQL 16 en `kaizen-postgres` (127.0.0.1:5432, healthy, volumen persistente).
- Roles verificados por psql: `app_user` (`rolbypassrls=f`), `service_role` (`rolbypassrls=t`), `migrator` (`rolbypassrls=f`).
- `.env` con las tres URLs apuntando a roles distintos.
- Migración `001_initial_setup` ejecutada: 23 tablas, owner `migrator`, RLS desactivado (correcto hasta B3).
- `package.json` con scripts `migrate`/`migrate:down`/`migrate:create` vía `dotenv-cli`.

### B1 — CERRADO
- `src/config/database.js`:
  - Dos pools independientes: `appPool` ← `DATABASE_URL_APP` (`app_user`), `servicePool` ← `DATABASE_URL_SERVICE` (`service_role`).
  - `import 'dotenv/config'` al inicio; `pool.on('error')` no letal; `application_name` `kaizen-app`/`kaizen-service`.
  - `pingPool(pool)` → `{ ok: boolean, error?: string }` (forma consistente en éxito y fallo).
  - `pingAll()` → `{ app, service }`, cada uno `{ ok, error? }`.
  - `closePools()` con `Promise.allSettled`.
- `src/middleware/errorHandler.js`:
  - `notFound(req,res)` → 404 JSON `{ error:'not_found', path }`.
  - `errorHandler(err,req,res,next)` con firma de 4 args; mensaje genérico en 500 si `NODE_ENV=production`.
- `src/index.js`:
  - `import 'dotenv/config'` primero; `express.json({limit:'1mb'})`; `trust proxy 1`.
  - `GET /health` → pinga ambos pools, 200 con `{ status:'ok', uptime, db:{app:{ok:true},service:{ok:true}}, timestamp }` o 503 `degraded`.
  - `notFound` + `errorHandler` montados al final.
  - Cierre limpio en `SIGINT`/`SIGTERM`: `server.close()` + `closePools()` + `process.exit(0)`.
- Verificado: `/health` → 200 `ok`, ruta inexistente → 404 JSON, logs de arranque muestran `app_user` y `service_role`.

### B2 — CERRADO
Auth base (local + Google OIDC) + JWT + middleware `SET LOCAL`.

**Migración `002_auth_credentials.js` aplicada:**
- Tabla `auth_credentials`:
  - `profile_id uuid PK → profiles(id) ON DELETE CASCADE`
  - `email text NOT NULL UNIQUE`
  - `password_hash text NULL`
  - `google_sub text NULL`
  - `email_verified boolean NOT NULL DEFAULT false`
  - `created_at`, `updated_at` timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
- Índice único parcial `auth_credentials_google_sub_idx` (`WHERE google_sub IS NOT NULL`).
- Check `auth_credentials_login_method_check`: `password_hash IS NOT NULL OR google_sub IS NOT NULL`.
- Trigger `auth_credentials_set_updated_at` con función `set_updated_at()`.
- `user_roles.id` migrado a `GENERATED BY DEFAULT AS IDENTITY`.

**Dependencias añadidas:** `jsonwebtoken`, `argon2`, `google-auth-library`.

**Archivos creados:**
- `src/config/auth.js` → exporta `JWT_SECRET`, `JWT_EXPIRES_IN`, `GOOGLE_CLIENT_ID`; falla al arrancar si falta alguno.
- `src/middleware/asyncHandler.js` → helper para Express 4.
- `src/middleware/index.js`, `src/routes/index.js`, `src/services/index.js` → barrels de re-export.
- `src/services/password.js` → `hashPassword` (argon2id) / `verifyPassword`.
- `src/services/jwt.js` → `signToken({sub, role})` / `verifyToken(token)`.
- `src/services/google.js` → `verifyGoogleIdToken(idToken)` con `audience: GOOGLE_CLIENT_ID`.
- `src/services/auth.js`:
  - `registerLocal({email, password, displayName})` → transacción: `profiles` + `auth_credentials` + `user_roles` (`alumno`) → JWT.
  - `loginLocal({email, password})` → verifica argon2 → JWT.
  - `loginGoogle({idToken})` → resuelve por `google_sub` → si email existe sin `google_sub` devuelve 409 `link_required` → si no existe crea usuario con `password_hash = NULL`.
  - Errores con `code`: `email_taken`, `invalid_credentials`, `weak_password`, `link_required`.
- `src/middleware/auth.js`:
  - `requireAuth`: valida Bearer JWT → `req.user = { id, role }`.
  - `requireRole(...roles)`: 403 si rol insuficiente.
  - `withRlsContext(handler)`: abre transacción en `appPool`, `set_config('app.current_user_id', id, true)` + `set_config('app.current_role', role, true)`, ejecuta handler, commit/rollback.
- `src/routes/auth.js`: `POST /auth/register`, `POST /auth/login`, `POST /auth/google`, `GET /auth/me` (protegida + `withRlsContext`).
- `src/index.js`: monta `app.use('/auth', authRouter)`.

**Verificado manualmente:**
- Registro local → 201 `{ token, user: { id, email, role: "alumno" } }`.
- Login local OK → 200 con token; password mal → 401 `invalid_credentials`.
- `/auth/me` con token → 200 con `rls_context.uid` = `req.user.id`; sin token o token inválido → 401.
- Registro duplicado → 409 `email_taken`.
- `/auth/google` con ID token real (OAuth 2.0 Playground con `GOOGLE_CLIENT_ID` propio) → 200 con `token` y `user` creado con `password_hash = NULL` y `google_sub`. **Verificado con cuenta real.**
- Caso `409 link_required`: implementado, no probado con cuenta real (ver §8).

**Repo Git (4 commits, `main` limpio):**
```
e01ec7a feat(B0): migración inicial con 23 tablas
02c91ca chore: andamiaje inicial del repo (B0/B1)
1f21843 docs: cerrar B2 en contexto y plan de bloques
4356ba5 feat(B2): auth base con JWT, Google OIDC y middleware SET LOCAL
```
`.env` ignorado en `.gitignore` (línea 35). `scripts/migrate.js` placeholder borrado; `scripts/README.md` añadido.

### B3 — CERRADO
RLS Fase 1 en 6 tablas + tests por rol + refactor de `createUser` y login.

**Migración `003_rls_fase1.js` aplicada:**
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + `ALTER TABLE ... FORCE ROW LEVEL SECURITY` en las 6 tablas: `profiles`, `auth_credentials`, `user_roles`, `user_mfa`, `audit_log`, `academy_settings`.
- Políticas `CREATE POLICY` según la tabla de §5 "RLS (Fase 1, cerrada en B3)". Todas con `TO app_user`.
- `REVOKE UPDATE, DELETE ON audit_log FROM app_user` (doble barrera append-only).
- `down`: `DROP POLICY` de cada política, `NO FORCE` + `DISABLE ROW LEVEL SECURITY`, `GRANT UPDATE, DELETE ON audit_log TO app_user` para restaurar el estado previo, y borrado de la fila de `pgmigrations`.
- Verificado `migrate:down` → `migrate` → `migrate:down` sin error.

**Refactor de `src/services/auth.js`:**
- `createUser` (helper interno compartido por `registerLocal` y `loginGoogle`-nuevo):
  - Genera `profileId = crypto.randomUUID()` **antes** de abrir la transacción.
  - Dentro de `appPool` + `BEGIN`:
    1. `SELECT set_config('app.current_user_id', $1, true)` con `profileId`.
    2. `SELECT set_config('app.current_role', 'alumno', true)`.
    3. `INSERT INTO profiles (id, display_name) ...`.
    4. `INSERT INTO auth_credentials (profile_id, email, password_hash, google_sub, email_verified) ...`.
    5. `INSERT INTO user_roles (user_id, role) VALUES ($1, 'alumno')`.
    6. `COMMIT`.
  - **Todas** las llamadas dentro de la transacción usan `client.query(...)`, nunca `appPool.query(...)`. Esto es crítico: si se mezclan, el `set_config` cae en un cliente y el `INSERT` en otro, y RLS bloquea con `42501`.
  - Cumple `profiles_insert_self` (`WITH CHECK id = uid`), `auth_credentials_insert_self` (`profile_id = uid`) y `user_roles_insert_self_alumno_or_admin` (`user_id = uid AND role = 'alumno'`).
- `loginLocal` / `loginGoogle`:
  - `findCredentialsByEmail(email)` y `findCredentialsByGoogleSub(googleSub)` usan **`servicePool`** (única lectura de `auth_credentials` sin JWT). Documentado como excepción.
  - Tras verificar credenciales, la lectura de `user_roles` para emitir JWT también va por `servicePool`.
  - El login es la **única** ruta sin identidad; todo lo demás va por `appPool` + `withRlsContext`.

**Nuevo script `scripts/test-rls.js` + `package.json`:**
- `"test:rls": "node scripts/test-rls.js"`.
- 14 casos, todos `OK`, exit 0:
  - Alumno A ve su `profiles`; no ve el de B si B no es público; ve perfiles públicos.
  - Alumno A no puede `INSERT` un `profiles` con `id` distinto al suyo (`42501`).
  - Alumno A no puede `UPDATE` el perfil de B (0 filas).
  - Alumno A no puede `SELECT` `auth_credentials` de B (0 filas).
  - Alumno A puede `SELECT` su `user_roles`; no los de B.
  - Alumno A no puede `INSERT` `user_roles` con `role = 'admin'` (`42501`).
  - Profesor ve perfiles de alumnos.
  - Admin ve `auth_credentials` de cualquiera.
  - Admin puede `INSERT` en `audit_log`.
  - Admin **no** puede `UPDATE` ni `DELETE` en `audit_log` (`REVOKE`).
  - `service_role` (vía `servicePool`) lee `auth_credentials` de cualquiera (bypass de RLS).
- `scripts/test-rls.js` es **destructivo** (crea y borra filas reales con `service_role`): **solo local, nunca producción**. B20 lo migrará a BD efímera por test run.

**Verificado manualmente (con el servidor reiniciado tras `migrate`):**
- `npm run test:rls` → `14 OK, 0 FAIL`, exit 0.
- `npm run migrate:down` → `migrate` → `migrate:down` sin error.
- `POST /auth/register` → 201 `{ token, user: { id, email, role: "alumno" } }`. (Primer intento dio `42501` porque el proceso en `:3000` tenía cargado el `auth.js` viejo; **reiniciar el servidor lo resolvió** — ver §2 y §9.)
- `POST /auth/login` → 200 con token (`servicePool` en login funciona con RLS activo).
- `GET /auth/me` con token → 200 con `rls_context.uid` = `req.user.id` (`withRlsContext` operativo).
- `GET /health` → 200 `ok`.

**Repo Git (pendiente de commit al cerrar este bloque):**
- Nuevo commit `feat(B3): RLS Fase 1 en 6 tablas + tests por rol + refactor createUser/login`.
- Commits previos sin cambios.

### B4–B20 — PENDIENTES
Ver `plan-de-bloques.md`.

---

## 5. Decisiones de diseño consolidadas

### Auth
| Decisión | Valor |
|---|---|
| Tabla de credenciales | **`auth_credentials` separada** de `profiles` (B2) |
| Métodos de login | email+password local **y** Google OIDC (no excluyentes) |
| Token de Google a verificar | **ID Token** (OIDC), no access token |
| Librería Google | `google-auth-library` (`OAuth2Client.verifyIdToken`) |
| Vinculación por email | **NO automática**. Exigir login local previo para vincular. |
| Usuario nuevo vía Google | `password_hash = NULL`, `google_sub` seteado |
| JWT propio | `sub` (`profiles.id`) + `role` (de `user_roles`), sin "limitado" en B2 |
| Refresh tokens | Fuera de B2 (B2.5 o B20) |
| MFA | Tabla `user_mfa` ya existe; B4 solo añade endpoints |
| Hash | `argon2` (argon2id) |

### RLS (Fase 1, cerrada en B3)

Tablas con RLS `ENABLE` + `FORCE`: `profiles`, `auth_credentials`, `user_roles`, `user_mfa`, `audit_log`, `academy_settings`.

Notación: `uid = current_setting('app.current_user_id', true)::uuid`, `role = current_setting('app.current_role', true)`. Todas las políticas son `TO app_user`.

| Tabla | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `profiles` | `id = uid OR is_public = true OR role IN ('admin','profesor')` | `id = uid` | `id = uid OR role = 'admin'` | `role = 'admin'` |
| `auth_credentials` | `profile_id = uid OR role = 'admin'` | `profile_id = uid` | `profile_id = uid OR role = 'admin'` | `role = 'admin'` |
| `user_roles` | `user_id = uid OR role IN ('admin','profesor')` | `role = 'admin' OR (user_id = uid AND role = 'alumno')` | `role = 'admin'` | `role = 'admin'` |
| `user_mfa` | `user_id = uid OR role = 'admin'` | `user_id = uid` | `user_id = uid OR role = 'admin'` | `user_id = uid OR role = 'admin'` |
| `audit_log` | `role = 'admin'` | `uid IS NOT NULL` | — (denegado; + `REVOKE`) | — (denegado; + `REVOKE`) |
| `academy_settings` | `uid IS NOT NULL` (cualquier autenticado) | `role = 'admin'` | `role = 'admin'` | `role = 'admin'` |

**Excepciones documentadas:**
- **Login sin identidad**: `loginLocal` / `loginGoogle` leen `auth_credentials` vía `servicePool` (rol `service_role`, `BYPASSRLS`). Helpers: `findCredentialsByEmail`, `findCredentialsByGoogleSub`. Es la **única** ruta sin JWT que toca `auth_credentials`. Cualquier otro acceso va por `withRlsContext` (`appPool`).
- **`audit_log` append-only**: doble barrera (`REVOKE UPDATE, DELETE` + ausencia de política `FOR UPDATE/DELETE`). `service_role` tiene `BYPASSRLS` y técnicamente podría `DELETE`; la protección frente a `service_role` es disciplina de código + auditoría en B20.
- **`registerLocal` y `loginGoogle`-nuevo** usan `createUser` con `set_config('app.current_user_id', nuevoUuid, true)` + `set_config('app.current_role', 'alumno', true)` dentro de la misma transacción `appPool`, **usando siempre `client.query`** (nunca `appPool.query`) para que el GUC y el `INSERT` caigan en el mismo cliente.

**Riesgo residual aceptado en B3:**
- Política `profiles_select` permite a `profesor` leer **todos** los perfiles (necesario para pasar lista en B8). En B13 (perfiles públicos) se revisará si conviene restringir a "solo perfiles de alumnos con reserva activa".
- `academy_settings_select_all_authenticated = uid IS NOT NULL` asume que todos los parámetros son públicos para autenticados. En B5 se revisará si algún parámetro (p. ej. claves Stripe) debe aislarse o si hace falta lectura anónima (añadir `is_public boolean` o política específica).

### Datos de salud
| Decisión | Valor |
|---|---|
| Ubicación | **Tabla separada** `student_health_info` (no columnas en `profiles`) |
| Campos | lesiones, condiciones físicas, experiencia previa (y disciplina), medicación, alergias, contacto de emergencia |
| Flujo | Google/registro crean usuario "desnudo"; health info se completa en onboarding |
| Bloqueo | Backend bloquea reservas (B7), checkout (B10) y operaciones de alumno activo hasta que exista fila |
| Implementación del bloqueo | B4.5 (no en B2) |

### Billing y pagos fallidos
| Decisión | Valor |
|---|---|
| Evento Stripe clave | `invoice.payment_failed` (también `invoice.payment_action_required`, `customer.subscription.updated/deleted`) |
| Datos en `invoices` | Añadir `stripe_invoice_id`, `status`, `attempt_count`, `next_payment_attempt`, `last_payment_error` (jsonb), `hosted_invoice_url` |
| Notificación al alumno | **Email transaccional** en `invoice.payment_failed` (B10.6). Push en B15. |
| Notificación al admin | **Pasiva**: lista en panel (B10.2 + UI en B19). Sin email diario ni push al admin. |
| Lista de morosos | `GET /admin/billing/failed-payments` sobre `invoices` con `status IN ('open','past_due','uncollectible')` |
| Segmentación | B10.1 (modelo + webhook), B10.2 (endpoint admin), B10.6 (emails), B19 (UI) |

### Operativas (heredadas)
1. Solo pago con tarjeta vía Stripe. `cash_payments` vacía para futuro.
2. Cancelación de suscripciones SOLO admin (`cancel-now` / `cancel-at-period-end`).
3. MFA TOTP para admin; tabla `user_mfa` ya existe.
4. Asistencia: manual por profesor + QR dinámico en tablet fija.
   - Tablet autentica con `device_token` (no JWT de usuario).
   - Token hasheado en BD (`device_tokens`).
   - Polling/SSE a `/api/tablet/active-sessions`.
   - QR rota cada N segundos, incluye `session_id`.
   - Ventana de check-in configurable (default 30 min antes, 10 min después).
5. Perfiles públicos con flags granulares (`visible_fields jsonb`, ya en `profiles`).
6. Informes con tablas de agregación nocturna (`student_stats_daily`, `academy_stats_daily` ya existen).
7. Upgrade: prorrateo inmediato (`always_invoice` + `pending_if_incomplete`), disciplinas al instante.
8. Downgrade: sin reembolso, al final del periodo (Subscription Schedule 2 fases), disciplinas al transicionar.
9. Consentimientos: seguro/waiver, protección de datos, derechos de imagen. Menores requieren tutor.
10. `student_health_info` en tabla separada (ver arriba).

---

## 6. Esquema de BD

Owner de todas las tablas: `migrator`. **RLS activo con `FORCE` en las 6 tablas de Fase 1** (desde B3); el resto sigue sin RLS hasta su bloque.

### Tablas

| Tabla | Tipo | Notas |
|---|---|---|
| `academy_settings` | configuración | parámetros globales de la academia (PK `key text`, `value jsonb`) — **RLS Fase 1** |
| `academy_stats_daily` | agregación | stats diarias de academia (B16) |
| `activity_feed` | social | feed de actividad (B14) |
| `attendance` | operativa | asistencia a sesiones (B8) |
| `audit_log` | auditoría | trazas de acciones admin — **RLS Fase 1, append-only**. Columnas: `id uuid PK` (sin default), `actor_id uuid NOT NULL FK profiles(id) ON DELETE RESTRICT`, `action text NOT NULL`, `resource_type text NOT NULL`, `resource_id text NOT NULL`, `changes jsonb`, `created_at timestamptz DEFAULT CURRENT_TIMESTAMP` |
| `auth_credentials` | auth | **credenciales (B2) — RLS Fase 1** |
| `bookings` | operativa | reservas (B7) |
| `cash_payments` | pagos | vacía, reservada para futuro |
| `class_sessions` | operativa | sesiones de clase (B6) |
| `disciplines` | catálogo | disciplinas (B5) |
| `event_registrations` | eventos | inscripciones a eventos |
| `events` | eventos | eventos especiales |
| `invoices` | pagos | facturas (ampliar en B10.1) |
| `pgmigrations` | sistema | control de migraciones |
| `plan_disciplines` | catálogo | relación plan ↔ disciplina (B5) |
| `plans` | catálogo | planes de suscripción (B5) |
| `profiles` | usuarios | **identidad pública — RLS Fase 1** |
| `push_subscriptions` | notificaciones | suscripciones push (B15) |
| `student_stats_daily` | agregación | stats diarias por alumno (B16) |
| `subscription_agreements` | consentimientos | waiver/consentimientos (B4.5) |
| `subscriptions` | pagos | suscripciones Stripe (B10) |
| `user_mfa` | auth | secretos TOTP admin — **RLS Fase 1** |
| `user_roles` | auth | roles por usuario — **RLS Fase 1** |
| `webhook_events` | pagos | idempotencia webhooks Stripe (B10) |

### `profiles` (identidad pública)

```
id             uuid  NOT NULL  (PK)   ← sin default; la app genera
display_name   text
phone          text
avatar_url     text
bio            text
social_links   jsonb
is_public      boolean  DEFAULT false
visible_fields jsonb
created_at     timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
```

Índices: `profiles_pkey` (id), `profiles_is_public_index` parcial `WHERE is_public = true`.
**No** contiene `email`, `password_hash`, `google_sub` ni `role`.

RLS: `ENABLE` + `FORCE`. Políticas `profiles_select`, `profiles_insert_self`, `profiles_update_self_or_admin`, `profiles_delete_admin` (ver §5).

### `auth_credentials` (credenciales, B2)

```
profile_id     uuid  NOT NULL  (PK, FK profiles(id) ON DELETE CASCADE)
email          text  NOT NULL  UNIQUE
password_hash  text            -- NULL si solo Google
google_sub     text            -- NULL si solo password
email_verified boolean NOT NULL DEFAULT false
created_at     timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
updated_at     timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
```

Índices: `auth_credentials_pkey` (profile_id), `auth_credentials_email_key` UNIQUE (email), `auth_credentials_google_sub_idx` UNIQUE parcial `WHERE google_sub IS NOT NULL`.
Check: `password_hash IS NOT NULL OR google_sub IS NOT NULL`.
Trigger: `auth_credentials_set_updated_at` (función `set_updated_at()`).
RLS: `ENABLE` + `FORCE`. Políticas `auth_credentials_select_self_or_admin`, `auth_credentials_insert_self`, `auth_credentials_update_self_or_admin`, `auth_credentials_delete_admin`. **Excepción login** vía `servicePool`.

### `user_roles`

```
id      bigint   NOT NULL  (PK)   ← GENERATED BY DEFAULT AS IDENTITY (desde B2)
user_id uuid     NOT NULL
role    app_role NOT NULL          ← enum {alumno, profesor, admin}
```

Índices: `user_roles_pkey` (id), `user_roles_user_id_index` (user_id).
RLS: `ENABLE` + `FORCE`. Políticas `user_roles_select`, `user_roles_insert_self_alumno_or_admin`, `user_roles_update_admin`, `user_roles_delete_admin`.

### `user_mfa`

```
id                       uuid  NOT NULL  (PK)
user_id                  uuid  NOT NULL  (UNIQUE)
totp_secret_encrypted    text
recovery_codes_encrypted text
mfa_enabled              boolean DEFAULT false
created_at               timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
updated_at               timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
```

Índices: `user_mfa_pkey`, `user_mfa_user_id_index`, `user_mfa_user_id_key` UNIQUE (user_id).
RLS: `ENABLE` + `FORCE`. Políticas `user_mfa_select`, `user_mfa_insert_self`, `user_mfa_update_self_or_admin`, `user_mfa_delete_self_or_admin`.

### `audit_log`

Sin cambios de columnas. RLS: `ENABLE` + `FORCE`. Políticas `audit_log_select_admin`, `audit_log_insert_authenticated`. **Sin política `FOR UPDATE/DELETE`** + `REVOKE UPDATE, DELETE FROM app_user` (append-only, ver §5).

### `academy_settings`

PK `key text`, `value jsonb NOT NULL`. RLS: `ENABLE` + `FORCE`. Políticas `academy_settings_select_all_authenticated`, `academy_settings_insert_admin`, `academy_settings_update_admin`, `academy_settings_delete_admin`.

### `subscriptions`

```
id                     uuid  NOT NULL  (PK)
student_id             uuid  NOT NULL  (FK profiles(id) ON DELETE CASCADE)
plan_id                bigint NOT NULL (FK plans(id) ON DELETE RESTRICT)
status                 sub_status NOT NULL
payment_method         payment_method DEFAULT 'stripe'
current_period_start   timestamptz
current_period_end     timestamptz
cancel_at_period_end   boolean DEFAULT false
cancelled_at           timestamptz
stripe_subscription_id text
created_at             timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
```

### `invoices` (a ampliar en B10.1)

<!-- PENDIENTE: pegar salida de `\d invoices` para rellenar columnas actuales.
     En B10.1 se añadirán: stripe_invoice_id, status, attempt_count,
     next_payment_attempt, last_payment_error, hosted_invoice_url. -->

---

## 7. Estructura del repo

```
kaizen-app-v2/
├── src/
│   ├── config/
│   │   ├── auth.js              ← JWT_SECRET, JWT_EXPIRES_IN, GOOGLE_CLIENT_ID
│   │   └── database.js          ← dos pools (appPool, servicePool)
│   ├── middleware/
│   │   ├── asyncHandler.js      ← helper para Express 4
│   │   ├── auth.js              ← requireAuth, requireRole, withRlsContext
│   │   ├── errorHandler.js      ← notFound + errorHandler
│   │   └── index.js             ← barrel
│   ├── routes/
│   │   ├── auth.js              ← /auth/register, /auth/login, /auth/google, /auth/me
│   │   └── index.js             ← barrel
│   ├── services/
│   │   ├── auth.js              ← registerLocal, loginLocal, loginGoogle, createUser,
│   │   │                          findCredentialsByEmail, findCredentialsByGoogleSub
│   │   ├── google.js            ← verifyGoogleIdToken
│   │   ├── index.js             ← barrel
│   │   ├── jwt.js               ← signToken, verifyToken
│   │   └── password.js          ← hashPassword, verifyPassword
│   └── index.js                 ← GET /health, monta /auth, cierre limpio
├── migrations/
│   ├── 001_initial_setup.js     ← 23 tablas
│   ├── 002_auth_credentials.js  ← auth_credentials + user_roles IDENTITY
│   └── 003_rls_fase1.js         ← RLS ENABLE+FORCE + políticas en 6 tablas
├── scripts/
│   ├── test-rls.js              ← tests por rol (npm run test:rls), destructivo, solo local
│   └── README.md                ← scripts de operación futuros
├── db-architecture.md
├── docker-compose.yaml
├── contexto-proyecto.md         ← este documento
├── plan-de-bloques.md           ← hoja de ruta
├── README.md
├── .env                         ← no versionado (ignorado)
├── .env.example                 ← plantilla versionada
└── package.json                 ← incluye "test:rls"
```

---

## 8. Pendientes inmediatos (antes de escribir B4)

- [ ] **Probar caso `409 link_required`** de `/auth/google` con una cuenta cuyo email ya exista con password local (heredado de B2; no bloquea B4 pero sí B20).
- [ ] **Confirmar enums `sub_status` y `payment_method`** (antes de B10).
- [ ] **Pegar `\d invoices`** para rellenar §6 antes de B10.1.
- [ ] **Decidir en B4** el cifrado de `totp_secret_encrypted` y `recovery_codes_encrypted` (AES-256-GCM con clave en `.env`, p. ej. `MFA_ENCRYPTION_KEY`). No está en `.env` todavía.
- [ ] **Confirmar en B4** si `GET /auth/me` debe devolver también `user_mfa.mfa_enabled` (para que el frontend sepa si pedir TOTP en login).
- [ ] **Limpiar datos de prueba** huérfanos en local: `repro-*@test.local`, `b3-check-*@test.local` en `profiles`/`auth_credentials`/`user_roles`. No rompen nada, pero conviene no acumular. Opcional.

---

## 9. Riesgos conocidos

- **UUID sin default en `profiles`**: si la app olvida generarlo, `INSERT` falla. Centralizado en `createUser` (B3) con `crypto.randomUUID()` antes de la transacción.
- **Mezclar pools**: si alguna ruta usa `servicePool` sin necesidad, se salta RLS. Desde B3, `servicePool` solo se usa en `findCredentialsByEmail` / `findCredentialsByGoogleSub` (login) y jobs administrativos explícitos.
- **Mezclar `client.query` y `appPool.query` dentro de una transacción**: si `set_config` va por un cliente y el `INSERT` por otro, RLS bloquea con `42501`. En `createUser` todas las llamadas usan `client.query`.
- **`SET LOCAL` fuera de transacción**: no aplica y RLS no filtra. Siempre `BEGIN … COMMIT`. `withRlsContext` lo garantiza; `createUser` lo hace manualmente.
- **Servidor viejo tras migración**: tras aplicar una migración que cambia el contrato con la app (RLS, columnas), **reiniciar el servidor**. Síntoma típico: errores `42501` que no se reproducen en un proceso Node limpio. Añadido a §2 como convención.
- **Google OAuth sin verificar `audience`**: aceptar tokens de otras apps. Siempre `audience: GOOGLE_CLIENT_ID`.
- **`GOOGLE_CLIENT_ID` ausente en `.env`**: la verificación falla con `payload audience != requiredAudience`. Mitigado con el check en `src/config/auth.js`.
- **Vinculación automática por email**: account takeover. No hacerlo.
- **Health info en `profiles`**: filtra datos sensibles en perfiles públicos. Tabla separada.
- **No meter `password_hash`/`google_sub` en `profiles`**: mezcla público con secreto y complica RLS. Van en `auth_credentials`.
- ~~**RLS en `auth_credentials` rompe login**~~ → **resuelto en B3**: login usa `servicePool` encapsulado en `findCredentialsByEmail` / `findCredentialsByGoogleSub`.
- ~~**RLS en `profiles` rompe registro**~~ → **resuelto en B3**: `createUser` hace `set_config('app.current_user_id')` + `set_config('app.current_role', 'alumno')` antes del `INSERT`, dentro de la misma transacción `appPool` y con `client.query`.
- **Política `profiles_select` demasiado laxa para `profesor`**: el profesor ve todos los perfiles. Aceptado en B3 (necesario para B8); revisar en B13 si se restringe a "solo perfiles de alumnos con reserva activa".
- **`academy_settings` pública para autenticados**: si en B5 se añaden parámetros sensibles o se necesita lectura anónima, aislar (columna `is_public` o política específica). Riesgo residual aceptado en B3.
- **`audit_log` protegido solo por RLS + `REVOKE`**: `service_role` (BYPASSRLS) podría `DELETE` si se usa mal. Protección real = disciplina de código + auditoría en B20.
- **`scripts/test-rls.js` destructivo**: crea y borra filas reales con `service_role`. **Solo local, nunca producción.** B20 lo migrará a BD efímera por test run.
- **`scripts/test-rls.js` sin framework**: suficiente para B3, pero si crece conviene migrar a Node test runner o Vitest en B20.
- **Webhook Stripe sin idempotencia**: replay duplica facturas. Usar `webhook_events` (B10).
- **Emails de billing sin proveedor decidido**: B10.6 depende de elegir Resend/Postmark/SMTP antes de empezar.