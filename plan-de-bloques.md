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
| B4.5 | `student_health_info` + `user_agreements` + bloqueo backend | B2 | Pendiente |
| B4.5.1 | Gestión documental admin (`agreement_documents`, storage, subida) | B4.5 | Pendiente |
| B4.6 | Cuenta familiar: el tutor crea y gestiona hijos sin credenciales (`PLAN_FAMILIA.md`) | B4.5.1 | IMPLEMENTADO (pendiente commit) |
| B5 | CRUD disciplinas, planes y disciplinas elegibles (`plan_disciplines`) (admin) | B3, B4.6 | IMPLEMENTADO (pendiente commit) |
| B6 | Clases + sesiones (CRUD admin, generación a 1 año, vista profesor) | B5 | Hecho (calendario alumno pendiente) |
| B7 | Reservas (`create_booking`, `FOR UPDATE`, lista de espera) | B6, B4.5 | IMPLEMENTADO (pendiente commit) |
| B8 | Asistencia manual (`register_attendance`, auditoría) | B7 | IMPLEMENTADO (pendiente commit) |
| B9 | QR dinámico (`device_tokens`, SSE, check-in) | B8 | IMPLEMENTADO (pendiente commit) |
| B10 | Stripe base (checkout, portal, webhook idempotente) | B4.5, B7 | IMPLEMENTADO |
| B10.1 | Modelo Stripe en `invoices` + webhook `invoice.payment_failed` | B10 | IMPLEMENTADO |
| B10.2 | Endpoint admin morosos y "en gracia" por pagador | B10.1, B10.3 | IMPLEMENTADO |
| B10.3 | Seguro y cobertura de riesgo (seguro anual o `waiver`) | B10.1 | Implementado |
| B10.5 | Upgrade/downgrade + cambio de disciplina | B10 | Diseñado |
| B10.6 | Emails transaccionales de billing (al pagador) | B10.1 | Pendiente |
| B11 | Baja admin de suscripciones y seguro + cambio de pagador | B10.5, B10.3 | Pendiente |
| B12 | ~~Validación final waiver/consentimientos en checkout~~ | — | ELIMINADO (absorbido por B4.5 y B10.3) |
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

### B4.5 — `student_health_info` + `user_agreements` + bloqueo backend — Pendiente
- **Objetivo**: onboarding de salud y consentimientos; bloquear reservas/checkout hasta que estén completos. Versiones vigentes hardcodeadas en config (B4.5.1 las moverá a BD).
- **Entregable**:
  - Migración `004_student_health_and_agreements.js`: `student_health_info` (1:1, RLS self+admin), `user_agreements` (append-only, RLS self+admin), vista `student_health_professor_view` (`SECURITY INVOKER`, solo `injuries`/`conditions`), triggers `set_updated_at`.
  - `src/config/agreements.js`: `AGREEMENT_TYPES`, `CURRENT_*_VERSION`.
  - `src/services/profile.js`: `requireCompleteProfile(studentId, role)` → `{ ok, missing }`.
  - `src/middleware/requireCompleteProfile.js`.
  - `src/routes/me.js`: `GET /me/profile-status`, `POST /me/health`, `POST /me/agreements`.
  - `src/routes/agreements.js`: `GET /agreements/:type/current` (sirve PDF placeholder de config).
  - Tests por rol en `scripts/test-rls.js`.
- **Fuera de alcance**: subida admin de documentos (B4.5.1); UI de onboarding (frontend); consentimiento de menores; eIDAS; `public_profiles` (B13).
- **Checklist de cierre**:
  - [ ] `student_health_info` creada con `profile_id` PK, `ON DELETE CASCADE`, `emergency_contact_*` NOT NULL, trigger `set_updated_at`.
  - [ ] `user_agreements` creada con `UNIQUE(profile_id, type, version)`, append-only (`REVOKE UPDATE, DELETE`).
  - [ ] RLS `ENABLE` + `FORCE` en ambas; políticas coherentes con §5.
  - [ ] Vista `student_health_professor_view` con solo `profile_id`, `injuries`, `conditions`; SELECT a `profesor`.
  - [ ] `src/config/agreements.js` con los 3 tipos y sus versiones; falla al arrancar si falta.
  - [ ] `requireCompleteProfile` devuelve `{ ok, missing }` con la definición de §5 (display_name + health con emergency_contact + 3 agreements en versión vigente).
  - [ ] `POST /me/health` (upsert) y `POST /me/agreements` (`{ type, version }`) funcionan.
  - [ ] `GET /me/profile-status` devuelve `{ ok, missing }` sin provocar 403.
  - [ ] `GET /agreements/:type/current` sirve el PDF vigente (placeholder de config).
  - [ ] Tests por rol añadidos a `scripts/test-rls.js`: alumno no lee health de otro; admin sí; profesor solo ve `injuries`/`conditions` vía vista; alumno no puede borrar `user_agreements`.
  - [ ] Verificación HTTP manual: alumno sin health → `GET /me/profile-status` con `missing: ['health_info','emergency_contact','waiver','data_protection','rights_of_image']`; tras completar → `ok: true`.
  - [ ] `migrate:down` → `migrate` → `migrate:down` sin error.
  - [ ] Servidor reiniciado tras `migrate` (riesgo §9).
  - [ ] Commit `feat(B4.5): student_health_info + user_agreements + requireCompleteProfile`.

### B4.5.1 — Gestión documental admin (`agreement_documents`, storage, subida) — Pendiente
- **Objetivo**: que el admin pueda subir, publicar y retirar los PDFs de los 3 tipos de agreement; `requireCompleteProfile` pasa a leer la versión vigente de BD.
- **Dependencia dura**: va **inmediatamente después de B4.5, antes de B5**. Sin esto, B7/B10 no pueden usar versiones reales.
- **Entregable**:
  - Migración `005_agreement_documents.js`: tabla `agreement_documents` con ciclo `created → published → retired`, índice único parcial para "una versión vigente por tipo", RLS (alumnos ven publicados, admin todo).
  - `src/config/storage.js`: `AGREEMENTS_STORAGE_PATH` (default `./storage/agreements`); crea directorio al arrancar.
  - `src/services/storage.js`: `saveFile`, `readFile`, `deleteFile` (filesystem, sin S3).
  - `src/services/agreements.js`: `getCurrentVersion(type)` (lee de BD), `publishDocument`, `retireDocument`.
  - `src/routes/admin/agreements.js`: `POST /admin/agreements/documents` (multipart), `POST /admin/agreements/documents/:id/publish`, `GET /admin/agreements/documents`.
  - `GET /agreements/:type/current` cambia de config a BD.
  - `requireCompleteProfile` cambia de fuente (mismo contrato `{ ok, missing }`).
  - `storage/` en `.gitignore` + `.gitkeep`.
- **Fuera de alcance**: S3/MinIO (B20), backup de `storage/` (B20), firma electrónica avanzada (futuro), UI de admin (B19).
- **Checklist de cierre**:
  - [ ] `agreement_documents` creada con `UNIQUE(type, version)`, índice parcial de versión vigente, RLS.
  - [ ] `AGREEMENTS_STORAGE_PATH` en `.env` / `.env.example`; directorio creado al arrancar; `storage/` en `.gitignore`.
  - [ ] `storage.js` con `saveFile`/`readFile`/`deleteFile`; checksum SHA-256 al guardar.
  - [ ] `POST /admin/agreements/documents` (multipart, admin): valida `type` ∈ `AGREEMENT_TYPES`, `version` semver-ish, `mime_type = application/pdf`, tamaño ≤ 10 MB; 409 `duplicate_document` / `version_exists_different_content` si aplica.
  - [ ] `POST /admin/agreements/documents/:id/publish` (admin): retira la vigente anterior del mismo tipo, publica la nueva, audita en `audit_log`.
  - [ ] `GET /admin/agreements/documents` (admin): lista con versiones y estado.
  - [ ] `GET /agreements/:type/current` sirve el PDF publicado vigente desde `AGREEMENTS_STORAGE_PATH`.
  - [ ] `requireCompleteProfile` lee versión vigente de `agreement_documents` (vía `getCurrentVersion`); contrato `{ ok, missing }` sin cambios.
  - [ ] Tests por rol: admin sube/publica; alumno no puede subir; alumno ve el publicado; versión retirada no es "vigente".
  - [ ] `migrate:down` → `migrate` → `migrate:down` sin error.
  - [ ] Servidor reiniciado tras `migrate`.
  - [ ] Verificación HTTP manual end-to-end: admin sube PDF → publica → alumno `GET /agreements/waiver/current` obtiene el PDF → `POST /me/agreements` con la versión nueva → `requireCompleteProfile` `ok: true`.
  - [ ] Commit `feat(B4.5.1): agreement_documents + storage + subida admin + requireCompleteProfile desde BD`.

