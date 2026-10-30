# Kaizen App — Contexto del proyecto

> Documento vivo. Refleja **dónde estamos**. Se actualiza al cerrar cada bloque.
> La hoja de ruta completa está en `plan-de-bloques.md`.

Última actualización: **2026-10-27 — B4.6 REABIERTO (rediseño Cuenta Familiar)**. B4.5 y B4.5.1 cerrados (commits `65bd98b`, `672d870`). B4.6 se implementó con el modelo "menor con login propio" (commit `bc4685d`) y se **reabre** antes de B5: el hijo pasa a ser un perfil sin credenciales gestionado por su tutor. Plan completo en **`PLAN_FAMILIA.md`**; vocabulario en `CONTEXT.md`; razón en `docs/adr/0002-hijo-sin-credenciales.md`. Sin código escrito todavía para el rediseño. (Las secciones §4 B4.5/B4.5.1 y §8 conservan el detalle histórico de su cierre.)

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
- **Email transaccional**: Resend, por `fetch` y sin SDK (B10.6, ADR 0008). Plan B: Brevo, si se exigen datos en la UE.
- **Migraciones**: `node-pg-migrate` + `dotenv-cli`.
- **Roles BD**: `migrator` (DDL, NOBYPASSRLS), `app_user` (RLS, NOBYPASSRLS), `service_role` (BYPASSRLS).
- **Hash password**: `argon2` (argon2id).
- **JWT**: `jsonwebtoken`. **Google**: `google-auth-library`. **MFA admin (B4)**: `otpauth`. **Cifrado MFA**: `node:crypto` (AES-256-GCM), sin dependencia externa. **Stripe (B10)**: `stripe`. **Uploads (B4.5.1)**: `express.raw` nativo (cuerpo `application/pdf`), sin dependencia extra.

---

## 2. Convenciones

- ESM puro: `import` / `export`, nunca `require`.
- Estructura `src/`: `config/`, `middleware/`, `routes/`, `services/`.
- Rutas finas, lógica en `services/`.
- **Nunca** conectar con `DATABASE_URL` (migrator) desde la app. Solo `DATABASE_URL_APP` y `DATABASE_URL_SERVICE`.
- `SET LOCAL` **siempre** dentro de transacción (`BEGIN … COMMIT`), nunca `pool.query` suelto.
- Errores: lanzar objetos con `status`/`code`/`message`; `errorHandler` los formatea.
- **UUIDs**: `profiles.id` y `user_agreements.id` son `uuid` **sin default**. La app genera con `crypto.randomUUID()`.
- **Roles**: viven en `user_roles` (tabla separada), no en `profiles`. Se leen al emitir JWT.
- **Credenciales**: viven en `auth_credentials` (tabla separada, B2), no en `profiles`.
- **Express 4**: handlers async con `try/catch` o `asyncHandler(fn)` (helper ya creado en B2).
- **`servicePool` es excepción, no norma**: solo login (`findCredentialsByEmail`, `findCredentialsByGoogleSub`) y jobs administrativos explícitos. Todo lo demás va por `appPool` + `withRlsContext`.
- **Tras aplicar una migración que cambia el contrato con la app** (RLS, columnas nuevas, etc.), **reiniciar el servidor**. El proceso en memoria mantiene el código anterior y puede fallar con errores que parecen de BD.
- **`withRlsContext` firma canónica `(req, res, client)`** desde B4.5. `res` es siempre Response de Express; `client` es siempre el client de `appPool` (dentro de transacción con `SET LOCAL`). Handlers que no usan `client` siguen funcionando (JS ignora argumentos extra). **Handlers que declaraban `(req, client)` o accedían al client por `res` se rompen** con `client.query is not a function` y hay que migrarlos.
- **`withRlsContext` serializa el resultado del handler** si este devuelve algo (`if (result !== undefined) res.json(result)`). Si el handler hace `res.json(...)` él mismo y devuelve `undefined`, no se duplica. Fix aplicado en B4.
- **`dotenv-cli` expone el binario como `dotenv`**, no como `dotenv-cli`. Los scripts de `package.json` deben invocar `dotenv -e .env -- …`.

---

## 3. Variables de entorno (`.env`, no versionado)
PORT=3000
DATABASE_URL=postgresql://migrator:...@localhost:5432/kaizen_db
DATABASE_URL_APP=postgresql://app_user:...@localhost:5432/kaizen_db
DATABASE_URL_SERVICE=postgresql://service_role:...@localhost:5432/kaizen_db

B2 (configuradas y verificadas):
JWT_SECRET=...
JWT_EXPIRES_IN=7d
GOOGLE_CLIENT_ID=...

GOOGLE_CLIENT_SECRET no hace falta para verificar ID tokens
B4 (configuradas y verificadas):
MFA_ENCRYPTION_KEY=<32 bytes base64 o 64-char hex>
MFA_TOKEN_EXPIRES_IN=5m
MFA_TOTP_ISSUER=Kaizen App
MFA_RECOVERY_CODE_COUNT=10

B4.5.1 (a configurar):
AGREEMENTS_STORAGE_PATH=./storage/agreements

B10:
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
STRIPE_STATEMENT_DESCRIPTOR="KAI ZEN TRAINING CAMP"   # B11: en los Products de Kaizen (no en la cuenta, que comparte maat); src/config/stripe.js valida al arrancar

B10.6:
EMAIL_TRANSPORT=log            # log | resend; src/config/email.js valida al arrancar
RESEND_API_KEY=...             # obligatoria con resend
EMAIL_FROM="Kaizen <onboarding@resend.dev>"   # remitente de pruebas; en producción Kaizen <avisos@mail.<dominio>>
EMAIL_REPLY_TO=...             # buzón de la academia (opcional; el pie lo da como contacto)
EMAIL_LOG_PATH=./storage/emails.log

text

`MFA_ENCRYPTION_KEY` **obligatoria**: `src/config/mfa.js` falla al arrancar si falta o no mide 32 B. Acepta base64 (44 chars) o hex (64 chars). Generar con:
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

`AGREEMENTS_STORAGE_PATH` (B4.5.1): ruta **fuera** de `src/` y **fuera** de `uploads` genéricos. Default `./storage/agreements`. El directorio se crea al arrancar si no existe. Añadir `storage/` a `.gitignore` (excepto `storage/.gitkeep`).

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
e01ec7a feat(B0): migración inicial con 23 tablas
02c91ca chore: andamiaje inicial del repo (B0/B1)
1f21843 docs: cerrar B2 en contexto y plan de bloques
4356ba5 feat(B2): auth base con JWT, Google OIDC y middleware SET LOCAL

text
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
- `"test:rls": "dotenv -e .env -- node scripts/test-rls.js"`.
- 14 casos, todos `OK`, exit 0.
- `scripts/test-rls.js` es **destructivo**: solo local, nunca producción. B20 lo migrará a BD efímera por test run.

**Verificado manualmente (con el servidor reiniciado tras `migrate`):**
- `npm run test:rls` → `14 OK, 0 FAIL`, exit 0.
- `npm run migrate:down` → `migrate` → `migrate:down` sin error.
- `POST /auth/register` → 201. (Primer intento dio `42501` por proceso viejo; reiniciar el servidor lo resolvió — ver §2 y §9.)
- `POST /auth/login` → 200 con token.
- `GET /auth/me` con token → 200 con `rls_context.uid` = `req.user.id`.
- `GET /health` → 200 `ok`.

**Repo Git:**
- Commit `feat(B3): RLS Fase 1 en 6 tablas + tests por rol + refactor createUser/login`.

### B4 — CERRADO
MFA TOTP admin: setup + activate + verify (login en dos pasos con `mfa_token`), recovery codes de un solo uso, AES-256-GCM para secretos, fix de `withRlsContext`. Verificación HTTP end-to-end 1a–1i.

**Sin migración nueva.** `user_mfa` ya existía (con RLS desde B3). No se tocó el esquema.

**Variables nuevas en `.env` / `.env.example`:** `MFA_ENCRYPTION_KEY` (obligatoria, 32 B), `MFA_TOKEN_EXPIRES_IN` (default `5m`), `MFA_TOTP_ISSUER` (default `Kaizen App`), `MFA_RECOVERY_CODE_COUNT` (default `10`).

**Archivos nuevos:**
- `src/config/mfa.js` → exporta `MFA_ENCRYPTION_KEY` (Buffer 32 B; falla al arrancar si falta o no mide 32 B; acepta base64 o hex), `MFA_TOKEN_EXPIRES_IN`, `MFA_TOTP_ISSUER`, `MFA_RECOVERY_CODE_COUNT`.
- `src/services/crypto.js` → `encrypt` / `decrypt` con AES-256-GCM. Formato: `base64( iv (12 B) || authTag (16 B) || ciphertext )`. Sin dependencia externa (`node:crypto`).
- `src/services/mfa.js` → lógica de negocio:
  - `setupMfa(profileId, role, label)` → genera secreto TOTP (160 bits), URI `otpauth://`, N recovery codes base32 (10 chars, alfabeto sin 0/1/I/O), los hashea con argon2id, cifra secreto y JSON de hashes con AES-256-GCM, guarda en `user_mfa` (`mfa_enabled = false`). Devuelve `{ otpauth_uri, recovery_codes }` (codes en claro, **una sola vez**). 409 `mfa_already_enabled` si ya estaba activo. Sobrescribe si había fila con `mfa_enabled = false`.
  - `verifyAndEnableMfa(profileId, role, code)` → valida TOTP (`window: 1`) y activa `mfa_enabled`. Solo TOTP (no recovery codes). Errores: 400 `invalid_request`, 400 `mfa_not_setup`, 400 `invalid_totp`.
  - `verifyMfaCode(profileId, role, code)` → para login: prueba TOTP (`window: 1`); si falla, prueba recovery codes; si acierta, **lo elimina del array persistido** (un solo uso real). Devuelve `true/false`.
  - `getMfaStatus(profileId, role)` → abre transacción propia (login). `{ enabled }`.
  - `getMfaStatusWithClient(client, profileId)` → usa el `client` de `withRlsContext` (`/auth/me`).
  - `withRlsSelf(profileId, role, fn)` interno: **exige `role` real**; 500 `rls_context_missing` si falta. Usa `client.query` para todo.
