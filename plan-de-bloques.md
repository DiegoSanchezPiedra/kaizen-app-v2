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
| B4 | MFA TOTP admin | B2 | CERRADO |
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
- **Entregable**: migración `002_auth_credentials.js`; `src/config/auth.js`; `src/middleware/asyncHandler.js`; servicios `auth.js`, `password.js`, `jwt.js`, `google.js`; `src/middleware/auth.js`; `src/routes/auth.js`; montaje en `src/index.js`; barrels.
- **Checklist de cierre**:
  - [x] Migración `002` aplicada y reversible (`migrate:down`).
  - [x] Registro crea usuario (profiles + auth_credentials + user_roles `alumno`), hashea password, devuelve JWT.
  - [x] Login verifica password y devuelve JWT.
  - [x] Google verifica ID token con `audience: GOOGLE_CLIENT_ID`, resuelve por `google_sub` o email, crea usuario si es nuevo (`password_hash = NULL`). Verificado con cuenta real.
  - [x] Vinculación por email NO automática (409 `link_required` si coincide email sin `google_sub`). Implementado, no probado con cuenta real (→ B20).
  - [x] Middleware protege ruta de prueba y ejecuta `SET LOCAL` en transacción.

### B3 — RLS Fase 1 + tests por rol — CERRADO
- **Objetivo**: activar RLS en las 6 tablas de Fase 1, refactorizar `createUser` y login para convivir con RLS, y verificar por rol con un script reproducible.
- **Entregable**: migración `003_rls_fase1.js`; refactor `createUser`; `scripts/test-rls.js` + `"test:rls"`.
- **Fuera de alcance**: RLS en tablas de B5+. Endpoints nuevos de admin (B4+).
- **Checklist de cierre**:
  - [x] Migración `003` aplicada y reversible.
  - [x] RLS `ENABLE` + `FORCE` en las 6 tablas; `migrator` respeta RLS.
  - [x] Registro local post-B3 → 201, con servidor reiniciado tras `migrate`.
  - [x] Login local post-B3 → 200 con token.
  - [x] `/auth/me` post-B3 → 200 con `rls_context.uid` = `req.user.id`.
  - [x] `npm run test:rls` → 14/14 `OK`, exit 0.
  - [x] `audit_log` append-only: `UPDATE`/`DELETE` fallan para `app_user` (incluido admin), `INSERT` funciona.

### B4 — MFA TOTP admin — CERRADO
- **Objetivo**: TOTP para rol `admin`, con recovery codes y `mfa_enabled` en login.
- **Entregable**: endpoints `/auth/mfa/*`, cifrado AES-256-GCM de secretos, login MFA en dos pasos.
- **Fuera de alcance**: MFA para alumno/profesor (futuro), push MFA, WebAuthn.
- **Checklist de cierre**:
  - [x] `POST /auth/mfa/setup` genera secreto TOTP + URI `otpauth://` + recovery codes (cifrados/hasheados).
  - [x] `POST /auth/mfa/activate` valida TOTP y activa `mfa_enabled`.
  - [x] Login de admin exige TOTP si `mfa_enabled = true` (`mfa_required` + `mfa_token`).
  - [x] Recovery codes: un solo uso, se consumen.
  - [x] `GET /auth/me` expone `mfa_enabled`.
  - [x] `npm run test:mfa` → 13/13 `OK`, exit 0.
  - [x] Verificación HTTP end-to-end del flujo completo (1a–1i): login → `mfa_required` → `/auth/mfa/verify` con TOTP → token final → `/auth/me` con `mfa_enabled: true`; recovery code válido una vez y rechazado en el reintento; `mfa_token` rechazado por `requireAuth`.