### B4.6 — Cuenta familiar — IMPLEMENTADO (pendiente commit)
- **Objetivo**: el tutor se registra, crea a sus hijos (perfiles **sin credenciales**) y gestiona todo por ellos. Plan, decisiones D1–D16 y tabla de refactor en `PLAN_FAMILIA.md`; vocabulario en `CONTEXT.md`; ADR 0002.
- **Primera versión** (commit `bc4685d`): menor con login propio y tutor que solo firmaba. Se sustituye.
- **Dependencia dura**: después de B4.5.1 y **antes de B5** (reservas y pagos nacen con este modelo).
- **Entregable**:
  - Reescribir `006_minors_guardians.js` en el sitio. Se mantienen `birth_date`, el rol `tutor`, `guardianships`, `signed_by` y la unicidad con el firmante. Se añaden `create_child` (`SECURITY DEFINER`), el helper RLS `is_guardian_of`, políticas de tutor en `student_health_info` y `profiles`.
  - Registro propio solo ≥ 18 (`registerLocal`). Onboarding de Google: aplazado al frontend (aún no hay endpoint que fije `birth_date`).
  - `subscriptions.payer_id NOT NULL` (la regla D14 llega en B10).
  - `GET/POST /me/children`, `PATCH /me/children/:id`; `profile_id` opcional en `/me/health`, `/me/profile-status` y `/me/agreements`.
  - `getProfileStatus`: rol `tutor` = `display_name` + `data_protection`. Hijo: firmas del tutor hasta los 18.
  - `requireCompleteProfile`: comprueba sujeto + actor.
- **Fuera de alcance**: UI; invitación para reclamar el perfil a los 18; invitación de un 2º tutor; reservas y pagos (B7/B10, que ya nacen con sujeto/actor). 
- **Permisos de BD** (aplicados a mano como superusuario el 2026-10-27; repetir en cada instalación nueva): `GRANT service_role TO migrator` y `GRANT CREATE ON SCHEMA public TO service_role`. Son necesarios para que la vista de profesor (004) y `is_guardian_of`/`create_child` (006) tengan owner `service_role` (BYPASSRLS).
- **Checklist de cierre** (verde el 2026-10-27; el HTTP de firmas queda pendiente de documentos publicados): `test-minors.js` reescrito (el tutor crea un hijo y no se vincula a perfiles existentes; un adulto no puede ser hijo; el tutor edita la salud y firma; otro tutor no; a los 18 pierde poderes pero ve la lista; tutor sin `data_protection` incompleto); `test:rls` verde; `migrate:down` → `migrate` sin error; verificación HTTP del flujo del tutor.

### B5 — CRUD disciplinas, planes y disciplinas elegibles (admin) — IMPLEMENTADO
- **Objetivo**: catálogo de disciplinas y planes, con RLS. Vocabulario en `CONTEXT.md` ("Planes y disciplinas"); modelo en ADR 0003: **el plan fija cuántas disciplinas, la suscripción fija cuáles**.
- **Entregable**: migración `007` con esquema + RLS en `disciplines`, `plans`, `plan_disciplines`; endpoints admin CRUD.
  - `disciplines`: `minors_only boolean NOT NULL DEFAULT false`; `is_active NOT NULL DEFAULT true`.
  - `plans`: número de disciplinas a elegir (1, 2… o NULL = todas); `minors_only boolean NOT NULL DEFAULT false`; `billing_period` restringido a un conjunto cerrado (hoy solo `monthly`); `price_cents NOT NULL ≥ 0`; `is_active NOT NULL DEFAULT true`.
  - `plan_disciplines` = **disciplinas elegibles** (opcional; sin filas = cualquier disciplina activa permitida por edad). **No** son las disciplinas cubiertas.
  - `disciplines.id` / `plans.id`: `GENERATED ALWAYS AS IDENTITY` (ids como string en JSON). `plans.stripe_price_id` nullable único, lo rellena B10. `plans.name` único.
  - Endpoints: admin `/admin/disciplines`, `/admin/plans`, `/admin/plans/:id/disciplines` (PUT reemplaza la lista; sin `DELETE` HTTP) y lectura autenticada `GET /disciplines`, `GET /plans`. Cambio de precio y retirada se auditan en `audit_log`.
  - Reglas añadidas: `max_disciplines`/`minors_only` no se editan con suscripciones (409); elegibles ≥ `max_disciplines`; un plan solo menores puede listar disciplinas de adultos (adolescentes en Muay Thai adultos). Que un adulto no contrate planes solo menores se valida en B10 con `plans.minors_only`.
  - ~~**Pendiente B10**~~: hecho en `012` (`plans_select_subscribed`, `disciplines_select_subscribed`).
- **Reglas**: nunca se borra una disciplina o plan con historial: se desactiva (retirar). Precio editable (se aplica desde la siguiente facturación de cada suscriptor; la propagación a Stripe es B10).
- **Fuera de alcance**: suscripciones y disciplinas elegidas (B10), precios Stripe (B10), cambio de disciplina / upgrade / downgrade (B10.5), lectura anónima del catálogo (decidido: no).
- **Checklist de cierre**:
  - [x] Esquema y RLS en las 3 tablas: lectura para autenticados (activos; retirados solo admin), escritura solo admin.
  - [x] CRUD admin `/admin/disciplines`, `/admin/plans`, `/admin/plans/:id/disciplines` (elegibles).
  - [x] Validación: número de disciplinas ≥ 1 o "todas"; `billing_period` del conjunto cerrado; sin `DELETE` de filas con historial.
  - [x] Tests por rol: `npm run test:catalog` → 10/10 OK; `test:rls`, `test:agreements`, `test:minors` verdes.
  - [x] `migrate:down` → `migrate` → `migrate:down` sin error.

### B6 — CRUD `class_sessions` + calendario — Pendiente
- **Objetivo**: sesiones de clase con calendario.
- **Entregable**: RLS en `class_sessions`; endpoints admin + lectura para alumnos.
- **Fuera de alcance**: reservas (B7), QR (B9), eventos (`events`/`event_registrations`, sin bloque asignado).
- **Nota**: un evento no es una sesión (ver `CONTEXT.md`). La FK `events.id → class_sessions(id)` de `001` es un error; se elimina cuando se aborden los eventos.
- **Nota**: `session_status.completed` sobra: «celebrada» se calcula por la hora (ver `CONTEXT.md`). El enum queda en `scheduled | cancelled`.
- **Checklist de cierre**:
  - [ ] RLS en `class_sessions`.
  - [ ] CRUD admin + listado por disciplina/fecha.
  - [ ] Tests por rol.