- `src/middleware/mfa.js`:
  - `signMfaToken({ sub, role })` → JWT con `{ sub, role, mfa: 'pending' }`, expiración `MFA_TOKEN_EXPIRES_IN`.
  - `requireMfaToken(req, res, next)` → valida `Authorization: Bearer` con `mfa: 'pending'`; deja `req.mfa = { userId, role }`. Rechaza JWT normales.
  - `requireMfaTokenFromBody(req, res, next)` → variante que lee `req.body.mfa_token`; misma validación; mismo `req.mfa`.

**Archivos modificados:**
- `src/middleware/auth.js`:
  - **Fix** `withRlsContext`: añadido `if (result !== undefined) res.json(result);` tras `COMMIT`. Antes no serializaba el resultado → `/auth/me` devolvía body vacío (bug de B2/B3 detectado en B4).
  - `requireAuth`: **rechaza tokens con `mfa: 'pending'`** (401 `invalid_token`).
  - `requireAuth`: rechaza también `sub`/`role` ausentes.
- `src/services/auth.js`:
  - `loginLocal` / `loginGoogle` → ya **no firman token**; devuelven `{ profileId, email, role }`. La ruta decide.
  - `registerLocal` y `createUser` sin cambios.
- `src/routes/auth.js`:
  - `POST /login` y `POST /google`: si MFA activo → `{ mfa_required: true, mfa_token }`; si no → `{ token, user }`.
  - `GET /me`: devuelve `{ user, mfa_enabled, rls_context }` (ahora sí se serializa).
  - Nuevos: `POST /auth/mfa/setup`, `POST /auth/mfa/activate`, `POST /auth/mfa/verify`.
- `package.json`: `"test:mfa": "dotenv -e .env -- node scripts/test-mfa.js"`. Los scripts usan el binario `dotenv`.

**Archivos nuevos (scripts):**
- `scripts/test-mfa.js` + `"test:mfa"`. Autocontenido: crea admin de prueba con `service_role`, 13 casos, limpia en `finally`. **Destructivo, solo local**.

**Verificación automatizada:**
- `npm run test:mfa` → **13 OK, 0 FAIL**, exit 0.

**Verificación HTTP manual end-to-end (contra el servidor, admin `admin-mfa-manual@test.local` creado con `service_role`, borrado al final):**

| Paso | Petición | Resultado observado |
|---|---|---|
| 1a | `POST /auth/login` (sin MFA todavía) | `200 { token, user: { id, email, role: "admin" } }` |
| 1b | `POST /auth/mfa/setup` con token | `201 { otpauth_uri, recovery_codes: [10] }` |
| 1c | `POST /auth/mfa/activate` con TOTP | `200 { enabled: true }` |
| 1d | `POST /auth/login` (MFA activa) | `200 { mfa_required: true, mfa_token }` (sin `token` ni `user`) |
| 1e | `POST /auth/mfa/verify` con `mfa_token` + TOTP | `200 { token, user: { id, role } }` (sin `email`) |
| 1f | `GET /auth/me` con token final | `200 { user, mfa_enabled: true, rls_context }` |
| 1g | `POST /auth/mfa/verify` con recovery code | `200 { token, user: { id, role } }` (code consumido) |
| 1h | Reintento del mismo recovery code | `401 { error: "unauthorized", code: "invalid_mfa_code" }` |
| 1i | `GET /auth/me` con `mfa_token` | `401` (verificado indirectamente: `requireAuth` rechaza `mfa: 'pending'`; verificado también que `requireMfaTokenFromBody` rechaza un JWT normal con `invalid_mfa_token`) |

**Decisiones de diseño tomadas en B4 (detalladas en §5 "MFA (B4)"):**
- MFA exclusivo de `admin` (tabla genérica; restricción en capa de app).
- Cifrado AES-256-GCM con `MFA_ENCRYPTION_KEY` (32 B).
- Recovery codes: 10 códigos base32 de 10 chars, **hasheados con argon2id**, JSON en `user_mfa.recovery_codes_encrypted`.
- Login MFA en **dos pasos** con `mfa_token` intermedio (JWT 5 min, `mfa: 'pending'`).
- Dos rutas separadas: `POST /auth/mfa/activate` (JWT normal + `{ code }`) y `POST /auth/mfa/verify` (`mfa_token` + `{ code }`).
- `/auth/mfa/verify` devuelve `{ token, user: { id, role } }` **sin `email`**, coherente con `/auth/me`.
- QR: el backend devuelve **URI `otpauth://` en claro**; el frontend la renderiza.

**Repo Git:** commit `feat(B4): MFA TOTP admin (setup/activate/verify, recovery codes, AES-256-GCM) + fix withRlsContext`.

### B4.5 — IMPLEMENTADO
> 2026-10-30: el fix del owner de la vista está aplicado (`test:rls` 22 OK) y el bloque tiene commit (`65bd98b`). Lo de abajo es el registro de entonces.
`student_health_info` (1:1) + `user_agreements` (3 tipos obligatorios, versionados) + helper `requireCompleteProfile` + endpoints `/me/*` + `GET /agreements/:type/current`. **Todo implementado y verificado excepto el test de la vista del profesor**, que falla por owner incorrecto. Ver §8 para el fix exacto.

**Migración `004_student_health_and_agreements.js` aplicada** (reversible: `migrate:down` → `migrate` → `migrate:down` verificado):
- `student_health_info`: `profile_id uuid PK → profiles(id) ON DELETE CASCADE`; `injuries`, `conditions`, `previous_experience`, `previous_discipline`, `medication`, `allergies` todos `text NULL`; `emergency_contact_name text NULL`, `emergency_contact_phone text NULL` (el helper los exige, no la tabla); `created_at`, `updated_at` `timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP`; trigger `student_health_info_set_updated_at` (reutiliza `set_updated_at()` de B2).
- `user_agreements`: `id uuid PK` (sin default; app genera con `crypto.randomUUID()`), `profile_id uuid NOT NULL FK profiles(id) ON DELETE CASCADE`, `type text NOT NULL` con `CHECK (type IN ('waiver','data_protection','rights_of_image'))`, `version text NOT NULL`, `signed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP`, `ip inet`, `user_agent text`. `UNIQUE(profile_id, type, version)`. Índice `user_agreements_profile_type_idx (profile_id, type)`. Append-only: `REVOKE UPDATE, DELETE ON user_agreements FROM app_user` (verificado: `app_user=ar/migrator`, sin `w` ni `d`).
- Vista `student_health_professor_view`: `SECURITY DEFINER` (`security_barrier = true, security_invoker = false`), owner **`migrator`** ← **PENDIENTE → `service_role`**; `WHERE current_setting('app.current_role', true) = 'profesor'`; expone solo `profile_id`, `injuries`, `conditions`. `GRANT SELECT` a `app_user`.
- RLS `ENABLE` + `FORCE` en ambas tablas. Políticas `TO app_user`:
  - `student_health_info_select`: `profile_id = uid OR role = 'admin'`.
  - `student_health_info_insert_self`: `WITH CHECK profile_id = uid`.
  - `student_health_info_update_self_or_admin`: USING y WITH CHECK `profile_id = uid OR role = 'admin'`.
  - `student_health_info_delete_self_or_admin`: USING `profile_id = uid OR role = 'admin'`.
  - `user_agreements_select`: `profile_id = uid OR role = 'admin'`.
  - `user_agreements_insert_self`: `WITH CHECK profile_id = uid`.
  - **Sin política UPDATE ni DELETE** en `user_agreements` (append-only por doble barrera: `REVOKE` + ausencia de política).

**Archivos nuevos:**
- `src/config/agreements.js` → `AGREEMENT_TYPES = ['waiver','data_protection','rights_of_image']`; `CURRENT_AGREEMENT_VERSIONS = { waiver: '1.0', data_protection: '1.0', rights_of_image: '1.0' }`. Validación al arrancar: cada tipo tiene versión; cada versión cumple `/^\d+\.\d+$/`; no hay claves huérfanas en el mapa. Falla al importar si algo no cuadra (verificado: con `waiver: 'undefined'` aborta con `[config/agreements] Versión inválida para 'waiver': "undefined". Formato esperado: X.Y (ej. 1.0).`).
- `src/services/profile.js` → `requireCompleteProfile(studentId, role)` → `{ ok: true }` | `{ ok: false, missing: [...] }`. `missing ⊆ ['display_name','health_info','emergency_contact','waiver','data_protection','rights_of_image']`. Si `role !== 'alumno'` devuelve `{ ok: true }` sin tocar BD (admin/profesor no reservan). Abre transacción propia (`appPool` + `BEGIN` + `SET LOCAL` + `COMMIT`), todas las queries por `client.query`. Una query para los 3 agreements con `unnest`.
- `src/middleware/requireCompleteProfile.js` → envuelve el helper. `403 { error:'forbidden', code:'profile_incomplete', missing:[...] }` si falta algo. `500 rls_context_missing` si `req.user` no está (bug de composición). Import con alias (`checkProfileComplete`) para no colisionar con el nombre del middleware.
- `src/routes/me.js`:
  - `GET /me/profile-status` (`requireAuth`) → `{ ok, missing? }`.
  - `POST /me/health` (`requireAuth` + `withRlsContext`) → upsert parcial de `student_health_info`. Valida: al menos un campo de `allowed[]` (400 `no_fields`); tipos `string | null` (400 `invalid_field_type` con `field`). `ON CONFLICT (profile_id) DO UPDATE SET` solo de los campos enviados. Devuelve `{ health: {...} }`.
  - `POST /me/agreements` (`requireAuth` + `withRlsContext`) → `{ type, version }`. Valida `type ∈ AGREEMENT_TYPES` (400 `invalid_type` + `allowed`); `version === CURRENT_AGREEMENT_VERSIONS[type]` (400 `invalid_version` + `expected`). `INSERT ... ON CONFLICT (profile_id, type, version) DO NOTHING RETURNING ...`; si 0 filas → 409 `agreement_already_signed`. Registra `ip` (`req.ip`) y `user_agent` (`req.get('user-agent')`). Devuelve `{ agreement: { id, type, version, signed_at } }`.
  - Importa `crypto` de `node:crypto` para `crypto.randomUUID()`.
