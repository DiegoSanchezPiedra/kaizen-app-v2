# Plan: generar `TRASPASO.md`

## Contexto
Traspaso de un proyecto empezado con DeepSeek. Se pide un único documento de handoff basado en el código real + `contexto-proyecto.md` + `plan-de-bloques.md`. Sin tocar código.

## Acción única al aprobar
Crear `/home/diego/kaizen-app-v2/TRASPASO.md` con el contenido literal de abajo (entre las marcas). No se modifica ningún otro archivo.

## Verificación
- El archivo existe y `git status` solo muestra `?? TRASPASO.md` como novedad.

---8<--- INICIO TRASPASO.md ---8<---

# TRASPASO — Kaizen App

> Análisis a 2026-10-26 sobre `main` (HEAD `ee731e1`) + cambios sin commitear en working tree.

## 1. Estado Real del Proyecto

**Qué es (5 líneas)**
1. Backend API (Node/Express/PostgreSQL) para gestionar una academia de artes marciales/deportes: alumnos, profesores y admin.
2. Auth propia (email+password y Google OIDC) con JWT y MFA TOTP obligatorio para admin.
3. Seguridad de datos delegada en Row Level Security de PostgreSQL, con el contexto de usuario inyectado por transacción (`set_config`).
4. Onboarding del alumno: ficha de salud + 3 consentimientos legales versionados que bloquean reservas y pagos si faltan.
5. Roadmap: catálogo de disciplinas/planes, calendario de clases, reservas con aforo, asistencia (manual + QR en tablet), suscripciones Stripe, gamificación, push, informes y panel admin.

**Estado por bloque (según código, no según docs)**

| Bloque | Estado | Evidencia |
|---|---|---|
| B0 Docker + PG + roles + migración inicial | [COMPLETADO] | `docker-compose.yaml`, `migrations/001_initial_setup.js` (23 tablas, 8 enums) |
| B1 Esqueleto backend | [COMPLETADO] | `src/index.js`, `src/config/database.js`, `src/middleware/errorHandler.js` |
| B2 Auth local + Google + JWT + SET LOCAL | [COMPLETADO] | `002_auth_credentials.js`, `src/services/auth.js`, `src/middleware/auth.js`, `src/routes/auth.js` |
| B3 RLS Fase 1 + tests por rol | [COMPLETADO] | `003_rls_fase1.js`, `scripts/test-rls.js` |
| B4 MFA TOTP admin | [COMPLETADO] | `src/services/mfa.js`, `src/services/crypto.js`, `src/middleware/mfa.js`, `scripts/test-mfa.js`. Commit `ee731e1` |
| B4.5 Salud + consentimientos + `requireCompleteProfile` | [A MEDIO HACER] | Todo el código existe pero **sin commitear** (`??` en git). Vista del profesor rota (owner `migrator`, `004:109`), test RLS 21 OK / 1 FAIL. Bugs adicionales en §4 |
| B4.5.1 Gestión documental admin | [PENDIENTE] | No existen `005_agreement_documents.js`, `src/config/storage.js`, `src/services/storage.js`, `src/services/agreements.js`, `src/routes/admin/`, `storage/` |
| B5 CRUD disciplinas/planes | [PENDIENTE] | Solo tablas de `001`, sin RLS ni rutas |
| B6 `class_sessions` + calendario | [PENDIENTE] | Ídem |
| B7 Reservas + lista de espera | [PENDIENTE] | Ídem. `requireCompleteProfile` existe pero no está montado en ninguna ruta |
| B8 Asistencia manual | [PENDIENTE] | Ídem |
| B9 QR dinámico / `device_tokens` | [PENDIENTE] | La tabla `device_tokens` **no existe** en ninguna migración |
| B10 Stripe base | [PENDIENTE] | `stripe` instalado, cero código |
| B10.1 `invoices` Stripe + `payment_failed` | [PENDIENTE] | — |
| B10.2 Morosos admin | [PENDIENTE] | — |
| B10.5 `subscription_disciplines` + up/downgrade | [PENDIENTE] | La tabla **no existe** |
| B10.6 Emails billing | [PENDIENTE] | Sin proveedor ni dependencia |
| B11 Cancelación admin | [PENDIENTE] | — |
| B12 Consentimientos en checkout | [PENDIENTE] | — |
| B13 Perfiles públicos | [PENDIENTE] | — |
| B14 Racha/badges | [PENDIENTE] | — |
| B15 Push | [PENDIENTE] | Sin `web-push` |
| B16 Agregaciones + cron | [PENDIENTE] | — |
| B17 Endpoints informes | [PENDIENTE] | — |
| B18 PWA | [PENDIENTE] | No hay frontend en el repo |
| B19 Panel admin | [PENDIENTE] | — |
| B20 Hardening | [PENDIENTE] | — |