### B7 — Reservas (`create_booking`, `FOR UPDATE`, lista de espera) — IMPLEMENTADO
- **Objetivo**: reservas con bloqueo de plaza (`FOR UPDATE`) y lista de espera.
- **Cuenta familiar**: `student_id` = sujeto + `booked_by` = actor; RLS con `is_guardian_of`; `profile_id` opcional; bloqueo si el hijo o el tutor está incompleto. `event_registrations`: mismo patrón. Ver `PLAN_FAMILIA.md` §5.
- **Entregable**: RLS en `bookings`; función `create_booking` con `FOR UPDATE`; endpoints de reserva/cancelación; middleware `requireCompleteProfile` (B4.5) montado.
- **Reglas de dominio**: fijadas en `CONTEXT.md` § Reservas (grill-with-docs, sin ADR).
- **Implementación** (migración `009`): la lógica vive en funciones `SECURITY DEFINER` (owner `service_role`): `book_session`, `cancel_booking`, `cancel_session_bookings` (públicas) y `covers`, `promote_waitlist` (internas). `app_user` solo lee `bookings`. Aforo: `FOR UPDATE` de la sesión; solape: `pg_advisory_xact_lock` por alumno. Enum `booking_cancel_reason`; `academy_settings`: `booking_window_days` = 14, `cancellation_notice_minutes` = 60. Se crea `subscription_disciplines` (solo tabla; flujos en B10.5). Avisos: filas `notice.*` en `audit_log` con `changes.recipients` (B15 los envía). Se corrige el `UNIQUE` de 001, que era total y no parcial. Endpoints: `GET /bookings`, `POST /bookings`, `POST /bookings/:id/cancel`.
- **Pendiente**: la subida de aforo (ajuste de sesión) y el cambio de clase deben llamar a `promote_waitlist` y eximir de cancelación tardía; la pérdida de cobertura masiva y el cambio de disciplina quedan para B10.5; la promoción no vuelve a comprobar el perfil completo.
- **Fuera de alcance**: pago (B10), asistencia (B8).
- **Checklist de cierre**:
  - [x] RLS en `bookings`.
  - [x] `create_booking` transaccional con `FOR UPDATE` y control de aforo (`book_session`).
  - [x] Lista de espera funciona (promoción, salto por solape, `no_coverage`).
  - [x] `requireCompleteProfile` (B4.5) bloquea reservas con `403 profile_incomplete`.
  - [x] Tests de concurrencia + rol (`npm run test:bookings`).

### B8 — Asistencia manual (`register_attendance`, auditoría) — Pendiente
- **Objetivo**: profesor pasa lista manualmente; se audita.
- **Cuenta familiar**: la edición de la ficha de salud del hijo por el tutor ya está en B4.6 (sale de aquí).
- **Entregable**: RLS en `attendance`; endpoints de lista; inserción en `audit_log`.
- **Implementación** (migración `010`): funciones `SECURITY DEFINER` (owner `service_role`) `mark_attendance`, `close_attendance`, `correct_attendance`, `professor_session_health` (públicas) y `attendance_session` (interna); `app_user` solo lee `attendance`. `attendance.booking_id` (reserva asociada) y `corrected_by`; `class_sessions.attendance_closed_at/_by` (NULL = sin registrar). `academy_settings.attendance_correction_hours` = 48. La vista `student_health_professor_view` se **elimina**: la sustituye `professor_session_health(session)`, que exige profesor de la sesión, sesión programada y de hoy (Madrid), solo reservas `confirmed`, sin experiencia ni disciplina previa, y audita cada consulta (`health.view`). `cancel_session_bookings` borra la lista y sus asistencias. Auditoría: `attendance.close`, `attendance.correct` (from/to/motivo), `health.view`. Endpoints: `GET /sessions/:id/attendance`, `PUT /sessions/:id/attendance/:studentId`, `POST /sessions/:id/attendance/close`, `POST /sessions/:id/attendance/:studentId/correct`, `GET /professor/sessions/:id/health`.
- **Pendiente**: `audit_log_insert_authenticated` (003) permite a cualquier autenticado insertar filas en `audit_log` (→ B20).
- **Fuera de alcance**: QR (B9).
- **Checklist de cierre**:
  - [x] RLS en `attendance`.
  - [x] Profesor solo pasa lista de sus sesiones.
  - [x] Asistencia solo con reserva activa; cierre de lista genera las faltas (CONTEXT.md §Asistencia).
  - [x] Correcciones con motivo; parámetro `attendance_correction_hours` en `academy_settings`.
  - [x] Vista de salud del profesor restringida a campos y alcance de CONTEXT.md §Asistencia.
  - [x] `audit_log` registra cierres de lista, correcciones y consultas de salud del profesor.
  - [x] Tests por rol (`npm run test:attendance`).

### B9 — QR dinámico (`device_tokens`, SSE, check-in) — IMPLEMENTADO
- **Objetivo**: tablet fija con `device_token`, QR rotativo de prueba de presencia, check-in desde el móvil. Vocabulario en CONTEXT.md §Asistencia (check-in, reserva candidata, ventana, QR, tablet).
- **Cuenta familiar (decidido)**: el tutor hace check-in de sus hijos con su móvil; respaldo manual del profesor (CONTEXT.md §Asistencia).
- **Decidido (2026-10-28)**: el QR no lleva `session_id`; la sesión se deduce de las reservas candidatas (una → se marca; varias → se elige; ninguna → rechazo, nunca crea reserva). Se aceptan el QR actual y el anterior. Ventana −30/+10 min ajustable por el admin. La tablet muestra QR + sesiones abiertas, sin nombres. El check-in de un hijo queda con `recorded_by` = tutor; la lista del profesor muestra el método.
- **Entregable**: tabla `device_tokens` (hash), vinculación con código de un solo uso y revocación (admin), endpoints `/tablet/*` (sin prefijo `/api`, como el resto de `src/index.js`), SSE `/tablet/active-sessions`, rotación de QR, endpoint de check-in del alumno/tutor.
- **Nota**: `mark_attendance` (`migrations/010_attendance.js`) rechaza marcar antes de `starts_at`; el check-in necesita su propia función, con la ventana en lugar de `starts_at`.
- **Implementación** (migración `011`): `device_tokens` guarda sha256 del token y del código de vinculación (15 min, un solo uso); `app_user` sin acceso a las columnas de hash; RLS solo admin. El QR no se guarda: `HMAC(clave derivada de JWT_SECRET, floor(now/N))` en `src/services/checkin.js`, valen el tramo actual y el anterior. Funciones `SECURITY DEFINER` (owner `service_role`): `link_tablet`, `tablet_feed`, `checkin_qr_seconds` (la tablet llama sin contexto RLS por `appPool`), `check_in(booking?)` y la interna `checkin_window_open`. `academy_settings`: `checkin_opens_minutes` = 30, `checkin_closes_minutes` = 10, `checkin_qr_seconds` = 30. `check_in` bloquea la sesión `FOR UPDATE` como `close_attendance`. La lista del profesor devuelve `method`. Endpoints: `POST/GET /admin/tablets`, `POST /admin/tablets/:id/revoke`, `PUT /admin/settings/checkin`, `POST /tablet/link`, `GET /tablet/active-sessions` (SSE, `Authorization: Device <token>`), `POST /checkin { code, booking_id? }`.
- **Pendiente**: rate limit en `/tablet/link`; auditar vincular/revocar; check-in de varios hijos en una petición.
- **Fuera de alcance**: MFA de tablet (futuro).
- **Checklist de cierre**:
  - [x] `device_tokens` con hash y RLS.
  - [x] Admin vincula (código de un solo uso) y revoca tablets.
  - [x] Tablet autentica con `device_token`.
  - [x] QR rota cada N segundos (actual + anterior válidos), sin `session_id`.
  - [x] Ventana de check-in ajustable por el admin.
  - [x] Check-in: candidatas propias y de hijos; rechazo sin candidatas.
  - [x] Tests (`npm run test:checkin`) y smoke del SSE con `curl -N`.