- `src/routes/agreements.js`:
  - `GET /agreements/:type/current` (`requireAuth`) → sirve placeholder `text/plain; charset=utf-8` con headers `X-Agreement-Type` y `X-Agreement-Version`. 404 `unknown_agreement_type` + `allowed` si el tipo no es válido. **B4.5.1 lo sustituye por el PDF publicado desde `AGREEMENTS_STORAGE_PATH` sin cambiar la firma.**
- Montaje en `src/index.js`: `app.use('/me', meRouter)` y `app.use('/agreements', agreementsRouter)`.

**Archivos modificados:**
- `src/middleware/auth.js` — **cambio de firma de `withRlsContext`**: el handler recibe `(req, res, client)` (antes `(req, res)`). `client` es el client de `appPool` dentro de transacción con `SET LOCAL`. Retrocompatible con handlers que no usan el tercer argumento; **rompe handlers que declaraban `(req, client)`** (patrón de facto en B4). Detectado en `/auth/me`.
- `src/routes/auth.js` — **fix** del handler de `/me`: firma `(req, res, client)` (antes `(req, client)`, lo que hacía que `client` dentro del handler fuera `res` → `client.query is not a function`). Ahora pasa `client` a `getMfaStatusWithClient(client, req.user.id)` correctamente.

**Tests (`scripts/test-rls.js`):**
- `seed()` ampliado: inserta `student_health_info` para A (con emergency contact) y B (sin emergency contact), y 3 `user_agreements` para A en `v1.0`. B sin agreements en el seed.
- `cleanup()` ampliado: borra `user_agreements` y `student_health_info` antes de `profiles` (por FK CASCADE, pero explícito).
- 8 casos nuevos añadidos al final del `try`:
  1. `B4.5 — alumno A NO ve el health de B` → OK.
  2. `B4.5 — alumno A SÍ ve su propio health` → OK.
  3. `B4.5 — admin SÍ ve el health de A` → OK.
  4. `B4.5 — profesor NO ve la tabla base student_health_info` → OK.
  5. `B4.5 — profesor SÍ ve la vista student_health_professor_view (solo 3 columnas)` → **FAIL** (0 filas).
  6. `B4.5 — alumno NO puede UPDATE en user_agreements (REVOKE)` → OK.
  7. `B4.5 — alumno NO puede DELETE en user_agreements (REVOKE)` → OK.
  8. `B4.5 — alumno NO ve los agreements de B` → OK.
- Resultado actual: **21 OK, 1 FAIL**.

**Verificación HTTP manual end-to-end contra el servidor (alumno `b3-check-1@test.local`):**
- `GET /auth/me` → `200 { user: { id, role: "alumno" }, mfa_enabled: false, rls_context: { uid, role: "alumno" } }` (fix confirmado).
- `GET /me/profile-status` (sin health ni agreements) → `{ ok: false, missing: ["health_info","waiver","data_protection","rights_of_image"] }` (`display_name` no aparece porque el registro le puso uno).
- `POST /me/health` con `injuries` + `emergency_contact_*` → `200 { health: { profile_id: <uid>, injuries: "ninguna", conditions: null, ..., emergency_contact_name: "Ana", emergency_contact_phone: "+34600000000", created_at, updated_at } }`. `health.profile_id` coincide con `rls_context.uid` → RLS `insert_self` OK.
- `POST /me/agreements` × 3 (`waiver`, `data_protection`, `rights_of_image` en `v1.0`) → `200 { agreement: { id, type, version, signed_at } }` × 3.
- `GET /me/profile-status` → `{ ok: true }`.
- Edge-cases verificados (todos OK):
  - `POST /me/health` body `{}` → `400 { error:"invalid_request", code:"no_fields", allowed:[...] }`.
  - `POST /me/health` `injuries: 123` → `400 { error:"invalid_request", code:"invalid_field_type", field:"injuries" }`.
  - Re-firma `waiver@1.0` → `409 { error:"conflict", code:"agreement_already_signed", type:"waiver", version:"1.0" }`.
  - `POST /me/agreements` `{ type:"waiver", version:"9.9" }` → `400 { error:"invalid_request", code:"invalid_version", expected:"1.0" }`.
  - `POST /me/agreements` `{ type:"otro", version:"1.0" }` → `400 { error:"invalid_request", code:"invalid_type", allowed:[...] }`.
  - `GET /agreements/waiver/current` → `text/plain` con `Kaizen App — waiver v1.0` + placeholder.
  - `GET /agreements/otro/current` → `404 { error:"not_found", code:"unknown_agreement_type", allowed:[...] }`.
  - `POST /me/health` sin token → `401 { error:"unauthorized", code:"missing_token" }`.

**Fix para cerrar B4.5 (aplicado; ver §8):**
1. `npm run migrate:down` (revierte `004`).
2. En `migrations/004_student_health_and_agreements.js`, cambiar `pgm.sql('ALTER VIEW student_health_professor_view OWNER TO migrator;')` → `pgm.sql('ALTER VIEW student_health_professor_view OWNER TO service_role;')`. Actualizar el comentario encima de la vista para explicar que `SECURITY DEFINER` con owner `service_role` (`BYPASSRLS`) es lo que permite que la vista devuelva filas; `migrator` es `NOBYPASSRLS` y con `FORCE ROW LEVEL SECURITY` en la tabla base, la vista devolvía 0 filas.
3. `npm run migrate`.
4. Reiniciar el servidor.
5. `npm run test:rls` → esperado **22 OK, 0 FAIL** (o **24 OK** si se añaden los 2 tests opcionales de alumno/admin sobre la vista).
6. Commit `feat(B4.5): student_health_info + user_agreements + requireCompleteProfile`.

### B4.5.1 — IMPLEMENTADO (commit `672d870`; la verificación HTTP manual no consta)
Migración `005_agreement_documents.js`: tabla `agreement_documents` (ciclo borrador → publicado → retirado, índice único parcial de una vigente por tipo, RLS, sin DELETE) y `UNIQUE(user_id)` en `user_roles` (ADR `docs/adr/0001-rol-unico-por-perfil.md`). `getCurrentVersions` lee de BD; `src/config/agreements.js` solo exporta `AGREEMENT_TYPES` y `VERSION_RE`. Endpoints admin en `src/routes/admin/agreements.js`: `GET /admin/agreements/documents`, `POST /admin/agreements/documents?type=&version=` (**cuerpo crudo `application/pdf`, ≤ 10 MB, sin multipart ni dependencia nueva**), `POST /admin/agreements/documents/:id/publish` (retira la vigente anterior y audita). `GET /agreements/:type/current` sirve el PDF. Sin `retireDocument`: se retira solo al publicar otro. Un tipo sin documento vigente cuenta como no firmado, así que **ningún alumno tiene el perfil completo hasta que un admin publique los 3 tipos**. Test: `npm run test:agreements`.

### B4.6 — IMPLEMENTADO (nuevo modelo de Cuenta Familiar, commit `920772c`; plan en `PLAN_FAMILIA.md`)
**Primera versión (commit `bc4685d`, sustituida):** migración `006_minors_guardians.js` (`profiles.birth_date`, rol `tutor`, `guardianships` creada solo por admin, `user_agreements.signed_by` + RLS de firma por representación), `birthDate` obligatoria en `POST /auth/register`, `profile_id` opcional en `POST /me/agreements`, `getProfileStatus` menor/adulto, `scripts/test-minors.js`. Modelaba al menor **con login propio**.

**Nuevo modelo (decidido el 2026-10-27, sin implementar):** el tutor se registra, crea a sus hijos (perfiles **sin credenciales**) y gestiona todo por ellos: perfil, ficha de salud, acuerdos, cuota, reservas, eventos y avisos. Se reescribe `006` en el sitio (no hay nada desplegado). Se conserva casi todo el esquema (`birth_date`, `guardianships`, `signed_by`) y se añaden `create_child` (SQL `SECURITY DEFINER`), el helper RLS `is_guardian_of`, políticas de tutor en `student_health_info` y `profiles`, y `GET/POST /me/children` + `PATCH /me/children/:id`. El registro propio exige ≥ 18. El rol `tutor` firma su propio `data_protection`. Decisiones D1–D16 en §5 "Cuenta familiar"; tabla mantener/refactorizar/borrar en `PLAN_FAMILIA.md` §4. **Va antes de B5.**