## 2. Arquitectura y Convenciones (La "Biblia")

**Stack (versiones instaladas en `node_modules`)**
- Node **24.21.0**, ESM (`"type": "module"`).
- `express` 4.22.3 · `pg` 8.23.1 · `argon2` 0.45.1 · `jsonwebtoken` 9.0.3 · `google-auth-library` 11.3.1 · `otpauth` 9.5.2 · `dotenv` 16.6.1 · `stripe` 14.25.0 (sin usar).
- Dev: `node-pg-migrate` 9.0.0 · `dotenv-cli` 11.0.0 (binario `dotenv`) · `eslint` 8.57.1 · `prettier` 3.9.10.
- PostgreSQL 16 en Docker (`kaizen-postgres`, solo `127.0.0.1:5432`, volumen `~/Documents/kaizen-db`).
- Sin framework de tests: scripts Node con `node:assert` (`npm run test:rls`, `npm run test:mfa`), **destructivos, solo local**.

**Estructura**
```
src/
  index.js            monta /health, /auth, /me, /agreements, notFound, errorHandler
  config/             lectura y validación de env al importar (fallan al arrancar)
  middleware/         auth.js (requireAuth, requireRole, withRlsContext), mfa.js,
                      requireCompleteProfile.js, asyncHandler.js, errorHandler.js
  routes/             auth.js, me.js, agreements.js
  services/           auth, jwt, password, google, mfa, crypto, profile
migrations/           001..004 (node-pg-migrate, ESM, up/down reversibles)
scripts/              test-rls.js, test-mfa.js
```
`src/*/index.js` son barrels vacíos (placeholder); nadie los importa.

**Roles de BD y pools**
- `migrator` (owner de tablas, DDL, NOBYPASSRLS) → solo `DATABASE_URL`, solo migraciones. **La app nunca lo usa.**
- `app_user` (NOBYPASSRLS) → `appPool` (`DATABASE_URL_APP`). Camino por defecto.
- `service_role` (BYPASSRLS) → `servicePool` (`DATABASE_URL_SERVICE`). Solo login (`findCredentialsByEmail`, `findCredentialsByGoogleSub`, lectura de rol) y jobs administrativos explícitos.

**Patrones obligatorios**
- Toda query con identidad: `appPool.connect()` → `BEGIN` → `set_config('app.current_user_id', uid, true)` + `set_config('app.current_role', role, true)` → queries **siempre con el mismo `client.query`** → `COMMIT`/`ROLLBACK` → `release()`. Mezclar `appPool.query` dentro de la transacción ⇒ error `42501`.
- En rutas: `withRlsContext(async (req, res, client) => {...})`. Firma canónica `(req, res, client)`. Si el handler **devuelve** un valor, `withRlsContext` hace `res.json(valor)` tras `COMMIT`. Para respuestas no-200, usar `res.status(x).json(...); return;` (sin devolver `res`, ver §4).
- En servicios sin `req`: helper propio con el mismo patrón (`withRlsSelf` en `mfa.js`, transacción manual en `profile.js`/`createUser`).
- Políticas RLS: siempre `TO app_user`, `ENABLE` + `FORCE`. `uid = current_setting('app.current_user_id', true)::uuid`, `role = current_setting('app.current_role', true)`.
- Tablas append-only: sin política UPDATE/DELETE **y** `REVOKE UPDATE, DELETE ... FROM app_user` (doble barrera).
- UUIDs: `profiles.id`, `user_agreements.id`, `user_mfa.id` **sin default**; generar con `crypto.randomUUID()` (`node:crypto`).
- Migraciones: `pgm.sql(...)` para RLS/políticas; `down` revierte todo (incl. `GRANT` de vuelta). Tras migrar, **reiniciar servidor**.
- Rutas finas, lógica en `services/`. Async en Express 4: `try/catch` + `next(err)` o `asyncHandler`.