### B10 — Stripe base (checkout, portal, webhook idempotente) — IMPLEMENTADO
- **Objetivo**: checkout, portal de cliente y webhook idempotente. Vocabulario en `CONTEXT.md` («Suscripción», «Cobros»).
- **Estados**: `sub_status` = estados de Stripe tal cual; se añade `unpaid`. `canceled` / `incomplete_expired` → `cancelled`. **En vigor** = `active` + `past_due` (periodo de gracia = reintentos de Stripe, 2 semanas en el Dashboard; al agotarse Stripe marca `unpaid`, no cancela). **Viva** = `active` + `past_due` + `unpaid`. `grace_period` y `academy_settings.grace_period_days` quedan sin uso (documentados). `pending_cash` / `cash` / `cash_payments`: efectivo reservado e inactivo (no antes de 2028); sale de `covers`.
- **Cuenta familiar**: una suscripción por hijo + `subscriptions.payer_id` = quien hace el checkout (el propio alumno adulto o un tutor vinculado); cliente Stripe por pagador en **`profiles.stripe_customer_id`** (único, nullable, solo backend); checkout con `profile_id`; RLS = alumno, tutor vinculado o pagador. Cambio de pagador: B11.
- **Planes (B5, ADR 0003)**: el checkout recibe plan + **disciplinas elegidas** (tantas como el plan, entre las elegibles, respetando "solo menores" de plan y disciplina). **Comprobación de edad obligatoria en el checkout**: un adulto no puede contratar un plan `minors_only` ni elegir una disciplina `minors_only`; un menor puede elegir cualquier disciplina. Por eso `subscription_disciplines` nace aquí. Plan a 0 € no contratable.
- **Sincronización plan ↔ Stripe** (el plan es la fuente de verdad): crear plan → Product + Price mensual EUR; cambio de precio → Price nuevo, archivar el viejo y pasar las suscripciones vivas al nuevo sin prorrateo (aplica desde su siguiente renovación); renombrar → Product; retirar/reactivar → archivar/desarchivar Price. Script único para los planes existentes sin `stripe_price_id`. `price_cents` = precio final IVA incluido; sin Stripe Tax.
- **Checkout**: Stripe Checkout alojado (modo suscripción), solo tarjeta (+ Apple Pay / Google Pay), caducidad 30 min, ciclo de facturación por aniversario. 409 si el alumno tiene suscripción viva. Plan y disciplinas en `metadata`. La fila local **nace en el webhook** `checkout.session.completed`; si choca con el índice único parcial (otra ganó la carrera) → cancelar la nueva en Stripe, reembolsar su primer cobro y avisar a pagador y admin. `success_url` no concede acceso.
- **Portal**: Customer Portal configurado solo para método de pago y ver recibos; sin cambio de plan ni cancelación.
- **Pérdida de cobertura**: al pasar a `unpaid` o `cancelled` → cancelar reservas/esperas futuras con motivo «sin cobertura», aviso (`notice.*` en `audit_log`) al pagador y a los tutores del hijo.
- **Entregable**: migración (enum `unpaid`, `profiles.stripe_customer_id`, índice único parcial de suscripción viva, RLS en `subscriptions` y `subscription_disciplines`, `covers` = `active` + `past_due`); endpoints `/billing/checkout`, `/billing/portal`; webhook con `webhook_events`; hooks de catálogo → Stripe.
- **Fuera de alcance**: recibos (B10.1), seguro y cobertura de riesgo (B10.3; hasta entonces el `waiver` sigue en el perfil completo), upgrade/downgrade y cambio de disciplina (B10.5), cambio de pagador (B11), SEPA (`MEJORAS.md`). La baja admin se adelantó de B11 (ver B11).
- **Implementación** (migración `012`, SDK `stripe@23`, API `2026-09-30.endive`): `src/config/stripe.js` (cliente único; `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PORTAL_CONFIGURATION_ID`, `APP_URL`). `012`: `sub_status` + `unpaid` (no reversible); `profiles.stripe_customer_id` (no se oculta por columna: un `cus_` no es credencial; ningún servicio lo devuelve); `subscriptions.stripe_subscription_id` único y `NOT NULL`; `subscriptions_one_live_idx` (viva = `active`/`past_due`/`unpaid`); RLS de lectura en `subscriptions`, `subscription_disciplines` e `invoices` (alumno, tutor incl. histórico, pagador, admin) — **antes no tenían RLS y `app_user` podía escribirlas**; `webhook_events` sin acceso para `app_user`; `covers` = `active` + `past_due`; `revoke_coverage(student)` (definer, interna); `is_guardian_of` con `NULLIF` (rompía con sesión vacía). `grace_period`/`pending_cash` quedan en el enum sin uso. Catálogo: `syncPlanToStripe` dentro de la transacción de `createPlan`/`updatePlan`; un Product por plan, Price nuevo por cada precio, sin `default_price` (Stripe no deja archivarlo); pasar a 0 € con suscriptores → 409; script `npm run sync-stripe-plans`. Checkout (`src/services/billing.js`): Customer creado y guardado fuera de la transacción (gana el primero si hay carrera); sin `payment_method_types`; pedido en `metadata` de sesión y suscripción; `integration_identifier`. Portal: `npm run stripe-portal-config` (solo método de pago y recibos). Webhook (`src/services/stripeWebhook.js`, `POST /webhooks/stripe` montado antes de `express.json`): firma con `constructEvent`; idempotencia = fila de `webhook_events` en la misma transacción que los efectos; cada handler relee el objeto de Stripe (eventos desordenados); pagador por el cliente, no por metadata; eventos: `checkout.session.completed`/`async_payment_succeeded`/`async_payment_failed`, `customer.subscription.updated`/`deleted`, `invoice.finalized`/`paid`/`payment_failed`, `charge.refunded`, `charge.dispute.created`, `radar.early_fraud_warning.created`. Avisos `notice.*` en `audit_log`. Endpoints: `POST /billing/checkout`, `POST /billing/portal`, `POST /webhooks/stripe`. Tests: `npm run test:billing`, `npm run test:webhook` (contra un sandbox de Stripe).
- **Pendiente**: «solo tarjeta» en el Dashboard (el sandbox ofrece `link` y `satispay`); clave restringida `rk_` propia al reclamar el sandbox; la migración de suscriptores al cambiar de precio es secuencial en la petición (`shortcut:`); un plan que pasa de 0 € a precio crea otro Product; `past_due` → `unpaid` y el pool del webhook en B20.
- **Checklist de cierre**:
  - [x] RLS en `subscriptions` y `subscription_disciplines`.
  - [x] Una sola suscripción viva por alumno (índice único parcial) y carrera de checkouts resuelta (cancelación + reembolso).
  - [x] Checkout crea la suscripción en Stripe; la fila local nace en el webhook.
  - [x] Validación de edad / solo menores / disciplinas elegibles / plan a 0 €.
  - [x] Sincronización plan ↔ Price (crear, precio, nombre, retirar).
  - [x] Portal redirige con la configuración limitada.
  - [x] Webhook idempotente vía `webhook_events`.
  - [x] `covers` sin `pending_cash`; pérdida de cobertura al pasar a `unpaid` / `cancelled`.
  - [x] `requireCompleteProfile` (sujeto y actor) bloquea el checkout (E2E por HTTP: adulto e hijo incompletos → 403).
  - [x] Tests manuales con Stripe CLI (E2E 2026-10-29: `stripe listen` + dos Checkouts reales pagados, alumno y su hijo en el mismo cliente; bajas admin por HTTP de vuelta por el webhook).