### B5–B14 — IMPLEMENTADOS · B10.7 y B15–B20 — PENDIENTES
Estado al 2026-10-30 (detalle, decisiones y pendientes de cada bloque en `plan-de-bloques.md`):
- **Implementados, con commit y tests verdes**: B5 catálogo, B6 clases, sesiones y calendario del alumno (migración `018`, `test:calendar`), B7 reservas, B8 asistencia, B9 check-in QR, B10 Stripe base, B10.1 recibos, B10.2 morosos, B10.3 seguro, B10.5 cambio de plan y de disciplina, B10.6 emails de billing, B11 baja del seguro y cambio de pagador, B13 perfiles públicos, directorio y lectura de `profiles` (migración `017`, `test:profiles`), B14 racha, horas, badges, ranking mensual opt-in y disciplina abierta (migración `019`, `test:progress`).
- **Pendientes**: B10.7 migración de los clientes de maat (al pasar a producción) y B15–B20. Siguiente en orden: **B15**.
- B12 eliminado (absorbido por B4.5 y B10.3).

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
| MFA | Tabla `user_mfa` ya existe; B4 añade endpoints (cerrado) |
| Hash | `argon2` (argon2id) |

### MFA (B4, cerrada)
| Decisión | Valor |
|---|---|
| Alcance B4 | **Solo rol `admin`**. La tabla `user_mfa` es genérica; la restricción vive en la capa de app (`requireRole('admin')` en `/auth/mfa/setup` y `/auth/mfa/activate`). |
| Ampliación futura a profesor/alumno | **Fuera de B4.** Requerirá: (a) cambiar `requireRole('admin')` por `requireAuth` en `/auth/mfa/*`; (b) política "MFA por rol" (en `academy_settings` p. ej. `mfa.required_roles`, o columna `user_mfa.required`) para que el login sepa a quién exigir TOTP; (c) revisar RLS de `user_mfa` (ya es `self OR admin`). |
| Cifrado de secretos TOTP | **AES-256-GCM**, clave de 32 B en `MFA_ENCRYPTION_KEY` (base64 o hex), independiente de `JWT_SECRET`. Formato: `iv (12 B) || authTag (16 B) || ciphertext`, base64. |
| Recovery codes | **10 códigos de 10 caracteres base32** (sin 0/1/I/O), **hasheados con argon2id**. Se reutiliza la columna `user_mfa.recovery_codes_encrypted` (contiene JSON de hashes, no cifrado simétrico). **Un solo uso**: al verificar uno, se elimina del array y se persiste. |
| Flujo de login con MFA | **En dos pasos**, con `mfa_token` intermedio. |
| `POST /auth/login` (admin con `mfa_enabled = true`) | `200 { mfa_required: true, mfa_token }`. `mfa_token`: JWT corto (5 min), `mfa: "pending"`, `sub` = `profiles.id`, rechazado por `requireAuth`; solo `requireMfaTokenFromBody` lo acepta en `/auth/mfa/verify`. |
| `POST /auth/mfa/activate` | Activación: `requireAuth` + `requireRole('admin')` + `{ code }` (TOTP). Pone `mfa_enabled = true`. |
| `POST /auth/mfa/verify` | Login: `requireMfaTokenFromBody` + `{ mfa_token, code }`. Acepta TOTP o recovery code. Emite `{ token, user: { id, role } }`. |
| `POST /auth/mfa/setup` | `requireAuth` + `requireRole('admin')`. Genera secreto + URI + recovery codes (una sola vez), guarda cifrado/hasheado con `mfa_enabled = false`. 409 `mfa_already_enabled` si ya estaba activo. |
| `GET /auth/me` | Devuelve `{ user, mfa_enabled, rls_context: { uid, role } }`. `mfa_enabled` se lee con `getMfaStatusWithClient` dentro del `withRlsContext`. |
| QR | El backend devuelve **URI `otpauth://` en claro**; el frontend la renderiza. |
| Librerías | `otpauth` (TOTP), `argon2` (recovery codes), `node:crypto` (AES-256-GCM). |
| `withRlsSelf` en `src/services/mfa.js` | **Exige `role` real** (no hardcodea `'admin'`). 500 `rls_context_missing` si falta. |

### `withRlsContext` (evolución en B4.5)
| Decisión | Valor |
|---|---|
| Firma del handler | **`(req, res, client)`** desde B4.5. `res` es siempre Response de Express; `client` es siempre el client de `appPool` dentro de transacción con `SET LOCAL`. |
| Retrocompatibilidad | Handlers que no usan el tercer argumento siguen funcionando (JS ignora argumentos extra). |
| Rotura | Handlers que declaraban `(req, client)` (patrón de facto en B4) se rompen con `client.query is not a function`. Migrados en B4.5: `/auth/me` en `src/routes/auth.js`. |
| Serialización | `if (result !== undefined) res.json(result)` tras `COMMIT` (fix de B4). Handlers que llaman a `res.json(...)` y devuelven `undefined` no duplican respuesta. |
| Regla a partir de B4.5 | `res` es siempre Response; `client` es siempre el client. Nunca al revés. |

### Salud y consentimientos (B4.5, decisiones cerradas)
| Decisión | Valor |
|---|---|
| `student_health_info` cardinalidad | **1:1** con `profiles` (`profile_id uuid PK → profiles(id) ON DELETE CASCADE`). Historial de cambios, si hace falta, vía `audit_log` (B8/B20); no se modela historial de salud en B4.5. |
| `student_health_info` campos | Lesiones (`injuries text`), condiciones físicas (`conditions text`), experiencia previa (`previous_experience text`, `previous_discipline text`), medicación (`medication text`), alergias (`allergies text`), contacto de emergencia (`emergency_contact_name text NULL`, `emergency_contact_phone text NULL`), `created_at`, `updated_at`. Trigger `set_updated_at`. **`emergency_contact_*` NULL en tabla**; el helper los exige (permite guardar progreso parcial de onboarding). |
| `student_health_info` RLS | `ENABLE` + `FORCE`. Políticas `TO app_user`: SELECT `profile_id = uid OR role = 'admin'`; INSERT `profile_id = uid`; UPDATE `profile_id = uid OR role = 'admin'`; DELETE `profile_id = uid OR role = 'admin'`. **Profesor NO lee la tabla base.** |
| Vista `student_health_professor_view` | **`SECURITY DEFINER` con owner `service_role` (`BYPASSRLS`)** + `security_barrier = true`. Expone **solo** `profile_id`, `injuries`, `conditions` (sin medicación, alergias, contacto de emergencia, experiencia). Filtro `WHERE current_setting('app.current_role', true) = 'profesor'`. `GRANT SELECT` a `app_user`. **Corrección respecto al diseño original**: el primer intento usó `OWNER TO migrator` (asumiendo que `SECURITY DEFINER` bypassa RLS), pero `migrator` es `NOBYPASSRLS` y `student_health_info` tiene `FORCE ROW LEVEL SECURITY` → la vista devolvía 0 filas. El owner debe ser `service_role`. **Riesgo**: si el `WHERE` se rompe, cualquier rol con `app.current_role = 'profesor'` vería `injuries`/`conditions` de todos los alumnos (acotado a esas 2 columnas clínicas; no escala a medicación/alergias/contacto). Test en `scripts/test-rls.js` cubre los 4 roles. En B8 se restringirá a "alumnos con reserva en sus sesiones" cuando exista `bookings`. |
| Ficha de salud del profesor (B8) | **La vista anterior se elimina en la migración 010**: la sustituye la función `professor_session_health(session)` (`SECURITY DEFINER`, owner `service_role`, `EXECUTE` solo para `app_user`). Exige rol profesor, `trainer_id` = usuario, sesión programada y de hoy (Europe/Madrid); devuelve solo reservas `confirmed` con lesiones, condiciones, alergias, medicación y contacto de emergencia (nunca experiencia ni disciplina previa) y escribe `health.view` en `audit_log` por consulta. Endpoint `GET /professor/sessions/:id/health`. Tests en `scripts/test-attendance.js`. |
| `user_agreements` (nombre) | **Renombrada respecto al plan original** (`subscription_agreements` → `user_agreements`) porque es a nivel de usuario, no de suscripción Stripe. Documentado aquí para evitar confusión en B10/B12/B19. |
| `user_agreements` modelo | `id uuid PK` (sin default; app genera), `profile_id uuid NOT NULL FK profiles(id) ON DELETE CASCADE`, `type text NOT NULL` (`CHECK IN ('waiver','data_protection','rights_of_image')`), `version text NOT NULL`, `signed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP`, `ip inet`, `user_agent text`. `UNIQUE(profile_id, type, version)`. Índice `(profile_id, type)`. |
| `user_agreements` RLS | `ENABLE` + `FORCE`. SELECT `profile_id = uid OR role = 'admin'`; INSERT `profile_id = uid`; UPDATE denegado (append-only); DELETE denegado. `REVOKE UPDATE, DELETE ON user_agreements FROM app_user` (doble barrera, como `audit_log`). Verificado: `app_user=ar/migrator`. |
| Tipos de agreement | **Tres, todos obligatorios**: `waiver`, `data_protection`, `rights_of_image`. Fuente de verdad: `AGREEMENT_TYPES` en `src/config/agreements.js`. Añadir un cuarto tipo = añadir al array + bump de versión + migración de datos. |
| Versionado y re-firma | Cada tipo tiene una **versión vigente** (constante `CURRENT_AGREEMENT_VERSIONS` durante B4.5; desde B4.5.1 se lee de `agreement_documents` con `getCurrentVersions(client)` en `src/services/agreements.js`). Si el alumno firmó una versión anterior, `requireCompleteProfile` lo marca como `missing` hasta que firme la vigente. **Sin migración de datos**: la comparación es en tiempo de consulta. |
| Definición de "perfil completo" | Un alumno está completo si y solo si: (1) `profiles.display_name` no vacío (`trim <> ''`); (2) existe fila en `student_health_info` con `emergency_contact_name` y `emergency_contact_phone` no nulos (el resto de campos clínicos puede estar vacío — el waiver cubre el riesgo); (3) existe `user_agreements` para **cada** uno de los 3 tipos en su versión vigente. **No** se exigen campos clínicos rellenos. |
| Contrato del helper | `requireCompleteProfile(studentId, role)` → `{ ok: true }` \| `{ ok: false, missing: string[] }` con `missing ⊆ ['display_name','health_info','emergency_contact','waiver','data_protection','rights_of_image']`. Middleware `requireCompleteProfile` → `403 { error:'forbidden', code:'profile_incomplete', missing:[...] }`. |
| Alcance del helper | Si `role !== 'alumno'`, devuelve `{ ok: true }` sin tocar BD. Admin y profesor no reservan, no necesitan health info ni agreements para operar. Si en el futuro se decide que profesores también firman, ampliar aquí. |
| Ubicación del helper | Lógica en `src/services/profile.js` (`requireCompleteProfile`). Middleware fino en `src/middleware/requireCompleteProfile.js` (envuelve la lógica, lee `req.user.id`/`req.user.role`). B7 y B10 lo montan como middleware. |
| Endpoints B4.5 | `GET /me/profile-status` (`requireAuth`) → `{ ok, missing? }`; `POST /me/health` (`requireAuth` + `withRlsContext`) → upsert parcial; `POST /me/agreements` (`requireAuth` + `withRlsContext`) → `{ type, version }`, valida contra versión vigente; `GET /agreements/:type/current` (`requireAuth`) → placeholder `text/plain` durante B4.5; desde BD en B4.5.1. |
| Consentimiento de menores | **Fuera de alcance de B4.5.** El modelo actual asume tutor legal = `profile_id`. Cuando se aborde (futuro), añadir `guardian_profile_id` o tabla `guardianships`. Riesgo en §9. |
| Firma electrónica avanzada (eIDAS) | **Fuera de alcance.** El `POST /me/agreements` con `{ type, version }` + registro de `ip`/`user_agent`/`signed_at` es consentimiento simple. Si se necesita eIDAS (B12/B20), se migra. Documentado como riesgo en §9. |