**Errores**
- Servicios lanzan `Error` con `status` y `code` (helper `httpError(status, code, message)` en `services/auth.js`; en otros servicios se construye a mano).
- `errorHandler` responde `{ error: err.code || 'internal_error', message, details? }`; oculta mensaje en 500 si `NODE_ENV=production`.
- Respuestas directas desde middleware/rutas usan otra forma: `{ error: '<categoria>', code: '<detalle>', ...extra }` (p. ej. `{ error:'unauthorized', code:'missing_token' }`). Ver inconsistencia en §4.
- Códigos `snake_case` en inglés; mensajes de log/config en español con prefijo `[modulo]`.

**Estilo**: comentarios de cabecera `// src/ruta/archivo.js`, separadores `// ----`, nombres `camelCase` en JS y `snake_case` en SQL y JSON de respuesta. Prettier por defecto (comillas simples, `;`, trailing commas).

## 3. Reglas de Negocio Críticas

1. **Roles**: `alumno | profesor | admin` (enum `app_role`), en `user_roles`, nunca en `profiles`. Todo usuario nuevo es `alumno`; solo admin puede asignar otros roles (política `user_roles_insert_self_alumno_or_admin`).
2. **Credenciales** en `auth_credentials`, nunca en `profiles`. Check: `password_hash` o `google_sub` no nulos.
3. **Google**: verificar ID Token con `audience: GOOGLE_CLIENT_ID`. **Nunca vincular por email automáticamente**: email existente sin `google_sub` ⇒ `409 link_required` (anti account-takeover).
4. **MFA**: solo admin (`requireRole('admin')` en setup/activate). Login de admin con MFA ⇒ `{ mfa_required, mfa_token }`; el `mfa_token` (claim `mfa:'pending'`, 5 min) **debe ser rechazado** por `requireAuth`. Recovery codes de un solo uso (se eliminan del array al usarse). Secretos con AES-256-GCM (`MFA_ENCRYPTION_KEY`, 32 B); recovery codes hasheados argon2id.
5. **Perfil completo (alumno)** = `display_name` no vacío + fila en `student_health_info` con `emergency_contact_name` y `_phone` no nulos + firma de **los 3** consentimientos (`waiver`, `data_protection`, `rights_of_image`) **en su versión vigente**. Los campos clínicos NO son obligatorios. Profesor/admin siempre `ok`.
6. **Bloqueo**: reservas (B7) y checkout (B10/B12) deben montar `requireCompleteProfile` ⇒ `403 profile_incomplete` + `missing[]`. `GET /me/profile-status` nunca da 403.
7. **Re-firma**: publicar versión nueva de un consentimiento deja a todos los alumnos "pendientes" automáticamente (comparación en tiempo de consulta, sin migrar datos). `user_agreements` es append-only; `UNIQUE(profile_id, type, version)`; se registran `ip` y `user_agent`.
8. **Salud**: `student_health_info` 1:1, nunca en `profiles`, **nunca unida a perfiles públicos** (B13). Profesor no lee la tabla base; solo `injuries`/`conditions` vía `student_health_professor_view` (a restringir en B8 a alumnos de sus sesiones).
9. **`audit_log` append-only** (también para admin). `service_role` técnicamente podría borrar: no hacerlo nunca.
10. **Pagos**: solo tarjeta vía Stripe (`cash_payments` reservada). Cancelación de suscripciones **solo admin** (`cancel-now` / `cancel-at-period-end`). Upgrade: prorrateo inmediato (`always_invoice` + `pending_if_incomplete`), disciplinas al instante. Downgrade: sin reembolso, al final del periodo (Subscription Schedule de 2 fases). Webhooks idempotentes vía `webhook_events`.
11. **Morosos**: email al alumno en `invoice.payment_failed`; al admin solo lista pasiva (`status IN ('open','past_due','uncollectible')`), sin emails/push.
12. **Asistencia QR**: tablet con `device_token` (hasheado, no JWT de usuario), QR rotativo con `session_id`, ventana configurable (default −30 / +10 min).
13. **Reservas**: plaza bloqueada con `SELECT … FOR UPDATE`, lista de espera (`booking_status`: `confirmed | waitlisted | cancelled`).
14. **Fuera de alcance explícito**: menores/tutores, firma eIDAS, refresh tokens, MFA para no-admin, S3.
15. **Proceso**: no abrir un bloque sin cerrar el anterior; no implementar nada de bloques futuros; decisiones nuevas se documentan primero en `contexto-proyecto.md` §5.