### B10.1 — Recibos (`invoices`) + webhook `invoice.payment_failed` — IMPLEMENTADO
- **Objetivo**: guardar los **recibos** (término en `CONTEXT.md`; no son facturas legales) y manejar el cobro fallido.
- **Entregable**: migración de `invoices`: `stripe_invoice_id` UNIQUE, `subscription_id`, `student_id`, **`payer_id`**, `period_start` / `period_end`, `amount_due_cents`, `amount_paid_cents`, `currency`, `status` (Stripe tal cual: draft/open/paid/uncollectible/void), `paid_at`, `attempt_count`, `next_payment_attempt`, `last_payment_error`, `hosted_invoice_url`, `invoice_pdf` (sustituye `external_pdf_url`). Sin líneas ni impuestos. Handlers de `invoice.*`.
- **Reglas**: `invoice.payment_failed` no quita acceso (la suscripción pasa a `past_due`); guarda intento / siguiente reintento / motivo y deja `notice.*` solo al pagador (enlace al portal). Al pagar después, vuelve a `active`; las reservas canceladas no vuelven.
- **RLS lectura**: pagador del recibo, alumno sujeto, tutores vinculados (incluido el vínculo histórico D16), admin. Profesor no.
- **Fuera de alcance**: emails (B10.6), endpoint admin (B10.2), factura legal VeriFactu (bloque futuro; descargable desde la app).
- **Implementación** (en `012` y `stripeWebhook.js`, junto con B10): `paid_cents` → `amount_paid_cents`, sin `external_pdf_url`, `status` con `CHECK`; `id` con default. Recibos de suscripción por `invoice.parent.subscription_details.subscription` (API `endive`); el primero lo guarda `checkout.session.completed` (su `invoice.paid` suele llegar antes que la fila). `last_payment_error` = mensaje del PaymentIntent del pago; se conserva el último aunque luego se pague.
- **Hecho en B10.3**: recibos del seguro (`invoices.insurance_id`; un recibo es de una suscripción o de un seguro).
- **Checklist de cierre**:
  - [x] Columnas añadidas y RLS.
  - [x] `invoice.payment_failed` guarda `last_payment_error` y crea el aviso al pagador.
  - [x] Idempotencia vía `webhook_events`.
  - [x] Tests manuales con Stripe CLI (E2E: recibos `paid` de ambos Checkouts).

### B10.2 — Endpoint admin morosos y "en gracia" — IMPLEMENTADO
- **Objetivo**: lista para el panel admin, agrupada por pagador.
- **Entregable**: endpoint solo admin con dos listas: **morosos** (pagadores con alguna suscripción o seguro `unpaid`) y **en gracia** (`past_due`, no morosos).
- **Fuera de alcance**: UI (B19), emails (B10.6).
- **Implementación** (sin migración): `listOverduePayers` en `services/billing.js`, solo lectura sobre `subscriptions`, `insurances` e `invoices` (sin llamar a Stripe). `GET /admin/billing/delinquents` y `GET /admin/billing/grace` (`src/routes/admin/billing.js`), `?limit` (25, máx. 100) y `?offset`; error 400 `invalid_pagination`. Respuesta `{ payers, total, limit, offset }`; cada pagador trae `items` (suscripciones y seguros `past_due`/`unpaid`: alumno, plan o tramo, estado, fin de periodo) e `invoices` (recibos `open`: importe, intentos, siguiente reintento, último error, `hosted_invoice_url`). Orden: recibo pendiente más antiguo, luego `payer_id`. Un moroso muestra también lo que tenga en gracia.
- **Checklist de cierre**:
  - [x] Endpoint devuelve las dos listas paginadas, agrupadas por pagador.
  - [x] Solo admin (`requireRole('admin')` del router; la RLS además no da nada al resto).
  - [x] Tests (`npm run test:billing`).

### B10.3 — Seguro y cobertura de riesgo — IMPLEMENTADO
- **Objetivo**: seguro anual de la academia como alternativa al `waiver` (ADR 0005, ADR 0006). Términos en `CONTEXT.md` («Seguro y cobertura de riesgo»).
- **Reglas**:
  - Cobertura de riesgo = seguro en vigor (`active` / `past_due`) o `waiver` vigente. No hay seguro externo.
  - Seguro por alumno, independiente de la suscripción: 2ª suscripción Stripe anual del mismo cliente, por aniversario. Estados como la suscripción; `unpaid` se recupera pagando el recibo y cuenta para moroso. Como mucho un seguro vivo por alumno.
  - Lo contrata solo el pagador actual de la suscripción, para un alumno con suscripción viva y sin seguro vivo: al contratar la suscripción o en cualquier momento después.
  - Checkout: elección obligatoria seguro / `waiver` salvo cobertura de riesgo. `waiver` → se firma antes de abrir el Checkout. Seguro → un solo paso: Checkout de la cuota y, tras confirmarse, el seguro en servidor con la misma tarjeta (`default_incomplete`, 3DS con `handleNextAction`). Si el seguro no se paga: la suscripción sigue, el alumno queda sin cobertura de riesgo y se avisa al pagador.
  - Precios: dos (adulto / menor), > 0 €, editables por el admin. El seguro nace **desactivado** y solo se activa con los dos precios. Desactivado: no se contrata y los vivos no renuevan (aviso al pagador).
  - Renovación: aviso al pagador 30 días antes; el aviso fija precio y tramo (edad ese día). No renueva (con aviso): tras la baja de la suscripción sin otra viva, tras un cambio de pagador, con el seguro desactivado, o si el día del cobro el alumno es un hijo de 18+ sin perfil reclamado.
  - Sin cobertura de riesgo: no reserva; no se cancelan reservas. En espera, la promoción **salta** (sigue en la lista) a quien no tiene cobertura de riesgo o perfil completo; «sin cobertura» queda solo para la suscripción.
  - Visibilidad: el seguro, como los recibos; el profesor ve solo «sin cobertura de riesgo» en su lista del día.