### Gestión documental (B4.5.1, decisiones cerradas)
| Decisión | Valor |
|---|---|
| Almacenamiento | **Filesystem local** bajo `AGREEMENTS_STORAGE_PATH` (default `./storage/agreements`). Crear directorio al arrancar si no existe. `storage/` en `.gitignore` (excepto `storage/.gitkeep`). Capa `src/services/storage.js` con `saveFile`, `readFile`, `deleteFile` para poder migrar a S3/MinIO en B20 sin tocar rutas. |
| Tabla `agreement_documents` | `id uuid PK`, `type text NOT NULL` (mismo enum que `user_agreements.type`), `version text NOT NULL`, `storage_path text NOT NULL` (ruta relativa a `AGREEMENTS_STORAGE_PATH`), `checksum text NOT NULL` (SHA-256 hex), `mime_type text NOT NULL DEFAULT 'application/pdf'`, `published_at timestamptz NULL`, `retired_at timestamptz NULL`, `published_by uuid FK profiles(id)`, `created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP`. `UNIQUE(type, version)`. Índice parcial `(type) WHERE published_at IS NOT NULL AND retired_at IS NULL` (solo una versión vigente por tipo). |
| Ciclo de vida del documento | `created` (subido, sin publicar) → `published` (`published_at` set, visible para alumnos) → `retired` (`retired_at` set, ya no vigente pero firmas históricas conservadas). **Nunca `DELETE`** de un documento publicado. |
| Publicación | `POST /admin/agreements/documents/:id/publish` → en transacción: retira la versión vigente anterior del mismo tipo (`retired_at = now()`), marca la nueva (`published_at = now()`), `published_by = req.user.id`. Auditado en `audit_log`. |
| Re-firma masiva al publicar | **Correcto por diseño**: al publicar versión nueva, todos los alumnos que firmaron la anterior quedan "pendientes" automáticamente (comparación en tiempo de consulta). **No** se crea fila en `user_agreements` para el alumno; simplemente `requireCompleteProfile` devuelve `missing: ['waiver']` hasta que firme. Aviso al alumno: B15 (push) / B18 (UI). |
| Subida | `POST /admin/agreements/documents?type=&version=` (admin; **cuerpo crudo `application/pdf`**, `express.raw`, sin multipart). Valida `type` en `AGREEMENT_TYPES`, `version` semver-ish (`^\d+\.\d+$`), el cuerpo empieza por `%PDF-`, tamaño ≤ 10 MB (límite en B4.5.1; revisar en B20). Calcula SHA-256 al guardar; si ya existe un documento con mismo `(type, version)` y mismo checksum, devuelve 409 `duplicate_document`; si mismo `(type, version)` y checksum distinto, 409 `version_exists_different_content`. |
| `requireCompleteProfile` en B4.5.1 | Cambia la fuente de la versión vigente: `src/config/agreements.js` (B4.5) → `agreement_documents` (B4.5.1) vía `getCurrentVersions(client)` en `src/services/agreements.js`, que recibe el `client` de la transacción RLS que abre `withRlsContext` (sin transacción propia). Un tipo sin vigente cuenta como no firmado. **El contrato `{ ok, missing }` no cambia.** |
| `GET /agreements/:type/current` | Sirve el PDF vigente desde `AGREEMENTS_STORAGE_PATH`. En B4.5 sirve placeholder `text/plain`; en B4.5.1 sirve el PDF real. Auth: **`requireAuth`** (no público; el alumno debe estar logueado para firmar). |
| Subida sin librería multipart | Decidido: `express.raw({ type: 'application/pdf', limit: '10mb' })` y validación manual (tipo, versión, firma `%PDF-`). Archivo en disco `<uuid>.pdf` con SHA-256 calculado al guardar. |
| Backup de `storage/` | **Fuera de alcance de B4.5.1.** B20 añadirá backup automático (rsync a VPS secundario o similar). Riesgo en §9. |

### Cuenta familiar (rediseño de B4.6, decisiones cerradas 2026-10-27)
Detalle e impacto por bloque en `PLAN_FAMILIA.md`.

| # | Decisión | Valor |
|---|---|---|
| D1 | Hijo | `profile` + `user_roles('alumno')` + `guardianships`, **sin `auth_credentials`**: sin email ni login. El tutor actúa con su JWT. |
| D2 | Registro propio | Solo ≥ 18 (local y onboarding de Google). Un menor solo existe como hijo de un tutor. |
| D3 | Tutor | Capacidad que da la relación (ADR 0001 intacto). Cualquier adulto crea hijos; el rol `tutor` = adulto que no entrena. |
| D4 | Vínculos | Quien crea al hijo queda vinculado; el admin añade o quita más tutores. Mismos poderes. La invitación de un 2º tutor queda aplazada. |
| D5 | Pagos | Una suscripción por hijo (`student_id` = hijo) + `subscriptions.payer_id`. Un cliente Stripe por pagador. Sin descuentos familiares. |
| D6 | Avisos | Los del hijo → todos sus tutores; facturación → pagador. Nunca al hijo. |
| D7 | Migración | Reescribir `006` en el sitio. |
| D8 | Familia | Término de UI; sin tabla `families`. |
| D9 | 18 años | Caen los poderes del tutor (se calcula con `birth_date`). El adulto **reclama** su perfil por invitación y conserva su historial. El tutor puede seguir siendo el pagador. |
| D10 | Límites | Ninguno. Al crear: `birth_date` obligatoria y < 18. Sin rangos de edad por disciplina (**revisado en B5**: existen disciplinas y planes "solo menores"; ver `CONTEXT.md`). |
| D11 | Perfil completo del tutor | `display_name` + su propio `data_protection`. |
| D12 | Baja | El tutor no borra hijos; lo hace el admin. No se puede quitar el último tutor de un menor. |
| D13 | API | `profile_id` opcional (sujeto) en `/me/*`, reservas, inscripciones y checkout. `GET/POST /me/children`, `PATCH /me/children/:id`. |
| D14 | Pagador válido | El propio alumno adulto o un perfil vinculado en `guardianships`. |
| D15 | Bloqueo | Para reservar o pagar por un hijo: hijo **y** tutor completos. |
| D16 | Hijo con 18 sin reclamar | El tutor lo ve en la lista y paga sus suscripciones; no edita, firma, reserva ni ve su salud. |

### RLS (Fase 1, cerrada en B3)

Tablas con RLS `ENABLE` + `FORCE`: `profiles`, `auth_credentials`, `user_roles`, `user_mfa`, `audit_log`, `academy_settings`.

Notación: `uid = current_setting('app.current_user_id', true)::uuid`, `role = current_setting('app.current_role', true)`. Todas las políticas son `TO app_user`.

| Tabla | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `profiles` | `id = uid OR role = 'admin' OR (role = 'profesor' AND teaches_student(id))` (B13; sin `is_public`: lo público, por la vista `public_profiles`, ADR 0010) + `profiles_select_guardian` (006) | `id = uid` | `id = uid OR role = 'admin'`; tutor (006) con `WITH CHECK … AND is_public = false` (B13) | `role = 'admin'` |
| `auth_credentials` | `profile_id = uid OR role = 'admin'` | `profile_id = uid` | `profile_id = uid OR role = 'admin'` | `role = 'admin'` |
| `user_roles` | `user_id = uid OR role = 'admin'` (B13: sin profesor) | `role = 'admin' OR (user_id = uid AND role = 'alumno')` | `role = 'admin'` | `role = 'admin'` |
| `user_mfa` | `user_id = uid OR role = 'admin'` | `user_id = uid` | `user_id = uid OR role = 'admin'` | `user_id = uid OR role = 'admin'` |
| `audit_log` | `role = 'admin'` | `uid IS NOT NULL` | — (denegado; + `REVOKE`) | — (denegado; + `REVOKE`) |
| `academy_settings` | `uid IS NOT NULL` (cualquier autenticado) | `role = 'admin'` | `role = 'admin'` | `role = 'admin'` |