## 4. Deuda Técnica o Inconsistencias

**Bugs reales en código**
1. **Vista del profesor devuelve 0 filas** — `migrations/004_student_health_and_agreements.js:109` usa `OWNER TO migrator` y el comentario de `:93` afirma que bypassa RLS (falso). Fix documentado: owner `service_role`. **Riesgo no documentado**: `ALTER VIEW … OWNER TO service_role` ejecutado por `migrator` exige que `migrator` sea miembro de `service_role`, y `service_role` necesita `SELECT` sobre `student_health_info`. Ninguna migración hace `GRANT` (los grants a `app_user`/`service_role` se hicieron fuera del repo) ⇒ verificar antes de reaplicar.
2. **`withRlsContext` + `return res.status(...).json(...)`** — `src/routes/me.js:57,69,115,123,151` devuelven el objeto `res`; `src/middleware/auth.js:60` hace entonces `res.json(res)` ⇒ `TypeError` (estructura circular) tras el `COMMIT`, que acaba en `errorHandler` intentando responder de nuevo (`ERR_HTTP_HEADERS_SENT`). El cliente recibe el 400/409 correcto, por eso pasó la verificación manual, pero cada error de validación genera un error en servidor. Corregir en el middleware (ignorar si `res.headersSent`) o en los handlers.
3. **Alumnos de Google (y registros sin `displayName`) no pueden completar el perfil** — `src/services/google.js:16` no devuelve `payload.name`, así que `loginGoogle` crea `display_name = NULL`; y **no existe endpoint para editar `display_name`**. `requireCompleteProfile` marcará `display_name` para siempre. Falta un `PATCH /me/profile` (o equivalente) no previsto en el plan.
4. **`crypto` sin importar en `src/routes/me.js:141`** — funciona solo porque Node ≥19 expone `globalThis.crypto`. El contexto dice que se importa de `node:crypto`; no es así.
5. `withRlsContext` hace `appPool.connect()` fuera del `try` (`auth.js:49`): si el pool falla, la promesa rechaza sin `next(err)` (Express 4 no la captura).
6. Login elige el rol con `ORDER BY id LIMIT 1`: un usuario con varios roles (permitido por `UNIQUE(user_id, role)`) entra siempre con el más antiguo. Regla de negocio no definida.

**Código vs documentación**
7. **`subscription_agreements` sigue existiendo** (`001:100`) y documentada en `db-architecture.md:92`. El contexto dice que se "renombró" a `user_agreements`, pero en realidad hay dos tablas; la antigua es huérfana. Decidir si se elimina con migración.
8. `plan-de-bloques.md` B4.5 pide vista `SECURITY INVOKER` y `emergency_contact_*` `NOT NULL`; el código y el contexto hacen lo contrario (`SECURITY DEFINER`, NULL). El plan está desactualizado. Su tabla resumen marca B4.5 como "Pendiente" mientras el contexto dice "EN CURSO".
9. `plan-de-bloques.md` B4.5 espera `missing` con `'emergency_contact'` cuando no hay fila de salud; el código solo devuelve `'health_info'` en ese caso (el contexto refleja el comportamiento real).
10. `db-architecture.md` dice "RLS con FORCE en todas las tablas" y que `service_role` se usa para "waiver": falso hoy (RLS solo en 8 tablas) y contradice el contexto. Documento obsoleto (generado en B0).
11. **`contexto-proyecto.md` está duplicado**: el documento completo se repite a partir de la línea ~820 (pegado dos veces). Hay que deduplicarlo.
12. El contexto (§7) lista como existentes `src/config/storage.js`, `src/services/storage.js`, `src/services/agreements.js`, `src/routes/admin/agreements.js`, `005_agreement_documents.js`, `storage/` y `agreement_documents` en §6: **no existen** (son de B4.5.1).
13. Mensajes de commit reales ≠ documentados (`ee731e1 Block B4 - closed` vs `feat(B4): …`).
14. Formato de error inconsistente: `errorHandler` emite `{ error: <code>, message }` y las rutas emiten `{ error: <categoria>, code: <detalle> }`. El cliente recibe dos contratos distintos.
15. `.env.example` desincronizado: no tiene `DATABASE_URL_APP`, `DATABASE_URL_SERVICE`, `GOOGLE_CLIENT_ID`, `JWT_EXPIRES_IN`; tiene variables obsoletas (`TOTP_ENCRYPTION_KEY`, `QR_HMAC_SECRET`, `STRIPE_API_KEY` vs `STRIPE_SECRET_KEY` del contexto) y un `DATABASE_URL` con usuario `kaizen_app_user`/host `db`, que no coincide con los roles reales.
16. `npm run lint` no tiene configuración de ESLint en el repo (no hay `.eslintrc*`); probablemente falla.
17. `README.md` es genérico y no refleja la arquitectura.
18. Barrels `src/{middleware,routes,services}/index.js` vacíos: el contexto dice que reexportan.