- **Entregable**: `waiver` fuera de `getProfileStatus` / `missing` (B4.5); `risk_cover` como requisito aparte en `book_session` (B7), en `promote_waitlist` y en la respuesta de estado; modelo del seguro (estado, pagador, tramo, `stripe_subscription_id`) y parámetros de la academia (precios, activado); endpoints admin de precios y activación; elección en `POST /billing/checkout` y endpoint de contratar seguro; webhooks distinguen cuota / seguro (recibos del seguro en `invoices`); renovación sin seguro (`cancel_at_period_end`) en los casos de arriba; avisos `notice.*`; aviso de profesor en la lista; borrar `subscription_agreements`. Datos existentes: `waiver` firmado ⇒ con cobertura.
- **Fuera de alcance**: baja del seguro por el admin (B11), seguro sin suscripción (eventos, en su bloque), lista de morosos (B10.2, que debe incluir seguros `unpaid`).
- **Implementación** (migración `013`):
  - **Tabla `insurances`**: estado `sub_status`, pagador, `bracket` (`adult`/`minor`, tramo del Price en curso, leído de `price.metadata.bracket`) y `stripe_subscription_id`. Tiene `insurances_one_live_idx` (viva = `active`/`past_due`/`unpaid`) y RLS de lectura como los recibos; `app_user` no escribe.
  - **`invoices.insurance_id`**, con `CHECK num_nonnulls(subscription_id, insurance_id) = 1`.
  - **Funciones `SECURITY DEFINER`**:
    - `signed_current(profile, type)` (interna).
    - `profile_missing(profile)`: lo que le falta al alumno para el perfil completo, ya sin `waiver`. Es la única fuente: la usan `getProfileStatus` y la promoción.
    - `has_risk_cover(profile)`: seguro `active`/`past_due` o `waiver` vigente. Un `waiver` ya firmado da cobertura sin migrar datos.
  - **Reservas**:
    - `book_session` → `no_risk_cover` (403).
    - `promote_waitlist` salta a quien no tiene perfil completo o cobertura de riesgo, que sigue en la lista. Con esto desaparece el `shortcut:` de 009.
  - Se borra `subscription_agreements`.
  - **Ajustes**: `academy_settings.insurance_enabled` = `false`. Los precios y los ids de Stripe (`insurance_price_{adult,minor}_cents`, `insurance_stripe_price_{adult,minor}`, `insurance_stripe_product`) se crean al guardarlos.
  - **Servicio** (`src/services/billing.js`):
    - `updateInsuranceSettings`: un Product «Seguro» y un Price anual por precio (el viejo se archiva). Los seguros vivos no se migran: lo hace el aviso. Desactivar → `cancel_at_period_end` y `notice.insurance_wont_renew`.
    - `startInsurance` (`default_incomplete`, cobro en servidor con `invoices.pay` `off_session: false`, `lock_student`) y `contractInsurance` / `getInsurance`. El `client_secret` para `handleNextAction` solo se devuelve al pagador.
    - `upsertInsurance`.
  - **Webhook**:
    - Checkout con `metadata.insurance` → `startInsurance` (`idempotencyKey` por sesión). Si no puede crearse: `notice.insurance_not_paid`.
    - Nuevo evento `customer.subscription.created`.
    - `metadata.kind = 'insurance'` → `onInsuranceChange`, sin `revoke_coverage`. Si caduca sin pagarse: `notice.insurance_not_paid`.
    - Baja de la cuota sin otra viva → el seguro no renueva.
    - `syncInvoice` resuelve la cuota o el seguro (si la fila del seguro aún no está confirmada, la crea desde Stripe).
    - El primer recibo del seguro (`billing_reason = subscription_create`) no genera `notice.payment_failed`: el pagador está en pantalla (3DS o rechazo); si no llega a pagarse, avisa `notice.insurance_not_paid` al caducar.
    - **`invoice.upcoming`**: fija el Price del tramo de hoy y deja `notice.insurance_renewal`. No renueva (`notice.insurance_wont_renew`, con `reason`) si el seguro está desactivado, no hay suscripción viva, el pagador cambió o el hijo cumple 18 antes de renovar (decidido en el aviso, reclame o no el perfil).
  - **Endpoints**:
    - `POST /billing/checkout { …, insurance? }` → 409 `risk_cover_required` / `insurance_disabled` / `insurance_exists`.
    - `POST /billing/insurance { profile_id? }` → 409 `subscription_required`, 403 `not_payer`.
    - `GET /billing/insurance?profile_id=`.
    - `PUT /admin/settings/insurance { price_adult_cents?, price_minor_cents?, enabled? }` → 409 `insurance_prices_missing`.
  - **Estado y lista del profesor**: `GET /me/profile-status` devuelve `risk_cover` (solo alumno). La lista del profesor (`getAttendance`) devuelve `risk_cover`.
  - **Tests**: `test:bookings` (regla nueva y regresión), `test:minors`, `test:billing` y `test:webhook` (seguro contra el sandbox).
- **E2E** (2026-10-29, sandbox `kaizen-app-testing`, `stripe listen` + Chrome):
  - Checkout con seguro y tarjeta 3DS: el seguro pide `requires_action`, se completa con `handleNextAction` y pasa a `active` con su recibo.
  - 3DS fallado: la cuota sigue `active` y el seguro queda `incomplete`, sin cobertura de riesgo. El reintento reutiliza el mismo seguro; al caducar, `cancelled` + `notice.insurance_not_paid`.
  - *Test clock* (simulación del Dashboard): `invoice.upcoming` real fija 45 € tras subir el precio, y la renovación cobra 45 €. Desactivado → `cancel_at_period_end`, y al final del año `cancelled` sin recibo nuevo.
  - *Upcoming renewal events* = 30 días en el sandbox. Es un ajuste de toda la cuenta: en producción, coordinarlo con maat (B10.7).
- **Notas**:
  - Con *test clock*, Stripe rechaza modificar suscripciones mientras el reloj avanza. El aviso responde 500 y se reprocesa en el reintento (en el E2E, `stripe events resend`).
  - La clave del sandbox reclamable (`rkcs_test_`) no permite *test clocks* por API ni `accounts.retrieve`.
- **Pendiente**: reactivar el seguro no deshace los `cancel_at_period_end` de la desactivación.
- **Checklist de cierre**:
  - [x] `missing` sin `waiver`; reservar exige `risk_cover`.
  - [x] Promoción salta (no saca) a quien no tiene cobertura de riesgo o perfil completo.
  - [x] Checkout obliga a elegir seguro o `waiver` si no hay cobertura; `waiver` firmado antes de pagar.
  - [x] Seguro tras el Checkout con 3DS; fallo ⇒ suscripción intacta, sin cobertura de riesgo y aviso.
  - [x] Contratar seguro después (con suscripción viva, sin seguro vivo, solo el pagador).
  - [x] Seguro desactivado por defecto; activación exige los dos precios.
  - [x] Renovación con precio y tramo del aviso; casos de no renovación.
  - [x] `unpaid` recuperable; vencimiento sin `waiver` bloquea reservar y no cancela reservas.
  - [x] `subscription_agreements` eliminada.
  - [x] Tests (incluida la regresión de B7/B9 con la nueva regla) y E2E con Stripe CLI.

### B10.5 — Upgrade/downgrade + cambio de disciplina — Diseñado
- **Objetivo**: subir de plan (más caro) inmediato con prorrateo; bajar (igual o más barato) en la siguiente facturación; cambio de disciplina. Términos en `CONTEXT.md` («Suscripción», «Reservas»), decisión en ADR 0007.
- **Reglas** (decididas 2026-10-29):
  - **Subida**: *pending update* (`payment_behavior: pending_if_incomplete`, `proration_behavior: always_invoice`), con `price` y `metadata` (`plan_id`, `discipline_ids`). Solo se aplica si se paga. Si la tarjeta se rechaza: *void* del recibo y 402 `payment_failed`. Si pide 3DS: `client_secret` para `handleNextAction`. Si había una bajada programada, se libera su Schedule antes.
  - **Bajada**: Subscription Schedule `from_subscription`, con la fase 1 actual y la fase 2 desde `current_period_end` (Price y `metadata` nuevos), `end_behavior: release`. Como mucho una programada: una nueva sustituye la fase 2, una subida o el `DELETE` liberan el Schedule. Lo reservado entretanto de las disciplinas que se pierden se cancela al aplicarse (`revoke_coverage`, «sin cobertura»).
  - Subida o bajada por precio de Kaizen (`price_cents`): más caro = subida; igual o más barato = bajada; mismo plan → 409. Destino: plan activo, con las mismas validaciones que el checkout (edad, solo menores, elegibles, número).
  - **Adulto en un plan solo menores** (paso a los 18, por estado y no por evento: no existe el flujo de reclamar): el cambio es inmediato con prorrateo, suba o baje. Una bajada así deja saldo a favor en el cliente de Stripe, sin reembolso.
  - **Quién**: el cambio de plan, el pagador actual o el admin. El cambio de disciplina, además el alumno adulto y cualquier tutor vinculado. El admin no paga: si una subida suya pide 3DS → 409 `requires_payer_action` y aviso al pagador.
  - **Estados**: el cambio de plan solo con la suscripción `active` y sin `cancel_at_period_end`; el cambio de disciplina con ella en vigor (`active` / `past_due`).
  - **Cambio de disciplina**: una sustitución por llamada. Lo escribe el endpoint (ADR 0007) y la `metadata` de Stripe queda como espejo. Cuenta para el límite por periodo, contado en `audit_log` `subscription.discipline_change` desde `current_period_start`. Es gratis (no cuenta) si la disciplina abandonada ya no se cubre: desactivada, o solo menores para un adulto. Cancela las reservas y esperas futuras de la abandonada con motivo `discipline_change`. Un plan «todas» no tiene disciplinas que cambiar.
  - **Parámetro** `discipline_changes_per_period`: valor inicial 1, admite 0 (`academy_int` no lo acepta, así que se lee con otra consulta).
  - El seguro no se toca (CONTEXT § Seguro).
