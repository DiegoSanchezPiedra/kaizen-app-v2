# Kaizen App — Plan de bloques

> Hoja de ruta estable. Define **qué hacer y en qué orden**.
> El estado real (qué está hecho) vive en `contexto-proyecto.md`.

---

## Índice

1. Cómo leer este documento
2. Convenciones de los bloques
3. Tabla resumen de bloques
4. Detalle por bloque

---

## 1. Cómo leer este documento

- Cada bloque tiene: **objetivo**, **entregable**, **fuera de alcance** y **checklist de cierre**.
- Un bloque **no se abre** hasta que el anterior esté en la checklist de cierre cumplida y reflejada en `contexto-proyecto.md`.
- Los bloques **no se solapan**: si algo pertenece a un bloque futuro, no se implementa antes.
- Si un bloque necesita una decisión de diseño nueva, se documenta primero en `contexto-proyecto.md` §5 y luego se implementa.

---

## 2. Convenciones de los bloques

- **Entregable**: qué archivos/endpoints/tablas deben existir al terminar.
- **Fuera de alcance**: qué NO se toca en ese bloque (para evitar scope creep).
- **Checklist de cierre**: condiciones verificables (comandos, tests manuales, estados esperados).

---

## 3. Tabla resumen de bloques

| Bloque | Título | Depende de | Estado |
|---|---|---|---|
| B0 | Docker + PostgreSQL + roles + migración inicial | — | CERRADO |
| B1 | Esqueleto backend (pools, `/health`, errorHandler) | B0 | CERRADO |
| B2 | Auth base (local + Google OIDC) + JWT + `SET LOCAL` | B1 | CERRADO |
| B3 | RLS Fase 1 + tests por rol | B2 | CERRADO |
| B4 | MFA TOTP admin | B2 | Pendiente |
| B4.5 | `student_health_info` + consentimientos + bloqueo backend | B2 | Pendiente |
| B5 | CRUD disciplinas, planes, `plan_disciplinas` (admin) | B3 | Pendiente |
| B6 | CRUD `class_sessions` + calendario | B5 | Pendiente |
| B7 | Reservas (`create_booking`, `FOR UPDATE`, lista de espera) | B6 | Pendiente |
| B8 | Asistencia manual (`register_attendance`, auditoría) | B7 | Pendiente |
| B9 | QR dinámico (`device_tokens`, SSE, check-in) | B8 | Pendiente |
| B10 | Stripe base (checkout, portal, webhook idempotente) | B4.5, B7 | Pendiente |
| B10.1 | Modelo Stripe en `invoices` + webhook `invoice.payment_failed` | B10 | Pendiente |
| B10.2 | Endpoint admin `GET /admin/billing/failed-payments` | B10.1 | Pendiente |
| B10.5 | `subscription_disciplines` + upgrade/downgrade | B10 | Pendiente |
| B10.6 | Emails transaccionales de billing (al alumno) | B10.1 | Pendiente |
| B11 | Cancelación admin de suscripciones | B10.5 | Pendiente |
| B12 | Validación final waiver/consentimientos en checkout | B10, B4.5 | Pendiente |
| B13 | Perfiles públicos (flags, `public_profiles`, directorio) | B3 | Pendiente |
| B14 | Racha, badges, tabla opt-in | B7 | Pendiente |
| B15 | Push (`push_subscriptions`, envío) | B2 | Pendiente |
| B16 | Agregaciones de informes + cron nocturno | B8 | Pendiente |
| B17 | Endpoints de informes | B16 | Pendiente |
| B18 | PWA (manifest, Service Worker) | B13 | Pendiente |
| B19 | Panel admin (métricas, usuarios, auditoría, morosos) | B11, B17, B10.2 | Pendiente |
| B20 | Hardening (rate limiting, RLS audit, backups, E2E) | Todos | Pendiente |

---

## 4. Detalle por bloque

### B0 — Docker + PostgreSQL + roles + migración inicial — CERRADO
- **Objetivo**: entorno BD reproducible con tres roles y esquema inicial.
- **Entregable**: `docker-compose.yaml`, `.env`, `migrations/001_initial_setup.js`, scripts npm.
- **Checklist de cierre**:
  - [x] Contenedor healthy en `127.0.0.1:5432`.
  - [x] `app_user` (`rolbypassrls=f`), `service_role` (`rolbypassrls=t`), `migrator` (`rolbypassrls=f`).
  - [x] 23 tablas con owner `migrator`.
  - [x] `npm run migrate` y `migrate:down` funcionan.