**Información que falta en los `.md`**
- Cómo se crearon los roles `app_user`/`service_role` y sus `GRANT` (no hay script ni migración; reproducir el entorno desde cero no es posible solo con el repo).
- Columnas reales de `invoices` (marcado PENDIENTE en el contexto §6) y confirmación de enums `sub_status`/`payment_method` antes de B10.
- Definición de `device_tokens` y `subscription_disciplines` (citadas en el plan, sin esquema).
- Reglas de negocio de reservas: aforo, cuándo se cancela, promoción desde lista de espera, si se exige suscripción activa para reservar y qué disciplinas cubre cada plan.
- Gamificación (B14): qué es una racha, qué badges hay.
- Informes (B16/B17): qué métricas.
- Qué hace un `profesor` sobre `class_sessions` (¿se le asigna?, ¿la crea?).
- Política de multi-rol (ver punto 6).
- Proveedor de email (B10.6) y librería multipart (B4.5.1) sin decidir.

## 5. Próximos Pasos (Solo lógica, sin diseño)

Fuera de alcance de esta lista: B18 (PWA) y la parte de UI de B19.

0. **Higiene previa (≤1 sesión)**: deduplicar `contexto-proyecto.md`, alinear `plan-de-bloques.md` B4.5 con lo decidido, sincronizar `.env.example`, añadir config ESLint.
1. **Cerrar B4.5**: fix owner de la vista (verificando membership/grants, §4.1) + 2 tests opcionales (alumno/admin no ven la vista); fix `withRlsContext`/`return res` (§4.2); importar `crypto` (§4.4); resolver `display_name` (§4.3: devolver `name` desde Google + endpoint para editarlo); `test:rls` verde; commit.
2. **B4.5.1** gestión documental (dependencia dura antes de B5): `agreement_documents`, storage, subida/publicación, `getCurrentVersion` en `requireCompleteProfile` y en `POST /me/agreements`. Decidir `multer` y `published_by ON DELETE SET NULL`. Decidir qué hacer con `subscription_agreements` (§4.7).
3. **B5** disciplinas/planes/`plan_disciplines` (+ revisar RLS de `academy_settings`).
4. **B6** `class_sessions` (definir antes el papel del profesor).
5. **B7** reservas con `FOR UPDATE`, lista de espera y `requireCompleteProfile` montado (definir antes las reglas de aforo/espera).
6. **B8** asistencia manual + `audit_log`; restringir la vista del profesor a sus alumnos.
7. **B10** Stripe base (checkout, portal, webhook idempotente) → **B12** en el mismo flujo (consentimientos vigentes en checkout; ya cubierto en gran parte por `requireCompleteProfile`).
8. **B10.1** `invoices` + `invoice.payment_failed` (antes: `\d invoices`, confirmar enums).
9. **B10.5** `subscription_disciplines` + upgrade/downgrade.
10. **B11** cancelación admin.
11. **B10.2** endpoint de morosos.
12. **B10.6** emails de billing (elegir proveedor).
13. **B9** QR dinámico / tablet (`device_tokens`).
14. **B13** perfiles públicos (sin unir salud; revisar `profiles_select` del profesor).
15. **B15** push (incluye aviso de re-firma).
16. **B14** racha/badges (requiere definición de negocio).
17. **B16** agregaciones + cron → **B17** endpoints de informes.
18. **B19 (solo endpoints)**: usuarios, auditoría, métricas y documentos legales.
19. **B20** hardening: rate limiting, auditoría RLS, backups BD + `storage/`, checksum al servir PDFs, test runner real con BD efímera, E2E (MFA, onboarding), probar `link_required` con cuenta real.

---8<--- FIN TRASPASO.md ---8<---