- **Pasos**:
  1. **Migración `014`**:
     - `subscriptions.stripe_schedule_id`, `scheduled_plan_id`, `scheduled_discipline_ids bigint[]`, `scheduled_at`, todas nullable y escritas solo por el webhook.
     - Seed `discipline_changes_per_period` = 1.
     - Función `change_discipline(subscription, from, to, actor)` `SECURITY DEFINER`: `lock_student`, sustitución en `subscription_disciplines`, cancelación de reservas y esperas futuras de `from` con `discipline_change` + `booking_notice`. Devuelve las canceladas.
  2. **Servicio** (`services/billing.js`):
     - Extraer `validateOrder` (plan + disciplinas) de `createCheckout`.
     - Nuevas: `changePlan`, `cancelScheduledChange`, `changeDiscipline`, `getSubscription` y `updateDisciplineChangeSettings`.
  3. **Adaptar lo existente al Schedule**:
     - `cancelSubscription`: libera el Schedule antes y avisa `notice.scheduled_change_discarded`.
     - `syncPlanToStripe`: en las suscripciones con Schedule, actualiza el Price en sus fases en lugar de la suscripción. Una bajada programada a un plan retirado se respeta.
     - Comprobar en el sandbox `cancel` / `cancel_at_period_end` con un Schedule adjunto.
  4. **Webhook**:
     - `customer.subscription.updated`: si `metadata.plan_id` ≠ `plan_id` local, actualiza `plan_id`, sustituye `subscription_disciplines` por `metadata.discipline_ids` y ejecuta `revoke_coverage`. En una bajada, `notice.plan_downgraded` al pagador.
     - Nuevos `subscription_schedule.created/updated/released/canceled/completed`: releen el Schedule y rellenan o vacían `scheduled_*`.
     - Añadir los eventos al endpoint del Dashboard y a `stripe listen`.
  5. **Endpoints** (las tres acciones también para el admin en `routes/admin/billing.js`, `/admin/subscriptions/:id/...`):
     - `GET /billing/subscription?profile_id=` → `{ id, status, plan, disciplines, current_period_end, cancel_at_period_end, scheduled_change, discipline_changes_left }`.
     - `POST /billing/subscriptions/:id/plan { plan_id, discipline_ids }`:
       - subida → `200 { change: 'upgrade', status: 'applied' | 'requires_action', client_secret? }`;
       - bajada → `202 { change: 'downgrade', scheduled_at }`;
       - errores: 400 `invalid_field`, 402 `payment_failed`, 403 `not_payer`, 404 `subscription_not_found` / `plan_not_found`, 409 `subscription_not_active` / `cancel_scheduled` / `same_plan` / `plan_minors_only` / `discipline_not_eligible` / `requires_payer_action` (admin).
     - `DELETE /billing/subscriptions/:id/plan/scheduled` → 204; 404 `no_scheduled_change`.
     - `POST /billing/subscriptions/:id/disciplines { from_id, to_id }` → `200 { disciplines, changes_left, free }`; 409 `discipline_change_limit { limit, used, resets_at }` / `plan_all_disciplines` / `discipline_not_chosen` / `discipline_not_eligible` / `subscription_not_in_force`.
     - `PUT /admin/settings/discipline-changes { per_period }` (entero ≥ 0).
  6. **Tests**:
     - `test:billing`: validaciones, límite (también 0), sustitución gratis, permisos y errores.
     - `test:webhook`: aplicar el plan desde la `metadata`, `scheduled_*`, `revoke_coverage`.
     - E2E con `stripe listen` + Chrome:
       - subida con tarjeta 3DS y con tarjeta rechazada;
       - bajada con *test clock* hasta el cambio de fase;
       - baja admin con una bajada programada;
       - cambio de precio del plan con una bajada programada.
- **Fuera de alcance**: baja (B11), flujo de reclamar el perfil a los 18 y su aviso (bloque propio; B10.5 lo resuelve por estado), emails (B10.6), UI.
- **Checklist de cierre**:
  - [ ] Subida: prorrateo cobrado y plan y disciplinas aplicados solo tras el pago (3DS y rechazo).
  - [ ] Bajada: sin reembolso, aplicada al cambiar de fase; sustituir y anular; reservas no cubiertas canceladas al aplicarse.
  - [ ] Adulto en plan solo menores: cambio inmediato con prorrateo.
  - [ ] Cambio de disciplina: inmediato, límite por periodo (también 0), gratis si ya no se cubre, cancela con `discipline_change`.
  - [ ] Baja admin y cambio de precio conviven con un Schedule.
  - [ ] Seguro intacto.
  - [ ] Tests y E2E con Stripe CLI.

### B10.6 — Emails transaccionales de billing (al pagador) — Pendiente
- **Objetivo**: email al alumno en `invoice.payment_failed`.
- **Cuenta familiar**: el destinatario es el **pagador**, no el alumno (un hijo no tiene email).
- **Entregable**: proveedor elegido (Resend/Postmark/SMTP), `services/email.js`, plantilla.
- **Fuera de alcance**: push (B15).
- **Checklist de cierre**:
  - [ ] Proveedor configurado en `.env`.
  - [ ] Email enviado en `invoice.payment_failed`.
  - [ ] Idempotencia (no duplicar en replay).
  - [ ] Test manual.

### B10.7 — Migración de los clientes de maat — Pendiente (al pasar a producción)
- **Contexto**: la cuenta de Stripe de producción hoy la usa maat, con clientes pagando. Hasta el paso a producción Kaizen trabaja solo con el sandbox; la cuenta real no se conecta antes.
- **Objetivo**: que las suscripciones vivas de maat pasen a Kaizen sin que nadie vuelva a pagar ni a meter la tarjeta (clientes, tarjetas y aniversarios ya están en la cuenta).
- **Ya hecho** (2026-10-29): convivencia en la misma cuenta. El webhook ignora los Checkouts sin el pedido de Kaizen en `metadata` y los estados sin mapear (`trialing`, `paused`) de suscripciones que no son de Kaizen (test en `test-webhook.js`).
- **Entregable**:
  - Inventario de la cuenta real: número de suscripciones, Prices usados, trials/pausas, Stripe Tax, métodos de pago, configuración del portal, cómo se identifica a cada persona (email) y si maat es una plataforma Connect.
  - Script de importación idempotente: cliente → perfil pagador (`profiles.stripe_customer_id`), alumno y menores, Price de maat → plan de Kaizen (`subscriptions.update` al Price del plan con `proration_behavior: 'none'`), disciplinas (CSV o exportación de maat), fila en `subscriptions` + `subscription_disciplines`, recibos con `syncInvoice`.
  - *Upcoming renewal events* (aviso del seguro, B10.3) es un ajuste de toda la cuenta: acordar con maat los 30 días.
  - Endpoint de webhook propio de Kaizen con API `2026-09-30.endive` (sin cambiar la versión por defecto de la cuenta), clave `rk_live_` restringida y configuración de portal propia.
  - Plan de corte: cuándo deja maat de vender y de recibir webhooks.
- **Fuera de alcance**: cuentas de Stripe distintas (las tarjetas no se mueven sin el soporte de Stripe).
- **Checklist de cierre**:
  - [ ] Inventario revisado con el admin.
  - [ ] Importación probada en un sandbox con datos copiados.
  - [ ] Base legal del traspaso de datos confirmada (gestoría).
  - [ ] Importación en producción y conteo cuadrado con Stripe.