**RLS (B4.5, nuevas tablas):**

| Tabla | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `student_health_info` | `profile_id = uid OR role = 'admin'` | `profile_id = uid` | `profile_id = uid OR role = 'admin'` | `profile_id = uid OR role = 'admin'` |
| `user_agreements` | `profile_id = uid OR role = 'admin'` | `profile_id = uid` | — (denegado; + `REVOKE`) | — (denegado; + `REVOKE`) |

**Vista `student_health_professor_view`**: `SECURITY DEFINER` con owner **`service_role`** (`BYPASSRLS`) + `security_barrier = true` + `WHERE current_setting('app.current_role', true) = 'profesor'`. `GRANT SELECT` a `app_user`. Expone solo `profile_id`, `injuries`, `conditions`. **Pendiente de cambiar owner de `migrator` a `service_role`** (ver §8).

**Excepciones documentadas:**
- **Login sin identidad**: `loginLocal` / `loginGoogle` leen `auth_credentials` vía `servicePool`. Helpers: `findCredentialsByEmail`, `findCredentialsByGoogleSub`. Es la **única** ruta sin JWT que toca `auth_credentials`.
- **`audit_log` append-only**: doble barrera (`REVOKE UPDATE, DELETE` + ausencia de política). `service_role` podría `DELETE`; protección = disciplina de código + auditoría en B20.
- **`registerLocal` y `loginGoogle`-nuevo**: `createUser` con `set_config` + `client.query` dentro de la misma transacción `appPool`.
- **`requireCompleteProfile`** (B4.5): abre su propia transacción `appPool` + `SET LOCAL` (no usa `withRlsContext` porque necesita devolver el resultado, no serializar). Todas las queries por `client.query`.
- **`withRlsContext`**: desde B4.5 pasa `(req, res, client)` al handler. `client` es el de `appPool` dentro de transacción.

**Riesgo residual aceptado en B3:**
- `profiles_select` permite a `profesor` leer todos los perfiles. En B13 se revisará si restringir a "solo alumnos con reserva activa". → **B13 diseñado** (ADR 0010): el profesor, solo los alumnos con alguna reserva en sus sesiones; `profiles` sin lectura pública (`is_public` sale de la política) y lo público por la vista `public_profiles`.
- `academy_settings_select_all_authenticated = uid IS NOT NULL` asume que todos los parámetros son públicos para autenticados. En B5 se revisará si añadir `is_public` o política específica.

### Datos de salud
| Decisión | Valor |
|---|---|
| Ubicación | **Tabla separada** `student_health_info` (B4.5) |
| Campos | lesiones, condiciones físicas, experiencia previa (y disciplina), medicación, alergias, contacto de emergencia |
| Flujo | Google/registro crean usuario "desnudo"; health info se completa en onboarding |
| Bloqueo | Backend bloquea reservas (B7), checkout (B10) vía `requireCompleteProfile` (B4.5) |
| Implementación del bloqueo | B4.5 (helper) + B7/B10 (montaje como middleware) |

### Billing y pagos fallidos
| Decisión | Valor |
|---|---|
| Evento Stripe clave | `invoice.payment_failed` (también `invoice.payment_action_required`, `customer.subscription.updated/deleted`) |
| Datos en `invoices` | Añadir `stripe_invoice_id`, `status`, `attempt_count`, `next_payment_attempt`, `last_payment_error` (jsonb), `hosted_invoice_url` |
| Notificación al pagador | **Email transaccional** de los 16 avisos de facturación (B10.6 y B11: outbox `notice_deliveries` + worker, ADR 0008). Push en B15. |
| Notificación al admin | **Pasiva**: lista en panel (B10.2 + UI en B19). Sin email diario ni push al admin. |
| Lista de morosos | `GET /admin/billing/failed-payments` sobre `invoices` con `status IN ('open','past_due','uncollectible')` |
| Segmentación | B10.1 (modelo + webhook), B10.2 (endpoint admin), B10.6 (emails), B19 (UI) |

### Operativas (heredadas)
1. Solo pago con tarjeta vía Stripe. `cash_payments` vacía para futuro.
2. Cancelación de suscripciones SOLO admin (`cancel-now` / `cancel-at-period-end`).
3. MFA TOTP para admin (implementado en B4).
4. Asistencia: manual por profesor + QR dinámico en tablet fija.
   - Tablet autentica con `device_token` (no JWT de usuario).
   - Token hasheado en BD (`device_tokens`).
   - Polling/SSE a `/tablet/active-sessions`.
   - QR rotativo de prueba de presencia; sin `session_id` (la sesión sale de la reserva, ver CONTEXT.md).
   - Ventana de check-in configurable (default 30 min antes, 10 min después).
5. Perfiles públicos con flags granulares (`visible_fields jsonb`).
6. Informes con tablas de agregación nocturna.
7. Upgrade: prorrateo inmediato (`always_invoice` + `pending_if_incomplete`), disciplinas al instante.
8. Downgrade: sin reembolso, al final del periodo (Subscription Schedule 2 fases), disciplinas al transicionar.
9. Consentimientos: seguro/waiver, protección de datos, derechos de imagen (todos obligatorios, versionados, B4.5). Menores requieren tutor (futuro).
10. `student_health_info` en tabla separada.

---

## 6. Esquema de BD

Owner de todas las tablas: `migrator`. **RLS activo con `FORCE` en las 8 tablas de Fase 1 + B4.5** (`profiles`, `auth_credentials`, `user_roles`, `user_mfa`, `audit_log`, `academy_settings`, `student_health_info`, `user_agreements`); el resto sigue sin RLS hasta su bloque.

### Tablas

| Tabla | Tipo | Notas |
|---|---|---|
| `academy_settings` | configuración | parámetros globales (PK `key text`, `value jsonb`) — **RLS Fase 1** |
| `academy_stats_daily` | agregación | stats diarias de academia (B16) |
| `agreement_documents` | legal | documentos legales versionados (B4.5.1) |
| `attendance` | operativa | asistencia a sesiones (B8) |
| `audit_log` | auditoría | **RLS Fase 1, append-only** |
| `auth_credentials` | auth | credenciales (B2) — **RLS Fase 1** |
| `bookings` | operativa | reservas (B7) |
| `cash_payments` | pagos | vacía, reservada para futuro |
| `class_sessions` | operativa | sesiones de clase (B6) |
| `disciplines` | catálogo | disciplinas (B5); `is_open` = disciplina abierta (B14) |
| `event_registrations` | eventos | inscripciones a eventos |
| `events` | eventos | eventos especiales |
| `invoices` | pagos | facturas (ampliar en B10.1) |
| `notice_deliveries` | notificaciones | entregas de los avisos (outbox, B10.6, ADR 0008); solo `servicePool` |
| `payer_changes` | pagos | cambio de pagador pendiente (B11, ADR 0009); RLS de lectura para los dos pagadores y el admin, escribe `servicePool` |
| `pgmigrations` | sistema | control de migraciones |
| `plan_disciplines` | catálogo | relación plan ↔ disciplina (B5) |
| `plans` | catálogo | planes de suscripción (B5) |
| `profiles` | usuarios | identidad pública — **RLS Fase 1** |
| `push_subscriptions` | notificaciones | suscripciones push (B15) |
| `student_health_info` | salud | **1:1 con `profiles`** (B4.5) — **RLS B4.5** |
| `student_stats_daily` | agregación | stats diarias por alumno (B16); B14 no la usa (racha al leer), B16 decide su forma |
| `subscriptions` | pagos | suscripciones Stripe (B10) |
| `user_agreements` | legal | consentimientos firmados por usuario (B4.5). Renombrada desde `subscription_agreements`. Append-only. — **RLS B4.5** |
| `user_mfa` | auth | secretos TOTP admin — **RLS Fase 1** |
| `user_roles` | auth | roles por usuario — **RLS Fase 1** |
| `webhook_events` | pagos | idempotencia webhooks Stripe (B10) |

`activity_feed` (001) se borró en B14 (`019`): no hay feed.

**Funciones de B14** (`019`, `SECURITY DEFINER`, owner `service_role`): `student_progress`, `public_achievements`, `monthly_ranking` y `revoke_open_discipline` (exige admin), con `EXECUTE` para `app_user`; internas `student_present` (fuente única de los presentes que cuentan), `month_hours` y `student_achievements`. `covers` cubre además las abiertas; `public_disciplines` y `change_discipline` las excluyen. La vista `public_profiles` gana la columna `achievements`.

### `profiles` (identidad pública)
id uuid NOT NULL (PK) ← sin default; la app genera
display_name text
phone text
avatar_url text
bio text
social_links jsonb
is_public boolean DEFAULT false
visible_fields jsonb
created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP

text

Índices: `profiles_pkey` (id), `profiles_is_public_index` parcial `WHERE is_public = true`.
**No** contiene `email`, `password_hash`, `google_sub` ni `role`.

RLS: `ENABLE` + `FORCE`. Políticas `profiles_select`, `profiles_insert_self`, `profiles_update_self_or_admin`, `profiles_delete_admin`.

### `auth_credentials` (credenciales, B2)
profile_id uuid NOT NULL (PK, FK profiles(id) ON DELETE CASCADE)
email text NOT NULL UNIQUE
password_hash text -- NULL si solo Google
google_sub text -- NULL si solo password
email_verified boolean NOT NULL DEFAULT false
created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP

text

Índices: `auth_credentials_pkey`, `auth_credentials_email_key` UNIQUE, `auth_credentials_google_sub_idx` UNIQUE parcial.
Check: `password_hash IS NOT NULL OR google_sub IS NOT NULL`.
Trigger: `auth_credentials_set_updated_at`.
RLS: `ENABLE` + `FORCE`. Excepción login vía `servicePool`.