### B4.5 — `student_health_info` + consentimientos + bloqueo backend — Pendiente
- **Objetivo**: onboarding de salud y consentimientos; bloquear reservas/checkout hasta que existan.
- **Entregable**: migración `student_health_info` + `subscription_agreements` con RLS; endpoints `/me/health` y `/me/agreements`; helper de bloqueo.
- **Fuera de alcance**: UI de onboarding (frontend), validación de menores (futuro).
- **Checklist de cierre**:
  - [ ] Tabla `student_health_info` creada con RLS (self + admin).
  - [ ] Tabla `subscription_agreements` con RLS (self + admin).
  - [ ] `POST /me/health` y `POST /me/agreements` funcionan.
  - [ ] Helper `requireCompleteProfile(studentId)` bloquea reservas (B7) y checkout (B10).
  - [ ] Tests por rol añadidos a `scripts/test-rls.js`.

### B5 — CRUD disciplinas, planes, `plan_disciplinas` (admin) — Pendiente
- **Objetivo**: catálogo de disciplinas y planes, con RLS.
- **Entregable**: migración RLS en `disciplines`, `plans`, `plan_disciplines`; endpoints admin CRUD.
- **Fuera de alcance**: asignación de planes a alumnos (B10), precios Stripe (B10).
- **Checklist de cierre**:
  - [ ] RLS en las 3 tablas (lectura pública, escritura admin).
  - [ ] CRUD admin `/admin/disciplines`, `/admin/plans`, `/admin/plans/:id/disciplines`.
  - [ ] Tests por rol.
  - [ ] `academy_settings` revisada: si hace falta lectura anónima, añadir `is_public`.

### B6 — CRUD `class_sessions` + calendario — Pendiente
- **Objetivo**: sesiones de clase con calendario.
- **Entregable**: RLS en `class_sessions`; endpoints admin + lectura para alumnos.
- **Fuera de alcance**: reservas (B7), QR (B9).
- **Checklist de cierre**:
  - [ ] RLS en `class_sessions`.
  - [ ] CRUD admin + listado por disciplina/fecha.
  - [ ] Tests por rol.

### B7 — Reservas (`create_booking`, `FOR UPDATE`, lista de espera) — Pendiente
- **Objetivo**: reservas con bloqueo de plaza (`FOR UPDATE`) y lista de espera.
- **Entregable**: RLS en `bookings`; función `create_booking` con `FOR UPDATE`; endpoints de reserva/cancelación.
- **Fuera de alcance**: pago (B10), asistencia (B8).
- **Checklist de cierre**:
  - [ ] RLS en `bookings`.
  - [ ] `create_booking` transaccional con `FOR UPDATE` y control de aforo.
  - [ ] Lista de espera funciona.
  - [ ] Bloqueo por `student_health_info` (B4.5) activo.
  - [ ] Tests de concurrencia + rol.

### B8 — Asistencia manual (`register_attendance`, auditoría) — Pendiente
- **Objetivo**: profesor pasa lista manualmente; se audita.
- **Entregable**: RLS en `attendance`; endpoint `POST /professor/attendance`; inserción en `audit_log`.
- **Fuera de alcance**: QR (B9).
- **Checklist de cierre**:
  - [ ] RLS en `attendance`.
  - [ ] Profesor solo pasa lista de sus sesiones.
  - [ ] `audit_log` registra cada asistencia.
  - [ ] Tests por rol.

### B9 — QR dinámico (`device_tokens`, SSE, check-in) — Pendiente
- **Objetivo**: tablet fija con `device_token`, QR rotativo, check-in por SSE.
- **Entregable**: tabla `device_tokens` (hash), endpoints `/tablet/*`, SSE `/tablet/active-sessions`, rotación de QR.
- **Fuera de alcance**: MFA de tablet (futuro).
- **Checklist de cierre**:
  - [ ] `device_tokens` con hash y RLS.
  - [ ] Tablet autentica con `device_token`.
  - [ ] QR rota cada N segundos con `session_id`.
  - [ ] Ventana de check-in configurable.
  - [ ] Tests manuales.