### B11 — Baja admin de suscripciones y seguro + cambio de pagador — Pendiente
- **Objetivo**: la baja la hace solo el admin (`cancel-now` / `cancel-at-period-end`), también la del seguro (paso a `waiver`); y el **cambio de pagador**.
- **Cambio de pagador**: el admin elige al nuevo pagador (tutor vinculado o el propio alumno adulto) → enlace de Checkout para él (mismo plan y disciplinas, empieza al fin del periodo) → al completarlo, la suscripción antigua se cancela a fin de periodo. Si no lo completa a tiempo, no hay cambio y se avisa al admin. Al reclamar el perfil a los 18 se crea un aviso al admin para pasar el pago al propio alumno. Son dos suscripciones consecutivas (Stripe no cambia el cliente de una suscripción).
- **Entregable**: endpoints `/admin/subscriptions/:id/cancel-now` y `/cancel-at-period-end`; baja del seguro; endpoint de cambio de pagador.
- **Seguro y cambio de pagador** (B10.3): al cambiar de pagador, poner `cancel_at_period_end` en el seguro vivo (`insuranceWontRenew`, motivo `payer_changed`). El aviso de renovación ya lo detecta si no se hizo antes.
- **Adelantado a B10** (2026-10-29): `POST /admin/subscriptions/:id/cancel-now` y `/cancel-at-period-end` (`src/routes/admin/billing.js`, `cancelSubscription` en `services/billing.js`): se pide la baja a Stripe y el estado local llega por el webhook; 404/409 si no existe o ya está cancelada; `audit_log` `subscription.cancel_now` / `subscription.cancel_at_period_end`. Quedan la baja del seguro y el cambio de pagador.
- **Fuera de alcance**: baja por el alumno o el pagador (no permitida; revisión legal en `MEJORAS.md`).
- **Checklist de cierre**:
  - [ ] Ambos endpoints de baja funcionan; la baja de la suscripción no toca el seguro.
  - [ ] Cambio de pagador con traspaso a fin de periodo y caso "no completado".
  - [ ] `audit_log` registra.
  - [ ] Tests.

### B12 — ELIMINADO
- Absorbido: los consentimientos (`data_protection`, `rights_of_image`) ya los exige el perfil completo (B4.5) en el checkout, y el `waiver` pasa a la elección seguro / `waiver` del checkout (B10.3, ADR 0005).

### B13 — Perfiles públicos (flags, `public_profiles`, directorio) — Pendiente
- **Objetivo**: perfiles públicos con flags granulares y directorio.
- **Cuenta familiar**: un hijo nunca es público (`is_public` forzado a false). Añadir al checklist.
- **Entregable**: vista/función `public_profiles` respetando `visible_fields`; endpoint `/public/profiles`.
- **Fuera de alcance**: UI (B18).
- **Checklist de cierre**:
  - [ ] `public_profiles` solo expone campos permitidos.
  - [ ] **`student_health_info` NO se une a `public_profiles`** (riesgo §9 B4.5).
  - [ ] Directorio paginado.
  - [ ] Revisar política `profiles_select` para `profesor` (¿restringir a alumnos con reserva?).
  - [ ] Tests.

### B14 — Racha, badges, tabla opt-in — Pendiente
- **Objetivo**: gamificación básica (racha, badges, tabla opt-in).
- **Cuenta familiar**: los hijos no aparecen en el feed ni en las tablas públicas.
- **Entregable**: tablas/vistas necesarias; endpoints.
- **Fuera de alcance**: push de logros (B15).
- **Checklist de cierre**:
  - [ ] Racha calculada.
  - [ ] Badges asignados.
  - [ ] Tabla opt-in funcional.
  - [ ] Tests.

### B15 — Push (`push_subscriptions`, envío) — Pendiente
- **Objetivo**: notificaciones push.
- **Cuenta familiar**: los avisos de un hijo van a todos sus tutores (incluido "cumple 18, debe reclamar su perfil"); los de facturación, al pagador.
- **Entregable**: RLS en `push_subscriptions`; endpoints de suscripción; envío con web-push.
- **Fuera de alcance**: push al admin (solo alumno).
- **Checklist de cierre**:
  - [ ] Suscripción/desuscripción.
  - [ ] Envío en eventos clave (pago fallido, reserva, **re-firma de agreement tras publicación de versión nueva** — B4.5.1).
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
  - [ ] **Aviso de re-firma pendiente al alumno** (B4.5.1) visible en la PWA.
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
  - [ ] **Gestión de documentos legales (B4.5.1) visible**: subir, publicar, retirar.
  - [ ] Tests manuales.

### B20 — Hardening (rate limiting, RLS audit, backups, E2E) — Pendiente
- **Objetivo**: endurecer el sistema.
- **Entregable**: rate limiting, auditoría de RLS, backups (incluido `storage/`), tests E2E, runner formal (Node test runner o Vitest), `npm run lint`, `npm run test`, `npm run build:prod` si hay frontend.
- **Fuera de alcance**: nada.
- **Checklist de cierre**:
  - [ ] Rate limiting en `/auth/*` y `/admin/agreements/*`.
  - [ ] Auditoría de RLS (revisar todas las políticas, incluidas B4.5 y B4.5.1).
  - [ ] Backups automáticos de BD **y de `AGREEMENTS_STORAGE_PATH`**.
  - [ ] Verificación de checksum al servir `GET /agreements/:type/current` (B4.5.1).
  - [ ] E2E de flujos críticos (incluye flujo MFA completo de B4 con supertest, y flujo B4.5/B4.5.1: subir → publicar → firmar → `requireCompleteProfile`).
  - [ ] `scripts/test-rls.js` y `scripts/test-mfa.js` migrados a BD efímera por test run (no destructivo en local compartido).
  - [ ] **[Alta] `audit_log` insertable por cualquier autenticado** (detectado en B8): la política `audit_log_insert_authenticated` (003) deja a cualquier usuario con `app_user` insertar filas arbitrarias, con lo que la auditoría es inalterable pero no auténtica. Arreglo: quitar la política y el `INSERT` a `app_user`, y mover los `INSERT` directos de `services/catalog.js` y `services/agreements.js` a funciones `SECURITY DEFINER` (las de 009/010 ya no la necesitan).
  - [ ] **[Media] Smoke tests HTTP que matan procesos ajenos** (detectado en B8): en B8 se usó `pkill -f "node src/index.js"` para parar el servidor de prueba y probablemente paró otro servidor que ya escuchaba en el 3999. Arreglo: los E2E arrancan el servidor en un puerto libre (`PORT=0`/supertest) y lo paran por su PID, nunca con `pkill -f`.
  - [ ] **[Media] Llamadas a Stripe dentro de la transacción del webhook** (detectado en B10): `services/stripeWebhook.js` llama a la API de Stripe con la conexión de `servicePool` (máx. 5) abierta; una ráfaga de eventos con Stripe lento puede agotar el pool. Asumible al volumen de un gimnasio. Arreglo si hace falta: leer de Stripe antes de abrir la transacción o subir el pool del webhook.
  - [ ] **[Media] `past_due` → `unpaid` sin test real** (detectado en B10): `test-webhook` cubre la baja (`deleted`) pero no la ventana de reintentos. Arreglo: test con Stripe test clocks (avanzar el reloj hasta agotar los reintentos) que compruebe que `past_due` conserva las reservas y `unpaid` las cancela.
  - [ ] **[Media] Webhooks que agotan los reintentos de Stripe** (detectado en B10.3): un evento que falla (500) se reprocesa en los reintentos de Stripe (unos 3 días); si los agota, se pierde, p. ej. el aviso de renovación del seguro (`invoice.upcoming`). Arreglo: alerta de webhooks fallidos en el Dashboard de producción y reenvío (`stripe events resend`) como procedimiento.
  - [ ] **[Baja] `scripts/test-attendance.js` falla entre las 00:00 y las 00:05 de Madrid** (detectado en B8): la sesión «de hoy» empieza 5 min antes de `now()` y cae en el día anterior. Arreglo: fijar la hora de la sesión dentro del día de Madrid o inyectar el reloj al migrar a la BD efímera.