### `user_roles`
id bigint NOT NULL (PK) ← GENERATED BY DEFAULT AS IDENTITY
user_id uuid NOT NULL
role app_role NOT NULL ← enum {alumno, profesor, admin}

text

RLS: `ENABLE` + `FORCE`. Políticas `user_roles_select`, `user_roles_insert_self_alumno_or_admin`, `user_roles_update_admin`, `user_roles_delete_admin`.

### `user_mfa`
id uuid NOT NULL (PK)
user_id uuid NOT NULL (UNIQUE)
totp_secret_encrypted text -- AES-256-GCM, base64(iv||tag||ct), desde B4
recovery_codes_encrypted text -- AES-256-GCM de JSON de hashes argon2id, desde B4
mfa_enabled boolean DEFAULT false
created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP

text

Índices: `user_mfa_pkey`, `user_mfa_user_id_index`, `user_mfa_user_id_key` UNIQUE.
RLS: `ENABLE` + `FORCE`. Políticas `user_mfa_select`, `user_mfa_insert_self`, `user_mfa_update_self_or_admin`, `user_mfa_delete_self_or_admin`.

### `audit_log`

Sin cambios de columnas. RLS: `ENABLE` + `FORCE`. Políticas `audit_log_select_admin`, `audit_log_insert_authenticated`. **Sin política FOR UPDATE/DELETE** + `REVOKE UPDATE, DELETE FROM app_user`.

### `academy_settings`

PK `key text`, `value jsonb NOT NULL`. RLS: `ENABLE` + `FORCE`. Políticas `academy_settings_select_all_authenticated`, `academy_settings_insert_admin`, `academy_settings_update_admin`, `academy_settings_delete_admin`.

### `student_health_info` (B4.5)
profile_id uuid NOT NULL (PK, FK profiles(id) ON DELETE CASCADE)
injuries text
conditions text
previous_experience text
previous_discipline text
medication text
allergies text
emergency_contact_name text NULL -- exigido por requireCompleteProfile, no por la tabla
emergency_contact_phone text NULL -- idem
created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP

text

Trigger: `student_health_info_set_updated_at`.
RLS: `ENABLE` + `FORCE`. Políticas `TO app_user`: SELECT `profile_id = uid OR role = 'admin'`; INSERT `profile_id = uid`; UPDATE `profile_id = uid OR role = 'admin'`; DELETE `profile_id = uid OR role = 'admin'`.
Vista `student_health_professor_view` (`SECURITY DEFINER`, owner **`service_role`** — pendiente fix): expone solo `profile_id`, `injuries`, `conditions`; SELECT permitido a `profesor` vía `current_setting('app.current_role', true) = 'profesor'`.

### `user_agreements` (B4.5)
id uuid NOT NULL (PK) ← sin default; la app genera
profile_id uuid NOT NULL (FK profiles(id) ON DELETE CASCADE)
type text NOT NULL -- CHECK: 'waiver' | 'data_protection' | 'rights_of_image'
version text NOT NULL
signed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
ip inet
user_agent text

text

`UNIQUE(profile_id, type, version)`. Índice `(profile_id, type)`.
RLS: `ENABLE` + `FORCE`. SELECT `profile_id = uid OR role = 'admin'`; INSERT `profile_id = uid`; UPDATE denegado; DELETE denegado. `REVOKE UPDATE, DELETE ON user_agreements FROM app_user` (doble barrera append-only; verificado `app_user=ar/migrator`).

### `agreement_documents` (B4.5.1)
id uuid NOT NULL (PK)
type text NOT NULL
version text NOT NULL
storage_path text NOT NULL
checksum text NOT NULL -- SHA-256 hex
mime_type text NOT NULL DEFAULT 'application/pdf'
published_at timestamptz
retired_at timestamptz
published_by uuid (FK profiles(id))
created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP

text

`UNIQUE(type, version)`. Índice parcial `(type) WHERE published_at IS NOT NULL AND retired_at IS NULL` para localizar la versión vigente.
RLS: `ENABLE` + `FORCE`. SELECT `published_at IS NOT NULL OR role = 'admin'` (alumnos ven documentos publicados); INSERT/UPDATE `role = 'admin'`; DELETE denegado (`REVOKE DELETE`).

### `subscriptions`
id uuid NOT NULL (PK)
student_id uuid NOT NULL (FK profiles(id) ON DELETE CASCADE)
plan_id bigint NOT NULL (FK plans(id) ON DELETE RESTRICT)
status sub_status NOT NULL
payment_method payment_method DEFAULT 'stripe'
current_period_start timestamptz
current_period_end timestamptz
cancel_at_period_end boolean DEFAULT false
cancelled_at timestamptz
stripe_subscription_id text
created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
-- PREVISTO B10 (Cuenta familiar, D5/D14): payer_id uuid NOT NULL FK profiles(id)

text

### `invoices` (a ampliar en B10.1)

<!-- PENDIENTE: pegar salida de `\d invoices` para rellenar columnas actuales.
     En B10.1 se añadirán: stripe_invoice_id, status, attempt_count,
     next_payment_attempt, last_payment_error, hosted_invoice_url. -->

---

## 7. Estructura del repo
kaizen-app-v2/
├── src/
│ ├── config/
│ │ ├── agreements.js ← (B4.5) AGREEMENT_TYPES, VERSION_RE (B4.5.1; la constante de versiones desapareció)
│ │ ├── auth.js ← JWT_SECRET, JWT_EXPIRES_IN, GOOGLE_CLIENT_ID
│ │ ├── database.js ← dos pools (appPool, servicePool)
│ │ ├── mfa.js ← (B4) MFA_ENCRYPTION_KEY, MFA_TOKEN_EXPIRES_IN, MFA_TOTP_ISSUER, MFA_RECOVERY_CODE_COUNT
│ │ └── storage.js ← (B4.5.1) AGREEMENTS_STORAGE_PATH
│ ├── middleware/
│ │ ├── asyncHandler.js
│ │ ├── auth.js ← requireAuth (rechaza mfa:'pending'), requireRole, withRlsContext (firma (req,res,client) desde B4.5)
│ │ ├── errorHandler.js
│ │ ├── index.js
│ │ ├── mfa.js ← (B4) signMfaToken, requireMfaToken, requireMfaTokenFromBody
│ │ └── requireCompleteProfile.js ← (B4.5)
│ ├── routes/
│ │ ├── admin/
│ │ │ └── agreements.js ← (B4.5.1) subida/publicación/retirada
│ │ ├── agreements.js ← (B4.5) GET /agreements/:type/current
│ │ ├── auth.js ← /register, /login, /google, /me, /mfa/setup, /mfa/activate, /mfa/verify
│ │ ├── index.js
│ │ └── me.js ← (B4.5) /me/profile-status, /me/health, /me/agreements
│ ├── services/
│ │ ├── agreements.js ← (B4.5.1) getCurrentVersions, getCurrentDocument, createDocument, publishDocument, listDocuments
│ │ ├── auth.js ← registerLocal, loginLocal, loginGoogle, createUser, findCredentialsByEmail/GoogleSub
│ │ ├── crypto.js ← (B4) encrypt, decrypt (AES-256-GCM)
│ │ ├── google.js
│ │ ├── index.js
│ │ ├── jwt.js
│ │ ├── mfa.js ← (B4) setupMfa, verifyAndEnableMfa, verifyMfaCode, getMfaStatus, getMfaStatusWithClient
│ │ ├── password.js
│ │ ├── profile.js ← (B4.5) requireCompleteProfile
│ │ └── storage.js ← (B4.5.1) saveFile, readFile, deleteFile
│ └── index.js ← monta /auth, /me, /agreements
├── migrations/
│ ├── 001_initial_setup.js
│ ├── 002_auth_credentials.js
│ ├── 003_rls_fase1.js
│ ├── 004_student_health_and_agreements.js ← (B4.5)
│ └── 005_agreement_documents.js ← (B4.5.1)
├── scripts/
│ ├── test-rls.js ← npm run test:rls (destructivo, solo local)
│ ├── test-mfa.js ← (B4) npm run test:mfa (destructivo, solo local)
│ └── README.md
├── storage/ ← (B4.5.1) AGREEMENTS_STORAGE_PATH, en .gitignore
│ └── .gitkeep
├── db-architecture.md
├── docker-compose.yaml
├── contexto-proyecto.md
├── plan-de-bloques.md
├── README.md
├── .env
├── .env.example
└── package.json ← incluye "test:rls", "test:mfa"

text

---

## 8. Pendientes inmediatos (B4.5 — fix + cierre)

**Fix para cerrar B4.5:**

- [ ] **Cambiar owner de la vista** en `migrations/004_student_health_and_agreements.js`: `ALTER VIEW student_health_professor_view OWNER TO migrator;` → `ALTER VIEW student_health_professor_view OWNER TO service_role;`. Actualizar el comentario encima de la vista: `SECURITY DEFINER` con owner `service_role` (`BYPASSRLS`) es lo que permite que la vista devuelva filas; `migrator` es `NOBYPASSRLS` y con `FORCE ROW LEVEL SECURITY` en la tabla base, la vista devolvía 0 filas.
- [ ] **Reaplicar la migración**: `npm run migrate:down` → `npm run migrate`.
- [ ] **Reiniciar el servidor** (riesgo §9).
- [ ] **`npm run test:rls`** → esperado **22 OK, 0 FAIL** (o **24 OK** si se añaden los 2 tests opcionales abajo).
- [ ] **Commit** `feat(B4.5): student_health_info + user_agreements + requireCompleteProfile`.
- [ ] **Cierre formal**: mover B4.5 a CERRADO en §4, actualizar §5 con la decisión corregida del owner (ya está en §5 de este documento), actualizar §9 con riesgos cerrados.