### B10 — Stripe base (checkout, portal, webhook idempotente) — Pendiente
- **Objetivo**: checkout, portal de cliente y webhook idempotente.
- **Entregable**: RLS en `subscriptions`; endpoints `/billing/checkout`, `/billing/portal`; webhook con `webhook_events`.
- **Fuera de alcance**: `invoices` ampliadas (B10.1), upgrade/downgrade (B10.5), cancelación (B11).
- **Checklist de cierre**:
  - [ ] RLS en `subscriptions`.
  - [ ] Checkout crea suscripción en Stripe + fila local.
  - [ ] Portal redirige.
  - [ ] Webhook idempotente vía `webhook_events`.
  - [ ] Bloqueo por `student_health_info` + consentimientos (B4.5, B12).

### B10.1 — Modelo Stripe en `invoices` + webhook `invoice.payment_failed` — Pendiente
- **Objetivo**: ampliar `invoices` con datos Stripe; manejar `invoice.payment_failed`.
- **Entregable**: migración de columnas (`stripe_invoice_id`, `status`, `attempt_count`, `next_payment_attempt`, `last_payment_error`, `hosted_invoice_url`); webhook handler.
- **Fuera de alcance**: emails (B10.6), endpoint admin (B10.2).
- **Checklist de cierre**:
  - [ ] Columnas añadidas y RLS.
  - [ ] `invoice.payment_failed` guarda `last_payment_error`.
  - [ ] Idempotencia vía `webhook_events`.
  - [ ] Tests manuales con Stripe CLI.

### B10.2 — Endpoint admin `GET /admin/billing/failed-payments` — Pendiente
- **Objetivo**: lista de morosos para el panel admin.
- **Entregable**: endpoint con RLS admin, filtro `status IN ('open','past_due','uncollectible')`.
- **Fuera de alcance**: UI (B19).
- **Checklist de cierre**:
  - [ ] Endpoint devuelve lista paginada.
  - [ ] Solo admin.
  - [ ] Tests.

### B10.5 — `subscription_disciplines` + upgrade/downgrade — Pendiente
- **Objetivo**: disciplinas por suscripción, upgrade inmediato, downgrade al final del periodo.
- **Entregable**: tabla `subscription_disciplines` con RLS; endpoints de upgrade/downgrade con Subscription Schedule.
- **Fuera de alcance**: cancelación (B11).
- **Checklist de cierre**:
  - [ ] Tabla + RLS.
  - [ ] Upgrade: prorrateo + disciplinas al instante.
  - [ ] Downgrade: sin reembolso + disciplinas al transicionar.
  - [ ] Tests manuales con Stripe.

### B10.6 — Emails transaccionales de billing (al alumno) — Pendiente
- **Objetivo**: email al alumno en `invoice.payment_failed`.
- **Entregable**: proveedor elegido (Resend/Postmark/SMTP), `services/email.js`, plantilla.
- **Fuera de alcance**: push (B15).
- **Checklist de cierre**:
  - [ ] Proveedor configurado en `.env`.
  - [ ] Email enviado en `invoice.payment_failed`.
  - [ ] Idempotencia (no duplicar en replay).
  - [ ] Test manual.

### B11 — Cancelación admin de suscripciones — Pendiente
- **Objetivo**: admin cancela (`cancel-now` / `cancel-at-period-end`).
- **Entregable**: endpoints `/admin/subscriptions/:id/cancel-now` y `/cancel-at-period-end`.
- **Fuera de alcance**: cancelación por alumno (no permitida).
- **Checklist de cierre**:
  - [ ] Ambos endpoints funcionan.
  - [ ] `audit_log` registra.
  - [ ] Tests.

### B12 — Validación final waiver/consentimientos en checkout — Pendiente
- **Objetivo**: bloquear checkout si faltan consentimientos.
- **Entregable**: validación en `/billing/checkout` contra `subscription_agreements`.
- **Fuera de alcance**: firma electrónica avanzada (futuro).
- **Checklist de cierre**:
  - [ ] Checkout bloqueado sin consentimientos.
  - [ ] Tests.