### B1 — Esqueleto backend — CERRADO
- **Objetivo**: servidor arranca, conecta a ambos pools, expone `/health`, maneja errores.
- **Entregable**: `src/index.js`, `src/config/database.js`, `src/middleware/errorHandler.js`.
- **Checklist de cierre**:
  - [x] `/health` → 200 `{status:"ok", db:{app:{ok:true},service:{ok:true}}}`.
  - [x] Ruta inexistente → 404 JSON.
  - [x] `Ctrl+C` cierra limpio, `ss -tlnp | grep 3000` vacío.
  - [x] Logs muestran `app_user` y `service_role` (nunca `migrator`).

### B2 — Auth base (local + Google OIDC) + JWT + `SET LOCAL` — CERRADO
- **Objetivo**: registro, login local, login Google, JWT con `sub`+`role`, middleware que abre transacción con `SET LOCAL`.
- **Entregable** (implementado):
  - Migración `002_auth_credentials.js`: tabla `auth_credentials`, índice único parcial en `google_sub`, check de método de login, trigger `updated_at`, `user_roles.id` → IDENTITY.
  - `src/config/auth.js`.
  - `src/middleware/asyncHandler.js` (helper Express 4).
  - `src/services/auth.js`, `password.js`, `jwt.js`, `google.js`.
  - `src/middleware/auth.js` (`requireAuth`, `requireRole`, `withRlsContext`).
  - `src/routes/auth.js`: `POST /auth/register`, `POST /auth/login`, `POST /auth/google`, `GET /auth/me`.
  - `src/index.js`: monta `/auth`.
  - Barrels `index.js` en `middleware/`, `routes/`, `services/`.
- **Checklist de cierre**:
  - [x] Migración `002` aplicada y reversible (`migrate:down`).
  - [x] Registro crea usuario (profiles + auth_credentials + user_roles `alumno`), hashea password, devuelve JWT.
  - [x] Login verifica password y devuelve JWT.
  - [x] Google verifica ID token con `audience: GOOGLE_CLIENT_ID`, resuelve por `google_sub` o email, crea usuario si es nuevo (`password_hash = NULL`). **Verificado con cuenta real.**
  - [x] Vinculación por email NO automática (409 `link_required` si coincide email sin `google_sub`). Implementado, no probado con cuenta real.
  - [x] Middleware protege ruta de prueba y ejecuta `SET LOCAL` en transacción.

### B3 — RLS Fase 1 + tests por rol — CERRADO
- **Objetivo**: activar RLS en las 6 tablas de Fase 1, refactorizar `createUser` y login para convivir con RLS, y verificar por rol con un script reproducible.
- **Entregable** (implementado):
  - Migración `003_rls_fase1.js`: `ENABLE` + `FORCE ROW LEVEL SECURITY` en `profiles`, `auth_credentials`, `user_roles`, `user_mfa`, `audit_log`, `academy_settings`. Políticas por tabla (ver `contexto-proyecto.md` §5). `REVOKE UPDATE, DELETE ON audit_log FROM app_user`. Reversible.
  - `src/services/auth.js`: `createUser` con `set_config('app.current_user_id', nuevoUuid, true)` + `set_config('app.current_role', 'alumno', true)` dentro de la transacción `appPool`, **usando siempre `client.query`**. `findCredentialsByEmail` / `findCredentialsByGoogleSub` vía `servicePool` (única lectura sin JWT).
  - `scripts/test-rls.js` + `"test:rls": "node scripts/test-rls.js"` en `package.json`.
- **Fuera de alcance**: RLS en tablas de B5+ (disciplinas, planes, sesiones, reservas, pagos, etc.). Se activan en su bloque. Endpoints nuevos de admin (B4+).
- **Checklist de cierre**:
  - [x] Migración `003` aplicada y reversible (`migrate:down` → `migrate` → `migrate:down` sin error).
  - [x] RLS `ENABLE` + `FORCE` en las 6 tablas; `migrator` respeta RLS (comprobado por `test:rls`).
  - [x] Registro local post-B3 → 201 con usuario creado (RLS activo + `set_config` funcionan), **con el servidor reiniciado tras `migrate`**.
  - [x] Login local post-B3 → 200 con token (`servicePool` en login funciona).
  - [x] `/auth/me` post-B3 → 200 con `rls_context.uid` = `req.user.id` (`withRlsContext` sigue operativo).
  - [x] `npm run test:rls` → 14/14 `OK`, exit 0.
  - [x] `audit_log` append-only: `UPDATE`/`DELETE` fallan para `app_user` (incluido admin), `INSERT` funciona.