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
  - **Pendiente B10**: política para que el alumno con suscripción en un plan/disciplina retirado lo siga viendo (necesita RLS de `subscriptions`).
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

### B9 — QR dinámico (`device_tokens`, SSE, check-in) — Pendiente
- **Objetivo**: tablet fija con `device_token`, QR rotativo, check-in por SSE.
- **Cuenta familiar (decidido)**: el tutor hace check-in de sus hijos con su móvil; respaldo manual del profesor (CONTEXT.md §Asistencia).
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
- **Cuenta familiar**: una suscripción por hijo + `subscriptions.payer_id` (el propio alumno adulto o un tutor vinculado); cliente Stripe **por pagador** (decidir `profiles.stripe_customer_id` vs `billing_customers`); checkout con `profile_id`; RLS = alumno, tutor vinculado o pagador. Morosos (B10.2) agrupados por pagador.
- **Planes (B5, ADR 0003)**: el checkout recibe plan + **disciplinas elegidas** (tantas como el plan, entre las elegibles, respetando "solo menores" de plan y disciplina). **Comprobación de edad obligatoria en el checkout** (el alumno ya es conocido): un adulto no puede contratar un plan `minors_only` ni elegir una disciplina `minors_only`; un menor puede elegir cualquier disciplina, incluidas las de adultos. B5 solo guarda los flags, no valida edad. Por eso `subscription_disciplines` nace aquí (sale de B10.5). Máximo **una** suscripción activa por alumno. Cambio de precio de un plan → actualizar las suscripciones en Stripe desde su siguiente facturación. Cambio de pagador entre tutores: siguiente facturación; al reclamar el perfil, pagador = el propio alumno.
- **Entregable**: RLS en `subscriptions` y `subscription_disciplines`; endpoints `/billing/checkout`, `/billing/portal`; webhook con `webhook_events`.
- **Fuera de alcance**: `invoices` ampliadas (B10.1), upgrade/downgrade y cambio de disciplina (B10.5), cancelación (B11).
- **Checklist de cierre**:
  - [ ] RLS en `subscriptions` y `subscription_disciplines`.
  - [ ] Una sola suscripción activa por alumno (restricción en BD).
  - [ ] Checkout crea suscripción en Stripe + fila local.
  - [ ] Portal redirige.
  - [ ] Webhook idempotente vía `webhook_events`.
  - [ ] `requireCompleteProfile` (B4.5) y consentimientos (B12) bloquean checkout.

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

### B10.5 — Upgrade/downgrade + cambio de disciplina — Pendiente
- **Objetivo**: subir de plan (más caro) inmediato con prorrateo; bajar (igual o más barato) en la siguiente facturación; cambio de disciplina. Términos en `CONTEXT.md`.
- **Entregable**: endpoints de upgrade/downgrade con Subscription Schedule; endpoint de cambio de disciplina; parámetro de academia "cambios de disciplina por periodo" (hoy 1); sustitución gratis por baja de disciplina y al reclamar el perfil a los 18 (con plan solo menores: cambio inmediato con prorrateo). `subscription_disciplines` ya existe (B10).
- **Fuera de alcance**: cancelación (B11).
- **Checklist de cierre**:
  - [ ] Upgrade: prorrateo + disciplinas al instante.
  - [ ] Downgrade: sin reembolso + disciplinas al transicionar.
  - [ ] Cambio de disciplina: inmediato, límite por periodo, cancela reservas futuras de la disciplina abandonada.
  - [ ] Tests manuales con Stripe.

### B10.6 — Emails transaccionales de billing (al alumno) — Pendiente
- **Objetivo**: email al alumno en `invoice.payment_failed`.
- **Cuenta familiar**: el destinatario es el **pagador**, no el alumno (un hijo no tiene email).
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
- **Objetivo**: bloquear checkout si faltan consentimientos (versión vigente).
- **Entregable**: validación en `/billing/checkout` contra `user_agreements` + `getCurrentVersion` (B4.5.1).
- **Fuera de alcance**: firma electrónica avanzada (futuro).
- **Checklist de cierre**:
  - [ ] Checkout bloqueado sin los 3 consentimientos en versión vigente.
  - [ ] Re-firma tras publicar versión nueva bloquea checkout hasta firmar.
  - [ ] Tests.

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
  - [ ] **[Baja] `scripts/test-attendance.js` falla entre las 00:00 y las 00:05 de Madrid** (detectado en B8): la sesión «de hoy» empieza 5 min antes de `now()` y cae en el día anterior. Arreglo: fijar la hora de la sesión dentro del día de Madrid o inyectar el reloj al migrar a la BD efímera.