### B13 — Perfiles públicos (flags, `public_profiles`, directorio) — Pendiente
- **Objetivo**: perfiles públicos con flags granulares y directorio.
- **Entregable**: vista/función `public_profiles` respetando `visible_fields`; endpoint `/public/profiles`.
- **Fuera de alcance**: UI (B18).
- **Checklist de cierre**:
  - [ ] `public_profiles` solo expone campos permitidos.
  - [ ] Directorio paginado.
  - [ ] Revisar política `profiles_select` para `profesor` (¿restringir a alumnos con reserva?).
  - [ ] Tests.

### B14 — Racha, badges, tabla opt-in — Pendiente
- **Objetivo**: gamificación básica (racha, badges, tabla opt-in).
- **Entregable**: tablas/vistas necesarias; endpoints.
- **Fuera de alcance**: push de logros (B15).
- **Checklist de cierre**:
  - [ ] Racha calculada.
  - [ ] Badges asignados.
  - [ ] Tabla opt-in funcional.
  - [ ] Tests.

### B15 — Push (`push_subscriptions`, envío) — Pendiente
- **Objetivo**: notificaciones push.
- **Entregable**: RLS en `push_subscriptions`; endpoints de suscripción; envío con web-push.
- **Fuera de alcance**: push al admin (solo alumno).
- **Checklist de cierre**:
  - [ ] Suscripción/desuscripción.
  - [ ] Envío en eventos clave (pago fallido, reserva).
  - [ ] Tests manuales.

### B16 — Agregaciones de informes + cron nocturno — Pendiente
- **Objetivo**: agregaciones diarias (`student_stats_daily`, `academy_stats_daily`).
- **Entregable**: job nocturno (cron), RLS en las tablas de agregación.
- **Fuera de alcance**: endpoints (B17).
- **Checklist de cierre**:
  - [ ] Job corre a las 03:00.
  - [ ] Datos correctos para un día de prueba.
  - [ ] Tests.

### B17 — Endpoints de informes — Pendiente
- **Objetivo**: endpoints de informes para admin/profesor.
- **Entregable**: `/admin/reports/*`, `/professor/reports/*`.
- **Fuera de alcance**: UI (B19).
- **Checklist de cierre**:
  - [ ] Endpoints paginados.
  - [ ] RLS correcta.
  - [ ] Tests.

### B18 — PWA (manifest, Service Worker) — Pendiente
- **Objetivo**: frontend PWA.
- **Entregable**: `manifest.json`, Service Worker, build del frontend.
- **Fuera de alcance**: backend (sin cambios).
- **Checklist de cierre**:
  - [ ] Instalable.
  - [ ] Offline básico.
  - [ ] Build reproducible (`npm run build:frontend` o equivalente, a decidir aquí).

### B19 — Panel admin (métricas, usuarios, auditoría, morosos) — Pendiente
- **Objetivo**: panel admin con métricas, usuarios, auditoría y morosos.
- **Entregable**: endpoints + UI.
- **Fuera de alcance**: nada específico.
- **Checklist de cierre**:
  - [ ] Métricas visibles.
  - [ ] Gestión de usuarios.
  - [ ] `audit_log` consultable.
  - [ ] Morosos (B10.2) visible.
  - [ ] Tests manuales.

### B20 — Hardening (rate limiting, RLS audit, backups, E2E) — Pendiente
- **Objetivo**: endurecer el sistema.
- **Entregable**: rate limiting, auditoría de RLS, backups, tests E2E, runner formal (Node test runner o Vitest), `npm run lint`, `npm run test`, `npm run build:prod` si hay frontend.
- **Fuera de alcance**: nada.
- **Checklist de cierre**:
  - [ ] Rate limiting en `/auth/*`.
  - [ ] Auditoría de RLS (revisar todas las políticas).
  - [ ] Backups automáticos.
  - [ ] E2E de flujos críticos (incluye flujo MFA completo de B4 con supertest).
  - [ ] `scripts/test-rls.js` y `scripts/test-mfa.js` migrados a BD efímera por test run (no destructivo en local compartido).