**Tests opcionales (recomendados) para blindar la vista:**

- [ ] `B4.5 — alumno NO ve la vista student_health_professor_view`: con `withCtx({ uid: ids.a, role: 'alumno' })`, `SELECT * FROM student_health_professor_view` → 0 filas (el `WHERE` filtra por `'profesor'`).
- [ ] `B4.5 — admin NO ve la vista student_health_professor_view`: con `withCtx({ uid: ids.admin, role: 'admin' })`, `SELECT * FROM student_health_professor_view` → 0 filas (el `WHERE` filtra por `'profesor'`).

**Pendientes heredados (no bloquean B4.5):**

- [ ] **Probar caso `409 link_required`** de `/auth/google` con cuenta real (heredado de B2). Probar en B20 con staging.
- [ ] **Confirmar enums `sub_status` y `payment_method`** (antes de B10).
- [ ] **Pegar `\d invoices`** para rellenar §6 antes de B10.1.
- [ ] **Limpiar datos de prueba** huérfanos en local: `repro-*@test.local`, `b3-check-*@test.local`, `mfa-test-*@test.local`, `admin-mfa-manual@test.local`. Opcional.

---

## 9. Riesgos conocidos

- **UUID sin default en `profiles` y `user_agreements`**: si la app olvida generarlo, `INSERT` falla. Centralizado en `createUser` (profiles) y `POST /me/agreements` (`crypto.randomUUID()`).
- **Mezclar pools**: si alguna ruta usa `servicePool` sin necesidad, se salta RLS. Desde B3, `servicePool` solo en login y jobs administrativos explícitos.
- **Mezclar `client.query` y `appPool.query` dentro de una transacción**: RLS bloquea con `42501`. En `createUser`, `withRlsSelf` y `requireCompleteProfile` todas las queries usan `client.query`.
- **`SET LOCAL` fuera de transacción**: RLS no filtra. `withRlsContext`, `createUser` y `requireCompleteProfile` lo garantizan.
- **Servidor viejo tras migración**: reiniciar el servidor tras aplicar migraciones que cambian el contrato con la app.
- **Google OAuth sin verificar `audience`**: aceptar tokens de otras apps. Siempre `audience: GOOGLE_CLIENT_ID`.
- **`GOOGLE_CLIENT_ID` ausente en `.env`**: verificación falla con `payload audience != requiredAudience`. Mitigado en `src/config/auth.js`.
- **Vinculación automática por email**: account takeover. No hacerlo.
- **Health info en `profiles`**: tabla separada `student_health_info`.
- **No meter `password_hash`/`google_sub` en `profiles`**: van en `auth_credentials`.
- ~~**RLS en `auth_credentials` rompe login**~~ → resuelto en B3.
- ~~**RLS en `profiles` rompe registro**~~ → resuelto en B3.
- **Política `profiles_select` demasiado laxa para `profesor`**: aceptado en B3; revisar en B13. → decidido en B13 (ADR 0010); queda como residual que el profesor lee a nivel SQL la fila entera (no solo `display_name`) de los alumnos de sus sesiones.
- **`academy_settings` pública para autenticados**: revisar en B5 (añadir `is_public` o política específica).
- **`audit_log` protegido solo por RLS + `REVOKE`**: `service_role` podría `DELETE`. Protección = disciplina de código + auditoría en B20.
- **`scripts/test-rls.js` y `scripts/test-mfa.js` destructivos**: solo local. B20 los migrará a BD efímera.
- **Scripts de test sin framework**: suficiente para B3/B4/B4.5; migrar a Node test runner o Vitest en B20.
- **Webhook Stripe sin idempotencia**: usar `webhook_events` (B10).
- ~~**Emails de billing sin proveedor decidido**~~ → Resend (B10.6 diseñado).
- ~~**`withRlsContext` no serializaba el resultado**~~ → resuelto en B4.
- **`loginGoogle` en alta nueva firma un token que se descarta**: ineficiencia menor, sin impacto de seguridad. Limpiar en B20 si se unifica el contrato.
- ~~**`dotenv-cli` expone el binario como `dotenv`**~~ → corregido en B4.
- **`argon2` requiere scripts de instalación nativos**: `npm install` avisa de `node-gyp-build` no cubierto por `allowScripts`. Si se reinstala en limpio, puede necesitar `npm install-scripts approve argon2` o build tools.
- **`test-mfa.js` manipula `mfa_enabled` con `service_role`** para el caso de recovery codes. Acotado al script. B20.
- **MFA solo admin, pero `user_mfa` es genérica**: la restricción está en la capa de app. Mitigado por `requireRole('admin')` en las dos rutas actuales.
- **Flujo HTTP de MFA verificado manualmente, sin test automatizado**: el flujo 1a–1i se ha verificado a mano contra el servidor. B20 añadirá supertest para cubrirlo en CI.
- **`student_health_info` nunca debe unirse a `public_profiles`**: cuando B13 cree la vista pública, verificar explícitamente que no incluye campos de salud. Añadir a checklist de B13. → B13 lo garantiza con un test de dependencias de la vista (`information_schema.view_table_usage`) y de su lista exacta de columnas.
- **`requireCompleteProfile` puede quedar desactualizado** si cambia la definición de "completo". Mitigación: constantes en `src/config/agreements.js`; tests en `scripts/test-rls.js` que cubren los 3 tipos.
- **Consentimiento sin firma electrónica avanzada (eIDAS)**: el `POST /me/agreements` con `{ type, version }` + `ip`/`user_agent`/`signed_at` es consentimiento simple. Si se necesita eIDAS (B12/B20), migrar. Documentado en §5.
- ~~**Menores sin tutor modelado**~~ → `guardianships` en B4.6; modelo redefinido como Cuenta familiar (`PLAN_FAMILIA.md`).
- **NUEVO Cuenta familiar — `create_child` es `SECURITY DEFINER`**: si se rompe la comprobación del llamante, cualquiera podría crear perfiles vinculados. Cubrir con un test en `test-minors.js`.
- **NUEVO Cuenta familiar — hijo con 18 sin reclamar su perfil**: queda bloqueado en silencio. Avisar a los tutores (B15). El flujo de invitación no tiene bloque asignado.
- **NUEVO Cuenta familiar — último tutor**: quitarlo dejaría el perfil del menor inaccesible. Lo impide la app (D12); valorar un trigger.
- **NUEVO Cuenta familiar — B9 asume "un alumno, un móvil"**: el hijo no tiene login. El check-in lo hace el tutor + `profile_id` o el profesor a mano. Decidir en B9.
- **NUEVO B4.5 — `withRlsContext` cambia la firma a `(req, res, client)`**: handlers que declaraban `(req, client)` o accedían al client por `res` se rompen con `client.query is not a function`. Detectado en `/auth/me` (`src/routes/auth.js:98`) durante la verificación de B4.5; corregido. Regla: `res` es siempre Response, `client` es siempre el client.
- **NUEVO B4.5 — `student_health_professor_view` es `SECURITY DEFINER` con owner `service_role`**: la vista bypassa RLS porque su owner tiene `BYPASSRLS`. El filtro es `current_setting('app.current_role') = 'profesor'`. Si el `WHERE` se rompe o se elimina en una migración futura, cualquier rol con `app.current_role = 'profesor'` vería `injuries`/`conditions` de todos los alumnos. Mitigación: la vista solo expone 3 columnas (no medicación, alergias ni contacto de emergencia), y `scripts/test-rls.js` cubre los 4 roles (profesor ve, alumno/admin no ven). **Verificar en B20** que la vista sigue teniendo el `WHERE` y que su owner sigue siendo `service_role`. **Primer intento (owner `migrator`) falló**: `migrator` es `NOBYPASSRLS` y `student_health_info` tiene `FORCE ROW LEVEL SECURITY` → la vista devolvía 0 filas. Detectado en el test de B4.5. **Fix pendiente** (ver §8).
- **NUEVO B4.5.1 — storage local sin backup**: `AGREEMENTS_STORAGE_PATH` es un directorio local. Si se borra o el VPS muere, se pierden los PDFs. B20 añadirá backup.
- **NUEVO B4.5.1 — re-firma masiva al publicar versión nueva**: correcto por diseño, pero hay que avisar al alumno (B15 push / B18 UI) o se encontrará bloqueado sin saber por qué. Añadido a checklist de B15/B18.
- **NUEVO B4.5.1 — subida limitada a 10 MB**: `POST /admin/agreements/documents` usa `express.raw` con límite de 10 MB; revisar en B20.
- **NUEVO B4.5.1 — checksum sin verificación al servir**: `GET /agreements/:type/current` sirve el PDF sin verificar que el checksum coincide con el guardado. Añadir verificación en B4.5.1 o B20.
- **NUEVO B4.5.1 — `agreement_documents` con `published_by` FK a `profiles`**: si se borra el admin que publicó, `published_by` queda huérfano. Usar `ON DELETE SET NULL` o `ON DELETE RESTRICT`. Decidir en B4.5.1 (recomendación: `SET NULL`).
- **NUEVO B4.5.1 — `UNIQUE` parcial para "una versión vigente por tipo" no es trivial en PG**: PG no soporta `UNIQUE ... WHERE` con `published_at IS NOT NULL AND retired_at IS NULL` como constraint declarativo directo sobre columnas mutables sin expresión. Alternativa: índice único parcial sobre `(type) WHERE published_at IS NOT NULL AND retired_at IS NULL` — sí es posible. Verificar en B4.5.1; si falla, usar `SELECT … FOR UPDATE` al publicar (transacción serializa).
