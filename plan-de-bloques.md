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
| B4.5 | `student_health_info` + `user_agreements` + bloqueo backend | B2 | CERRADO |
| B4.5.1 | Gestión documental admin (`agreement_documents`, storage, subida) | B4.5 | CERRADO |
| B4.6 | Cuenta familiar: el tutor crea y gestiona hijos sin credenciales (`PLAN_FAMILIA.md`) | B4.5.1 | CERRADO |
| B5 | CRUD disciplinas, planes y disciplinas elegibles (`plan_disciplines`) (admin) | B3, B4.6 | CERRADO |
| B6 | Clases + sesiones (CRUD admin, generación a 1 año, vista profesor, calendario) | B5 | CERRADO |
| B7 | Reservas (`create_booking`, `FOR UPDATE`, lista de espera) | B6, B4.5 | CERRADO |
| B7.1 | Cambio de clase y ajuste de sesión sobre las reservas (promoción, exención de tardía, aviso) | B7, B15 | CERRADO |
| B6.1 | Sesiones sueltas y cancelación de una sesión (cancelar, recuperar, retroactiva, deshacer un ajuste) | B7.1 | CERRADO |
| B8 | Asistencia manual (`register_attendance`, auditoría) | B7 | CERRADO |
| B9 | QR dinámico (`device_tokens`, SSE, check-in) | B8 | CERRADO |
| B10 | Stripe base (checkout, portal, webhook idempotente) | B4.5, B7 | CERRADO |
| B10.1 | Modelo Stripe en `invoices` + webhook `invoice.payment_failed` | B10 | CERRADO |
| B10.2 | Endpoint admin morosos y "en gracia" por pagador | B10.1, B10.3 | CERRADO |
| B10.3 | Seguro y cobertura de riesgo (seguro anual o `waiver`) | B10.1 | CERRADO |
| B10.5 | Upgrade/downgrade + cambio de disciplina | B10 | CERRADO |
| B10.6 | Emails transaccionales de billing (al pagador) | B10.1, B10.3, B10.5 | CERRADO |
| B10.7 | Migración de los clientes de maat | B10–B11 | Pendiente (al pasar a producción) |
| B11 | Baja del seguro y cambio de pagador | B10.5, B10.3, B10.6 | CERRADO |
| B12 | ~~Validación final waiver/consentimientos en checkout~~ | — | ELIMINADO (absorbido por B4.5 y B10.3) |
| B13 | Perfiles públicos (flags, `public_profiles`, directorio) | B3 | CERRADO |
| B14 | Racha, horas, badges, ranking mensual opt-in y disciplina abierta | B8, B13 | CERRADO |
| B15 | Push (`push_subscriptions`, envío) | B2, B10.6 | CERRADO |
| B16 | Foto diaria de suscripciones + tareas nocturnas | B6, B10, B11 | CERRADO |
| B17 | Endpoints de informes | B16 | Diseñado |
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

### B4.5 — `student_health_info` + `user_agreements` + bloqueo backend — CERRADO
- **Estado** (verificado el 2026-10-30: commit en el historial y tests verdes: `65bd98b`, `test:rls` 22 OK). La checklist de abajo no se marcó en su día; detalle en `contexto-proyecto.md` §4.
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
  - [x] `student_health_info` creada con `profile_id` PK, `ON DELETE CASCADE` y trigger `set_updated_at`. `emergency_contact_*` quedaron `NULL` en la tabla y los exige el helper (decisión de §5 de `contexto-proyecto.md`: onboarding parcial).
  - [x] `user_agreements` append-only (`app_user` solo `INSERT`, `SELECT`). El `UNIQUE` es `(profile_id, signed_by, type, version)` desde B4.6 (`006`: dos tutores firman por el mismo hijo).
  - [x] RLS `ENABLE` + `FORCE` en ambas; políticas coherentes con §5.
  - [x] Vista `student_health_professor_view`: sustituida en B8 (`010`) por `professor_session_health`, acotada a una sesión y auditada.
  - [x] `src/config/agreements.js` con los 3 tipos; las versiones vigentes pasaron a `agreement_documents` en B4.5.1.
  - [x] `requireCompleteProfile` devuelve `{ ok, missing }` (fuente única `profile_missing`, `013`; el `waiver` pasó a la cobertura de riesgo en B10.3, que añade `risk_cover`).
  - [x] `POST /me/health` (upsert) y `POST /me/agreements` (`{ type, version }`) funcionan (verificado el 2026-10-31 por HTTP).
  - [x] `GET /me/profile-status` devuelve `{ ok, missing }` sin provocar 403.
  - [x] `GET /agreements/:type/current` sirve el PDF vigente (desde B4.5.1, el publicado en `agreement_documents`).
  - [x] Tests por rol en `scripts/test-rls.js` (22 OK el 2026-10-31); la salud del profesor, en `test:attendance` desde B8.
  - [x] Verificación HTTP manual (verificado el 2026-10-31, API real): alumno sin nada → `missing: ['health_info', 'data_protection', 'rights_of_image']` (sin `waiver` desde B10.3); tras salud y firmas → `{ ok: true, risk_cover: true }`.
  - [x] `migrate:down` → `migrate` → `migrate:down` sin error (en su día; no se repite: bajaría 17 migraciones con datos).
  - [x] Servidor reiniciado tras `migrate` (riesgo §9).
  - [x] Commit (`65bd98b`, «cierre de B4.5»).

### B4.5.1 — Gestión documental admin (`agreement_documents`, storage, subida) — CERRADO
- **Estado** (verificado el 2026-10-30: commit en el historial y tests verdes: `672d870`, `test:agreements` 7 OK). La checklist de abajo no se marcó en su día; la verificación HTTP manual no consta.
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
  - [x] `agreement_documents` creada con `UNIQUE(type, version)`, índice parcial de versión vigente, RLS.
  - [x] `AGREEMENTS_STORAGE_PATH` en `.env` / `.env.example`; directorio creado al arrancar; `storage/` en `.gitignore`.
  - [x] `storage.js` con `saveFile`/`readFile`/`deleteFile`; checksum SHA-256 al guardar.
  - [x] `POST /admin/agreements/documents` (cuerpo crudo `application/pdf`, sin multipart; admin): valida `type` ∈ `AGREEMENT_TYPES`, `version` semver-ish, `mime_type = application/pdf`, tamaño ≤ 10 MB; 409 `duplicate_document` / `version_exists_different_content` si aplica.
  - [x] `POST /admin/agreements/documents/:id/publish` (admin): retira la vigente anterior del mismo tipo, publica la nueva, audita en `audit_log`.
  - [x] `GET /admin/agreements/documents` (admin): lista con versiones y estado.
  - [x] `GET /agreements/:type/current` sirve el PDF publicado vigente desde `AGREEMENTS_STORAGE_PATH`.
  - [x] `requireCompleteProfile` lee versión vigente de `agreement_documents` (vía `getCurrentVersion`); contrato `{ ok, missing }` sin cambios.
  - [x] Tests por rol (`test:agreements`, 7 OK el 2026-10-31).
  - [x] `migrate:down` → `migrate` → `migrate:down` sin error (en su día; no se repite).
  - [x] Servidor reiniciado tras `migrate`.
  - [x] Verificación HTTP manual end-to-end (verificado el 2026-10-31, API real): el alumno no sube (403); el admin sube (201) y publica (200) los 3 tipos; el alumno descarga el PDF, idéntico al subido; firma la versión publicada (una no vigente → 400) y `profile-status` da `ok: true`.
  - [x] Commit (`672d870`).

### B4.6 — Cuenta familiar — CERRADO
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
- **Checklist de cierre** (verde el 2026-10-27; el HTTP de firmas, verificado el 2026-10-31 con documentos publicados de prueba: el tutor crea al hijo, guarda su salud y firma los 3 por él, otro perfil no firma por el hijo, y el tutor queda completo tras su `data_protection`): `test-minors.js` reescrito (el tutor crea un hijo y no se vincula a perfiles existentes; un adulto no puede ser hijo; el tutor edita la salud y firma; otro tutor no; a los 18 pierde poderes pero ve la lista; tutor sin `data_protection` incompleto); `test:rls` verde; `migrate:down` → `migrate` sin error; verificación HTTP del flujo del tutor.

### B5 — CRUD disciplinas, planes y disciplinas elegibles (admin) — CERRADO
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

### B6 — CRUD `class_sessions` + calendario — CERRADO
- **Estado** (verificado el 2026-10-30: commit en el historial y tests verdes: `096b5e8`, `test:classes` 12 OK). La checklist de abajo no se marcó en su día.
- **Objetivo**: sesiones de clase con calendario.
- **Entregable**: RLS en `class_sessions`; endpoints admin + lectura para alumnos.
- **Fuera de alcance**: reservas (B7), QR (B9), eventos (`events`/`event_registrations`, sin bloque asignado).
- **Nota**: un evento no es una sesión (ver `CONTEXT.md`). La FK `events.id → class_sessions(id)` de `001` es un error; se elimina cuando se aborden los eventos.
- **Nota**: `session_status.completed` sobra: «celebrada» se calcula por la hora (ver `CONTEXT.md`). El enum queda en `scheduled | cancelled`.
- **Checklist de cierre**:
  - [x] RLS en `class_sessions`.
  - [x] CRUD admin de clases + listado por disciplina/fecha (el ajuste de sesión, en B7.1; cancelar una sesión y las sueltas, en B6.1).
  - [x] Calendario del alumno, del tutor y del admin, con la cobertura por sujeto.
  - [x] Tests por rol.
- **Implementación del calendario** (migración `018`, 2026-10-30):
  - **Decidido 2026-10-30**:
    - `GET /sessions/calendar?from=&to=&discipline_id=&profile_id=` → `{ sessions }`. `from`/`to` son días de Madrid, ambos inclusive, como `listTrainerSessions`: por defecto, de hoy a hoy + 30, y 92 días como mucho.
    - Solo alumno, tutor y admin (`requireRole`). El profesor recibe 403 `insufficient_role`: sus sesiones están en `/professor/sessions`. Ver no exige perfil completo.
    - Cada sesión: `{ id, starts_at, ends_at, discipline: { id, name }, trainer: { id, display_name }, location, capacity, status, held, covered, booking }`.
    - `held` («celebrada») = `status = 'scheduled'` y `ends_at < now()`. Las canceladas aparecen con `status: 'cancelled'`.
    - `booking` es la reserva activa del sujeto (`{ id, status }`, `confirmed` o `waitlisted`) o `null`. Sin plazas libres: un alumno no puede contar las reservas ajenas con la RLS (ver Pendiente).
    - **Sujetos**: el alumno es él mismo, y `covered` y `booking` van planos. El tutor los recibe por hijo vigente (`{ <child_id>: … }`), sin el hijo que cumplió 18 sin reclamar su perfil y sin cobertura propia. El admin sin `profile_id` no recibe ni `covered` ni `booking`; con `profile_id`, recibe los de ese alumno. `profile_id` de alguien que no es admin → 400 `invalid_field`.
    - **Disciplinas retiradas** (aceptado): la RLS de `disciplines` solo enseña al alumno las activas y las de su suscripción viva, así que una sesión (pasada o cancelada) de una disciplina retirada no le sale. Al admin, sí.
  - **`018`**: `session_coverage(p_student, p_discipline)` es `SECURITY DEFINER`, tiene owner `service_role` y da `EXECUTE` a `app_user`. Llama a `covers` (012) si quien llama es el propio alumno, su tutor vinculado (`is_guardian_of`) o el admin; si no, devuelve `NULL`. No duplica la lógica de `covers`, que sigue sin `EXECUTE` para `app_user`. Tiene su `down` (probado up → down → up).
  - **Montaje**: `routes/sessions.js` se monta en `/sessions` **antes** que `attendance.js`, porque el `router.use(requireRole('profesor', 'admin'))` de este cierra todo `/sessions`.
  - **Servicio**: `listCalendar` en `services/sessions.js`, con el `client` RLS. El nombre del profesor (sustituto incluido) sale de `trainer_names`. Los hijos del tutor salen de `listChildren` (sin `pending_claim`). `covers` se llama una vez por sujeto y disciplina del rango, no por sesión (CTE `MATERIALIZED`): con 40 sesiones de 2 disciplinas, 2 llamadas en lugar de 40 (medido con `track_functions`). Un rango invertido o de más de 92 días → 400 `invalid_range`; una fecha mal formada o un `discipline_id` no entero → 400 `invalid_field`.
  - **Tests**: `test:calendar` (15) cubre:
    - alumno sin suscripción (lo ve todo, también solo menores y canceladas, con `covered` false);
    - plan de N y plan de «todas» (este no cubre solo menores a un adulto);
    - tutor con dos hijos y uno de 18 sin reclamar;
    - admin con y sin `profile_id`;
    - la disciplina retirada y el filtro `discipline_id`;
    - `session_coverage` por SQL (`NULL` para un perfil ajeno, también al tutor y al profesor);
    - la RLS del profesor y el nombre del sustituto;
    - los 400;
    - la ruta por HTTP con un express en memoria (403 del profesor, 401, y la asistencia sigue cerrada al alumno).

    Regresión con la API parada: `test:classes` 12, `test:bookings` 18, `test:profiles` 25 y `test:rls` 22, todos OK; `npm run lint` sin errores. Contra la API real (`npm run dev`, JWT firmados): 200 (alumno, tutor, admin), 403 (profesor), 400 `invalid_range` / `invalid_field` y 401; la base de desarrollo no tenía sesiones, así que las listas salieron vacías.
- **Pendiente**:
  - Plazas libres en el calendario: harían falta otra función `SECURITY DEFINER`, porque `bookings_select` no deja contar las reservas ajenas (→ `MEJORAS.md` 6.1).

### B7 — Reservas (`create_booking`, `FOR UPDATE`, lista de espera) — CERRADO
- **Objetivo**: reservas con bloqueo de plaza (`FOR UPDATE`) y lista de espera.
- **Cuenta familiar**: `student_id` = sujeto + `booked_by` = actor; RLS con `is_guardian_of`; `profile_id` opcional; bloqueo si el hijo o el tutor está incompleto. `event_registrations`: mismo patrón. Ver `PLAN_FAMILIA.md` §5.
- **Entregable**: RLS en `bookings`; función `create_booking` con `FOR UPDATE`; endpoints de reserva/cancelación; middleware `requireCompleteProfile` (B4.5) montado.
- **Reglas de dominio**: fijadas en `CONTEXT.md` § Reservas (grill-with-docs, sin ADR).
- **Implementación** (migración `009`): la lógica vive en funciones `SECURITY DEFINER` (owner `service_role`): `book_session`, `cancel_booking`, `cancel_session_bookings` (públicas) y `covers`, `promote_waitlist` (internas). `app_user` solo lee `bookings`. Aforo: `FOR UPDATE` de la sesión; solape: `pg_advisory_xact_lock` por alumno. Enum `booking_cancel_reason`; `academy_settings`: `booking_window_days` = 14, `cancellation_notice_minutes` = 60. Se crea `subscription_disciplines` (solo tabla; flujos en B10.5). Avisos: filas `notice.*` en `audit_log` con `changes.recipients` (se entregan por el outbox de B10.6, ADR 0008; los de reservas, por push en B15). Se corrige el `UNIQUE` de 001, que era total y no parcial. Endpoints: `GET /bookings`, `POST /bookings`, `POST /bookings/:id/cancel`.
- **Pendiente**: nada. Hecho en B10.3: la promoción re-comprueba el perfil completo (`profile_missing` en `promote_waitlist`, `013`). Hecho en B10.5: el cambio de disciplina. Hecho en **B7.1**: la subida de aforo y el cambio de clase promocionan, eximen de cancelación tardía y avisan a los afectados.
- **Fuera de alcance**: pago (B10), asistencia (B8).
- **Checklist de cierre**:
  - [x] RLS en `bookings`.
  - [x] `create_booking` transaccional con `FOR UPDATE` y control de aforo (`book_session`).
  - [x] Lista de espera funciona (promoción, salto por solape, `no_coverage`).
  - [x] `requireCompleteProfile` (B4.5) bloquea reservas con `403 profile_incomplete`.
  - [x] Tests de concurrencia + rol (`npm run test:bookings`).

### B7.1 — Cambio de clase y ajuste de sesión sobre las reservas — CERRADO
- **Objetivo**: cumplir lo que `CONTEXT.md` ya promete y B7 dejó pendiente. Un admin cambia una clase desde una fecha o ajusta una sesión concreta; las reservas siguen a su sesión; ante un **cambio que afecta a la sesión** (inicio, duración o profesor) se avisa a los afectados, que pueden cancelar sin que cuente como tardía; y si hay plazas nuevas, se promociona la lista de espera. Términos en `CONTEXT.md` (§ Clases y sesiones, § Reservas y § Avisos), y el modelo, en ADR 0004.
- **Por qué tras B15**: el aviso es un `booking_notice` más (push o email de respaldo, agrupado, ADR 0011). Se separó de B15 porque el aviso solo, sin la exención, diría algo que el sistema no cumple.
- **Choques con lo existente** (detectados en el diseño, 2026-10-31):
  - **Ni el cambio de clase ni el ajuste de sesión existen.** `updateClass` solo edita `location` (shortcut «hasta B7»), y no hay ninguna ruta ni función que ajuste una sesión. La checklist de B6 marcaba «CRUD admin» como hecho, pero solo existe el de clases. **B7.1 construye las dos operaciones** además de sus efectos sobre las reservas.
  - Tampoco existe cancelar una sesión concreta (`cancel_session_bookings` solo la llama `retireClass`), ni deshacerlo, ni la cancelación retroactiva por la API, ni las sesiones sueltas. **Pasan a un bloque nuevo, B6.1.**
  - `generateSessions` es idempotente por `UNIQUE (class_id, starts_at)`: si un ajuste mueve una sesión, la extensión diaria volvería a crear el hueco original. **Se añade `slot`** (ver Reglas).
  - `generateSessions` lee la clase sin bloquearla: la extensión diaria, a la vez que un cambio de clase, podría generar la última sesión con los valores anteriores. **Se bloquea la clase con `FOR SHARE`.**
  - B15 hace caducar un aviso agrupado al empezar su sesión **más próxima**: en un cambio de clase de 40 sesiones cuya primera empieza en 20 minutos, un worker que se retrase perdería el aviso de las 39 restantes. **Cambia para todos los avisos de reservas**: el grupo caduca al empezar su **última** sesión y solo cuenta las que no han empezado (`CONTEXT.md` § Aviso de reservas).
  - `CONTEXT.md` § Solape de reservas decía que un alumno no puede tener dos reservas solapadas, pero un cambio de hora puede dejárselas. **Se matiza**: no puede *reservar* ni ser promocionado a una que se solape; el cambio no se impide ni cancela ninguna.
  - El shortcut de `change_discipline` (014, orden alumno → sesión) **no se toca**: B7.1 usa el orden de `book_session` (sesión → alumno) y no lo empeora.
- **Reglas** (decididas 2026-10-31):
  - **Cambio de clase** (`change_class`):
    - Campos: profesor habitual, hora (`start_time`), duración, aforo y lugar. La disciplina y el día de la semana, no (409 `not_supported`: «retira la clase y crea otra»).
    - Fecha `from`: por defecto hoy (Madrid), nunca pasada, como mucho hoy + horizonte (si no, 400 `invalid_field`). La fila de la clase se actualiza; las sesiones afectadas son las de la clase con `slot >= from` (día de Madrid) que no han empezado, también las canceladas (sin avisos ni promoción, por si B6.1 las reactiva).
    - En cada sesión se cambian los campos que no estén en su `adjusted_fields`. `location` ahora también se propaga a las sesiones ya generadas.
    - Nueva hora: `slot` = `(día de Madrid del slot + start_time) AT TIME ZONE 'Europe/Madrid'` en **todas** las afectadas; `starts_at` = `slot` solo si `starts_at` no está ajustado. `ends_at` = `starts_at + duration_min` siempre que cambie uno de los dos.
    - El profesor debe tener rol `profesor` (400 `invalid_field`, como `createClass`). El solape del profesor lo impide la restricción `EXCLUDE` (409 `trainer_overlap`).
  - **Ajuste de sesión** (`adjust_session`):
    - Campos: profesor (sustituto), inicio (`starts_at`, fecha y hora libres, también otro día), duración, aforo y lugar. Cada campo cambiado entra en `adjusted_fields` y ya no lo pisa un cambio de clase. Vale también para una sesión suelta.
    - Sesión empezada o cancelada → 409 `session_not_adjustable`. Nuevo inicio no futuro → 400 `invalid_field`. `slot` no cambia.
  - **`slot`** (`class_sessions`): el inicio que le corresponde según su clase; `NULL` en una sesión suelta. Sustituye a `starts_at` en el `UNIQUE` de la generación: `UNIQUE (class_id, slot) WHERE class_id IS NOT NULL`. Solo lo cambian la generación y el cambio de hora de la clase.
  - **Aforo**: nunca por debajo de las reservas confirmadas (`CONTEXT.md`, ADR 0004). Todo o nada: 409 `capacity_below_bookings` con `{ sessions: [{ id, starts_at, confirmed }] }` y, en el cambio de clase, `fits_from` (el día siguiente a la última sesión que no cabe, si cae dentro del horizonte). Si sube, `promote_waitlist` en esa sesión (solo programadas).
  - **Cambio que afecta a la sesión**: en una sesión programada, cuando `starts_at`, `duration_min` o `trainer_id` **cambian de valor** (un sustituto igual al profesor actual no cuenta). Lugar y aforo no afectan.
    - Pone `class_sessions.changed_at = now()` (cada cambio lo sobreescribe).
    - Avisa a cada reserva activa, confirmada **o en espera**, creada antes del cambio: `booking_notice(id, 'notice.session_changed')`, al alumno o a todos sus tutores, sin el admin (actor) ni el profesor (ADR 0011).
  - **Exención de cancelación tardía**: `cancel_booking` no la marca `late` si `was.created_at < s.changed_at` (la reserva, o su entrada en espera, es anterior al último cambio). Vale hasta el inicio, que es cuando se cierra la cancelación; el motivo es `student`. Quien reserva después del cambio no queda exento. Se suma a la exención del promocionado dentro de plazo (B7).
  - **Solape de reservas**: el cambio no se impide ni cancela nada si deja a un alumno con dos reservas confirmadas solapadas; el aviso le deja elegir. `has_overlapping_booking` sigue frenando reservas y promociones.
  - **Orden de bloqueos**: clase (`FOR UPDATE`) → **todas** las sesiones afectadas (`SELECT … FOR UPDATE ORDER BY id`) → por cada sesión: aforo, cambio, avisos y `promote_waitlist` (que bloquea alumnos con `lock_student`). Es el orden de `book_session` y `cancel_booking`: nunca se espera una sesión con un alumno bloqueado, y dos cambios a la vez bloquean en el mismo orden. El ajuste es el caso de una sola sesión.
  - **Aviso `notice.session_changed`**:
    - `changes` (además de lo de `booking_notice`): `fields` (los cambiados, de `starts_at`, `duration_min` y `trainer_id`) y `previous_starts_at`.
    - Título: «Sesión cambiada» / «Sesiones cambiadas».
    - Una: «BJJ Fundamentos, mié, 5 nov, 18:30 (Lucía): ha cambiado la hora (antes lun, 3 nov, 19:00). Si ya no te viene bien, puedes cancelar sin que cuente como tardía». Profesor: «ha cambiado el profesor (ahora Carlos)», con el nombre de `trainer_names`. Duración: «ha cambiado la duración (ahora 1 h 30)». Varios campos se juntan con «y».
    - Varias (agrupado por alumno y transacción): «Han cambiado 8 sesiones de BJJ Fundamentos de Lucía (la hora y el profesor). Si ya no te vienen bien, puedes cancelarlas sin que cuente como tardía». El email de respaldo lista cada sesión con su fecha nueva.
    - Misma frase para confirmadas y en espera («cancelar» vale para salir de la espera). Solo español; nunca salud, edad ni fecha de nacimiento. `url` a `APP_URL/bookings`.
  - **Caducidad de los avisos de reservas** (cambia la de B15, para todos): un aviso agrupado caduca al empezar su **última** sesión; el TTL del push cuenta hasta entonces; el mensaje solo cuenta y lista las sesiones que aún no han empezado. Con una sola reserva no cambia nada.
  - **Concurrencia con la generación**: `generateSessions` lee la clase con `FOR SHARE`, así espera al cambio en curso (o el cambio a ella) y genera con los valores confirmados.
  - **Auditoría**: `class.change` (`from`, el patch y `{ sessions_changed, notified, promoted }`) y `session.adjust` (antes y después de cada campo cambiado), en `audit_log`.
- **Pasos**:
  1. **Migración `021`**:
     - `class_sessions`: `slot timestamptz` (`slot = starts_at` en las filas con `class_id`) y `changed_at timestamptz`. Se borra `class_sessions_class_start_key` y se crea `class_sessions_class_slot_key` `UNIQUE (class_id, slot) WHERE class_id IS NOT NULL`. `CHECK ((class_id IS NULL) = (slot IS NULL))`.
     - `change_class(p_class uuid, p_from date, p_patch jsonb)` y `adjust_session(p_session uuid, p_patch jsonb)`: `SECURITY DEFINER`, owner `service_role`, `EXECUTE` para `app_user`; exigen admin (`42501` `not_allowed`). Devuelven `jsonb` `{ sessions_changed, notified, promoted }`. Errores con `RAISE` y el código como mensaje (como `book_session`); el de aforo lleva `sessions` y `fits_from` en el `DETAIL` (JSON).
     - `cancel_booking` con `CREATE OR REPLACE`: la exención por `changed_at` (quita su shortcut).
     - Con su `down` (probado up → down → up): el `down` restaura `cancel_booking` de 009 y el `UNIQUE` por `starts_at` (falla si dos sesiones de una clase comparten `starts_at` tras un ajuste).
  2. **`services/sessions.js`**: `generateSessions` con `FOR SHARE` en el CTE de la clase, `slot` en el `INSERT` y `ON CONFLICT (class_id, slot)`. `adjustSession(client, { id, body, actorId })`: valida (`starts_at` ISO futuro, el resto como `CLASS_SPEC`; el profesor con rol `profesor`), llama a `adjust_session` y traduce los errores (`23P01` → 409 `trainer_overlap`).
  3. **`services/classes.js`**: `updateClass` (sin el shortcut) valida `from` y los campos de `CLASS_SPEC` (`discipline_id`/`weekday` → 409 `not_supported`), comprueba el profesor y llama a `change_class`. Devuelve la clase y los recuentos.
  4. **`services/notices.js`**: `SERVICE['notice.session_changed']` (textos de arriba); `bookingGroup` devuelve también el profesor y `changes` de cada fila y descarta las sesiones empezadas; `sendPending` caduca y calcula el TTL por la última sesión del grupo.
  5. **Rutas**:
     - `PATCH /admin/classes/:id` `{ from?, trainer_id?, start_time?, duration_min?, capacity?, location? }` → `{ class, sessions_changed, notified, promoted }`.
     - `PATCH /admin/sessions/:id` `{ trainer_id?, starts_at?, duration_min?, capacity?, location? }` → `{ session, sessions_changed, notified, promoted }`, en `routes/admin/sessions.js` (nuevo; `requireAuth`, `requireRole('admin')`, `withRlsContext`).
     - Body vacío → 400 `invalid_field`. Siempre con el `client` RLS, nunca `servicePool`.
  6. **Docs**: `contexto-proyecto.md` §6 (`slot`, `changed_at`, funciones de `021`) y rutas nuevas.
- **Tests** (`test:session-changes`, nuevo; `test:classes` cambia su caso «PATCH: solo location»):
  - **Cambio de clase**: hora, duración, profesor, aforo y lugar desde una fecha; respeta `adjusted_fields`; lo pasado y lo empezado no cambian; cambio de hora en el paso de horario de verano a invierno; `discipline_id` o `weekday` → 409; `from` pasado o más allá del horizonte → 400; profesor sin rol → 400; solape del profesor → 409 sin cambiar nada.
  - **Ajuste**: mover a otro día y ejecutar `generateSessions` sin que vuelva a crear el hueco (`slot`); cambio de hora de la clase después del ajuste (`slot` cambia, `starts_at` no); sesión empezada o cancelada → 409; sesión suelta.
  - **Aforo**: bajada por debajo de las confirmadas → 409 con `sessions` y `fits_from`, sin cambios; subida → promoción por orden de llegada, con el salto por solape y `no_coverage`.
  - **Avisos**: solo si el valor cambia (sustituto igual o solo lugar/aforo, sin aviso); confirmadas y en espera; tutores de un hijo; sin el admin; un aviso por alumno con N sesiones; texto con hora anterior y nombre del profesor; sin fecha de nacimiento ni edad; grupo con la primera sesión ya empezada: se envía y no la lista; caduca al empezar la última.
  - **Exención**: reserva anterior al cambio cancelada fuera de plazo → `student`; reserva posterior → `late`; dos cambios seguidos; promocionado tras el cambio (estaba en espera antes) → `student`.
  - **Solape**: tras un cambio de hora, dos reservas solapadas sin error; la promoción sigue saltando por solape.
  - **Concurrencia**: `change_class` y `book_session` a la vez (dos conexiones) sin interbloqueo ni aforo superado; `generateSessions` a la vez que un cambio de clase genera con los valores nuevos.
  - **Permisos**: alumno, tutor y profesor → `42501` en SQL y 403 por HTTP (express en memoria, como `test:calendar`); 401 sin sesión.
  - **Regresión**: `test:classes`, `test:bookings`, `test:calendar`, `test:attendance`, `test:checkin`, `test:push`, `test:notices`, `test:billing`, `test:progress` y `test:rls`; `npm run lint` sin errores.
  - **Manual**: con `PUSH_TRANSPORT=log`, cambiar la hora de una clase con dos reservas de un alumno y ver un solo payload agrupado en `storage/push.log`.
- **Fuera de alcance**:
  - cambiar la disciplina o el día de una clase (se retira y se crea otra);
  - sesiones sueltas, cancelar una sesión y deshacerlo, cancelación retroactiva por la API y deshacer un ajuste (**B6.1**);
  - el orden de bloqueos de `change_discipline` y la promoción tras el cambio de disciplina (shortcut de 014);
  - aviso al profesor que pierde o recibe una sesión (el profesor no recibe avisos);
  - plazas libres en el calendario (Pendiente de B6);
  - UI del admin (B19).
- **Implementación** (migración `021`, 2026-10-31):
  - **Desviación del diseño, decidida al implementar (2026-10-31)**: `generateSessions` solo genera los días **posteriores al último `slot`** de la clase (`greatest(starts_on, hoy, día de Madrid del max(slot) + 1)`). Con el diseño tal cual, un cambio de hora desde una fecha futura (p. ej. 19:00 → 20:00 desde hoy + 30) deja antes de `from` sesiones con el `slot` de las 19:00 mientras la clase ya dice 20:00, y la extensión diaria habría creado sesiones duplicadas a las 20:00 en esos días (o, con 19:30, chocado siempre con el `EXCLUDE` del profesor). Pasaba incluso con `from` = hoy si la sesión de hoy ya había empezado. El `UNIQUE (class_id, slot)` y el `ON CONFLICT` se mantienen como en el diseño. Las sesiones nunca se borran, así que el último `slot` solo avanza.
  - **`021`**:
    - `slot` y `changed_at` como en el diseño. El backfill (`slot = starts_at`) entra como `service_role`, porque `class_sessions` tiene RLS `FORCE` y `migrator` no tiene política (como el seed de 009).
    - `apply_session_change(old class_sessions, new class_sessions)` es **interna** (sin `EXECUTE` para `app_user`) y no estaba en el diseño. La usan las dos funciones públicas: actualiza una sesión ya bloqueada, recalcula `ends_at`, pone `changed_at` y avisa si cambia el inicio, la duración o el profesor de una programada, y llama a `promote_waitlist` si sube el aforo.
    - `booking_notice` gana un 3.er argumento `p_extra jsonb DEFAULT '{}'`, que se suma a `changes`, para guardar `fields` y `previous_starts_at`. Al cambiar la firma, se borra y se crea: dos versiones harían ambigua la llamada de 2 argumentos. El `down` vuelve a la de 020.
    - La auditoría (`class.change` y `session.adjust`) se escribe en SQL, con el actor de `app.current_user_id`, como en `book_session`. Por eso `updateClass` y `adjustSession` no reciben `actorId`.
    - `adjusted_fields` solo recibe los campos cuyo valor **cambia**: mandar el valor actual no lo fija. `session.adjust` guarda `{ before, after }` de esos campos.
    - `sessions_changed` cuenta las sesiones en las que cambia algún valor. `notified` cuenta las reservas avisadas (filas `notice.session_changed`), no los destinatarios.
    - Una sesión cancelada afectada por un cambio de clase cambia sus valores, pero no pone `changed_at`, ni avisa ni promociona.
    - «Reserva anterior al cambio» = `created_at < now()` de la transacción del cambio.
    - `fits_from` = el día de Madrid siguiente al `slot` de la última sesión que no cabe. Es `null` si cae más allá de hoy + `academy_int('horizon_days', 365)`. En el ajuste no hay `fits_from`.
    - Con su `down` (probado up → down → up, con `booking_notice` de 2 argumentos, `cancel_booking` de 009 y el índice por `starts_at` de vuelta).
  - **Servicios**:
    - `CLASS_SPEC` pasa de `classes.js` a `sessions.js`, porque el ajuste lo usa y `classes.js` ya importa `sessions.js`: así se evita un ciclo. También pasan allí `assertTrainer` (la usan `createClass`, `updateClass` y `adjustSession`) y `callChange`, que traduce los errores de `change_class` y `adjust_session`: `not_allowed` 403, `class_not_found` / `session_not_found` 404, `session_not_adjustable` 409, `capacity_below_bookings` 409 con el `DETAIL` como cuerpo, `23P01` 409 `trainer_overlap` y `40P01` 409 `booking_conflict_retry`.
    - Body vacío (o con solo `from`) → 400 `invalid_field` (`field: 'body'`), no el `empty_patch` de `validate`. `starts_at` exige ISO con zona horaria (`Z` o `±HH:MM`) y futuro. Un campo desconocido se ignora, como en el resto de la API.
    - `updateClass` devuelve `{ class, sessions_changed, notified, promoted }` y `adjustSession` devuelve `{ session, … }`. La ruta los devuelve tal cual.
  - **Avisos** (`services/notices.js`):
    - El nombre del profesor sale de `profiles` y no de `trainer_names`, que exige sesión, y el worker (`servicePool`) no la tiene.
    - Duración: «45 min», «1 h», «1 h 30», «1 h 05».
    - Con varias sesiones, los campos del texto son la unión de los del grupo, en el orden hora, duración, profesor. Si del grupo solo queda una sesión sin empezar, sale el texto de una.
    - `sendPending` caduca por el `max` del `expires_at` del grupo (antes el `min`), con el tope de 24 h de B10.6.
  - **Tests** (`test:session-changes`, 22 casos): los de la lista de arriba, y además:
    - el cambio de hora desde una fecha futura sin duplicar en la generación (la desviación);
    - la caducidad con el inicio actual y la retirada por `slot` (riesgos cerrados, abajo);
    - los 409 de aforo y de `not_supported` por HTTP;
    - que solo `change_class` y `adjust_session` tienen `EXECUTE` para `app_user`.

    La concurrencia usa dos conexiones reales y `pg_locks` para saber que una espera a la otra. Comprobado a mano que los tests detectan los fallos:
    - con `change_class` bloqueando sesión a sesión (orden invertido), el test de interbloqueo falla con `40P01`;
    - sin `FOR SHARE`, la generación crea la sesión a la hora antigua y su test falla.
  - **Regresión**: `test:calendar` y `test:profiles` insertaban sesiones con `class_id` y sin `slot`, que el nuevo `CHECK` rechaza: sus fixtures ponen ahora `slot`. `test:push` comprobaba el TTL hasta la sesión más próxima: ahora va hasta la última, con el tope de 24 h.
  - **Regresión verde**:
    - las de § Tests: `test:session-changes` 22, `test:classes` 12, `test:bookings` 18, `test:calendar` 15, `test:attendance` 12, `test:checkin` 8, `test:push` 9, `test:notices` 9, `test:billing` 38, `test:progress` 20 y `test:rls` 22;
    - además: `test:profiles` 25, `test:webhook` 35 (Stripe sandbox), `test:agreements` 7, `test:minors` 14, `test:catalog` 10 y `test:mfa` 13.

    `npm run lint` sin errores.
  - **Prueba manual** (`PUSH_TRANSPORT=log`, API real con `npm run dev`):
    - Alumno con dispositivo de push y dos reservas en una clase de dos sesiones. `PATCH /admin/classes/:id` `{ start_time: '20:30' }` con un JWT de admin respondió `notified: 2`, `sessions_changed: 2`.
    - El worker dejó **una** entrega `push` `sent` y escribió en `storage/push.log` un solo payload: `{ title: 'Sesiones cambiadas', body: 'Han cambiado 2 sesiones de BJJ Fundamentos manual de Lucía Manual (la hora). Si ya no te vienen bien, puedes cancelarlas sin que cuente como tardía', url: …/bookings, tag }`, con `TTL 86378s`.
  - **Riesgos cerrados tras la primera implementación** (2026-10-31), cada uno con su test, comprobado que falla con el código anterior:
    - **Caducidad con el inicio actual**: `sendPending` calcula la caducidad de un aviso de reservas con el `max(starts_at)` actual de las sesiones del grupo, no con el `expires_at` guardado. Antes, si un cambio posterior movía la sesión, el aviso anterior caducaba con el inicio antiguo. `expires_at` se sigue guardando en `changes`.
    - **Grupo vacío al componer**: si la última sesión empieza entre la comprobación de caducidad y la composición, `composeService` lanza un error `stale` y la entrega queda `skipped` (`stale`), no `failed`.
    - **`retireClass` por `slot`**: cancela las sesiones con `slot` desde la fecha, como el cambio de clase y la generación (`ends_on` = fecha − 1). Una sesión ajustada a otro día sigue el día que le tocaba.
- **Checklist de cierre**:
  - [x] Migración `021`: `slot` con su `UNIQUE`, `changed_at`, `change_class`, `adjust_session` y `cancel_booking` con la exención; `down` probado.
  - [x] Cambio de clase desde una fecha (profesor, hora, duración, aforo, lugar) respetando los ajustes; la disciplina y el día, 409.
  - [x] Ajuste de sesión (sustituto, inicio, duración, aforo, lugar) sin que la generación duplique el hueco.
  - [x] Aforo: bajada por debajo de las reservas, 409 con `fits_from`; subida, promoción.
  - [x] Aviso `session_changed` a confirmadas y en espera, agrupado, solo si cambia inicio, duración o profesor.
  - [x] Cancelación sin tardía para las reservas anteriores al cambio.
  - [x] Caducidad de los avisos agrupados por la última sesión.
  - [x] Orden de bloqueos clase → sesiones → alumnos; `generateSessions` con `FOR SHARE`.
  - [x] Tests (`test:session-changes` y regresión) y prueba manual con `PUSH_TRANSPORT=log`.

### B6.1 — Sesiones sueltas y cancelación de una sesión — CERRADO
- **Objetivo**: lo que falta de B6 para el admin (detectado en el diseño de B7.1, 2026-10-31): crear sesiones sueltas, cancelar una sesión concreta y recuperarla (las reservas no vuelven), la cancelación retroactiva con motivo por la API y deshacer un ajuste de sesión (devolver un campo a lo que dice su clase). Además, lo que `CONTEXT.md` promete al desactivar una disciplina. Términos en `CONTEXT.md` § Clases y sesiones («Cancelar una sesión», «Recuperar una sesión», «Cancelación retroactiva», «Deshacer un ajuste», «Retirar una clase»).
- **Se apoya en**: `cancel_session_bookings` (009/010, que se sustituye), `apply_session_change`, `adjust_session`, `slot` y `changed_at` (B7.1), `booking_notice` y `enqueue_notice` (B15).
- **Choques con lo existente** (detectados en el diseño, 2026-10-31):
  - **`cancel_session_bookings` no cancela la sesión**: anula reservas y asistencias, pero el `status` lo pone `retireClass` en JS (un `UPDATE` sin `ORDER BY id`). No bloquea la sesión y tiene `EXECUTE` para `app_user`: un admin podría anular las reservas de una sesión que sigue programada. **Se sustituye** por una función interna que hace todo, con dos públicas encima (`cancel_session` y `retire_class`).
  - **`retireClass` con una fecha pasada cancela sesiones celebradas**: cancela todo lo que tiene `slot >= date` sin mirar `starts_at`, borra sus asistencias y no deja motivo, cuando `CONTEXT.md` dice que el pasado se conserva. También cancela la sesión de hoy si ya ha empezado. **Cambia**: `date` nunca pasada y solo se cancelan las sesiones que no han empezado, como en el cambio de clase.
  - **En una sesión pasada, `cancel_session_bookings` crea avisos que nacen caducados** (`expires_at` = inicio): filas y entregas que el worker deja `skipped`. La retroactiva **no avisa**.
  - **Desactivar una disciplina no retira sus clases ni cancela sus sueltas**, aunque `CONTEXT.md` lo dice: `updateDiscipline` solo cambia `is_active`. Sus sesiones siguen programadas sin que nadie pueda reservarlas (`covers` exige disciplina activa) y la lista de espera se vacía con `no_coverage`. **Entra en B6.1.**
  - `CONTEXT.md` decía «se puede deshacer mientras la sesión no haya pasado»: **se precisa** a «no ha empezado» (después ya no se reserva).
  - `class_sessions` no guarda lo que dice su clase para ella, salvo `slot`: con solo la fila de la clase, tras un cambio de clase desde una fecha futura, deshacer el ajuste de una sesión anterior a esa fecha tomaría el valor nuevo y no el de sus vecinas. **Se añaden `class_trainer_id`, `class_duration_min`, `class_capacity` y `class_location`**, como `slot` (ver Reglas).
  - **Fixtures que se rompen** (decidido arreglarlos en B6.1):
    - el `REVOKE UPDATE` rompe `test-classes.js:98` y `:112` (esperan `rowCount 0`; ahora, `permission denied`) y `test-attendance.js:170` y `:196-197`;
    - el `CHECK` de `cancelled_at` rompe los que cancelan sin `cancelled_at`, también con `servicePool`: `test-progress.js:89`, `:121` y `:165`, `test-session-changes.js:178` y `:295`, y los helpers que insertan sesiones con `status 'cancelled'` (`test-calendar`, `test-bookings`, `test-attendance`);
    - los que insertan sesiones con `class_id` necesitan los `class_*`, como pasó con `slot` en B7.1.
  - Después de esto, el `UPDATE` de `class_sessions` para `app_user` ya no lo usa ninguna ruta: **se revoca** y se borra la política `class_sessions_update_admin`, para que toda escritura sobre una sesión existente pase por funciones, como en `bookings`. El `INSERT` se queda (generación y sueltas).
- **Reglas** (decididas 2026-10-31):
  - **Sesión suelta** (`createSession`):
    - Campos: `discipline_id`, `trainer_id`, `starts_at` (ISO con zona horaria, futuro), `duration_min`, `capacity` y `location` opcional, con los validadores de `SESSION_SPEC`/`CLASS_SPEC`.
    - Disciplina activa (400 `invalid_field`, como `createClass`; leída con `FOR SHARE`). Profesor con rol `profesor` (`assertTrainer`). `starts_at` como mucho hoy + horizonte (400 `invalid_field`). El solape del profesor lo frena el `EXCLUDE` (409 `trainer_overlap`).
    - `class_id` y `slot` NULL, `adjusted_fields` vacío. Sin aviso: nadie tiene reservas.
    - `INSERT` en JS con el `client` RLS (política `class_sessions_insert_admin`) y `audit()` con `session.create`, como `createClass`. Sin función SQL: no toca reservas.
    - Después se ajusta, se cancela y se recupera como cualquier otra. Deshacer un ajuste no existe en una suelta (409 `loose_session`).
  - **Cancelar una sesión** (`cancel_session(p_session, p_note)`): una sola operación con la frontera en el **inicio**.
    - **Antes del inicio**: cancelación normal. Anula reservas y esperas con `session_cancelled` y aviso `notice.session_cancelled` a cada una (al alumno o a sus tutores, agrupado por alumno y transacción). El motivo (`note`) es opcional.
    - **Desde el inicio** (también en curso): **cancelación retroactiva**. El motivo es obligatorio (400 `invalid_field`) y no se avisa a nadie. Anula las reservas con `session_cancelled`, borra la lista y sus asistencias (presentes y faltas) y vacía `attendance_closed_at`/`_by`. Racha, horas, badges y ranking cambian solos, porque se calculan al leer (B14). Una semana cuya única sesión celebrada era esta pasa a «se salta». Se permite aunque haya presentes (el admin corrige un error). **Sin plazo máximo**, como las correcciones del admin. **No se recupera.**
    - Ya cancelada → 409 `session_cancelled`.
  - **Motivo**: columnas nuevas en `class_sessions`, `cancelled_at`, `cancelled_by` y `cancel_note` (texto ≤ 500; no `cancel_reason`, para no confundirlo con el enum de `bookings`). Las rellenan toda cancelación (también la retirada de una clase y la desactivación de una disciplina, con `cancel_note` NULL) y las vacía la recuperación. El motivo **nunca** va en un aviso ni en el calendario del alumno: es texto libre y podría llevar salud. Lo ve solo el admin.
  - **Instantánea de la asistencia**: `session.cancel` guarda en `audit_log` `attendance: { closed_at, present: [ids], absent: [ids] }` antes de borrarla, para que la retroactiva no sea una pérdida irrecuperable.
  - **Recuperar una sesión** (`restore_session(p_session)`):
    - Solo una sesión cancelada (409 `session_not_cancelled`) que no ha empezado (409 `session_started`).
    - 409 `class_retired` si el día de Madrid de su `slot` es posterior al `ends_on` de su clase. Eso incluye todas las que canceló una retirada: para dar una más, se crea una suelta.
    - 409 `discipline_inactive` si su disciplina está desactivada.
    - El solape del profesor lo frena el `EXCLUDE` al volver a `scheduled` (409 `trainer_overlap`).
    - Vuelve con los valores que tiene: los que escribió un cambio de clase mientras estaba cancelada ya son los vigentes (B7.1 los actualizaba para esto). No toca `changed_at` ni promociona: no queda ninguna reserva. Las reservas no vuelven.
    - **Aviso `notice.session_restored`** a cada reserva o espera anulada **por esa cancelación** (`cancel_reason = 'session_cancelled'` y `cancelled_at` = el `cancelled_at` de la sesión), al alumno o a sus tutores, sin el admin. Título «Sesión recuperada». Texto: «BJJ Fundamentos, mié, 5 nov, 18:30 (Lucía): la academia ha recuperado la sesión. Si quieres ir, vuelve a reservar». `url` a `APP_URL/bookings`. Caduca al inicio, como todo aviso de reservas. Solo español; nunca salud, edad ni fecha de nacimiento.
  - **Deshacer un ajuste** (`reset_session(p_session, p_fields)`):
    - Por campo: `trainer_id`, `starts_at`, `duration_min`, `capacity` y `location`. El campo sale de `adjusted_fields` y toma **lo que dice su clase para esa sesión**: `class_trainer_id`, `class_duration_min`, `class_capacity` o `class_location`; `starts_at` vuelve a `slot`.
    - `starts_at` con el `slot` ya pasado → 409 `slot_passed` (la sesión empezaría en el pasado).
    - Solo sesiones programadas que no han empezado (409 `session_not_adjustable`) y de una clase (409 `loose_session`).
    - Un campo que no está ajustado no hace nada (idempotente).
    - El resto lo hace `apply_session_change`: si cambia el inicio, la duración o el profesor, es un **cambio que afecta a la sesión** (`changed_at`, `notice.session_changed` y exención de tardía, B7.1); si sube el aforo, promoción. Aforo todo o nada: por debajo de las confirmadas, 409 `capacity_below_bookings` con `{ sessions }`, sin cambios. El `EXCLUDE` → 409 `trainer_overlap`.
    - `sessions_changed` es 1 también si solo sale el campo de `adjusted_fields` sin que cambie el valor: la sesión vuelve a seguir a su clase.
  - **Valores de clase de la sesión** (`class_trainer_id`, `class_duration_min`, `class_capacity`, `class_location`): lo que dice su clase para esa sesión, como `slot` para el inicio. NULL en una suelta (`CHECK`: con `class_id`, los tres primeros `NOT NULL`; sin `class_id`, los cuatro NULL).
    - Los escribe `generateSessions`, con los valores de la clase.
    - Los escribe `change_class`, en **todas** las sesiones afectadas (`slot >= from`, sin empezar, también las canceladas) y **también en los campos ajustados**, que en los valores de la sesión no toca.
    - `adjust_session` y `reset_session` no los tocan nunca, y en una sesión empezada no cambian.
    - No se exponen en la API (`SESSION_SELECT` no los devuelve): los añadirá la UI del admin (B19) si los necesita.
  - **Retirar una clase** (`retire_class(p_class, p_date)`, sustituye al `UPDATE` de `retireClass`):
    - `date` por defecto hoy, nunca pasada y como mucho hoy + horizonte (400 `invalid_field`). Se mantienen 409 `already_retired` y 400 por fecha anterior al inicio de la clase.
    - `ends_on` = `date − 1`. Cancela las sesiones programadas con `slot >= date` (día de Madrid) que **no han empezado**, con `cancel_session_row` (con aviso).
  - **Desactivar una disciplina** (`updateDiscipline` con `is_active: false` sobre una activa):
    - En la misma transacción, retira **hoy** sus clases no retiradas antes de hoy: `retire_class(clase, greatest(hoy, starts_on))`, de modo que una que aún no ha empezado queda retirada antes de empezar (`ends_on = starts_on − 1`). Después cancela sus sueltas que no han empezado (`cancel_session`, sin motivo).
    - Se conservan las sesiones ya empezadas o en curso. El aviso `session_cancelled` sale agrupado por alumno, porque todo va en una transacción.
    - Volver a activarla no deshace nada: las clases se crean de nuevo y las sueltas se recuperan una a una.
    - La respuesta gana `{ retired_classes, cancelled_sessions }` solo al desactivar.
  - **Orden de bloqueos**: **disciplina → clase → sesiones (`ORDER BY id`) → alumnos**, el de B7.1 con la disciplina delante:

    | Operación | Disciplina | Clase | Sesiones | Alumnos |
    |---|---|---|---|---|
    | Desactivar disciplina | `FOR UPDATE` (`getDiscipline`) | cada una `FOR UPDATE` (`retire_class`, por id) | por id | — |
    | `retire_class` | — | `FOR UPDATE` | `FOR UPDATE` por id | — |
    | `cancel_session` | — | — | `FOR UPDATE` | — (no comprueba solapes) |
    | `restore_session` | `FOR SHARE` (activa) | `FOR SHARE` (`ends_on`) | `FOR UPDATE` | — |
    | `reset_session` | — | — (lee los `class_*` de la sesión) | `FOR UPDATE` | `promote_waitlist` |
    | Crear una suelta | `FOR SHARE` | — | `INSERT` | — |

    `class_id` y `discipline_id` de una sesión nunca cambian: se leen sin bloqueo para saber qué bloquear, y la sesión se relee ya bloqueada (una que otra transacción canceló mientras se esperaba se salta o da su 409).
  - **Concurrencia**: `book_session`, `cancel_booking`, `attendance_session` (pasar lista, cerrar, corregir) y `check_in` bloquean primero la sesión, así que ante una cancelación esperan y luego reciben `session_not_bookable`, la reserva ya anulada o `session_cancelled`. Una suelta creada a la vez que se desactiva su disciplina, o una sesión recuperada a la vez que se retira su clase, espera a la otra y ve el valor confirmado. `reset_session` y `change_class` a la vez no se interbloquean (el deshacer solo bloquea su sesión) y aciertan en los dos órdenes: si el deshacer va primero, el cambio de clase pisa el campo ya no ajustado; si va después, lee los `class_*` nuevos.
  - **Auditoría** (en SQL, con el actor de `app.current_user_id`, salvo `session.create`, que va por `audit()`):
    - `session.create`: los campos;
    - `session.cancel`: `{ note, retroactive, cancelled_bookings, notified, attendance }`;
    - `session.restore`: `{ notified }`;
    - `session.reset`: `{ fields, before, after }`, solo si cambia algo;
    - `class.retire`: `{ from, sessions: [ids] }`, sin un `session.cancel` por sesión.

    Desactivar una disciplina deja `discipline.update`, un `class.retire` por clase y un `session.cancel` por suelta.
  - **Permisos**: solo admin. Las funciones públicas exigen admin (`42501` `not_allowed`) y las rutas van con `requireRole('admin')` y el `client` RLS, nunca `servicePool`.
- **Pasos**:
  1. **Migración `022`**:
     - `class_sessions`: `cancelled_at timestamptz`, `cancelled_by uuid` (FK `profiles`, `ON DELETE SET NULL`), `cancel_note text` (`CHECK char_length ≤ 500`). Backfill de las canceladas existentes, `cancelled_at = now()`, como `service_role` (RLS `FORCE`, como en 021). Después, `CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))`. Las del backfill no avisan al recuperarse, porque `cancelled_at` no coincide con sus reservas; además son de clases retiradas y no se pueden recuperar.
     - `class_sessions`: `class_trainer_id uuid` (FK `profiles`, `RESTRICT`, como `trainer_id`), `class_duration_min integer`, `class_capacity integer`, `class_location text`, con su `CHECK`. Backfill como `service_role`: en cada campo, el valor de la sesión si no está en `adjusted_fields`; si lo está, el actual de la clase. Solo puede ser impreciso en sesiones de desarrollo ajustadas antes de 022 con un cambio de clase de fecha futura: no hay datos de producción (B10.7).
     - `change_class` con `CREATE OR REPLACE`: además escribe los `class_*` de cada sesión afectada (los cuatro, ajustados o no) cuando el patch trae el campo. `apply_session_change` los incluye en su `UPDATE` y en su comprobación de «sin cambios». El `down` vuelve a las de 021.
     - `cancel_session_row(s class_sessions, p_note text) RETURNS jsonb`, **interna**: la sesión ya está bloqueada. Hace el `status`, los campos del motivo y las reservas y esperas con `session_cancelled`, con `booking_notice(id, 'notice.session_cancelled')` solo si `s.starts_at > now()`. Toma la instantánea, borra las asistencias y vacía `attendance_closed_*`. Devuelve `{ cancelled_bookings, notified, attendance }`.
     - Públicas (`SECURITY DEFINER`, owner `service_role`, `REVOKE` de `PUBLIC`, `EXECUTE` para `app_user`; exigen admin), que devuelven `jsonb`. Errores con `RAISE` y el código como mensaje, como en 021:
       - `cancel_session(uuid, text)`: `{ retroactive, cancelled_bookings, notified }`. Errores: `session_not_found`, `session_cancelled` y `note_required`.
       - `restore_session(uuid)`: `{ notified }`. Errores: `session_not_found`, `session_not_cancelled`, `session_started`, `class_retired` y `discipline_inactive`.
       - `reset_session(uuid, text[])`: `{ sessions_changed, notified, promoted }`, con `apply_session_change`. Errores: `session_not_found`, `loose_session`, `session_not_adjustable`, `slot_passed`, `invalid_field` (campo desconocido) y `capacity_below_bookings` con `DETAIL`.
       - `retire_class(uuid, date)`: `{ cancelled_sessions, notified }`. Errores: `class_not_found`, `invalid_date`, `already_retired` y `before_start`.
     - `DROP FUNCTION cancel_session_bookings`. `REVOKE UPDATE ON class_sessions FROM app_user` y `DROP POLICY class_sessions_update_admin`.
     - Con su `down` (probado up → down → up): recrea la `cancel_session_bookings` de 010, la política y el `GRANT UPDATE`, y borra columnas y funciones.
  2. **`services/sessions.js`**:
     - `generateSessions`: los `class_*` en el `INSERT`, con los valores de la clase;
     - `createSession(client, { body, actorId })`;
     - `cancelSession(client, { id, body })`: `note` string recortada, ≤ 500;
     - `restoreSession(client, { id })`;
     - `resetSession(client, { id, body })`: `fields` array no vacío, sin repetir, de los cinco campos.

     Llaman a las funciones por `callChange`, con `CHANGE_ERRORS` ampliado (`note_required`/`invalid_field`/`invalid_date` → 400; `session_cancelled`, `session_not_cancelled`, `session_started`, `class_retired`, `discipline_inactive`, `loose_session`, `slot_passed`, `already_retired` → 409; `before_start` → 400). Cada una devuelve `{ session, … }` con `SESSION_SELECT`, que gana `cancelled_at`, `cancelled_by` y `cancel_note`.
  3. **`services/classes.js`**: `retireClass` valida `date` (formato, desde hoy, como mucho hoy + horizonte) y llama a `retire_class`. Sin el `UPDATE` ni la llamada a `cancel_session_bookings`.
  4. **`services/catalog.js`**: `updateDiscipline`, al pasar `is_active` de `true` a `false`:
     - `retire_class` por cada clase con `ends_on IS NULL OR ends_on >= hoy`, en orden de id;
     - `cancel_session` por cada suelta que no ha empezado, en orden de id.

     Devuelve los recuentos.
  5. **`services/notices.js`**: `SERVICE['notice.session_restored']` (textos de arriba).
  6. **Rutas** (`routes/admin/sessions.js`; body vacío o con campos de más: los desconocidos se ignoran, como en el resto de la API):
     - `POST /admin/sessions` `{ discipline_id, trainer_id, starts_at, duration_min, capacity, location? }` → 201 `{ session }`;
     - `POST /admin/sessions/:id/cancel` `{ note? }` → `{ session, retroactive, cancelled_bookings, notified }`;
     - `POST /admin/sessions/:id/restore` → `{ session, notified }`;
     - `POST /admin/sessions/:id/reset` `{ fields }` → `{ session, sessions_changed, notified, promoted }`.

     `POST /admin/classes/:id/retire` y `PATCH /admin/disciplines/:id` no cambian de forma (este gana los recuentos al desactivar).
  7. **Docs**: `contexto-proyecto.md` §6 (columnas, funciones de `022`, `cancel_session_bookings` retirada, `UPDATE` revocado) y rutas nuevas.
- **Tests** (`test:session-cancel`, nuevo):
  - **Suelta**: creación con `class_id`/`slot` NULL; disciplina inactiva, profesor sin rol, inicio pasado o más allá del horizonte → 400; solape del profesor → 409; se ajusta, se cancela y se recupera; deshacer un ajuste → 409 `loose_session`; `generateSessions` no la toca.
  - **Cancelar**: reservas y esperas anuladas con `session_cancelled`; un aviso por alumno, a los tutores de un hijo, sin el admin; `note` opcional y nunca en el texto del aviso; `cancelled_at/_by/note`; ya cancelada → 409; tras cancelar, `book_session` → `session_not_bookable`; libera el `EXCLUDE` del profesor.
  - **Retroactiva**: sesión en curso y sesión pasada con la lista cerrada (presentes y faltas): sin nota → 400; con nota, asistencias borradas, `attendance_closed_at` NULL, instantánea en `session.cancel`, sin avisos ni entregas; `student_progress` pierde las horas, la racha y el badge que daba esa sesión; la semana sin otra sesión celebrada pasa a saltarse; `monthly_ranking` baja; no se recupera (409 `session_started`).
  - **Recuperar**: vuelve a `scheduled` sin reservas; aviso `session_restored` solo a las anuladas por esa cancelación (no a quien canceló antes por su cuenta, ni a las de una cancelación anterior de la misma sesión); valores escritos por un cambio de clase mientras estaba cancelada; `class_retired`, `discipline_inactive`, `session_not_cancelled` y `session_started` → 409; profesor con otra sesión a esa hora → 409 `trainer_overlap`.
  - **Valores de clase**: la generación los rellena; un cambio de clase los escribe también en los campos ajustados y en las canceladas, pero no en las empezadas; una suelta los tiene NULL; el `CHECK` rechaza una sesión de clase sin ellos.
  - **Deshacer un ajuste**: cada campo vuelve a la clase y sale de `adjusted_fields`; tras un cambio de aforo desde una fecha futura, una sesión ajustada anterior a esa fecha vuelve al aforo de sus vecinas y no al nuevo; un cambio de clase posterior ya lo pisa; `starts_at` vuelve a `slot`; `slot` pasado → 409; profesor o hora distintos → `session_changed` y exención de tardía; aforo menor que las confirmadas → 409 sin cambios; aforo mayor → promoción; campo no ajustado → `sessions_changed: 0`; campo desconocido o `fields` vacío → 400; sesión cancelada o empezada → 409.
  - **Retirar**: `date` pasada → 400; retirar hoy con la sesión de hoy empezada la conserva (con su asistencia); las demás desde `date`, canceladas con aviso.
  - **Desactivar una disciplina**: retira sus clases (también una que aún no ha empezado), cancela sus sueltas futuras, conserva la de hoy ya empezada, avisos agrupados por alumno; volver a activarla no recupera nada.
  - **Concurrencia** (dos conexiones y `pg_locks`, como `test:session-changes`): `cancel_session` y `book_session` a la vez, sin reserva confirmada en una sesión cancelada; `restore_session` y `retire_class` de su clase a la vez, sin una sesión programada después del `ends_on`; `reset_session` y `change_class` a la vez, sin interbloqueo y con el valor correcto en los dos órdenes.
  - **Permisos**: alumno, tutor y profesor → `42501` en SQL y 403 por HTTP (express en memoria); 401 sin sesión; `cancel_session_row` sin `EXECUTE` para `app_user`; `cancel_session_bookings` ya no existe; `UPDATE class_sessions` como admin `app_user` → `permission denied`.
  - **Regresión**: `test:attendance` (su caso de cancelación retroactiva pasa a `cancel_session`), `test:bookings` (retirar una clase), `test:classes`, `test:session-changes`, `test:calendar`, `test:checkin`, `test:push`, `test:notices`, `test:progress`, `test:catalog`, `test:billing` y `test:rls`. Los fixtures de § Choques: los que hacen `UPDATE class_sessions` como `app_user` pasan a `servicePool` o a las funciones; los que cancelan, con `cancelled_at`; los que insertan sesiones de clase, con los `class_*`. Antes de cerrar, `grep` de `UPDATE class_sessions` y de `INSERT INTO class_sessions` en `scripts/` por si hay más. `npm run lint` sin errores.
  - **Manual**: con `PUSH_TRANSPORT=log`, cancelar y recuperar una sesión con una reserva y ver los dos payloads en `storage/push.log`.
- **Fuera de alcance**:
  - recuperar una sesión de una clase retirada, o deshacer la retirada de una clase (se crea una suelta o una clase nueva);
  - recuperar una cancelación retroactiva;
  - el recálculo de agregados de B16 tras una cancelación retroactiva de un mes ya agregado (**B16** lo tendrá en cuenta);
  - aviso al profesor que pierde o recupera una sesión (el profesor no recibe avisos);
  - UI del admin (B19).
- **Implementación** (migración `022`, 2026-10-31):
  - **Desviaciones del diseño, decididas al implementar (2026-10-31)**:
    - **Errores de validación en SQL → 400 `invalid_field`** con `{ field }`: `note_required` (`note`), `invalid_date` y `before_start` (`date`) y el `invalid_field` de `reset_session` (`fields`). Las Reglas ya decían 400 `invalid_field` para el motivo, y `retireClass` ya respondía así a la fecha anterior al inicio: la API no cambia. `CHANGE_ERRORS` gana un código y unos `details` opcionales para traducirlos.
    - **El tope del horizonte de `retire_class` lo pone solo `retireClass` (JS)**; en SQL, `invalid_date` es solo la fecha pasada. Desactivar una disciplina retira desde `greatest(hoy, starts_on)`, que puede caer más allá del horizonte en una clase que empieza lejos.
    - **Desactivar una disciplina retira las clases con `ends_on IS NULL OR ends_on >= greatest(hoy, starts_on)`**, no `>= hoy`: una clase ya retirada antes de empezar (`ends_on = starts_on − 1`, en el futuro) pasaría el filtro y daría `already_retired`.
    - **La respuesta de `PATCH /admin/disciplines/:id` lleva los recuentos dentro de `discipline`** (`{ discipline: { …, retired_classes, cancelled_sessions } }`), como `retire` los lleva dentro de `class`. `cancelled_sessions` son todas las sesiones canceladas: las de sus clases más las sueltas.
    - **`session.reset.fields` guarda los campos que de verdad se deshicieron** (los que estaban ajustados), no los pedidos.
    - **`sessions_changed` de un cambio de clase cuenta también las sesiones en las que solo cambian los `class_*`** (un campo ajustado): consecuencia de incluirlos en la comprobación de «sin cambios» de `apply_session_change`, como pide el diseño.
  - **`022`**:
    - Columnas, backfills (como `service_role`) y `CHECK` como en el diseño. El límite de 500 de `cancel_note` va en el mismo `CHECK` que `cancelled_at` (`class_sessions_cancel_check`); el de los `class_*` es `class_sessions_class_values_check`.
    - `change_class` y `apply_session_change` se recrean desde plantillas con y sin los `class_*`, como `cancel_booking` en 021; el `down` vuelve a las de 021 y recrea `cancel_session_bookings` de 010 con su `EXECUTE`, la política y el `GRANT UPDATE`.
    - `cancel_session_row` hace la instantánea (`present`/`absent` con los ids de los alumnos, ordenados), borra la lista, cancela la sesión y sus reservas, y avisa solo si `starts_at > now()`. `retire_class` bloquea todas sus sesiones por id antes de cancelar ninguna, como `change_class`. `restore_session` lee la sesión sin bloqueo, bloquea la disciplina y la clase (`FOR SHARE`) y la relee `FOR UPDATE`.
    - Con su `down` (probado up → down → up).
  - **Servicios**: `createSession` hace el `INSERT` por `callChange` (el `23P01` → 409 `trainer_overlap`) y audita `session.create` con `audit()`. `cancelSession` recorta `note` (vacía → sin motivo); más de 500 → 400. `retireClass` ya no recibe `actorId` (la auditoría `class.retire` va en SQL). `SESSION_SELECT` gana `cancelled_at`, `cancelled_by` y `cancel_note`. `notice.session_restored` compone siempre una sola sesión: se recupera una por transacción y un alumno tiene una sola reserva activa por sesión.
  - **Tests** (`test:session-cancel`, 17 casos): los de la lista de arriba, y además dos cancelaciones a la vez (la segunda espera y recibe `session_cancelled`, una sola auditada) y un deshacer a mitad de un cambio de clase (la clase ya bloqueada por otra transacción). Comprobado a mano que los tests de concurrencia detectan los fallos:
    - `restore_session` sin `FOR SHARE` en la clase: el test con `retire_class` falla (la recuperación no espera);
    - `cancel_session` sin `FOR UPDATE`: falla el de dos cancelaciones a la vez. El de `book_session` no lo detecta: el `UPDATE` de la sesión ya serializa contra la reserva;
    - `reset_session` bloqueando sesión → clase (orden invertido): el test a mitad del cambio de clase falla con `40P01` (`booking_conflict_retry`).
  - **Regresión** (fixtures de § Choques):
    - `test:classes`: los `UPDATE class_sessions` de profesor y alumno esperan `permission denied`; el `already_retired`, que ahora es un error de SQL, va en un savepoint.
    - `test:attendance`: la retroactiva pasa a `cancel_session`; el plazo de corrección usa una sesión con la lista cerrada hace 49 h desde el fixture (`servicePool`), porque `app_user` ya no hace `UPDATE` y un `UPDATE` de `servicePool` esperaría al bloqueo de la transacción abierta del test.
    - `cancelled_at` en los que cancelan (`test-progress`, `test-session-changes`) y en los helpers que insertan canceladas (`test-calendar`, `test-bookings`, `test-attendance`); los `class_*` en los que insertan sesiones de clase (`test-session-changes`, `test-calendar`, `test-profiles`).
    - `grep` final de `UPDATE class_sessions` e `INSERT INTO class_sessions` en `scripts/`: los `UPDATE` que quedan van por `servicePool` o esperan `permission denied`; todo `INSERT` de una sesión de clase lleva los `class_*`.
  - **Regresión verde**:
    - las de § Tests: `test:session-cancel` 17, `test:attendance` 12, `test:bookings` 18, `test:classes` 12, `test:session-changes` 22, `test:calendar` 15, `test:checkin` 8, `test:push` 9, `test:notices` 9, `test:progress` 20, `test:catalog` 10, `test:billing` 38 y `test:rls` 22;
    - además: `test:profiles` 25, `test:agreements` 7, `test:minors` 14, `test:mfa` 13 y `test:webhook` 35 (Stripe sandbox).

    `npm run lint` sin errores.
  - **Prueba manual** (`PUSH_TRANSPORT=log`, API real con `node src/index.js`): alumna con dispositivo de push y una reserva en una sesión suelta. `POST /admin/sessions/:id/cancel` con un JWT de admin respondió `notified: 1`, `cancelled_bookings: 1`; el worker escribió en `storage/push.log` `{ title: 'Sesión cancelada', body: 'BJJ Fundamentos B61, lun, 2 nov, 20:00 (Lucía Manual): la academia ha cancelado la sesión', url: …/bookings, tag }`. `POST /admin/sessions/:id/restore` respondió `notified: 1` y el worker escribió `{ title: 'Sesión recuperada', body: 'BJJ Fundamentos B61, lun, 2 nov, 20:00 (Lucía Manual): la academia ha recuperado la sesión. Si quieres ir, vuelve a reservar', … }`. Las dos entregas, `push` `sent`.
  - **Riesgos cerrados tras la primera implementación** (2026-10-31), con su test (`test:session-cancel`, ahora 18 casos), comprobado que falla con el código anterior:
    - **`updateDiscipline` con `callChange`**: llamaba a `retire_class` y `cancel_session` con `client.query` para no importar `services/sessions.js`, que importa `catalog.js`. El ciclo de imports no rompe: `callChange` solo se usa al llamar. Si otra transacción retira la clase o cancela la suelta entre la lista y la llamada, ahora sale su 409 (`already_retired`, `session_cancelled`) en vez de un 500; nada se aplica, como antes.
    - **`createClass` lee la disciplina `FOR SHARE`**, como `createSession`: una clase creada mientras se desactiva su disciplina espera y da 400 `invalid_field`. Antes se creaba con la disciplina ya inactiva y se escapaba de la retirada.
- **Checklist de cierre**:
  - [x] Migración `022`: columnas del motivo y `class_*`, `change_class` y `apply_session_change` recreadas, `cancel_session_row`, `cancel_session`, `restore_session`, `reset_session` y `retire_class`; `cancel_session_bookings` retirada y `UPDATE` revocado; `down` probado.
  - [x] Sesión suelta con sus validaciones.
  - [x] Cancelar una sesión con aviso; cancelación retroactiva con motivo, sin aviso y con la instantánea de la asistencia.
  - [x] Recuperar una sesión con aviso `session_restored`; 409 por clase retirada, disciplina inactiva y solape.
  - [x] Valores de clase por sesión (`class_*`) escritos por la generación y el cambio de clase.
  - [x] Deshacer un ajuste por campo, a lo que dice su clase para esa sesión, con aviso, exención y aforo como en B7.1.
  - [x] Retirar una clase sin tocar el pasado; desactivar una disciplina retira sus clases y cancela sus sueltas.
  - [x] Orden de bloqueos disciplina → clase → sesiones → alumnos.
  - [x] Tests (`test:session-cancel` y regresión) y prueba manual con `PUSH_TRANSPORT=log`.

### B8 — Asistencia manual (`register_attendance`, auditoría) — CERRADO
- **Estado** (verificado el 2026-10-30: commit en el historial y tests verdes: `4703047`, `test:attendance` 12 OK).
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

### B9 — QR dinámico (`device_tokens`, SSE, check-in) — CERRADO
- **Objetivo**: tablet fija con `device_token`, QR rotativo de prueba de presencia, check-in desde el móvil. Vocabulario en CONTEXT.md §Asistencia (check-in, reserva candidata, ventana, QR, tablet).
- **Cuenta familiar (decidido)**: el tutor hace check-in de sus hijos con su móvil; respaldo manual del profesor (CONTEXT.md §Asistencia).
- **Decidido (2026-10-28)**: el QR no lleva `session_id`; la sesión se deduce de las reservas candidatas (una → se marca; varias → se elige; ninguna → rechazo, nunca crea reserva). Se aceptan el QR actual y el anterior. Ventana −30/+10 min ajustable por el admin. La tablet muestra QR + sesiones abiertas, sin nombres. El check-in de un hijo queda con `recorded_by` = tutor; la lista del profesor muestra el método.
- **Entregable**: tabla `device_tokens` (hash), vinculación con código de un solo uso y revocación (admin), endpoints `/tablet/*` (sin prefijo `/api`, como el resto de `src/index.js`), SSE `/tablet/active-sessions`, rotación de QR, endpoint de check-in del alumno/tutor.
- **Nota**: `mark_attendance` (`migrations/010_attendance.js`) rechaza marcar antes de `starts_at`; el check-in necesita su propia función, con la ventana en lugar de `starts_at`.
- **Implementación** (migración `011`): `device_tokens` guarda sha256 del token y del código de vinculación (15 min, un solo uso); `app_user` sin acceso a las columnas de hash; RLS solo admin. El QR no se guarda: `HMAC(clave derivada de JWT_SECRET, floor(now/N))` en `src/services/checkin.js`, valen el tramo actual y el anterior. Funciones `SECURITY DEFINER` (owner `service_role`): `link_tablet`, `tablet_feed`, `checkin_qr_seconds` (la tablet llama sin contexto RLS por `appPool`), `check_in(booking?)` y la interna `checkin_window_open`. `academy_settings`: `checkin_opens_minutes` = 30, `checkin_closes_minutes` = 10, `checkin_qr_seconds` = 30. `check_in` bloquea la sesión `FOR UPDATE` como `close_attendance`. La lista del profesor devuelve `method`. Endpoints: `POST/GET /admin/tablets`, `POST /admin/tablets/:id/revoke`, `PUT /admin/settings/checkin`, `POST /tablet/link`, `GET /tablet/active-sessions` (SSE, `Authorization: Device <token>`), `POST /checkin { code, booking_id? }`.
- **Pendiente**: rate limit en `/tablet/link` (→ B20); auditar vincular/revocar (→ B20); check-in de varios hijos en una petición (→ `MEJORAS.md` 6.2).
- **Fuera de alcance**: MFA de tablet (futuro).
- **Checklist de cierre**:
  - [x] `device_tokens` con hash y RLS.
  - [x] Admin vincula (código de un solo uso) y revoca tablets.
  - [x] Tablet autentica con `device_token`.
  - [x] QR rota cada N segundos (actual + anterior válidos), sin `session_id`.
  - [x] Ventana de check-in ajustable por el admin.
  - [x] Check-in: candidatas propias y de hijos; rechazo sin candidatas.
  - [x] Tests (`npm run test:checkin`) y smoke del SSE con `curl -N`.

### B10 — Stripe base (checkout, portal, webhook idempotente) — CERRADO
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
- **Pendiente**: «solo tarjeta» en el Dashboard (el sandbox ofrece `link` y `satispay`) y clave restringida `rk_` propia (→ B10.7); la migración de suscriptores al cambiar de precio es secuencial en la petición (`shortcut:` aceptado en el código); un plan que pasa de 0 € a precio crea otro Product (→ `MEJORAS.md` 6.3); `past_due` → `unpaid` y el pool del webhook (→ B20).
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

### B10.1 — Recibos (`invoices`) + webhook `invoice.payment_failed` — CERRADO
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

### B10.2 — Endpoint admin morosos y "en gracia" — CERRADO
- **Objetivo**: lista para el panel admin, agrupada por pagador.
- **Entregable**: endpoint solo admin con dos listas: **morosos** (pagadores con alguna suscripción o seguro `unpaid`) y **en gracia** (`past_due`, no morosos).
- **Fuera de alcance**: UI (B19), emails (B10.6).
- **Implementación** (sin migración): `listOverduePayers` en `services/billing.js`, solo lectura sobre `subscriptions`, `insurances` e `invoices` (sin llamar a Stripe). `GET /admin/billing/delinquents` y `GET /admin/billing/grace` (`src/routes/admin/billing.js`), `?limit` (25, máx. 100) y `?offset`; error 400 `invalid_pagination`. Respuesta `{ payers, total, limit, offset }`; cada pagador trae `items` (suscripciones y seguros `past_due`/`unpaid`: alumno, plan o tramo, estado, fin de periodo) e `invoices` (recibos `open`: importe, intentos, siguiente reintento, último error, `hosted_invoice_url`). Orden: recibo pendiente más antiguo, luego `payer_id`. Un moroso muestra también lo que tenga en gracia.
- **Checklist de cierre**:
  - [x] Endpoint devuelve las dos listas paginadas, agrupadas por pagador.
  - [x] Solo admin (`requireRole('admin')` del router; la RLS además no da nada al resto).
  - [x] Tests (`npm run test:billing`).

### B10.3 — Seguro y cobertura de riesgo — CERRADO
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
- **Pendiente**: reactivar el seguro no deshace los `cancel_at_period_end` de la desactivación (→ `MEJORAS.md` 6.4).
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

### B10.5 — Upgrade/downgrade + cambio de disciplina — CERRADO
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
- **Implementación** (migración `014`):
  - **Sondeo del sandbox** (2026-10-29, antes del paso 3):
    - Una subida rechazada no lanza error: Stripe responde 200 con `pending_update` y el recibo `open`; el *void* descarta el pending update.
    - Con 3DS: PI `requires_action` y `confirmation_secret` en el recibo.
    - Con un Schedule adjunto, `cancel_at_period_end` **falla** («update the schedule instead») y `cancel` funciona (cancela también el Schedule).
    - Cambiar el Price directamente parte la fase actual y no toca la pendiente.
    - Un Schedule acepta reenviar una fase con un Price archivado.
    - Stripe no deja actualizar un Schedule si la suscripción tiene un pending update (salió en los tests).
  - **`014`**:
    - `subscriptions.stripe_schedule_id`, `scheduled_plan_id`, `scheduled_discipline_ids` y `scheduled_at` (inicio de la fase 2). Las escribe solo el webhook.
    - Seed `discipline_changes_per_period` = 1.
    - `discipline_change_limit()` y `discipline_changes_used(sub)`: definer, de solo lectura y con permiso para `app_user`. Cuentan los cambios no gratis del periodo en `audit_log`.
    - `change_discipline(sub, from, to, actor)`: interna, la llama el servicio con `servicePool`. Bajo `lock_student` aplica las reglas de estado, elegibilidad, «gratis» y límite (el límite no tiene carreras). Sustituye la disciplina, cancela las reservas y esperas futuras de `from` con `discipline_change` y `notice.discipline_change`, y escribe `audit_log`. Devuelve `{ free, cancelled }`. El 409 del límite lleva `{ limit, used, resets_at }` en `DETAIL`.
  - **Servicio** (`src/services/billing.js`):
    - `validateOrder`, compartido con `createCheckout`.
    - `changePlan`: valida contra local y contra Stripe. Es subida si el plan es más caro, o si es un adulto en un plan solo menores.
      - `applyPlanNow`: libera el Schedule y pide el pending update. Si la tarjeta se rechaza, anula el recibo y responde 402. Si pide 3DS, devuelve el `client_secret` al pagador; al admin le responde 409 y deja `notice.upgrade_requires_action` con el `hosted_invoice_url` (escrito con `servicePool` para que sobreviva al rollback). En el caso del admin, el pending update sigue vivo 23 h.
      - `scheduleDowngrade`: anula un pending update a medias (lo exige Stripe), crea o reutiliza el Schedule y reescribe sus fases (la actual tal cual y la nueva de 1 mes, `release`, `none`).
    - `cancelScheduledChange` (libera el Schedule), `changeDiscipline` (permisos, `change_discipline` y espejo de `discipline_ids` en la metadata de Stripe dentro de la transacción), `getSubscription` y `updateDisciplineChangeSettings`.
    - `pendingPhase(schedule)`: la fase pendiente. Un Schedule puede seguir adjunto ya aplicado.
  - **Adaptado al Schedule**:
    - `cancelSubscription` libera el Schedule antes de pedir la baja y, si había bajada pendiente, deja `notice.scheduled_change_discarded`.
    - `syncPlanToStripe` incluye las suscripciones con bajada programada al plan. Con Schedule adjunto cambia el Price en sus fases vigentes (`swapSchedulePrice`, `none`). Una bajada a un plan retirado se respeta.
  - **Webhook**:
    - `customer.subscription.updated`: si `metadata.plan_id` ≠ plan local, `applyPlan` cambia el plan, sustituye las disciplinas, ejecuta `revoke_coverage`, deja `notice.plan_downgraded` si baja o se queda igual y alinea el Price si cambió entretanto. Siempre ejecuta `syncSchedule`.
    - `subscription_schedule.created/updated/released/canceled/completed` → `onSchedule` (relee la suscripción).
    - `invoice.voided` actualiza el recibo.
    - El recibo de una subida (`billing_reason = subscription_update`) no genera `notice.payment_failed`.
  - **Endpoints**:
    - `GET /billing/subscription`, `POST /billing/subscriptions/:id/plan`, `DELETE /billing/subscriptions/:id/plan/scheduled` y `POST /billing/subscriptions/:id/disciplines`.
    - Las mismas acciones del admin en `/admin/subscriptions/:id/...`, más `PUT /admin/settings/discipline-changes`.
    - El cambio de disciplina sin permiso → 403 `not_allowed`.
  - **Tests**:
    - `test:billing`: validaciones y permisos del cambio de plan; cambio de disciplina (límite, límite 0, gratis, permisos, errores, espejo en Stripe); `getSubscription`.
    - `test:webhook`, contra el sandbox: subida aplicada, rechazada y con 3DS (pagador y admin), bajada que sustituye una subida a medias, bajada (`scheduled_*`, sustituir, anular), subida que libera el Schedule, bajada aplicada (fase simulada), cambio de precio con Schedule, baja admin con Schedule y adulto en un plan solo menores.
    - Regresión: `test:bookings`, `test:minors` y `test:catalog`.
    - Arreglado un choque previo de `test:billing` (el seguro real de B10.3 contra el fixture de B10.2).
  - **Sandbox**: la clave reclamable (`rkcs_test_`) se quedaba sin cupo. `.env` usa ahora la `sk_test_` del sandbox reclamado `kaizen-app-testing` (cuenta propia, no la de maat).
- **E2E** (2026-10-29/30, sandbox `kaizen-app-testing`, `stripe listen --all-snapshot` + Chrome + *test clock*, por HTTP contra `npm run dev`):
  - Subida con tarjeta 3DS: `requires_action` → `handleNextAction` → prorrateo de 15 € cobrado; plan y disciplinas aplicados por el webhook solo tras el pago; la reserva de la disciplina perdida, cancelada «sin cobertura».
  - Subida rechazada: 402 `payment_failed` con `decline_message`, recibo `void`, `pending_update_expired` y nada cambia.
  - Bajada con *test clock* hasta el cambio de fase: renovación al precio nuevo sin reembolso, plan y disciplinas aplicados, reserva hecha con la bajada programada cancelada, `notice.plan_downgraded` y `scheduled_*` vacíos. Una bajada posterior reutiliza el Schedule que sigue adjunto.
  - Cambio de precio del plan destino y del actual con bajada programada: cambian las fases del Schedule y el Price de la suscripción, sin prorrateo. Retirar el plan destino respeta la bajada (Price archivado).
  - Baja admin con bajada programada: Schedule liberado, `cancel_at_period_end` y `notice.scheduled_change_discarded`.
  - Arreglo salido del E2E: el detalle del 402 se llamaba `error` y pisaba la categoría del `errorHandler`, que además no tenía el 402. Ahora es `decline_message` y `errorHandler` tiene `402: 'payment_required'`.
  - Datos del E2E borrados después (base de desarrollo, *test clock* y productos archivados en el sandbox).
- **Pendiente**:
  - Añadir `subscription_schedule.*` e `invoice.voided` al endpoint del Dashboard (→ B10.7). En local, `stripe listen --all-snapshot` (o `--events` con ellos).
  - Las plazas que libera un cambio de disciplina no promocionan la espera (`shortcut:` aceptado, como `revoke_coverage`; B7.1 lo dejó fuera de alcance).
  - Un cambio de precio del plan descarta un pending update a medias de sus suscriptores (Stripe lo anula al cambiar `items`; aceptado).
  - El cambio de plan no pasa por `requireCompleteProfile` (el diseño no lo pide; aceptado).
- **Checklist de cierre**:
  - [x] Subida: prorrateo cobrado y plan y disciplinas aplicados solo tras el pago (3DS y rechazo).
  - [x] Bajada: sin reembolso, aplicada al cambiar de fase; sustituir y anular; reservas no cubiertas canceladas al aplicarse.
  - [x] Adulto en plan solo menores: cambio inmediato con prorrateo.
  - [x] Cambio de disciplina: inmediato, límite por periodo (también 0), gratis si ya no se cubre, cancela con `discipline_change`.
  - [x] Baja admin y cambio de precio conviven con un Schedule.
  - [x] Seguro intacto.
  - [x] Tests y E2E con Stripe CLI.

### B10.6 — Emails transaccionales de billing (al pagador) — CERRADO
- **Objetivo**: entregar por email al pagador los avisos de facturación que ya se crean (`notice.*` en `audit_log`) y los que faltaban (impagada, baja). Términos en `CONTEXT.md` («Avisos»), decisión en ADR 0008.
- **Reglas** (decididas 2026-10-30):
  - **Qué va por email**: 11 avisos de facturación, solo al pagador:
    - `payment_failed`: en cada intento, con el siguiente reintento. **Cambiado en B11**: solo en el primer intento.
    - `checkout_payment_failed`.
    - `checkout_race_refunded`: solo la entrega del pagador.
    - `insurance_not_paid`, `insurance_renewal`, `insurance_wont_renew`.
    - `plan_downgraded`, `upgrade_requires_action`.
    - Nuevos: `subscription_unpaid`, `insurance_unpaid`, `subscription_cancelled`.
  - **Qué no va por email**:
    - Los avisos de reservas (`no_coverage`, `booking_promoted`, `session_cancelled`, `discipline_change`) van por push en B15.
    - Los admins de `recipients` (`stripe_risk` y la parte del admin de la carrera) no reciben entrega: los consultan en el panel (B19). Las disputas las notifica Stripe a la cuenta.
    - El push de los avisos de facturación lo decide B15. **Decidido en B15**: no, solo email.
  - **Avisos nuevos**:
    - `notice.subscription_unpaid` / `notice.insurance_unpaid`: los crea el webhook en la transición a `unpaid` (no en cada evento). Llevan el `hosted_invoice_url` del recibo `open`.
    - `notice.subscription_cancelled`: lo crea `cancelSubscription` (baja admin), con `ends_at` (ahora o `current_period_end`) y, si la había, la bajada descartada (`discarded_plan_id`). **Sustituye** a `notice.scheduled_change_discarded`, que deja de crearse.
  - **Emails de cliente de Stripe** (cobro fallido, 3DS, renovación, recibos): apagados. Kaizen envía los suyos. Son ajustes de toda la cuenta, con la marca de la cuenta, y la de producción es de maat (ver B10.7).
  - **Outbox (ADR 0008)**:
    - `notice()` escribe el aviso en `audit_log` y sus entregas en `notice_deliveries` en **una sola sentencia** (CTE), también con `servicePool` en *autocommit* (`upgrade_requires_action`).
    - Las entregas salen de un mapa acción → canales en JS. Solo para destinatarios que no son admin.
    - `booking_notice` (SQL) no cambia.
  - **Worker** en el proceso (`index.js`), cada ~30 s:
    - Toma las entregas `pending` con `next_attempt_at <= now()` mediante `FOR UPDATE SKIP LOCKED`.
    - Compone el email **al enviar** (`audit_log.changes` + datos actuales). No guarda copia del email.
    - Estados: `pending` → `sent` | `failed` | `skipped`.
  - **Reintentos**:
    - Errores transitorios (red, 429, 5xx): reintento a 1 min, 5 min, 30 min, 2 h y 6 h, y después `failed`.
    - Errores permanentes (4xx): `failed` a la primera.
    - Caducidad: lo que sea antes, 24 h desde el aviso o su `expires_at`. Caducado → `skipped` (`stale`). Sin email → `skipped`.
    - Un `failed` no bloquea nada: queda con `last_error` para el panel (B19).
  - **Idempotencia**:
    - Replays de Stripe: `webhook_events` (el aviso se crea una vez por evento).
    - Duplicados de entrega: `UNIQUE (audit_id, recipient_id, channel)`.
    - Caída entre envío y marca: cabecera `Idempotency-Key` de Resend = id de la entrega (vale 24 h; los reintentos caben).
  - **Proveedor: Resend**:
    - Por `fetch`, sin SDK. `services/email.js` con dos transportes: `resend` y `log` (consola + fichero), por `.env`.
    - Datos en EE. UU. con DPA y SCC (apuntarlo en el registro de actividades). Si la gestoría exige la UE: Brevo, cambiando solo el transporte.
  - **Remitente**:
    - `Kaizen <avisos@mail.<dominio>>` (subdominio dedicado), con `Reply-To` al buzón de la academia.
    - DNS del subdominio: SPF y DKIM (registros de Resend) y DMARC `p=none`, que pasa a `quarantine` con informes limpios.
    - Hasta tener dominio: el remitente de pruebas de Resend. Verificar el dominio es un paso de producción y no bloquea el cierre.
  - **Contenido**:
    - Solo español. Una función por aviso que devuelve `{ subject, text, html }`, con *template literals* y un esqueleto HTML común. Siempre con texto plano.
    - Datos mínimos: nombre del pagador, nombre del alumno, plan o seguro, importe, fechas y enlace. **Nunca** salud, edad, fecha de nacimiento ni tarjeta. `turns_18` se redacta como «cambio de tramo de edad».
    - Destinatario: `auth_credentials.email` (con `servicePool`), aunque `email_verified = false`.
    - Enlaces a `APP_URL` (pantalla de facturación, desde la que se abre el portal). Excepción: `hosted_invoice_url` en `subscription_unpaid`, `insurance_unpaid` y `upgrade_requires_action`.
    - Sin opt-out: son emails de servicio (LSSI art. 21). El pie lo explica y da el contacto de la academia.
  - **Subida del admin con 3DS** (`upgrade_requires_action`):
    - Enlace al `hosted_invoice_url`: la página de Stripe autentica y paga el prorrateo. El webhook aplica el plan como siempre.
    - El aviso guarda `expires_at` = `pending_update.expires_at` y el email muestra la fecha límite.
    - Contenido: plan actual → nuevo, alumno e importe. Sin recordatorio: si no lo completa, no cambia nada.
- **Pasos**:
  1. **Migración `015`**:
     - Tabla `notice_deliveries`: `id uuid`, `audit_id` → `audit_log`, `recipient_id` → `profiles`, `channel` (`CHECK` `email`; B15 añade `push`), `status` (`CHECK` `pending`/`sent`/`failed`/`skipped`), `attempts`, `next_attempt_at`, `sent_at`, `provider_message_id`, `last_error`, `created_at`.
     - `UNIQUE (audit_id, recipient_id, channel)` e índice parcial `(next_attempt_at) WHERE status = 'pending'`.
     - Sin acceso para `app_user` (como `webhook_events`).
  2. **Configuración**: `EMAIL_TRANSPORT` (`log` | `resend`, por defecto `log`), `RESEND_API_KEY` (obligatoria con `resend`), `EMAIL_FROM`, `EMAIL_REPLY_TO`, `EMAIL_LOG_PATH`. Se validan al arrancar.
  3. **`services/email.js`**: `send({ to, subject, text, html, idempotencyKey })` con los dos transportes. Clasifica los errores en transitorio o permanente.
  4. **`services/notices.js`**:
     - Mapa acción → canales.
     - `notice()` se mueve desde `billing.js` y crea en una sentencia el aviso y sus entregas.
     - Plantillas de los 11 avisos.
     - `sendPending(db, transport)`: un lote del worker.
     - `startNoticeWorker()`, llamado desde `index.js` y parado al cerrar.
  5. **Emisores**:
     - Webhook: `subscription_unpaid` en `onSubscriptionChange` e `insurance_unpaid` en `onInsuranceChange`, en la transición a `unpaid`, con el recibo `open`.
     - `cancelSubscription`: `subscription_cancelled` en lugar de `scheduled_change_discarded`.
     - `applyPlanNow`: `expires_at` en `upgrade_requires_action`.
  6. **Stripe**: confirmar en el Dashboard del sandbox que los emails de cliente están apagados.
- **Endpoints**: ninguno. La consulta de entregas fallidas para el panel queda para B19.
- **Tests**:
  - **`npm run test:notices` (nuevo)**, con un transporte falso en memoria:
    - entregas solo para las acciones con email, sin admins y una por destinatario; los avisos de reservas no crean ninguna;
    - destinatario = pagador, nunca el hijo;
    - `sent`; sin duplicados al ejecutar dos veces o con dos workers;
    - reintento con espera creciente; `failed` permanente; `skipped` por 24 h, por `expires_at` y sin email;
    - las 11 plantillas, con su enlace, sin fecha de nacimiento ni edad.
  - **`test:webhook`** (regresión, sandbox):
    - `subscription_unpaid` / `insurance_unpaid` en la transición, con su entrega;
    - la baja admin crea `subscription_cancelled` y no `scheduled_change_discarded`;
    - sin `payment_failed` con el pagador en pantalla.
  - **E2E** con `EMAIL_TRANSPORT=log`: subida del admin con tarjeta 3DS → enlace del fichero → autenticar en la página de Stripe → plan aplicado por el webhook.
  - **Un envío real** con `EMAIL_TRANSPORT=resend` y el remitente de pruebas: clave, `Idempotency-Key` (dos llamadas → un email) y aspecto en Gmail y en el móvil.
- **Fuera de alcance**:
  - push (B15);
  - endpoint y UI de entregas fallidas (B19);
  - rebotes y quejas por webhook de Resend;
  - email de pago correcto, de pago recuperado y de tarjeta a punto de caducar;
  - aviso de baja del seguro (B11);
  - otros idiomas (ver B18);
  - verificación del dominio real (producción).
- **Implementación** (migración `015`):
  - **`015`**: `notice_deliveries` como en el paso 1. `audit_id` y `recipient_id` con `ON DELETE CASCADE` (los scripts de test borran avisos y perfiles; en producción `app_user` no borra ninguno). `REVOKE ALL` a `app_user`.
  - **Configuración** (`src/config/email.js`): falla al arrancar si `EMAIL_TRANSPORT` no es `log` / `resend` o si falta `RESEND_API_KEY` con `resend`. Por defecto `EMAIL_FROM` = `Kaizen <onboarding@resend.dev>` y `EMAIL_LOG_PATH` = `./storage/emails.log` (ignorado por `*.log`).
  - **`services/email.js`**: `send({ to, subject, text, html, idempotencyKey })`.
    - `resend`: `POST /emails` por `fetch` (timeout 15 s), con `Idempotency-Key` y `reply_to` si hay `EMAIL_REPLY_TO`.
    - `log`: consola + fichero.
    - Los errores llevan `transient`: red, 429 y 5xx sí; el resto de 4xx no.
  - **`services/notices.js`**:
    - `CHANNELS`: las 11 acciones → `['email']`; el resto (reservas, `stripe_risk`) sin canal.
    - `notice()`: CTE `INSERT audit_log … RETURNING id` + `INSERT notice_deliveries` por destinatario y canal, sin los que tienen rol `admin`, con `ON CONFLICT DO NOTHING` (destinatarios repetidos).
    - `compose(db, entrega)`: pagador (`auth_credentials.email`), alumno, recibo (importe y plan), fin del seguro y nombres de los planes, leídos al enviar. Sin email → `null`.
    - 11 plantillas: `mail()` común (saludo, párrafos, un botón, pie de servicio LSSI con el contacto de `EMAIL_REPLY_TO`), texto plano y HTML con los datos del usuario escapados. Importes y fechas en `es-ES`, hora de `Europe/Madrid`. `turns_18` → «cambio de tramo de edad». `payment_failed` no lleva el motivo del rechazo (Stripe lo da en inglés).
    - `sendPending(db, transport)`: lote de 20 con `FOR UPDATE OF d SKIP LOCKED` en una transacción. Compone con el pool (un error de SQL no aborta la de los bloqueos). Caducado (`now() > LEAST(created_at + 24 h, expires_at)`) → `skipped` `stale`; sin email → `skipped` `no_email`. Transitorio → `pending` a 1, 5, 30, 120 o 360 min; tras el 6.º intento, o con un error permanente o desconocido, `failed` con `last_error`.
    - `startNoticeWorker()`: cada 30 s, y sigue sin esperar mientras salgan lotes llenos. Devuelve la función que lo para y espera al lote en curso; `index.js` la llama al cerrar, antes de `closePools`.
  - **Emisores**:
    - `notice()` se importa de `notices.js` en `billing.js` y `stripeWebhook.js`.
    - `onSubscriptionChange`: el `UPDATE` devuelve el estado anterior (`FROM (SELECT … FOR UPDATE) was`). Solo en la transición a `unpaid`: `notice.subscription_unpaid` con `plan_id`, `amount_cents` y `hosted_invoice_url` de `latest_invoice`. `onInsuranceChange`, igual con `notice.insurance_unpaid` (`unpaidNotice`).
    - `cancelSubscription`: `notice.subscription_cancelled` en toda baja admin, con `plan_id`, `ends_at` (`cancel_at` o `ended_at` de Stripe) y `discarded_plan_id`. `scheduled_change_discarded` ya no se crea.
    - `applyPlanNow`: `upgrade_requires_action` lleva además `from_plan_id`, `amount_cents` y `expires_at` (`pending_update.expires_at`).
  - **Choque con el diseño** (decidido 2026-10-30): la baja admin y desactivar el seguro (`insuranceWontRenew` desde `updateInsuranceSettings`) corren en la transacción de `app_user`, que no escribe entregas. Esos dos avisos se escriben con `servicePool` en *autocommit*, justo después de la llamada a Stripe, como `upgrade_requires_action`: el aviso va con el efecto en Stripe, que no se deshace.
  - **Stripe**: emails de cliente apagados en el sandbox `kaizen-app-testing`: Subscriptions and emails (3DS y recordatorios, renovaciones, tarjetas a punto de caducar, fin de prueba, recordatorio de recibo impagado), Revenue recovery → Emails (cobro fallido) y Customer emails (pagos correctos y reembolsos).
  - **Tests**:
    - `test:notices` (nuevo), con transporte falso y sin Stripe. Aparca las entregas pendientes ajenas y las restaura. Cubre:
      - entregas por acción, sin admins y sin duplicados;
      - aviso y entrega en una sentencia (rollback);
      - destinatario el tutor pagador y nunca el hijo;
      - `Idempotency-Key` = id de la entrega;
      - dos workers a la vez;
      - reintentos (1/5/30/120/360 min y `failed`), error permanente y desconocido;
      - `skipped` por 24 h, por `expires_at` y sin email;
      - las 11 plantillas (enlace, escapado, sin fecha de nacimiento, edad ni «de el» / «a el»).
    - `test:webhook`: `subscription_unpaid` / `insurance_unpaid` solo en la transición, con su entrega; baja admin → `subscription_cancelled` (fin de periodo y ahora), sin `scheduled_change_discarded`; `expires_at`, importe y entrega en `upgrade_requires_action`. Sigue sin `payment_failed` con el pagador en pantalla. El paso a `unpaid` se simula al releer la suscripción (como la fase de B10.5).
    - Regresión: `test:billing`, `test:bookings` y `test:minors`.
    - Con `npm run dev` y `stripe listen` en marcha, los eventos reales del sandbox se cruzan con las simulaciones y el worker se lleva entregas del test: los tests se pasan con la API parada.
- **E2E** (2026-10-30, sandbox `kaizen-app-testing`, `stripe listen --all-snapshot` + Chrome):
  - **Subida del admin con 3DS**: `409 requires_payer_action` → el worker de `npm run dev` deja el email en `storage/emails.log` al primer intento, con el enlace, la fecha límite y 15,00 € → pago con 3DS en la página del recibo → el webhook aplica el plan (318 → 319). En Stripe, el recibo `subscription_update` queda `paid` y el `pending_update` desaparece.
  - **Arreglo salido del E2E**: las plantillas decían «de el plan» / «a el plan». Ahora dicen «del» / «al», y `test:notices` lo comprueba.
  - **Envío real con Resend** (remitente de pruebas a la cuenta propia): dos llamadas con la misma `Idempotency-Key` → el mismo id y un solo email. La misma clave con otro contenido → 409, que se trata como permanente. Aspecto correcto en Gmail y en el móvil.
  - Datos del E2E borrados después (base de desarrollo, suscripción y cliente del sandbox, planes archivados).
- **Pendiente**:
  - **Producción** (→ B10.7): verificar el dominio en Resend (SPF, DKIM, DMARC `p=none` → `quarantine`), `EMAIL_FROM` = `Kaizen <avisos@mail.<dominio>>`, `EMAIL_REPLY_TO` y apuntar Resend (EE. UU., DPA y SCC) en el registro de actividades. Apagar los mismos emails de cliente en la cuenta de producción.
  - Si se cae el proceso entre el envío y la marca y el email recompuesto cambia (por ejemplo, el nombre del plan), el reintento recibe un 409 de Resend y la entrega queda `failed`, aunque el email salió (→ `MEJORAS.md` 6.6).
  - Un aviso emitido con `servicePool` en *autocommit* (baja admin, desactivar el seguro, `upgrade_requires_action`) se queda aunque la ruta haga rollback después (→ B20).
  - El worker mantiene la transacción abierta mientras envía el lote (hasta 20 × 15 s en el peor caso) (→ B20).
- **Checklist de cierre**:
  - [x] Migración `015` (`notice_deliveries`, sin acceso para `app_user`).
  - [x] `notice()` crea aviso y entregas en una sentencia; mapa acción → canales; sin admins.
  - [x] Avisos nuevos `subscription_unpaid`, `insurance_unpaid` y `subscription_cancelled`; `scheduled_change_discarded` retirado.
  - [x] Worker con `SKIP LOCKED`, reintentos, caducidad (24 h / `expires_at`) e `Idempotency-Key`.
  - [x] 11 plantillas en español con datos mínimos.
  - [x] Proveedor configurado en `.env` (`log` por defecto, `resend` probado una vez).
  - [x] Emails de cliente de Stripe apagados en el sandbox.
  - [x] Tests (`test:notices`, regresión de `test:webhook`) y E2E del 3DS del admin desde el enlace.

### B10.7 — Migración de los clientes de maat — Pendiente (al pasar a producción)
- **Contexto**: la cuenta de Stripe de producción hoy la usa maat, con clientes pagando. Hasta el paso a producción Kaizen trabaja solo con el sandbox; la cuenta real no se conecta antes.
- **Objetivo**: que las suscripciones vivas de maat pasen a Kaizen sin que nadie vuelva a pagar ni a meter la tarjeta (clientes, tarjetas y aniversarios ya están en la cuenta).
- **Ya hecho** (2026-10-29): convivencia en la misma cuenta. El webhook ignora los Checkouts sin el pedido de Kaizen en `metadata` y los estados sin mapear (`trialing`, `paused`) de suscripciones que no son de Kaizen (test en `test-webhook.js`).
- **Entregable**:
  - Inventario de la cuenta real: número de suscripciones, Prices usados, trials/pausas, Stripe Tax, métodos de pago, configuración del portal, cómo se identifica a cada persona (email) y si maat es una plataforma Connect.
  - Script de importación idempotente: cliente → perfil pagador (`profiles.stripe_customer_id`), alumno y menores, Price de maat → plan de Kaizen (`subscriptions.update` al Price del plan con `proration_behavior: 'none'`), disciplinas (CSV o exportación de maat), fila en `subscriptions` + `subscription_disciplines`, recibos con `syncInvoice`.
  - *Upcoming renewal events* (aviso del seguro, B10.3) es un ajuste de toda la cuenta: acordar con maat los 30 días.
  - Emails de cliente de Stripe que tenga activos maat (cobro fallido, 3DS, renovación, recibos): son de toda la cuenta y se solapan con los de Kaizen (B10.6); acordar con maat antes del corte.
  - Descriptor: `STRIPE_STATEMENT_DESCRIPTOR` en el `.env` de producción y `npm run sync-stripe-plans` tras importar los planes, para que los Products de Kaizen lo lleven. Confirmar que «KAI ZEN TRAINING CAMP» es el nombre comercial con el que se conoce la academia (lo exigen las redes de tarjetas).
  - *Revenue recovery → Retries* de la cuenta: Kaizen necesita «mark the subscription as unpaid» al agotar los reintentos (en el sandbox estaba en cancelar; ver E2E de B11). Es un ajuste de toda la cuenta: si maat cancela, acordarlo antes del corte.
  - Endpoint de webhook propio de Kaizen con API `2026-09-30.endive` (sin cambiar la versión por defecto de la cuenta), clave `rk_live_` restringida y configuración de portal propia.
  - Plan de corte: cuándo deja maat de vender y de recibir webhooks.
  - Reasignado al cerrar B10–B11 (2026-10-31): «solo tarjeta» en el Dashboard y clave `rk_` restringida propia (B10); `subscription_schedule.*` e `invoice.voided` en el endpoint del Dashboard (B10.5); dominio de Resend (SPF, DKIM, DMARC), `EMAIL_FROM`, `EMAIL_REPLY_TO`, Resend en el registro de actividades y emails de cliente apagados en producción (B10.6); *Retries* en «mark as unpaid», para que un seguro nunca se cancele sin aviso (B11).
- **Fuera de alcance**: cuentas de Stripe distintas (las tarjetas no se mueven sin el soporte de Stripe).
- **Checklist de cierre**:
  - [ ] Inventario revisado con el admin.
  - [ ] Importación probada en un sandbox con datos copiados.
  - [ ] Base legal del traspaso de datos confirmada (gestoría).
  - [ ] Importación en producción y conteo cuadrado con Stripe.

### B11 — Baja del seguro y cambio de pagador — CERRADO
- **Objetivo**: baja del seguro por el admin (a fin de año o inmediata) y **cambio de pagador**. Además, arreglar que la baja inmediata de una suscripción deje su recibo pendiente cobrándose. Términos en `CONTEXT.md` («Suscripción», «Seguro y cobertura de riesgo»), decisión en ADR 0009.
- **Ya hecho en B10** (2026-10-29): `POST /admin/subscriptions/:id/cancel-now` y `/cancel-at-period-end` (`cancelSubscription`). Se pide la baja a Stripe y el estado local llega por el webhook. `audit_log` `subscription.cancel_now` / `subscription.cancel_at_period_end`.
- **Sondeo del sandbox** (2026-10-30, `kaizen-app-testing`, *test clock*):
  - Checkout `subscription_data.trial_end`: tiene que estar al menos 48 h en el futuro. Checkout lo anuncia como prueba y la suscripción nace `trialing` (sin mapear). Descartado.
  - Checkout `subscription_data.billing_cycle_anchor` + `proration_behavior: none`: se acepta desde 1 h en el futuro hasta la próxima fecha natural de cobro (a 40 días: «cannot be later than next natural billing date»). `amount_total` = 0. La suscripción nace **`active`**, sin cobro, y en el anchor cobra el mes completo (`subscription_cycle`). Tarjeta rechazada en el anchor → `past_due`.
  - Schedule con `start_date` futuro: `not_started` y sin suscripción hasta la fecha. Entonces la crea y cobra (`subscription_create`); si falla, `past_due`.
  - Caducidad del Checkout: como mucho 24 h (con 25 h, error).
  - **Al cancelar una suscripción con un recibo `open`, el recibo sigue `open`, con `auto_advance: true` y `next_payment_attempt`**: Stripe lo seguiría cobrando. Por eso hay que anularlo.
- **Reglas** (decididas 2026-10-30):
  - **Baja del seguro** (solo el admin):
    - Dos modos, como la suscripción: `cancel-at-period-end` (sigue en vigor hasta el final de su año y no renueva) y `cancel-now`.
    - Sin reembolso, nunca. `cancel` sin `prorate` ni `invoice_now`: con `prorate` Stripe deja saldo a favor en el cliente, que comparte con la cuota (ADR 0006), y se comería las cuotas siguientes. Si la academia devuelve algo, lo hace a mano en el Dashboard (`charge.refunded` deja `notice.stripe_risk` para el panel; el recibo local no cambia).
    - `cancel-now` anula (*void*) los recibos `open` del seguro: el pagador deja de ser moroso por él.
    - No exige `waiver`. Sin cobertura de riesgo, el alumno no reserva pero conserva lo reservado (CONTEXT § Pérdida de cobertura de riesgo). La respuesta devuelve `risk_cover` para que el panel avise.
    - Estados (Stripe manda: se relee antes de decidir):

      | Seguro | `cancel-at-period-end` | `cancel-now` |
      |---|---|---|
      | `active` / `past_due` / `unpaid`, renovando | sí | sí (+ *void* de los `open`) |
      | ya no renueva (`cancel_at_period_end`, por cualquier motivo) | 409 `insurance_cancel_scheduled` | sí |
      | `incomplete` | 409 `insurance_not_live` | 409 `insurance_not_live` |
      | `cancelled` | 409 `insurance_cancelled` | 409 `insurance_cancelled` |
      | no existe | 404 `insurance_not_found` | 404 `insurance_not_found` |

    - Aviso nuevo `notice.insurance_cancelled` (email) con `ends_at` y `voided` si anuló recibos. Va al pagador del seguro y, si es otro, al pagador actual de la suscripción, como `onUpcoming`. Se escribe con `servicePool` tras la llamada a Stripe, como `subscription_cancelled`.
    - `audit_log`: `insurance.cancel_now` / `insurance.cancel_at_period_end`.
  - **Baja inmediata de la suscripción** (arreglo): `cancelSubscription` con `cancel-now` anula también los recibos `open` de la suscripción, y `subscription_cancelled` lo dice (`voided`). A fin de periodo no cambia nada.
  - **La baja sigue siendo solo del admin**. La revisión legal de abrir la baja a fin de periodo al pagador sigue en `MEJORAS.md`; si la gestoría dice que aplica, irá a un bloque propio.
  - **Cambio de pagador** (ADR 0009):
    - **Encadenado**: la sucesora sale de un Checkout en modo suscripción con `subscription_data.billing_cycle_anchor` = **D** (fin de periodo de la antigua) y `proration_behavior: none`. El nuevo pagador paga 0 € hoy y X €/mes desde D. Al completarlo, la antigua recibe `cancel_at_period_end`.
    - **Cambio de pagador pendiente** (tabla `payer_changes`): suscripción antigua, nuevo pagador, plan y disciplinas de la sucesora, D, fecha límite, estado y, cuando se paga, `stripe_subscription_id` de la sucesora. Estados: `requested` → `paid` → `completed`, o `expired` / `cancelled`. Como mucho uno pendiente (`requested` / `paid`) por suscripción.
    - **Traspaso** (en D): la fila local de la sucesora nace aquí, no en el Checkout. Lo dispara el primer evento que llegue: `customer.subscription.deleted` / `updated` de la antigua, o `updated` / `invoice.paid` de la sucesora. Bajo `lock_student`:
      1. relee la antigua en Stripe; si aún no está `canceled`, no hace nada;
      2. marca la antigua `cancelled` en local;
      3. inserta la sucesora (pagador nuevo, plan y disciplinas de `payer_changes`), alinea su Price con el vigente del plan sin prorrateo (como `onCheckoutPaid`) y sincroniza su recibo;
      4. `payer_changes` → `completed`;
      5. **después**, `revoke_coverage` y la regla del seguro (que ya ven la sucesora): no se cancela ninguna reserva.

      Es idempotente. El índice `subscriptions_one_live_idx` no cambia y `lostRace` no se dispara (la fila de la sucesora no se inserta en el Checkout). El recibo de 0 € del Checkout no se guarda (`syncInvoice` lo ignora porque no tiene dueño).
    - **Quién**: lo pide solo el admin. El nuevo pagador es un tutor vinculado del alumno o el propio alumno adulto. Un adulto se paga a sí mismo, y el nuevo pagador no puede ser menor ni el pagador actual.
    - **Al pedirlo**: la antigua `active` y sin `cancel_at_period_end`, en local y en Stripe; sin pending update (409 `upgrade_pending`). Si quedan menos de 2 h para D → 409 `period_ending_soon`: se vuelve a pedir tras la renovación. **Fecha límite** = D − 1 h.
    - **Bajada programada**: se traslada a la sucesora. La sucesora nace con lo que la antigua tendría en D: `scheduled_plan_id` / `scheduled_discipline_ids` si hay bajada, o el plan y las disciplinas actuales. Al pagarse, se libera el Schedule de la antigua (con Schedule, Stripe no deja poner `cancel_at_period_end`).
    - **Mientras está pendiente se congela el pedido**: cambio de plan, bajada, anular la bajada y cambio de disciplina (también el gratis) sobre la antigua → 409 `payer_change_pending`. Para cambiar algo, el admin anula el cambio de pagador y lo pide otra vez.
    - **Enlace**: el aviso al nuevo pagador lleva a la app (`APP_URL/billing/payer-changes/:id`), nunca a una URL de Stripe. Cada «Pagar» abre un Checkout nuevo de 30 min (como `createCheckout`), mientras no pase la fecha límite. «A tiempo» = completar un Checkout antes de la fecha límite. Con 30 min de vida, el Checkout caduca siempre antes del anchor.
    - **Sin pago a tiempo**: en D la antigua renueva con su pagador, y ese `customer.subscription.updated` (periodo nuevo) marca `expired` y deja `notice.payer_change_expired`. Sin cron. El `GET` ya lo da por `expired` tras la fecha límite.
    - **El Checkout del cambio** no pregunta por la cobertura (seguro o `waiver`) ni exige `risk_cover`: la cobertura es del alumno y sigue igual. Tampoco vuelve a ejecutar `validateOrder`, porque es la misma suscripción que continúa: un plan retirado o un adulto en un plan solo menores no lo bloquean (B10.5 lo resuelve por estado). Sí exige que el plan tenga `stripe_price_id`. Pasa por `requireCompleteProfile` (actor = nuevo pagador, sujeto = alumno).
    - **Bajas y anulaciones con un cambio en marcha**:
      - Baja de la antigua (cualquier modo): un cambio `requested` → `cancelled`; uno `paid` → `cancelled` y la sucesora se cancela en Stripe (ha cobrado 0 €: nada que reembolsar). `notice.payer_change_cancelled` (`reason: subscription_cancelled`).
      - `DELETE` del admin: `requested` → `cancelled` (`reason: admin`) y caduca el Checkout abierto, si lo hay. `paid` → 409 `payer_change_paid`: no se deshace (habría que quitar el `cancel_at_period_end` y rehacer la bajada liberada). Si hace falta, otro cambio de vuelta después de D.
      - Pedir otro con uno `requested`: el viejo pasa a `cancelled` (`reason: replaced`). Con uno `paid` → 409 `payer_change_paid`.
      - **Carrera anular / pagar**: si `checkout.session.completed` llega con el cambio ya `cancelled` o `expired`, se cancela la sucesora en Stripe y se avisa con `notice.payer_change_cancelled`.
      - Si el nuevo pagador deja de cumplir las condiciones antes de pagar (tutor desvinculado), no abre el Checkout (403 `not_new_payer`). Una vez pagado, no se revisa.
    - **Seguro**: no cambia de pagador (CONTEXT). En el traspaso, si el seguro vivo lo paga otro que no es el nuevo pagador, `insuranceWontRenew(…, 'payer_changed')` con los dos pagadores como destinatarios. Si lo paga ya el nuevo pagador, no se toca. `onUpcoming` lo sigue detectando como red de seguridad. El nuevo pagador contrata el suyo con `contractInsurance` cuando termine el anterior (nunca hay dos vivos); no hay seguro sucesor encadenado.
  - **Avisos** (email salvo a los admins, que nunca reciben entregas y los consultan en el panel, B19). `CHANNELS` pasa de 11 a 16:

    | Acción | Cuándo | Destinatarios | Contenido |
    |---|---|---|---|
    | `notice.payer_change_requested` | el admin lo pide | nuevo pagador | alumno, plan, precio, desde D, fecha límite; botón a la app. `expires_at` = fecha límite |
    | `notice.payer_change_paid` | Checkout completado | antiguo + nuevo | antiguo: «termina el D; desde entonces la paga Y»; nuevo: «empiezas a pagar el D, X €/mes». Si se trasladó una bajada, lo dice |
    | `notice.payer_change_expired` | renovación en D sin pago | admins + antiguo + nuevo | antiguo: «sigues pagando tú»; nuevo: «el enlace ha caducado» |
    | `notice.payer_change_cancelled` | `DELETE`, sustituido, baja de la antigua o carrera | nuevo (+ antiguo si fue por baja con el cambio pagado) | «el cambio se ha anulado; el enlace ya no vale», con `reason` (`admin` / `replaced` / `subscription_cancelled`) |
    | `notice.insurance_cancelled` | baja del seguro | pagador del seguro + pagador actual | `ends_at`, sin reembolso, recibos anulados, firmar el `waiver` |

    Sin aviso propio: el traspaso (ya avisado al pagar; el seguro tiene `insurance_wont_renew`).
- **Pasos**:
  1. **Migración `016`**:
     - Tabla `payer_changes`: `id uuid`, `subscription_id` → `subscriptions`, `student_id`, `old_payer_id` y `new_payer_id` → `profiles`, `plan_id`, `discipline_ids bigint[]`, `starts_at` (D), `deadline`, `status` (`CHECK` `requested`/`paid`/`completed`/`expired`/`cancelled`), `checkout_session_id`, `stripe_subscription_id` (sucesora, `UNIQUE`), `cancel_reason`, `created_by`, `created_at`, `updated_at`.
     - Índice único parcial `(subscription_id) WHERE status IN ('requested', 'paid')`.
     - RLS de lectura: pagador antiguo, nuevo pagador y admin. `app_user` no escribe (como `insurances`).
  2. **Servicio** (`services/billing.js`):
     - `cancelInsurance(client, { id, atPeriodEnd, actorId })`: tabla de estados, `cancel` o `cancel_at_period_end`, *void* de los `open`, `audit_log`, `insurance_cancelled` con `servicePool`. Devuelve `risk_cover`.
     - `cancelSubscription`: *void* de los `open` en `cancel-now`; `voided` en el aviso; cancela el cambio de pagador pendiente (y la sucesora si estaba `paid`).
     - `requestPayerChange`, `cancelPayerChange`, `getPayerChange`, `payerChangeCheckout` (Checkout con anchor, `metadata.payer_change_id`, sin `insurance`).
     - `changePlan`, `cancelScheduledChange` y `changeDiscipline` → 409 `payer_change_pending`.
     - `getSubscription` devuelve `payer_change`.
  3. **Webhook** (`stripeWebhook.js`):
     - `onCheckoutPaid` con `metadata.payer_change_id`: comprueba que el cliente sea el del nuevo pagador. Si el cambio sigue `requested`: `paid` + `stripe_subscription_id`, libera el Schedule de la antigua, le pone `cancel_at_period_end` y deja `payer_change_paid`. Si no: cancela la sucesora y deja `payer_change_cancelled`. Nunca inserta en `subscriptions`.
     - `transferPayer(client, change)`: el traspaso del apartado Reglas, llamado desde `onSubscriptionChange` (antigua `cancelled`, o sucesora sin fila) y desde `syncInvoice` (recibo de una sucesora sin fila).
     - `onSubscriptionChange` de la antigua con periodo nuevo y cambio `requested` / `paid` vencido → `expired` + `payer_change_expired`. Una sucesora sin fila y sin traspaso posible se ignora (como hoy).
  4. **Avisos** (`notices.js`): las 5 acciones en `CHANNELS`, sus plantillas y `compose` con el destinatario respecto al cambio (antiguo / nuevo), el plan, el precio y las fechas de la sucesora.
  5. **Endpoints**: los del apartado siguiente.
- **Endpoints**:
  - Admin (`routes/admin/billing.js`):
    - `POST /admin/insurances/:id/cancel-now` y `/cancel-at-period-end` → `200 { id, stripe_status, ends_at, risk_cover }`; 404 `insurance_not_found`; 409 `insurance_not_live` / `insurance_cancelled` / `insurance_cancel_scheduled`.
    - `POST /admin/subscriptions/:id/payer-change { payer_id }` → `201 { id, status: 'requested', new_payer_id, plan_id, discipline_ids, starts_at, deadline }`; 400 `invalid_field`; 404 `subscription_not_found` / `profile_not_found`; 409 `subscription_not_active` / `cancel_scheduled` / `upgrade_pending` / `period_ending_soon` / `payer_change_paid` / `same_payer` / `invalid_payer`.
    - `DELETE /admin/subscriptions/:id/payer-change` → 204; 404 `no_payer_change`; 409 `payer_change_paid`.
  - Nuevo pagador (`routes/billing.js`):
    - `GET /billing/payer-changes/:id` → `{ id, status, student, plan, price_cents, disciplines, starts_at, deadline }`. Lo leen el pagador antiguo, el nuevo y el admin; el resto, 404.
    - `POST /billing/payer-changes/:id/checkout` → `200 { url }`; 403 `not_new_payer`; 409 `payer_change_expired` / `payer_change_cancelled` / `payer_change_paid`.
  - `GET /billing/subscription` añade `payer_change: { id, status, new_payer_id, starts_at, deadline } | null`.
  - `audit_log`: `insurance.cancel_now`, `insurance.cancel_at_period_end`, `subscription.payer_change_request`, `subscription.payer_change_cancel`.
- **Tests**:
  - **`test:billing`**:
    - baja del seguro: tabla de estados y errores;
    - cambio de pagador: validaciones (`invalid_payer` en sus tres casos, `same_payer`, `period_ending_soon`, `upgrade_pending`, `cancel_scheduled`), sustituir un `requested`, `DELETE` en cada estado, 409 `payer_change_pending` en las cuatro acciones congeladas, permisos de `GET` y `checkout`, y bajada programada trasladada a `payer_changes`.
  - **`test:webhook`** (sandbox):
    - baja del seguro inmediata con recibo `open` → `void` y `insurance_cancelled`; a fin de año;
    - baja inmediata de la suscripción con recibo `open` → `void`;
    - Checkout del cambio pagado → `paid`, `cancel_at_period_end` en la antigua, Schedule liberado y ninguna fila nueva en `subscriptions`;
    - traspaso en los dos órdenes (antigua `deleted` primero, sucesora primero) y repetido: una sola fila, reservas intactas, seguro `payer_changed` (y sin tocar si el seguro es del nuevo pagador);
    - `expired` en la renovación;
    - baja de la antigua con el cambio `paid` → sucesora cancelada;
    - carrera `DELETE` / pago.

    D se simula al releer la suscripción, como la fase de B10.5.
  - **`test:notices`**: las 5 plantillas (enlace, textos antiguo / nuevo, sin edad ni fecha de nacimiento) y sus entregas (sin admins).
  - **Regresión**: `test:bookings`, `test:minors` y `test:catalog`.
  - **E2E** con `stripe listen --all-snapshot` + Chrome + *test clock* hasta D:
    - cambio pedido → email en `storage/emails.log` → Checkout de 0 € → traspaso en D con el cobro al nuevo pagador y las reservas intactas;
    - cambio sin pagar → `expired` en la renovación;
    - baja inmediata del seguro `unpaid` → recibo anulado y el pagador fuera de morosos.
- **Fuera de alcance**:
  - baja por el alumno o el pagador (revisión legal en `MEJORAS.md`);
  - flujo de reclamar el perfil a los 18 y su aviso al admin para cambiar el pagador (bloque propio; el cambio de pagador ya sirve para hacerlo a mano);
  - seguro sucesor encadenado;
  - reembolsos automáticos (el único sigue siendo el de la carrera de checkouts, B10);
  - reactivar una baja programada (de suscripción o de seguro);
  - deshacer un cambio de pagador ya pagado;
  - UI y panel de cambios caducados (B19).
- **Checklist de cierre**:
  - [x] Migración `016` (`payer_changes`, RLS de lectura, sin escritura para `app_user`).
  - [x] Baja del seguro en los dos modos, con la tabla de estados, sin reembolso, *void* de los `open` y `insurance_cancelled`.
  - [x] Baja inmediata de la suscripción anula sus recibos `open`.
  - [x] Cambio de pagador: pedir, enlace a la app, Checkout con anchor, `paid`, traspaso idempotente en D sin cancelar reservas, `expired` sin cron.
  - [x] Bajada programada trasladada; pedido congelado con `payer_change_pending`.
  - [x] Bajas y anulaciones con el cambio en marcha (incluida la carrera anular / pagar).
  - [x] Seguro `payer_changed` en el traspaso.
  - [x] 5 avisos nuevos en `CHANNELS` con plantillas.
  - [x] `audit_log` registra.
  - [x] Tests (`test:billing`, `test:webhook`, `test:notices`, regresión).
  - [x] E2E con Stripe CLI y *test clock*.
- **Implementación** (migración `016`):
  - **Sondeo del sandbox** (2026-10-30, antes del paso 3; *test clock*, Checkout completado en Chrome con 4242):
    - Checkout con `billing_cycle_anchor` = D (fin de periodo de otra suscripción del mismo reloj) y `proration_behavior: none`: la página dice «0,00 € hoy, luego 10,00 €/mes desde D». Completado: `status: complete`, `payment_status: no_payment_required` (no `paid`), `amount_total` 0.
    - La sucesora nace **`active`**, **sin ningún recibo** (`latest_invoice` nulo) ni cargo, con la tarjeta como `default_payment_method`. Su periodo va de la creación a D.
    - Reloj a D + 1 h: la antigua (con `cancel_at_period_end`) pasa a `canceled` y la sucesora cobra el mes completo (`subscription_cycle`, 10 €, `paid`).
    - Orden de creación de los eventos: `invoice.upcoming` (sucesora, al avanzar el reloj, antes de D), `customer.subscription.deleted` (antigua), `invoice.created` / `updated` / `finalized` / `paid` (sucesora) y `customer.subscription.updated` (sucesora). La antigua no emite `updated` en D, solo `deleted`.
    - Consecuencias: `onCheckoutPaid` no descarta el Checkout del cambio (solo descarta `unpaid`). No hay recibo de 0 € que ignorar. `onUpcoming` ignora el `invoice.upcoming` de la sucesora (no es un seguro).
    - Antes, en la fase 1: un recibo `open` de prueba se fabrica sin *test clock* con `invoiceItems.create({ subscription })` + `invoices.create({ subscription, auto_advance: false })` + `finalize`. Tras `cancel` sigue `open`, y el *void* lo cierra.
  - **`016`**: `payer_changes` como en el paso 1, con `payer_changes_one_pending_idx` (`requested` / `paid`) y `CHECK` de `cancel_reason` (`admin` / `replaced` / `subscription_cancelled`). RLS de lectura para el pagador antiguo, el nuevo y el admin; `app_user` no escribe. La escriben el servicio (`serviceTx`, transacción propia con `servicePool`) y el webhook.
  - **Baja del seguro** (`cancelInsurance`):
    - Lee la fila con la RLS del admin y relee Stripe. Errores: 404 `insurance_not_found`, 409 `insurance_cancelled` (también si Stripe ya la canceló y el webhook no ha llegado), `insurance_not_live` e `insurance_cancel_scheduled`.
    - `update cancel_at_period_end` o `cancel` sin `prorate` ni `invoice_now`. En `cancel-now`, `voidOpenInvoices` (compartido con `cancelSubscription`).
    - `notice.insurance_cancelled` con `servicePool` (`ends_at`, `voided` = número de recibos anulados), al pagador del seguro y al de la suscripción viva si es otro.
    - `risk_cover` = si le queda cobertura de riesgo sin el seguro (el `waiver` vigente, `signed_current` con `servicePool`). Es igual en los dos modos, para que el panel avise también en la baja a fin de año.
    - La respuesta va sin envolver (`{ id, stripe_status, ends_at, risk_cover }`), como dice el diseño. La baja de la suscripción sigue devolviendo `{ subscription }`.
  - **`cancelSubscription`**: `voidOpenInvoices` en `cancel-now` y `voided` en `subscription_cancelled`, que lo dice en el email. Cierra el cambio de pagador pendiente **antes** de pedir la baja a Stripe, para que el fin de la antigua no se tome por un traspaso.
  - **Cambio de pagador** (`services/billing.js`):
    - `requestPayerChange`:
      - Valida: `payer_id`, perfil, `same_payer` e `invalid_payer` (el nuevo pagador es un menor, un adulto no vinculado al menor, o otro que no es el propio alumno adulto). Lo comprueba `validNewPayer` con `servicePool`.
      - Bajo el bloqueo de la fila de la suscripción: `payer_change_paid`, estado local, y con Stripe releído `subscription_not_active` / `cancel_scheduled` / `upgrade_pending` / `period_ending_soon`.
      - D = `current_period_end` de Stripe y fecha límite = D − 1 h. El plan y las disciplinas salen de la fase pendiente del Schedule, o los actuales.
      - Un `requested` anterior se cierra con `replaced`. Escribe `audit_log` y `payer_change_requested` (`expires_at` = fecha límite).
    - `cancelPayerChange`: un `requested` pasa a `cancelled (admin)`, caduca su Checkout y avisa. Uno `paid` → 409.
    - `closePayerChange`: comparten el cierre la sustitución, el `DELETE` y la baja. Caduca el Checkout abierto y, si estaba `paid`, descarta la sucesora y avisa también al antiguo.
    - `getPayerChange`: comprueba la RLS con `client` y lee el detalle con `servicePool` (el nuevo pagador no ve un plan retirado). `EFFECTIVE_STATUS` da `expired` a un `requested` pasada la fecha límite; también en `getSubscription.payer_change`.
    - `assertNewPayer` (403 `not_new_payer`, también si el tutor ya no está vinculado) y `payerChangeCheckout`:
      - bajo `FOR UPDATE` de la fila: Checkout con `billing_cycle_anchor` = D, `proration_behavior: none`, `metadata.payer_change_id` y 30 min;
      - guarda el `checkout_session_id` y caduca el Checkout anterior, para que haya uno abierto a la vez.
    - `assertNotFrozen` (409 `payer_change_pending`) en `changePlan`, `cancelScheduledChange` y `changeDiscipline`. Este último comprueba tras bloquear la fila de la suscripción, igual que el pedido, para que no se crucen.
    - `discardSuccessor`: cancela la sucesora, anula sus recibos `open` y reembolsa los pagados (clave `successor-refund-<pi>`). Devuelve lo reembolsado, que va en `refunded` de los avisos.
  - **Webhook** (`stripeWebhook.js`):
    - `onPayerChangePaid` (desde `onCheckoutPaid` con `metadata.payer_change_id`, tras comprobar el cliente):
      - Idempotente si la sucesora ya está guardada.
      - Cambio no `requested`: descarta la sucesora. Avisa `payer_change_cancelled` con `reason` = `cancel_reason` o `expired`, salvo si es una segunda sucesora del mismo cambio.
      - **Checkout tardío**: la antigua ya renovó (su periodo empieza en D o después) → `markExpired`, sin tocar la antigua.
      - Si no: libera el Schedule, pone `cancel_at_period_end`, `paid` y `payer_change_paid` a los dos pagadores (`from_plan_id` para decir si se trasladó la bajada).
    - `transferPayer`: bajo `lock_student` y `FOR UPDATE` del cambio, los cinco pasos del diseño.
      - La regla del seguro: el vivo y renovando que no paga el nuevo pagador → `insuranceWontRenew('payer_changed', [pagador del seguro, nuevo])`.
      - Se dispara desde `onSubscriptionChange`: de la sucesora antes del `UPDATE`, y de la antigua `cancelled` antes de `revoke_coverage`.
      - También desde `syncInvoice` (recibo de la sucesora sin fila).
    - `expirePayerChange` (antigua no cancelada con periodo que empieza en D o después) y `markExpired`: `expired`, descarta la sucesora si la hay y avisa a admins, antiguo y nuevo.
  - **Avisos** (`notices.js`):
    - `CHANNELS` pasa de 11 a 16.
    - `compose` lee el cambio (nuevo pagador, D, precio actual del plan) y pasa el destinatario a las plantillas, que distinguen antiguo y nuevo.
    - `insurance_cancelled` dice que no se devuelve la parte no usada, los recibos anulados y lo del `waiver`.
  - **Endpoints**:
    - Los del diseño, y además `GET /admin/payer-changes/:id`: el router `/billing` exige `alumno` / `tutor` y el admin no podía leer el cambio (decidido 2026-10-30).
    - `POST /billing/payer-changes/:id/checkout` lleva los guards `asNewPayer` (403 antes que el `not_guardian` de `requireCompleteProfile`) y `requireCompleteProfile`, con el alumno como sujeto.
  - **Decidido 2026-10-30, salido de la fase 3 — reembolso de la sucesora**:
    - Si el `checkout.session.completed` llega tras D, la antigua ya renovó con su pagador y la sucesora cobró el primer mes. Antes, según el orden de los eventos, el nuevo pagador pagaba sin recibir nada, y la antigua recibía la baja tras renovar.
    - Ahora el Checkout tardío caduca el cambio y toda sucesora descartada se reembolsa.
    - Es la **segunda excepción a «sin reembolsos automáticos»**, como la carrera de checkouts: corrige un cobro de más que Kaizen descarta, no devuelve un servicio prestado.
    - Fuera de ese caso (o de quitar a mano la baja de la antigua en el Dashboard), la sucesora se descarta antes de D y no hay nada que devolver.
  - **Decidido 2026-10-30, tras el E2E — costes de Stripe**:
    - Smart Retries se queda como está (8 reintentos en 2 semanas y `unpaid` al agotarse): un intento rechazado no cuesta nada en Stripe.
    - `notice.payment_failed` solo en el **primer intento** (`attempt_count = 1`). Los reintentos no avisan y, si se agotan, avisa `subscription_unpaid` / `insurance_unpaid`. Son 2 emails en vez de 9, para no saturar al pagador.
    - **Descriptor del extracto** `KAI ZEN TRAINING CAMP` (`STRIPE_STATEMENT_DESCRIPTOR`, validado al arrancar en `config/stripe.js`). Va en el `statement_descriptor` de los Products de Kaizen, cada plan y el del seguro: Stripe lo usa en los cobros de la suscripción antes que el de la cuenta, que en producción comparte maat. Se pone al crear el Product, y `npm run sync-stripe-plans` lo aplica a los que ya existen. Vacío: el de la cuenta.
    - `attempt_count` solo sube con los reintentos automáticos (un pago manual no cuenta), según la documentación de Stripe; el test simula el segundo intento al releer el recibo.
    - La baja por el pagador no cambia; queda en `MEJORAS.md`, también como medida contra las disputas.
  - **Tests**:
    - `test:billing`:
      - tabla de estados de la baja del seguro contra seguros reales, sin saldo a favor, destinatarios y `risk_cover`;
      - validaciones del pedido (con `upgrade_pending` y `period_ending_soon` simulados al releer Stripe), aviso y `audit_log`;
      - congelado en las cuatro acciones, `GET` y Checkout por quién (con el tutor desvinculado y pasada la fecha límite), `amount_total` 0;
      - sustituir un `requested` (Checkout caducado), `DELETE` y pedido con un `paid`, y bajada trasladada.
    - `test:webhook`:
      - baja del seguro a fin de año (antes, 409 de un seguro que ya no renovaba) e inmediata de un seguro `unpaid` con un recibo `open`: `void`, fuera de morosos y sin cobertura;
      - baja inmediata de la suscripción con un recibo `open`;
      - Checkout del cambio pagado (Schedule liberado, sin fila nueva, replay y sucesora duplicada);
      - traspaso con la antigua primero y con el recibo de la sucesora primero (una fila, reservas intactas, seguro `payer_changed` o intacto);
      - `expired` en la renovación, carrera `DELETE` / pago, Checkout tardío con la sucesora reembolsada una vez, y baja con el cambio pagado.
      - D se simula cancelando la antigua en Stripe; la renovación, al releer.
    - `test:notices`: las 16 plantillas, más los textos del nuevo pagador (con reembolso y sin él) y las entregas sin admins.
    - Regresión con la API parada: `test:billing` 38, `test:webhook` 35, `test:notices` 9, `test:bookings` 18, `test:minors` 14 y `test:catalog` 10, todos OK.
- **E2E** (2026-10-30, sandbox `kaizen-app-testing`, `stripe listen --all-snapshot` + Chrome + *test clock*, por HTTP contra `npm run dev` con tokens firmados; fixtures por base de datos, con documentos de acuerdos de prueba porque la base de desarrollo no tiene ninguno publicado):
  - **Cambio completo hasta D**:
    - tutor A da de alta a su hija con un Checkout de 20 € y reserva una sesión;
    - el admin pide el cambio a tutor B → 201 con D y la fecha límite;
    - el worker deja el email en `storage/emails.log`: plan, 20 €/mes, «hoy no se te cobra nada», fecha límite en hora de Madrid y enlace a `/billing/payer-changes/:id`;
    - tutor B hace `GET` y abre el Checkout: «0,00 € hoy, 20 €/mes desde el 30 de noviembre», pagado en Chrome;
    - el webhook lo deja `paid` y pone `cancel_at_period_end` a la antigua; la sucesora queda `active`, sin recibo ni fila local, y sale un email a cada pagador con su texto;
    - reloj a D + 1 h: antigua `cancelled`, sucesora en local pagada por tutor B (mismo plan y disciplina), cambio `completed`, recibo de 20 € `paid` de tutor B y la reserva `confirmed`. Solo hay avisos del cambio: ni `no_coverage` ni `payment_failed`.
  - **Cambio sin pagar → `expired`**:
    - cambio de vuelta a tutor A sobre la sucesora, sin pagar, y reloj a su D;
    - la sucesora renueva con tutor B y el cambio queda `expired`; el `GET` lo da `expired` y el Checkout tardío responde 409 `payer_change_expired`;
    - emails: «el enlace ya no vale» a tutor A y «sigues pagando tú» a tutor B. Los admins son destinatarios del aviso, sin entregas.
  - **Baja inmediata de un seguro `unpaid`**:
    - tutor B contrata el seguro por HTTP y se le pone al seguro, y solo a él, una tarjeta que se rechaza;
    - avance real de algo más de un año, de dos en dos meses: `past_due` en la renovación, 9 intentos y `unpaid` a las dos semanas, con tutor B en morosos;
    - `POST /admin/insurances/:id/cancel-now` → 200 con `risk_cover: true` (waiver firmado): recibo `void` en Stripe y en local, tutor B fuera de morosos, seguro `cancelled` por el webhook y repetido → 409 `insurance_cancelled`; email `insurance_cancelled`;
    - la suscripción sigue `active`.
  - **Hallazgo — ajuste de la cuenta**: el sandbox tenía *Revenue recovery → Retries → «If all retries for a payment fail»* en **cancelar la suscripción**. En el primer intento el seguro acabó `canceled` (`reason: payment_failed`) con el recibo `open` (Stripe ya no lo cobraba) y sin aviso al pagador de que el seguro había terminado. Kaizen supone `unpaid` desde B10.2 y los tests lo simulaban. Cambiado a **«mark the subscription as unpaid»** en el sandbox (2026-10-30); hay que revisar la cuenta de producción (B10.7).
  - **Incidencia de montaje**: el primer `stripe listen` no llevaba `--forward-to` y se perdieron los eventos del alta de tutor A. Se reenviaron firmados a la ruta real. En el primer intento se reenviaron también eventos de la regresión anterior: sus perfiles ya no existían y no escribieron nada (comprobado).
  - Con el *test clock*, una baja inmediata se lee «seguirá vigente hasta…» en el email: la plantilla compara `ends_at` con la hora real. En producción `ended_at` es el momento de la baja (`subscription_cancelled` de B10.6 hace igual).
  - Datos del E2E borrados después (base de desarrollo, *test clock*, plan y seguro archivados en Stripe y ajustes del seguro restaurados).
- **Pendiente**:
  - Endpoints sin prueba por HTTP en los tests (el E2E sí pasa por HTTP); en especial, el Checkout del cambio con un perfil incompleto (403 de `requireCompleteProfile`) (→ B20).
  - Si Stripe cancelara un seguro tras los reintentos (otro ajuste de la cuenta), el pagador no recibiría ningún aviso de que se ha terminado. Con `unpaid` no pasa (→ B10.7: *Retries* en «mark as unpaid»).
  - Si el precio del plan cambia con un cambio `paid`, la sincronización no ve la sucesora (no tiene fila): el primer cobro en D es al precio viejo y el traspaso la alinea, sin prorrateo, para los siguientes (→ `MEJORAS.md` 6.7).
  - Un aviso escrito con `servicePool` en *autocommit* (`insurance_cancelled`) se queda aunque la ruta haga rollback después, como en B10.6 (→ B20).

### B12 — ELIMINADO
- Absorbido: los consentimientos (`data_protection`, `rights_of_image`) ya los exige el perfil completo (B4.5) en el checkout, y el `waiver` pasa a la elección seguro / `waiver` del checkout (B10.3, ADR 0005).

### B13 — Perfiles públicos (flags, `public_profiles`, directorio) — CERRADO
- **Objetivo**: perfil público *opt-in* con campos visibles elegidos uno a uno, directorio para la academia, y cerrar lo que `profiles` deja leer hoy (el profesor y los perfiles públicos leen filas enteras). Términos en `CONTEXT.md` («Perfil público y directorio»), decisión en ADR 0010.
- **Choques con lo existente** (detectados en el diseño, 2026-10-30):
  - `profiles_select` (003) tiene `OR is_public = true`: la RLS filtra filas, no columnas, así que un perfil público dejaría a cualquiera con sesión leer su fila entera (`phone`, `birth_date`, `stripe_customer_id`). Hoy está latente: ningún endpoint pone `is_public`.
  - El profesor lee todas las filas de `profiles` (también la `birth_date` de los menores) y todo `user_roles` (riesgo aceptado en B3).
  - `profiles_update_guardian` (006) deja al tutor, a nivel SQL, poner `is_public` en un hijo. «Forzado a false» no puede ser un `CHECK` porque la edad cambia con el tiempo.
  - El calendario del alumno (lo que queda de B6) necesita el nombre del profesor, y un alumno solo puede leer la fila de un profesor si es pública.
- **Reglas** (decididas 2026-10-30):
  - **Quién puede ser público**: alumnos adultos **con acceso propio** (con `auth_credentials`) y profesores, siempre *opt-in* (`is_public` empieza en `false`). Nunca un hijo, tampoco el que cumplió 18 sin reclamar su perfil (no tiene `auth_credentials`), ni el rol tutor ni el admin. Lo decide la vista al leer, no el flag guardado.
  - **Público = visible para la academia**: cualquier perfil con sesión iniciada (alumno, tutor, profesor, admin). Nunca sin sesión. Ver el directorio no exige perfil completo.
  - **Campos visibles** (`visible_fields`): `display_name` y `role` van siempre. Flags booleanos, todos `false` al empezar, con una lista cerrada:
    - `bio`;
    - `social_links` (en bloque);
    - `disciplines`: alumno, las disciplinas activas que **cubre** (`covers()`, 012) su suscripción en vigor, con un plan de «todas» las elegibles, y lista vacía si no tiene; profesor, las disciplinas de sus clases no retiradas como profesor habitual (sin sustituciones ni sesiones sueltas);
    - `member_since` (`created_at`, como `YYYY-MM`).

    Nunca, con o sin flag: `phone`, email, `birth_date` o edad, salud, suscripción, pagos, seguro, reservas ni asistencia. No están en la lista.
  - **Sin avatar**: `avatar_url` se queda sin usar (fuera de alcance, ver abajo).
  - **Lectura** (ADR 0010):
    - `profiles_select` pierde `OR is_public = true`.
    - Lo público se lee solo por la vista **`public_profiles`** (owner `service_role`, `security_barrier`, `GRANT SELECT` solo a `app_user`):
      - **filas**: `is_public`, rol `alumno` o `profesor`, adulto (`birth_date` nula o de hace 18 años o más, como `ADULT` de 006), con `auth_credentials`, y `app.current_user_id` no nulo;
      - **columnas**, exactamente: `id`, `display_name`, `role`, `bio`, `social_links`, `disciplines` (`jsonb` `[{ id, name }]`), `member_since`. Los cuatro opcionales con `CASE WHEN (visible_fields->>'x')::boolean THEN … END`: oculto = `NULL`.
    - **Un filtro solo mira lo que el perfil enseña**: los filtros se aplican sobre la vista, así que `discipline_id` no encuentra a quien oculta sus disciplinas.
    - **`trainer_names (id, display_name)`**: vista de los perfiles con rol `profesor`, con el mismo patrón (owner `service_role`, exige sesión). El nombre del profesor de una sesión lo ve cualquiera con sesión, sea público o no. La usará el calendario del alumno (lo que queda de B6).
  - **Salud**: la vista no depende de `student_health_info`, y lo garantiza un test (ver Tests), no la revisión.
  - **Profesor**:
    - `profiles_select`: además del suyo, solo los alumnos con **alguna reserva** (cualquier estado y fecha) en una sesión que imparte (`class_sessions.trainer_id`, sustituciones incluidas), el mismo alcance que `bookings_select` (009). Con un helper `teaches_student(p_id)` `SECURITY DEFINER` (owner `service_role`, como `is_guardian_of`) para no encadenar la RLS de `bookings` dentro de la de `profiles`.
    - `user_roles_select`: sin `'profesor'` (el propio perfil y el admin).
    - **Riesgo residual que se acepta**: la RLS trabaja por filas, así que de esos alumnos el profesor puede leer a nivel SQL `phone` y `birth_date`. La API solo selecciona `display_name`. Escrito en el ADR 0010.
  - **Edición**:
    - Solo el dueño, con `PATCH /me/profile` (sin `profile_id`: un tutor nunca edita el perfil público de un hijo).
    - `is_public: true` de quien no puede ser público → 403 `not_eligible`. `bio` y `social_links` se guardan aunque no pueda: no salen en ningún sitio.
    - Validación (400 `invalid_field`):
      - `visible_fields`: objeto solo con las 4 claves de la lista y valores booleanos (se fusiona con lo guardado);
      - `bio`: texto de 500 caracteres como mucho, o `null`;
      - `social_links`: objeto `{ red: url }`, con las redes `instagram`, `tiktok`, `youtube` y `web`, y URLs `https://` de 200 caracteres como mucho, o `null`.
    - `profiles_update_guardian` añade `AND is_public = false` a su `WITH CHECK`: el tutor no publica al hijo ni a nivel SQL, y el hijo que reclama su perfil empieza no público sin hacer nada más.
  - **Despublicar** (admin): `POST /admin/profiles/:id/unpublish` pone `is_public = false`, sin tocar el contenido. Es idempotente (si no era público, 200 sin hacer nada). Deja `profile.unpublish` en `audit_log` y no avisa. El dueño puede volver a publicar.
  - **Directorio**:
    - `limit` / `offset` como `listOverduePayers` (B10.2): 25 por defecto, 100 como máximo, 400 `invalid_pagination`, `{ profiles, total, limit, offset }`.
    - Orden `display_name, id`.
    - Filtros: `q` (`ILIKE` sobre el nombre, sin `unaccent`: haría falta una extensión), `role` (`alumno` / `profesor`) y `discipline_id`.
  - **Respuesta de una ficha**: los campos ocultos **no aparecen** (no salen como `null`). Un perfil que no existe y uno que no es público dan el mismo 404 `profile_not_found`.
- **Pasos**:
  1. **Migración `017`**:
     - `profiles_select`: sin `OR is_public = true`; el profesor, con `teaches_student(id)` en lugar de `role IN ('admin','profesor')`.
     - `teaches_student(p_id uuid)`: `SECURITY DEFINER`, owner `service_role`, `EXECUTE` solo para `app_user`.
     - `user_roles_select`: sin `'profesor'`.
     - `profiles_update_guardian`: `WITH CHECK` con `AND is_public = false`.
     - Vistas `public_profiles` y `trainer_names`, con owner `service_role`, `security_barrier` y `GRANT SELECT` a `app_user`.
     - Datos: `UPDATE profiles SET is_public = false` de quien no puede ser público (debería no haber ninguno; por si acaso).
  2. **Antes de quitar `'profesor'` de `user_roles_select`**: comprobar que ningún camino con el `client` del profesor lee `user_roles` de otros. Por ejemplo, `notice()` filtra admins leyendo `user_roles`: con la RLS de un no admin el filtro no los ve. Hoy el profesor no crea avisos.
  3. **Servicio** (`services/profiles.js`): `listPublicProfiles`, `getPublicProfile`, `getMyProfile` (con `eligible`), `updateMyProfile` y `unpublishProfile`. Todos sobre `client` (RLS) y las vistas; nunca `servicePool`.
  4. **Rutas**: `routes/profiles.js` (`requireAuth`), `/me/profile` en `routes/me.js` y `routes/admin/profiles.js`.
  5. `test-rls.js`: el caso «profesor ve perfiles de alumnos» pasa a «solo los de sus sesiones».
- **Endpoints**:
  - `GET /profiles?q=&role=&discipline_id=&limit=&offset=` → `{ profiles: [ficha], total, limit, offset }`; 400 `invalid_pagination` / `invalid_field`.
  - `GET /profiles/:id` → `{ profile: ficha }`; 400 `invalid_id`; 404 `profile_not_found`.
  - Ficha: `{ id, display_name, role, bio?, social_links?, disciplines?: [{ id, name }], member_since?: 'YYYY-MM' }`.
  - `GET /me/profile` → `{ is_public, eligible, visible_fields, bio, social_links }` (lo guardado, con los 4 flags siempre presentes).
  - `PATCH /me/profile { is_public?, visible_fields?, bio?, social_links? }` → igual que el `GET`; 400 `invalid_field`; 403 `not_eligible`.
  - `POST /admin/profiles/:id/unpublish` → `200 { id, is_public: false }`; 404 `profile_not_found`.
  - `audit_log`: `profile.unpublish`.
- **Tests** (`test:profiles`, nuevo):
  - **Vista**:
    - las columnas de `public_profiles` son **exactamente** las 7 esperadas;
    - por `information_schema.view_table_usage`, solo depende de tablas permitidas (`profiles`, `user_roles`, `auth_credentials`, `subscriptions`, `plans`, `plan_disciplines`, `subscription_disciplines`, `disciplines`, `classes`) y **nunca** de `student_health_info`;
    - sin `app.current_user_id`, 0 filas (también en `trainer_names`).
  - **Quién sale**: alumno adulto público sí; no público, no; hijo con `is_public = true` forzado por SQL, no; hijo con 18 sin reclamar, no; tutor (rol) y admin con `is_public`, no; profesor público, sí.
  - **Campos**: cada flag por separado; un campo oculto no aparece en la respuesta; `disciplines` del alumno (plan de N, plan de «todas», sin suscripción en vigor → `[]`) y del profesor (clases no retiradas, sin sustituciones); `member_since`.
  - **Filtros**: `q`, `role`, `discipline_id` (quien oculta sus disciplinas no aparece) y paginación (`total`, límites, 400).
  - **404 iguales**: un id inexistente y uno no público.
  - **Edición**: validaciones de `PATCH`, `not_eligible` (tutor, admin), fusión de `visible_fields`, y el tutor no puede poner `is_public` a su hijo por SQL (`WITH CHECK`).
  - **Despublicar**: admin, idempotente, `audit_log`; un no admin → 403.
  - **RLS**:
    - `profiles` ya no muestra un perfil público ajeno a un alumno;
    - el profesor ve a los alumnos de sus sesiones (también los que cancelaron, también en sesiones pasadas y de sustitución) y no al resto;
    - el profesor no lee `user_roles` ajenos;
    - `trainer_names` lo lee un alumno.
  - **Regresión**: `test:rls`, `test:attendance` (la lista del profesor), `test:minors`, `test:bookings` y `test:checkin`.
- **Fuera de alcance**:
  - **avatar** (subida, recodificar la imagen para quitar EXIF y la ubicación GPS, almacenamiento y *backups*): en `MEJORAS.md`;
  - búsqueda sin acentos (`unaccent`);
  - el calendario del alumno (lo que queda de B6), que solo usará `trainer_names`;
  - el flujo de reclamar el perfil a los 18 (bloque propio; el perfil empieza no público sin hacer nada);
  - feed, rachas y rankings (B14);
  - avisos por despublicar;
  - sacar las columnas privadas de `profiles` a otra tabla (alternativa descartada en el ADR 0010);
  - UI (B18).
- **Checklist de cierre**:
  - [x] Migración `017`: `profiles_select` sin `is_public` y profesor con `teaches_student`, `user_roles_select` sin profesor, `WITH CHECK` del tutor, vistas `public_profiles` y `trainer_names`.
  - [x] `public_profiles` solo expone las 7 columnas, cada campo opcional detrás de su flag.
  - [x] **`student_health_info` NO se une a `public_profiles`**, garantizado por el test de dependencias (riesgo §9 B4.5).
  - [x] Un hijo nunca es público, tampoco con 18 sin reclamar su perfil, ni con el flag forzado por SQL.
  - [x] Directorio paginado, con filtros que solo miran lo visible.
  - [x] `profiles_select` del profesor restringida a los alumnos con reserva en sus sesiones.
  - [x] Endpoints de lectura, edición y despublicar, con `audit_log`.
  - [x] Tests (`test:profiles` y regresión).
- **Implementación** (migración `017`):
  - **`017`**:
    - `teaches_student(p_id)` (`SECURITY DEFINER`, owner `service_role`, `EXECUTE` solo `app_user`): alguna reserva, en cualquier estado y fecha, en una sesión con `class_sessions.trainer_id` = quien llama.
    - `profiles_select` = `id = uid OR admin OR (profesor AND teaches_student(id))`; `user_roles_select` = `user_id = uid OR admin`; `profiles_update_guardian` con `AND is_public = false` en el `WITH CHECK`.
    - Vistas `public_profiles` y `trainer_names` con `security_barrier`, owner `service_role` y `REVOKE ALL FROM PUBLIC, app_user` antes del `GRANT SELECT`: los permisos por defecto del migrator darían a `app_user` también `INSERT` / `UPDATE` / `DELETE`, y `trainer_names` (una sola tabla en el `FROM`) es una vista actualizable que se salta la RLS.
    - Las dos exigen `app.current_user_id` no vacío (`NULLIF`, como desde 012). Los flags se leen con `COALESCE((visible_fields->>'x')::boolean, false)`.
    - `member_since` = `created_at` en hora de Madrid, `YYYY-MM`. `disciplines` ordenadas por nombre.
    - Datos: el `UPDATE` de los no elegibles corre como `service_role` (el migrator no salta la `FORCE` RLS). No había ninguno.
    - Con su `down` (probado up → down → up).
  - **Decidido 2026-10-30 — fuente única con dos funciones** (al cerrar el bloque, para no duplicar reglas): `covers` solo la ejecuta `service_role`, y una función dentro de una vista se comprueba con el rol que consulta (probado: «permission denied for function covers»). Darle `EXECUTE` a `app_user` dejaría preguntar si cualquier alumno tiene cobertura. La primera versión repetía `covers` y la regla de quién puede ser público dentro de la vista y en `getMyProfile`. Ahora hay dos funciones `SECURITY DEFINER` (owner `service_role`, `EXECUTE` para `app_user`) que se guardan solas:
    - `can_be_public(id)`: la regla (alumno o profesor, adulto, con `auth_credentials`). Solo responde con sesión, y sobre uno mismo o un perfil `is_public`, así que no revela nada que la vista no enseñe. La usan la vista, `getMyProfile` y el `UPDATE` de datos.
    - `public_disciplines(id)`: llama a `covers` (alumno) o mira sus clases no retiradas (profesor). Da `NULL` si el perfil no es público, no puede serlo o no enseña sus disciplinas.
    - La vista ya solo depende de `profiles` y `user_roles` (tablas) y de esas dos funciones. El test de dependencias comprueba además, con `view_routine_usage`, que sus funciones son exactamente esas dos, y que ni ellas ni `covers` mencionan `student_health_info`.
    - Se reescribió `017` en el sitio (no hay nada desplegado). Para bajar la versión aplicada en desarrollo hicieron falta dos funciones de relleno.
  - **Paso 2 (`user_roles` del profesor)**: ningún camino con el `client` del profesor lee `user_roles` ajenos. `notice()` solo se llama desde el webhook y `billing.js` (alumno, tutor, admin o `servicePool`); `classes.js` lo lee en un servicio de admin; el login, con `servicePool`. Las funciones SQL que leen `user_roles` son `SECURITY DEFINER`. La lista de asistencia del profesor lee `profiles` de alumnos con reserva, que entran en `teaches_student`.
  - **Servicio** (`services/profiles.js`), siempre con `client`:
    - `listPublicProfiles`: paginación como `listOverduePayers`, `total` con un `count` aparte; `q` con `%`, `_` y `\` escapados; `role` fuera de `alumno` / `profesor`, `discipline_id` no numérico o `q` que no es un texto de 100 caracteres como mucho → 400 `invalid_field`. `discipline_id` filtra con `disciplines @> [{ id }]` sobre la vista.
    - `getPublicProfile`: los 4 campos opcionales que la vista da `NULL` se borran de la ficha (tampoco sale una `bio` visible pero vacía).
    - `getMyProfile`: `eligible` = `can_be_public(id)`, la misma regla que la vista.
    - `updateMyProfile`: un solo `UPDATE`, con `visible_fields` fusionado en SQL (`||`). Una clave ausente no cambia nada; `null` en `bio` / `social_links` borra.
    - `unpublishProfile`: `FOR UPDATE` de la fila y `audit_log` `profile.unpublish` solo si estaba publicado (repetir no deja otra fila).
  - **Rutas**: `routes/profiles.js` (`requireAuth`, `invalid_id` por `router.param`), `GET`/`PATCH /me/profile` en `routes/me.js` (validación fuera de la transacción; un campo desconocido, también `profile_id`, → 400 `invalid_field`; URL con `URL.canParse`) y `routes/admin/profiles.js` (`requireRole('admin')`).
  - **Tests**:
    - `test:profiles` (25): todos los casos de Tests. Las rutas se prueban por HTTP con un express en memoria y JWT firmados, sin la API levantada.
    - La consulta a `view_table_usage` va con el migrator (`DATABASE_URL`): esa vista solo lista tablas del rol conectado, y con `service_role` sale vacía.
    - También: `app_user` sin escritura en las vistas, una suscripción `cancelled` no da disciplinas, `%` literal en `q`, y `PATCH` que borra `bio` / `social_links`.
    - `test-rls.js`: «alumno A ve perfiles públicos» pasa a «NO ve en `profiles` un perfil público ajeno», y «profesor ve perfiles de alumnos» a «solo los de sus sesiones» (A no ha reservado; los casos con reservas, en `test:profiles`).
    - Regresión con la API parada: `test:profiles` 25, `test:rls` 22, `test:attendance` 12, `test:minors` 14, `test:bookings` 18 y `test:checkin` 8, todos OK.
    - Contra la API real (`npm run dev`, JWT firmados, fixtures borrados al acabar): `GET`/`PATCH /me/profile` (200 y 400), directorio con `q`, ficha con el campo oculto ausente, 404 igual para no público, 400 `invalid_pagination`, despublicar 403 / 200 y 401 sin token, todo como en el diseño.
  - **Lint**: `.eslintrc.json` (`eslint:recommended`, ESLint 8 ya instalado, sin dependencias nuevas); `npm run lint` cubre ahora `src`, `scripts` y `migrations`, y pasa sin errores.
- **Pendiente**:
  - `bio` y `display_name` no se filtran por contenido: lo resuelve el admin despublicando.
  - Riesgo residual aceptado (ADR 0010): el profesor lee a nivel SQL la fila entera de los alumnos de sus sesiones.

### B14 — Racha, horas, badges, ranking mensual opt-in y disciplina abierta — CERRADO
- **Objetivo**: gamificación básica sobre la asistencia: racha semanal, horas entrenadas, badges y un ranking mensual por disciplina con opt-in; y la **disciplina abierta** (el sparring), que las horas necesitan y hoy no cabe en el modelo. Términos en `CONTEXT.md` («Racha y logros», «Disciplina abierta», «Cubrir», «Campos visibles»). Sin ADR: nada es difícil de deshacer (calcular al leer admite una caché después sin cambiar la API, y el opt-in sigue el ADR 0010).
- **Choques con lo existente** (detectados en el diseño, 2026-10-30):
  - `student_stats_daily` (001) asume agregados nocturnos con `streak_weeks`, pero B14 lo calcula todo al leer y no depende de B16. B14 no la usa; B16 decide su forma (y quitar `streak_weeks`).
  - `activity_feed` (001): tabla sin bloque, sin RLS y sin uso, accesible por `app_user`. No hay feed: **se borra**.
  - B13 dice que el perfil público nunca enseña asistencia. Horas, racha y badges son asistencia agregada: solo salen con dos campos visibles nuevos; nunca el detalle (sesiones, presentes, faltas). `CONTEXT.md` ya matizado.
  - `public_profiles` y sus tests fijan **exactamente** 7 columnas y 2 funciones (`can_be_public`, `public_disciplines`); B14 añade una columna y una función.
  - El sparring es «libre para todas las disciplinas», pero toda sesión tiene una disciplina y solo la reserva quien la cubre (`covers()`, 009/012): un alumno de plan de 1 disciplina no podría reservarlo.
  - `public_disciplines` usa `covers()`: con la disciplina abierta, todo alumno con suscripción enseñaría «Sparring».
  - La dependencia era B7; la real es B8 (asistencia) y B13 (`visible_fields`, `public_profiles`). La disciplina abierta toca `covers()` (B10.5, ya implementado).
- **Reglas** (decididas 2026-10-30):
  - **Qué cuenta**: una fila `attendance` con `status = 'present'` de una sesión no cancelada, con o sin lista cerrada (un presente desmarcado antes del cierre deja de contar). Reservas, faltas y sin registrar no cuentan. Todo se calcula **al leer** sobre `attendance` + `class_sessions`, en hora de Madrid (`starts_at AT TIME ZONE 'Europe/Madrid'`); correcciones y cancelaciones retroactivas se aplican solas.
  - **Racha** (semanas, lunes–domingo):
    - una semana **suma** si tiene ≥ 1 presente, de cualquier disciplina;
    - se **salta** (ni suma ni rompe) si la academia no celebró ninguna sesión esa semana (ninguna `class_sessions` no cancelada que empiece en ella y ya terminada);
    - cualquier otra semana terminada sin presente la **rompe**;
    - la semana en curso suma si ya tiene presente y no rompe si aún no;
    - se dan `current` y `best`.
    - `shortcut:` el salto mira toda la academia, no las disciplinas del alumno (si en agosto solo hay Kids, un adulto rompe la racha); revisar si la academia lo pide.
  - **Horas**: duración de la sesión (`ends_at - starts_at`) de cada presente. **Horas del mes** por disciplina; la sesión cuenta en el mes (Madrid) en que empieza. Las horas de una disciplina abierta suman, enteras, en **cada disciplina no abierta en que el alumno tiene algún presente ese mes**; si ese mes solo hizo abiertas, no suman en ninguna.
  - **Badges**: lista cerrada en el código, calculados al leer, con `earned_at` = `starts_at` del presente que cruzó el umbral (para los de racha, el lunes de la semana que lo alcanzó). Solo se pierden si una corrección o cancelación retroactiva quita el dato. Nadie los da a mano; los grados no son badges.
    - `first_day`: primer presente;
    - `hours_10`, `hours_50`, `hours_100`, `hours_250`, `hours_500`, `hours_1000`: horas entrenadas **totales** (todas las disciplinas; las de una abierta, una sola vez);
    - `streak_4`, `streak_12`, `streak_26`, `streak_52`: **mejor** racha.
  - **Ranking mensual**:
    - uno por disciplina **activa y no abierta** (una desactivada sigue consultable por `discipline_id` para meses pasados; una abierta → 404 `ranking_not_found`);
    - `month=YYYY-MM` (por defecto el mes en curso en Madrid), sin límite hacia atrás; formato inválido → 400 `invalid_field`;
    - entran solo quienes **hoy** pueden ser públicos y lo son (`can_be_public`, `is_public`), rol `alumno`, con `visible_fields.ranking` y **> 0 h** en esa disciplina ese mes. Un mes pasado se calcula con el opt-in y los nombres de hoy;
    - orden por horas desc; empates con el mismo puesto (`rank()`: 1, 2, 2, 4) y dentro, por `display_name, id`;
    - fila: `{ rank, id, display_name, hours }` con `hours` a un decimal. Nada más;
    - paginación como el directorio: 25 por defecto, 100 máximo, 400 `invalid_pagination`;
    - lo lee cualquiera con sesión, sin perfil completo; sin sesión, 0 filas.
  - **Campos visibles** (`visible_fields`, B13): dos claves más en la lista cerrada, `false` al empezar:
    - `ranking`: aparecer en los rankings mensuales;
    - `achievements`: la ficha pública enseña `{ streak: { current, best }, badges: [{ code, earned_at }] }`.

    Exigen ser público, así que hijo, hijo con 18 sin reclamar, tutor (rol) y admin quedan fuera sin regla nueva. Un profesor puede guardarlos pero no tienen efecto (no entrena como alumno): `achievements` sale `NULL` y no aparece en rankings. Despublicar (admin) lo quita todo.
  - **Privado** (`progress`): lo ve el propio alumno, cualquier tutor vinculado de un hijo (también con 18 sin reclamar, como el resto de lo del hijo) y el admin de cualquier alumno; nunca el profesor ni otro alumno. Contenido: racha `current`/`best`, badges con fecha, y horas del mes por disciplina (`month=`, por defecto el actual). Sin puesto en el ranking.
  - **Disciplina abierta**:
    - `disciplines.is_open boolean NOT NULL DEFAULT false`, la pone el admin al crear o editar (B5);
    - `covers()`: además de lo de siempre, cubre una abierta para cualquier suscripción en vigor, respetando «solo menores» (adulto nunca una `minors_only`, ni con plan solo menores);
    - **no se elige**: no puede estar en `subscription_disciplines` y no ocupa hueco; en `plan_disciplines` se ignora. Elegirla da 409 `discipline_not_eligible`, como cualquier disciplina no elegible: en `validateOrder` (`billing.js`: contratar, subir/bajar) y en `change_discipline` (014: cambio y baja de disciplina);
    - marcarla abierta con alguna `subscription_disciplines` de una suscripción viva → 409 `discipline_in_use`;
    - desmarcarla: `revoke_coverage(student)` (012) para cada alumno con reservas o esperas futuras en ella (cancela con «sin cobertura» y avisa). `app_user` no tiene `EXECUTE` sobre `revoke_coverage` (solo lo llama el webhook, con `servicePool`): el servicio de catálogo lo llama con `servicePool` tras confirmar el cambio, o con una función `SECURITY DEFINER` que exija admin; no se da `EXECUTE` a `app_user`;
    - `public_disciplines` y el filtro `discipline_id` del directorio **no** incluyen las abiertas;
    - el calendario (`covers()`) ya la marca cubierta para cualquier suscriptor.
- **Pasos**:
  1. **Migración `019`**:
     - `DROP TABLE activity_feed` (el `down` la recrea como en 001).
     - `disciplines.is_open` y `covers()` (con `CREATE OR REPLACE`, misma firma, la versión de 012 + `OR d.is_open`).
     - `public_disciplines` sin abiertas.
     - Funciones `SECURITY DEFINER` (owner `service_role`, `EXECUTE` solo `app_user`, exigen `app.current_user_id`):
       - `student_present(p_id)` (interna, sin `EXECUTE` para `app_user`): los presentes con `starts_at`, `ends_at`, `discipline_id`, `is_open`. Fuente única de las tres siguientes.
       - `student_progress(p_id, p_month date)`: se guarda sola (propio, `is_guardian_of(p_id, true)` o admin; si no, `NULL`). Devuelve `jsonb` `{ streak, badges, hours }`.
       - `public_achievements(p_id)`: `NULL` salvo alumno público, `can_be_public` y `achievements` visible.
       - `monthly_ranking(p_discipline, p_month date)`: filas `(rank, id, display_name, hours)` con las reglas de arriba.
     - `public_profiles`: columna `achievements` (`public_achievements(id)`), con `REVOKE`/`GRANT` como en 017.
  2. **Servicio** (`services/progress.js`, nuevo): `getProgress`, `getRanking`; las reglas de racha y badges viven en SQL (una sola fuente; el servicio solo pagina y da forma). Siempre `client` (RLS), nunca `servicePool`.
  3. **B13**: `VISIBLE_FIELDS` con `ranking` y `achievements`; `getPublicProfile` borra `achievements` si es `NULL`.
  4. **B5 / B10.5**: `is_open` en el CRUD admin de disciplinas (con el 409 y `revoke_coverage` al desmarcar), y rechazo de abiertas al elegir disciplinas (`validateOrder` en `billing.js` y `change_discipline` de 014, que se reescribe en `019` con `NOT d.is_open`).
  5. **Rutas**: `GET /me/progress` en `routes/me.js` (`profile_id` como el resto) y `routes/rankings.js` (`requireAuth`).
  6. **Docs**: `contexto-proyecto.md` §6 (`activity_feed` borrada, `is_open`), `db-architecture.md` si sigue listando `activity_feed`.
- **Endpoints**:
  - `GET /me/progress?profile_id=&month=YYYY-MM` → `{ streak: { current, best }, badges: [{ code, earned_at }], hours: { month, disciplines: [{ id, name, hours }] } }`; 400 `invalid_profile_id` / `invalid_field`; 403 `not_guardian` si `profile_id` no es un hijo suyo (como el resto de `/me`; `student_progress` da `NULL` y el servicio lo traduce).
  - `GET /rankings/:disciplineId?month=&limit=&offset=` → `{ discipline: { id, name }, month, rows: [{ rank, id, display_name, hours }], total, limit, offset }`; 400 `invalid_id` / `invalid_field` / `invalid_pagination`; 404 `ranking_not_found` (no existe o es abierta).
  - `GET /profiles/:id` y `GET /profiles`: la ficha gana `achievements?`.
  - `GET/PATCH /me/profile`: `visible_fields` con 6 claves.
  - Admin de disciplinas (`POST /admin/disciplines`, `PATCH /admin/disciplines/:id`): `is_open` en crear/editar; 409 `discipline_in_use`.
  - Contratar, cambiar de plan y cambio de disciplina: elegir una abierta → 409 `discipline_not_eligible`.
- **Tests** (`test:progress`, nuevo):
  - **Racha**: semanas seguidas; semana sin presente rompe; semana sin sesiones celebradas en la academia se salta; semana en curso sin presente no rompe; dos presentes en una semana cuentan una; corte lunes 00:00 en Madrid (también en el cambio de hora); `best` > `current`; presente sin cerrar suma y desmarcado no; corrección presente → falta y cancelación retroactiva cambian el pasado.
  - **Horas**: duración real (1 h 30 = 1,5); mes por `starts_at` en Madrid (sesión del 31 a las 23:30); abierta suma en cada disciplina con presente ese mes y en ninguna si solo hizo la abierta.
  - **Badges**: cada umbral y su `earned_at`; abierta contada una vez en las totales; los de racha usan `best`; una corrección hace perder uno.
  - **Ranking**: solo opt-in públicos elegibles con > 0 h; hijo con `visible_fields.ranking` y `is_public` forzados por SQL no sale; profesor no sale; empates 1, 2, 2, 4; mes pasado; disciplina abierta → 404; retirar el opt-in lo quita también de meses pasados; paginación; sin sesión, 0 filas.
  - **Privado**: propio, tutor de su hijo, admin sí; otro alumno, profesor y tutor ajeno no.
  - **Perfil público**: `achievements` detrás de su flag; columnas de `public_profiles` exactamente 8 y funciones exactamente `can_be_public`, `public_disciplines`, `public_achievements`, ninguna menciona `student_health_info`.
  - **Disciplina abierta**: la cubre un plan de 1 disciplina; un adulto no cubre una abierta solo menores; no se puede elegir; marcarla con elegidas → 409; desmarcarla cancela reservas futuras con «sin cobertura»; no sale en las disciplinas públicas.
  - **Regresión**: `test:profiles` (ajustado a 8 columnas y 3 funciones), `test:bookings`, `test:billing`, `test:webhook`, `test:catalog`, `test:classes`, `test:calendar`, `test:attendance`, `test:checkin`, `test:rls`, `test:minors`.
- **Fuera de alcance**:
  - push de logros (B15 lo pasa a `MEJORAS.md` 5.3; podría detectar «acaba de conseguir» comparando `student_progress` antes y después de marcar presente);
  - feed de actividad, ranking general, badges por disciplina, «1.º del mes», grados (en `MEJORAS.md`);
  - `student_stats_daily` (B16);
  - caché o agregados de la racha (solo si un día hace falta);
  - avisos al perder o ganar un badge;
  - UI (B18), incluido dejar claro que el ranking es «entre quienes participan».
- **Checklist de cierre**:
  - [x] Migración `019`: `activity_feed` borrada, `is_open` + `covers()`, funciones de progreso y ranking, `public_profiles` con `achievements`.
  - [x] Racha, horas y badges calculados al leer en hora de Madrid, con las reglas de arriba.
  - [x] Ranking mensual por disciplina, solo opt-in elegible; **un hijo nunca aparece**, ni con los flags forzados por SQL.
  - [x] Privado solo para el propio alumno, sus tutores y el admin.
  - [x] Disciplina abierta: cubierta para todos, no elegible, 409 y `revoke_coverage` al desmarcar.
  - [x] `public_profiles` sigue sin depender de `student_health_info` (test de dependencias).
  - [x] Tests (`test:progress` y regresión).
- **Implementación** (migración `019`, 2026-10-30):
  - **`019`**:
    - `DROP TABLE activity_feed` (el `down` la recrea como en 001, con su índice y su FK).
    - `disciplines.is_open`; `covers()` con `CREATE OR REPLACE` (la de 012 + `d.is_open OR`, dentro del mismo filtro de «solo menores»); `public_disciplines` con `NOT d.is_open`.
    - `change_discipline` se reescribe sobre su definición actual (`pg_get_functiondef` + `replace` de la condición del destino, `NOT d.is_open`) en vez de copiar la función de 014 entera. Si no encuentra el texto exacto, la migración falla; el `down` hace el cambio inverso.
    - Funciones `SECURITY DEFINER` (owner `service_role`). Internas, sin `EXECUTE` para `app_user`: `student_present` (los presentes que cuentan, exige `app.current_user_id`), `month_hours` (horas del mes por disciplina no abierta, con la regla de la abierta) y `student_achievements` (racha y badges). Así la regla de horas y la de racha viven una sola vez: `student_progress` y `monthly_ranking` usan `month_hours`, y `student_progress` y `public_achievements` usan `student_achievements`. Con `EXECUTE` para `app_user`: `student_progress`, `public_achievements`, `monthly_ranking` y `revoke_open_discipline`.
    - Racha: semanas `date_trunc('week', starts_at AT TIME ZONE 'Europe/Madrid')` desde la del primer presente hasta la actual; cada una suma, se salta o rompe; cada ruptura abre un tramo y `n` cuenta las que suman dentro de él. `best` = el mayor `n`, `current` = el `n` de la última semana. Los de racha toman el lunes 00:00 de Madrid de la semana en que `n` llega al umbral; los de horas, la suma acumulada por `starts_at`. El `shortcut:` del salto está en la función.
    - Horas redondeadas a un decimal (`round(…, 1)`) en el ranking y también en el progreso privado (decidido 2026-10-30). El ranking ordena y empata sobre el valor redondeado, el que se ve.
    - `monthly_ranking` (decidido 2026-10-30): la RLS de `disciplines` oculta las desactivadas a quien no es admin, así que la función devuelve también el nombre de la disciplina, en cada fila y, sin participantes, en una fila sin alumno (`LEFT JOIN`). Lanza `ranking_not_found` si no existe o es abierta. Sin sesión, 0 filas.
    - `revoke_open_discipline(discipline)`: exige admin (`42501` `not_allowed`) y llama a `revoke_coverage` por cada alumno con reservas o esperas futuras en ella. Corre en la misma transacción que el `UPDATE`, así que `covers` ya ve la disciplina desmarcada. `app_user` sigue sin `EXECUTE` sobre `revoke_coverage`.
    - `public_profiles` se recrea (un `CREATE OR REPLACE` no puede quitar la columna en el `down`) con `achievements` = `public_achievements(id)` y `REVOKE`/`GRANT` como en 017.
    - Con su `down` (probado up → down → up).
  - **Servicio** (`services/progress.js`, con `client`): `getProgress` (`NULL` → 403 `not_guardian`) y `getRanking` (`month` `YYYY-MM` → 400 `invalid_field`; paginación como el directorio; una sola consulta sobre `monthly_ranking` con `total` y la página).
  - **B13**: `VISIBLE_FIELDS` con `ranking` y `achievements`; la ficha selecciona `achievements` y `card()` la borra si es `NULL` (como los otros opcionales).
  - **B5 / B10.5**: `is_open` en `DISCIPLINE_SPEC` y en las lecturas del catálogo (también el público). `updateDiscipline` bloquea la fila y, al marcarla abierta, da 409 `discipline_in_use` si alguna suscripción viva (`active`, `past_due`, `unpaid`) la tiene elegida **o en una bajada programada** (`scheduled_discipline_ids`); al desmarcarla llama a `revoke_open_discipline`. `validateOrder` filtra `NOT is_open`.
  - **Rutas**: `GET /me/progress` (`profile_id` con `validateSubject`, como el resto de `/me`) y `routes/rankings.js` (`requireAuth`, `invalid_id` por `router.param`).
  - **Tests**:
    - `test:progress` (20): todos los casos de Tests. Las reglas se prueban en una transacción de `servicePool` que se deshace al final; dentro se cancelan las sesiones ajenas, porque la racha mira toda la academia. El corte del lunes se prueba con domingo 23:30 y lunes 00:30 de Madrid en los dos cambios de hora (son el mismo domingo en UTC). La privacidad, la ficha y el ranking de una disciplina desactivada (por la RLS) van por HTTP con fixtures confirmados que se borran al acabar.
    - `test:profiles` ajustado: 8 columnas, funciones `can_be_public`, `public_achievements` y `public_disciplines`, y ninguna de las que llaman (`covers`, `student_achievements`, `student_present`) menciona `student_health_info`; 6 flags.
    - Regresión con la API parada: `test:progress` 20, `test:profiles` 25, `test:bookings` 18, `test:billing` 38, `test:webhook` 35, `test:catalog` 10, `test:classes` 12, `test:calendar` 15, `test:attendance` 12, `test:checkin` 8, `test:rls` 22 y `test:minors` 14, todos OK (Stripe en sandbox). `npm run lint` sin errores.
    - Contra la API real (`npm run dev`, JWT firmados, fixtures borrados al acabar): `GET /me/progress` (200, y 403 `not_guardian` para otro alumno), `GET /rankings/:id` (200, 400 con `month=2026-13`, 401 sin token) y la ficha pública con `achievements`, todo como en el diseño.
- **Pendiente**:
  - Carrera aceptada: si el admin marca una disciplina abierta mientras vive un checkout (o una bajada programada en Stripe) que la elige, el webhook la escribe igualmente en `subscription_disciplines` (no revalida). El alumno ocupa un hueco con algo que ya cubre, y nada lo avisa: lo corrige un cambio de disciplina.
  - Una abierta en `plan_disciplines` se ignora para cubrir, pero `checkEligible` (B5) la sigue contando entre las elegibles de un plan (→ `MEJORAS.md` 6.5).
  - Los `id` de disciplina salen como número dentro del `jsonb` (`hours.disciplines`, como `public_disciplines` en B13) y como texto en `discipline.id` del ranking (como el resto del catálogo; aceptado).

### B15 — Push (`push_subscriptions`, envío) — CERRADO
- **Objetivo**: entregar por push los avisos de reservas y el nuevo de re-firma, con email de respaldo para quien no tiene ningún dispositivo de push. Términos en `CONTEXT.md` («Avisos»), decisiones en ADR 0008 (outbox) y ADR 0011 (push por destinatario con email de respaldo).
- **Choques con lo existente** (detectados en el diseño, 2026-10-31):
  - La checklist pedía push de «pago fallido», pero `CONTEXT.md` dice que los avisos de facturación van siempre por email. **Gana `CONTEXT.md`**: la facturación sigue solo por email (B10.6) y el mapa `CHANNELS` de JS no cambia.
  - Este bloque y `PLAN_FAMILIA.md` (§ 6) incluían el aviso «cumple 18, debe reclamar su perfil», pero no existe el flujo de reclamar el perfil (aplazado desde B4.6) y el aviso necesita un disparador por fecha (un cron). **Se aplaza** al bloque que cree ese flujo.
  - B14 dejó el push de logros para B15: obliga a comparar `student_progress` antes y después de cada marca, y una corrección quita un badge ya avisado. **Pasa a `MEJORAS.md`** (5.3).
  - `CONTEXT.md` dice que el cambio de clase avisa al alumno, pero ese aviso no existe (como la promoción y la exención de cancelación tardía, pendientes desde B7). **Queda pendiente** con ellos, en un bloque propio (**B7.1**).
  - `push_subscriptions` (001): sin RLS, `app_user` con `arwd`, `user_id` sin FK y `endpoint` sin `UNIQUE`. Está vacía: **se rehace**.
  - No hay logout en el servidor (JWT sin estado): dar de baja un dispositivo es cosa del cliente (B18).
  - El aviso de re-firma tampoco existía: se crea aquí.
- **Reglas** (decididas 2026-10-31):
  - **Qué va por push**:
    - Reservas (`booking_notice`): `no_coverage`, `booking_promoted`, `session_cancelled`, `discipline_change`. Destinatarios sin cambios: el alumno o todos sus tutores (también los de un hijo con 18 sin reclamar).
    - Re-firma (`notice.agreement_published`, nuevo), ver abajo.
    - Facturación: **no** (solo email, B10.6).
  - **Canal por destinatario, al crear el aviso** (ADR 0011): `push` si tiene al menos un dispositivo de push; si no, `email` (email de respaldo). No se vuelve a decidir: si sus dispositivos caducan después, la entrega acaba `skipped` (`no_subscription`).
  - **Quién no recibe entrega**: los admin (como en B10.6), el **actor** del aviso (el tutor que cambia la disciplina de su hijo; los demás tutores, sí) y nadie con rol profesor (no tiene avisos). El aviso queda igualmente en `audit_log`.
  - **Agrupar cancelaciones**: si una misma transacción cancela varias reservas de un alumno con la misma acción (`no_coverage`, `discipline_change`), `audit_log` guarda una fila por reserva, pero solo la primera crea entregas. El worker compone un único mensaje con todas las de la misma acción, alumno y `created_at` (`now()` es constante en la transacción): «Se han cancelado 8 reservas de Lucía…».
  - **Caducidad**: los avisos de reservas guardan `expires_at` = inicio de la sesión (en uno agrupado, la sesión más próxima); el worker los marca `skipped` (`stale`) desde entonces, como en B10.6. El TTL del push es el tiempo que le queda al aviso hasta caducar.
  - **Re-firma** (`agreement_published`):
    - Al publicar una versión, en la misma transacción.
    - Destinatarios: quien tenía firmada la versión **anterior** (la que se retira) de ese tipo y sigue con una suscripción viva (`active`, `past_due`, `unpaid`). Por un hijo (menor de 18), sus tutores; el tutor (rol) que firmó su propio `data_protection`, si algún hijo suyo tiene una suscripción viva.
    - Excluidos: el hijo con 18 cumplidos sin reclamar su perfil (sus tutores ya no firman por él), del `waiver` quien tiene el seguro en vigor, y todo en la primera publicación de un tipo (no hay anterior).
    - Una sola entrega por destinatario aunque tenga varios hijos afectados. El texto no los nombra: «Hay una versión nueva de <acuerdo>. Fírmala para seguir reservando».
  - **Entrega push**: una por aviso, destinatario y canal (el `UNIQUE` de ADR 0008). El worker la envía a **todos** los dispositivos de push del destinatario en ese momento:
    - `sent` si al menos uno la acepta (201);
    - 404/410 → borra ese dispositivo; si no queda ninguno que la aceptara, `skipped` (`no_subscription`);
    - red, 429, 5xx → reintenta la entrega entera con las esperas de B10.6. Los dispositivos que ya la recibieron no la ven dos veces: `tag` y cabecera `Topic` = id del aviso;
    - 401/403 → `failed` sin borrar nada (suele ser VAPID mal configurada);
    - otro 4xx → `failed` (permanente).
  - **Dispositivos de push** (`push_subscriptions`):
    - Una fila por dispositivo, de un solo perfil: `endpoint` `UNIQUE`. Al suscribirse se hace upsert por `endpoint` y la fila **pasa al usuario actual** (móvil compartido).
    - Lo dan de alta y de baja solo **alumno y tutor** (el resto, 403). La baja al cerrar sesión la hace el cliente (B18); si no la hace, el dispositivo sigue recibiendo avisos hasta que otro se suscriba en él o caduque (riesgo aceptado, ADR 0011).
    - Sin límite de dispositivos por perfil (el rate limiting es de B20).
    - `endpoint` validado en la ruta (frontera de confianza, contra el SSRF del worker): `https` y host en una lista cerrada de push services: `fcm.googleapis.com`, `*.push.services.mozilla.com`, `*.notify.windows.com`, `*.push.apple.com`. El worker confía en lo guardado.
  - **VAPID**:
    - `.env`: `PUSH_TRANSPORT` (`log` | `webpush`, por defecto `log`, como `EMAIL_TRANSPORT`), `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY` (obligatorias con `webpush`), `VAPID_SUBJECT` (`mailto:` del buzón de la academia; por defecto el de `EMAIL_REPLY_TO`). Se validan al arrancar.
    - Generar: `npx web-push generate-vapid-keys`. La privada no se versiona.
    - Rotar: cambiar las claves y vaciar `push_subscriptions`; la PWA (B18) compara la clave pública al abrir y vuelve a suscribirse. Sin doble clave.
  - **Contenido**:
    - Payload JSON `{ title, body, url, tag }`, cifrado por `web-push` (`aes128gcm`). Solo español. Fechas y horas en `es-ES`, hora de Madrid.
    - Datos mínimos (se ve en la pantalla de bloqueo): nombre del alumno (un tutor con dos hijos necesita saber cuál), disciplina o clase y fecha de la sesión, o el tipo de acuerdo. **Nunca** salud, edad, fecha de nacimiento ni motivo de una cuenta impagada. Ejemplo: «Sesión cancelada · BJJ Fundamentos, lun 3 nov 19:00 (Lucía)».
    - `url` a `APP_URL/bookings` (reservas) o `APP_URL/agreements` (re-firma).
  - **Email de respaldo**: plantillas para los 4 avisos de reservas y la re-firma con `mail()` de B10.6. El pie pasa a ser un parámetro: «email de servicio sobre tus reservas en Kaizen» (o «sobre tus acuerdos»), con el contacto de la academia. Mismo enlace que el push.
  - **Sin opt-out** por tipo de aviso: el push se deja quitándole el permiso al navegador (y entonces llega el email de respaldo); el email de respaldo es de servicio (LSSI art. 21).
- **Pasos**:
  1. **Migración `020`**:
     - `push_subscriptions` se borra y se crea: `id uuid` (default `gen_random_uuid()`), `profile_id` → `profiles` `ON DELETE CASCADE`, `endpoint text UNIQUE`, `p256dh text`, `auth text`, `created_at`. Índice por `profile_id`. RLS `ENABLE` + `FORCE`: `SELECT` y `DELETE` de las filas propias para `app_user`; sin `INSERT` ni `UPDATE` directos. El `down` la recrea como en 001.
     - `notice_deliveries`: `CHECK (channel IN ('email', 'push'))`.
     - `save_push_subscription(endpoint, p256dh, auth)` (`SECURITY DEFINER`, `EXECUTE` para `app_user`): exige `app.current_user_id`; upsert por `endpoint` con `profile_id` = el usuario actual.
     - `enqueue_notice(audit_id, recipients uuid[], actor uuid)` (interna, sin `EXECUTE` para `app_user`): una entrega por destinatario, sin admins ni el actor; `push` si tiene algún dispositivo de push, si no `email`; `ON CONFLICT DO NOTHING`.
     - `booking_notice` con `CREATE OR REPLACE`: añade `expires_at` (inicio de la sesión) a `changes`, y llama a `enqueue_notice` salvo que en la transacción ya exista un aviso con la misma acción y el mismo alumno (`created_at = now()`).
     - `agreement_notice(document uuid)` (`SECURITY DEFINER`, `EXECUTE` para `app_user`): exige admin (`42501` `not_allowed`) y que el documento sea el vigente; busca la versión retirada más reciente del tipo (sin ella, no hace nada), crea `notice.agreement_published` (`type`, `version`, `previous_version`, `recipients`) y llama a `enqueue_notice`.
     - Con su `down` (probado up → down → up).
  2. **Dependencia**: `web-push` (cifrado `aes128gcm` y firma VAPID; no compensa escribirlos a mano).
  3. **Configuración** (`src/config/push.js`): las variables de VAPID de arriba, validadas al arrancar.
  4. **`services/push.js`**: `send({ subscription, payload, ttl, topic })` con dos transportes, `webpush` y `log` (consola + fichero, como el email). Devuelve el estado por dispositivo; clasifica el error en `gone` (404/410), transitorio (red, 429, 5xx) o permanente.
  5. **`services/notices.js`**:
     - `compose` por canal: el email de B10.6, los 5 nuevos emails de respaldo y el payload push (con los avisos agrupados).
     - `sendPending`: las entregas `push` leen los dispositivos del destinatario, envían a todos, borran los `gone` y marcan como arriba (`skipped` `no_subscription` si no queda ninguno).
     - `mail()` con el pie como parámetro.
  6. **`publishDocument`** (`services/agreements.js`): llama a `agreement_notice` tras publicar, en la misma transacción.
  7. **Rutas** (`routes/me.js` y una ruta pública para la clave):
     - `POST /me/push-subscriptions` `{ endpoint, keys: { p256dh, auth } }` → 201; 400 `invalid_field` (endpoint fuera de la lista, no `https`, claves vacías o no base64url); 403 `forbidden` si el rol no es alumno ni tutor.
     - `DELETE /me/push-subscriptions` `{ endpoint }` → 204 (también si no existe o es de otro: no se distingue).
     - `GET /push/vapid-public-key` → `{ key }` (con sesión; 503 `push_disabled` con `PUSH_TRANSPORT=log` sin claves).
  8. **Docs**: `contexto-proyecto.md` §3 (variables) y §6 (`push_subscriptions`, funciones de `020`).
- **Tests** (`test:push`, nuevo; `web-push` real contra un servidor HTTP local que responde 201, 404, 410, 429 o 500, con claves de cliente de `crypto.createECDH('prime256v1')` y endpoints insertados con `servicePool`):
  - **Canal**: con un dispositivo → `push`; sin ninguno → `email`; admin y actor sin entrega; los avisos de facturación siguen solo con `email`.
  - **Envío**: dos dispositivos reciben el payload descifrable con `tag` y `Topic`; 410 en uno borra ese y la entrega queda `sent`; 410 en todos → `skipped` `no_subscription`; 429/500 → `pending` con espera; 401/403 → `failed` sin borrar; caducado al empezar la sesión → `skipped` `stale`; TTL acotado.
  - **Agrupar**: `revoke_coverage` de un alumno con 3 reservas → 3 avisos, 1 entrega por tutor, un mensaje con las 3.
  - **Re-firma**: solo quien firmó la anterior y tiene suscripción viva; tutor por su hijo; tutor (rol) por su `data_protection`; sin el hijo de 18 sin reclamar; `waiver` sin quien tiene seguro en vigor; primera publicación sin aviso; un no admin que llama a `agreement_notice` → `42501`.
  - **Dispositivos**: alta, baja; mismo `endpoint` desde otro usuario pasa a ser suyo y el anterior deja de verlo; RLS: nadie lee ni borra los ajenos; `app_user` no inserta directamente; profesor y admin → 403; endpoint `http`, de un host fuera de la lista o con IP → 400.
  - **Contenido**: payloads y emails de respaldo sin fecha de nacimiento ni edad; nombre del alumno presente.
  - **Regresión**: `test:notices`, `test:bookings`, `test:billing`, `test:webhook`, `test:attendance`, `test:agreements`, `test:rls`, `test:minors`.
  - **Manual**: con `PUSH_TRANSPORT=log`, cancelar una sesión y ver el payload en el fichero. El push real en Chrome queda para B18 (necesita el Service Worker).
- **Fuera de alcance**:
  - push de los avisos de facturación (solo email);
  - push al admin y al profesor;
  - aviso «cumple 18, reclama tu perfil» (bloque del flujo de reclamar el perfil);
  - aviso de cambio de clase (B7.1);
  - push de logros (`MEJORAS.md` 5.3);
  - preferencias de avisos;
  - Service Worker, pedir permiso y baja al cerrar sesión (B18);
  - límite de dispositivos y rate limiting de las rutas (B20);
  - endpoint y UI de entregas fallidas (B19).
- **Implementación** (migración `020`, 2026-10-31):
  - **`020`**:
    - `push_subscriptions` se borra y se crea como en el diseño; `REVOKE ALL` + `GRANT SELECT, DELETE` a `app_user` (los privilegios por defecto le daban `arwd`). El `down` la recrea como en 001.
    - `notice_deliveries_channel_check` se sustituye por `channel IN ('email', 'push')`. El `down` falla si hay entregas `push` (borrarlas antes).
    - `enqueue_notice` excluye también a quien tiene rol profesor (además de admin y actor). El actor es `app.current_user_id` tal cual: sin sesión (webhook) no se excluye a nadie; `audit_log.actor_id` sigue con el `COALESCE` al alumno de 009.
    - `booking_notice` pasa a `plpgsql`; `recipients` se guarda como antes (array JSON) y añade `expires_at`. Agrupa **cualquier** acción de reservas (no solo `no_coverage` y `discipline_change`): con las otras dos no se da en la práctica (una reserva por alumno y sesión). Para encontrar el grupo se añade un índice parcial `audit_log (created_at) WHERE resource_type = 'booking'` (no estaba en el diseño).
    - `agreement_notice`: si el documento no es el vigente, `22023` `document_not_current`. Usa la misma regla de «firma que cuenta» que `signed_current` (013): el adulto que firmó él mismo o, por un menor, la firma de un tutor; así el hijo de 18 sin reclamar queda fuera sin una regla aparte. El tutor por su `data_protection` cuenta con cualquier hijo vinculado con suscripción viva. «Seguro en vigor» = `active` o `past_due`, como `has_risk_cover`. Sin destinatarios, el aviso se registra igual (con `recipients` vacío).
    - Con su `down` (probado up → down → up).
  - **Dependencia**: `web-push` 3.6.7.
  - **Configuración** (`src/config/push.js`): `PUSH_TRANSPORT`, `VAPID_*` y `PUSH_LOG_PATH` (por defecto `./storage/push.log`, como el del email). Con claves, `webpush.setVapidDetails` valida su formato al arrancar.
  - **`services/push.js`**: `send` no lanza: devuelve `{ status: 'sent' | 'gone' | 'transient' | 'permanent', error }`. Un error sin código HTTP (red, timeout de 15 s) es transitorio.
  - **`services/notices.js`**:
    - `compose` delega en `composeService` para los 4 avisos de reservas y la re-firma: payload push `{ title, body, url, tag }` o email de respaldo con `mail()`. El grupo se busca por el id del aviso en SQL (un `Date` de JS pierde los microsegundos de `created_at`).
    - `mail(subject, d, paragraphs, link, about)`: `about` es la primera frase del pie (la de facturación por defecto); el contacto de la academia lo añade `mail()`.
    - `sendPending(db, transport, pushTransport)`: la caducidad de un aviso de reservas es la sesión más próxima del grupo; el TTL, los segundos que le quedan. Una entrega push con un dispositivo aceptado y otro con error transitorio queda `sent`. Con transitorios agota las esperas de B10.6 y acaba `failed`. Si hay transitorios y permanentes a la vez, reintenta. Los dispositivos `gone` se borran en la transacción del lote. `Topic` = id del aviso sin guiones (web-push admite como mucho 32 caracteres); `tag` = id del aviso.
  - **`publishDocument`**: llama a `agreement_notice` tras el `audit_log` de la publicación.
  - **Rutas**:
    - `POST` y `DELETE /me/push-subscriptions` usan `requireRole('alumno', 'tutor')`, que responde 403 `insufficient_role` (como el resto de la API) en vez del `forbidden` del diseño.
    - Validación del `endpoint`: también rechaza puerto explícito, usuario o contraseña en la URL y más de 2048 caracteres. Las claves deben ser base64url y medir lo que exige el cifrado: `p256dh` 65 bytes y `auth` 16 bytes.
    - El `POST` responde `{ ok: true }`.
    - `GET /push/vapid-public-key` va en `routes/push.js` (montado en `/push`): 503 `push_disabled` si no hay clave pública.
  - **Tests** (`test:push`): web-push solo habla `https`, así que el servidor local es HTTPS, con un certificado autofirmado generado con `openssl` y `NODE_TLS_REJECT_UNAUTHORIZED=0` (solo en el test). El test descifra el `aes128gcm` con `crypto.hkdfSync`. La re-firma corre en una transacción con `ROLLBACK`, donde los documentos reales pasan a borrador.
  - **Prueba manual** (`PUSH_TRANSPORT=log`): `cancel_session_bookings` como admin sobre una sesión con una reserva de un alumno con dispositivo; el worker deja la entrega `sent` y escribe en `storage/push.log` el payload `{ title: 'Sesión cancelada', body: 'BJJ Fundamentos manual, mar, 3 nov, 19:00 (Lucía Manual): la academia ha cancelado la sesión', url: …/bookings, tag }` con `TTL` y `Topic`.
  - **Regresión verde**: `test:notices`, `test:bookings`, `test:billing`, `test:webhook` (Stripe sandbox), `test:attendance`, `test:agreements`, `test:rls`, `test:minors`, además de `test:progress`, `test:calendar`, `test:checkin`, `test:profiles`, `test:catalog`, `test:classes` y `test:mfa`. `npm run lint` sin errores.
- **Pendiente**:
  - Push real en Chrome con el Service Worker (B18).
  - El formato de fecha corta sale como lo da `es-ES` («mar, 3 nov, 19:00»), con comas, y no como el ejemplo del diseño («mar 3 nov 19:00»; aceptado).
  - Hecho en B7.1: el grupo caduca al empezar su **última** sesión (no la más próxima) y solo cuenta las que no han empezado.
- **Checklist de cierre**:
  - [x] Migración `020`: `push_subscriptions` rehecha con RLS `FORCE`, `channel` con `push`, `save_push_subscription`, `enqueue_notice`, `booking_notice` y `agreement_notice`.
  - [x] Alta y baja de dispositivos de push (alumno y tutor), con traspaso del `endpoint` y la lista cerrada de hosts.
  - [x] Avisos de reservas y de re-firma por push, o por email si no hay dispositivo; sin admin ni actor; agrupados y caducados al empezar la sesión.
  - [x] Avisos de facturación sin cambios (solo email).
  - [x] Worker: envío a todos los dispositivos, limpieza 404/410, reintentos y `skipped` como arriba.
  - [x] Contenido mínimo, en español, sin salud, edad ni fecha de nacimiento.
  - [x] VAPID por `.env`, validada al arrancar.
  - [x] Tests (`test:push` y regresión) y prueba manual con `PUSH_TRANSPORT=log`.

### B16 — Foto diaria de suscripciones + tareas nocturnas — CERRADO
- **Objetivo**: guardar cada noche lo que los informes de B17 necesitan y no se puede reconstruir después: el estado de las suscripciones de cada día (**foto diaria**, `academy_stats_daily`). Y lanzar de verdad las tareas nocturnas, empezando por `extend-horizon`, que hasta hoy nadie programa. Todo lo que sale de la asistencia y las sesiones (ocupación, presentes, faltas, horas) **no se agrega**: B17 lo calcula al leer, como B14. Términos en `CONTEXT.md` § Informes («Foto diaria», «Alta» y «baja», «Ingreso mensual recurrente», «Ocupación»). ADR 0012.
- **Se apoya en**: `extendHorizon` (B6, ADR 0004), `subscriptions` (B10), `payer_changes` (B11, ADR 0009) y el patrón de `SECURITY DEFINER` con owner `service_role` (B14, B6.1).
- **Choques con lo existente** (detectados en el diseño, 2026-10-31):
  - **No es el primer cron**: `scripts/extend-horizon.js` está «pensado para cron diario» y `scripts/README.md` habla de un «cron nocturno», pero nada lo programa. En producción el horizonte (ADR 0004) solo avanzaría a mano. **B16 programa las dos tareas** con un mismo lanzador. La regla «ningún cron nuevo» no está escrita en ninguna parte; lo más parecido es el ADR 0008, que descarta un cron *por minuto* para los avisos, y eso no cambia.
  - **`student_stats_daily` (001) sobra**: `classes_attended` es asistencia, que se calcula al leer, y `streak_weeks` ya vive en B14 (`student_achievements`). Agregarla obligaría a recalcular días ya agregados tras cada corrección, cancelación retroactiva o ajuste de sesión. **Se borra**, como `activity_feed` en B14.
  - **`academy_stats_daily` (001) mezcla foto y asistencia**: `occupancy_rate` se recalcula siempre desde `bookings` + `class_sessions` y se queda obsoleta tras una retroactiva (el pendiente de B6.1). **Se quita.** Las columnas `*_students` se rehacen con las de abajo, todas `NOT NULL`.
  - **El pasado de las suscripciones no se reconstruye**: `subscriptions` solo guarda el estado actual (sin historial de `past_due`/`unpaid`) y `plans.price_cents` se sobrescribe al cambiar el precio. Por eso la foto es lo único que se guarda.
  - **B17 no dice qué informes hay**. Se fija aquí la lista (§ B17, «Desde B16») porque decide qué guarda la foto.
  - **El traspaso parece una baja y un alta**: la antigua pasa a `cancelled` y la sucesora nace en D (`payer_changes` `completed`). No cuenta como ninguna de las dos.
  - La dependencia era B8. La real es B10 (`subscriptions`), B11 (`payer_changes`) y B6 (`extendHorizon`).
- **Reglas** (decididas 2026-10-31):
  - **Qué se agrega**: solo lo irrecuperable, el estado de las suscripciones. La asistencia, las reservas y la ocupación se calculan al leer en B17 sobre `attendance`, `bookings` y `class_sessions`. Así una cancelación retroactiva, una corrección o un ajuste de sesión se aplican solos, sin recalcular días agregados. Si un informe necesita la racha o las horas, usa las funciones de B14 (`student_achievements`, `month_hours`) y no repite la regla.
  - **`academy_stats_daily`** (una fila por día de Madrid):
    - `date date` PK;
    - `active`, `past_due`, `unpaid`: suscripciones en cada estado en el momento de la foto (una viva por alumno, así que son alumnos);
    - `new_subscriptions` (**altas**): suscripciones con `created_at` ese día de Madrid, salvo la sucesora de un traspaso (`stripe_subscription_id` de un `payer_changes` `completed`);
    - `cancelled_subscriptions` (**bajas**): suscripciones con `cancelled_at` ese día de Madrid, salvo la antigua de un traspaso (`subscription_id` de un `payer_changes` `completed`);
    - `mrr_cents`: **ingreso mensual recurrente**, la suma de `plans.price_cents` de las suscripciones en vigor (`active`, `past_due`). Las impagadas no suman (no se cobran) y el seguro tampoco (es anual). `shortcut:` tras un cambio de precio se usa el nuevo aunque la suscripción pague el viejo hasta renovar, así que el error dura como mucho un mes; guardar el precio en la suscripción si la academia necesita el MRR exacto.

    Todas `integer NOT NULL`. Sin desglose por plan ni por disciplina (B17 no lo pide), y sin nada de salud, edad ni fecha de nacimiento (ni menor/adulto).
  - **Qué día es una foto**: el job de las 03:00 del día D escribe la fila **D−1**, el estado al cierre de ese día tomado unas horas después. Altas y bajas son exactas por sus fechas; los recuentos por estado son los de las 03:00.
  - **Una foto no cambia nunca**: es lo que había ese día. Ninguna corrección posterior la toca.
  - **Idempotente**: `INSERT … ON CONFLICT (date) DO NOTHING`, gana la primera. Relanzar el mismo día no cambia nada, y dos ejecuciones a la vez dejan una sola fila sin errores.
  - **Día saltado**: queda un **hueco** sin fila, y B17 lo muestra como «sin dato». No se rellena con el estado de otro día. A mano, con `--date`, solo se puede hacer la foto de **ayer u hoy** (otra fecha → error), y solo si aún no existe: sirve para repetir la de esa misma mañana si el cron falló.
  - **Job** (`scripts/nightly.js`, `npm run nightly`):
    - primero `extendHorizon(servicePool)` y después la foto de D−1, cada una en su `try`: si una falla, la otra corre igual. Código de salida 1 si alguna falló, con el error en `stderr`;
    - lo lanza el **cron del sistema**: `CRON_TZ=Europe/Madrid` y `0 3 * * *`. Las 03:00 de Madrid existen y ocurren una sola vez en los dos cambios de hora (el salto es 02:00 → 03:00 y la vuelta 03:00 → 02:00);
    - no depende de que la API esté viva. Sin bloqueo asesor: la foto ya es idempotente y la generación tiene `UNIQUE (class_id, slot)`;
    - `npm run extend-horizon` se queda para lanzarlo a mano.
  - **Permisos**:
    - `academy_stats_daily` con RLS `FORCE`. `SELECT` solo para el admin (`app.current_role = 'admin'`); el profesor no, porque lleva dinero. Sin `INSERT`, `UPDATE` ni `DELETE` para `app_user`.
    - La foto la escribe `snapshot_academy_stats(p_date date) RETURNS boolean` (`true` si creó la fila): `SECURITY DEFINER`, owner `service_role`, `REVOKE` de `PUBLIC` y **sin `EXECUTE` para `app_user`**. Solo la llama el job con `servicePool`, que es un script de operación y no una ruta de usuario.
    - B17 la leerá con el `client` RLS, nunca con `servicePool`.
- **Pasos**:
  1. **Migración `023`**:
     - `DROP TABLE student_stats_daily` (el `down` la recrea como en 001, con su PK y su FK).
     - `academy_stats_daily`: borrar `active_students`, `new_students`, `cancelled_students`, `mrr_cents` y `occupancy_rate`, y añadir las siete columnas de arriba (`NOT NULL`). Está vacía (nadie escribe en ella), así que se recrea. RLS `FORCE` y la política de lectura del admin.
     - `snapshot_academy_stats(date)` con el `shortcut:` del MRR. Exige `p_date` = ayer u hoy de Madrid (`invalid_date`).
     - Con su `down` (probado up → down → up).
  2. **`scripts/nightly.js`** (como `extend-horizon.js`): `--date=YYYY-MM-DD` opcional, por defecto ayer de Madrid; imprime `sesiones creadas`, `foto <fecha>: creada | ya existía` y los errores.
  3. **`package.json`**: `nightly` y `test:nightly`.
  4. **Docs**:
     - `scripts/README.md`: la línea de crontab, `--date` y qué hacer si falla;
     - `contexto-proyecto.md` §6: `student_stats_daily` borrada, `academy_stats_daily` con su forma y su RLS, funciones de `023`;
     - `db-architecture.md`: las dos tablas y la línea de RLS de agregaciones (el profesor y el alumno no leen nada).
- **Tests** (`test:nightly`, nuevo; con `servicePool` en una transacción que se deshace, y las fechas en Madrid):
  - **Foto**:
    - recuentos con una suscripción de cada estado (activa, en gracia, impagada y cancelada);
    - MRR solo de las activas y en gracia, con el precio del plan; el seguro no suma;
    - alta y baja en su día de Madrid (creada a las 23:30 del 31 cuenta en el 31; a las 00:30 del 1, en el 1, también en los cambios de hora);
    - un traspaso (`payer_changes` `completed`) no cuenta ni como alta ni como baja, y una baja normal sí.
  - **Idempotencia**:
    - una segunda llamada devuelve `false` y no cambia la fila, aunque el estado haya cambiado entre medias;
    - dos llamadas a la vez (dos conexiones) dejan una sola fila sin error;
    - `p_date` distinta de ayer u hoy → `invalid_date`.
  - **Job**: con `extendHorizon` fallando (una clase rota en el fixture), la foto se hace igual y el código de salida es 1; relanzado, imprime «ya existía».
  - **Permisos** (como `app_user`):
    - el admin lee la fila, y el profesor y el alumno ven 0 filas;
    - `INSERT`/`UPDATE`/`DELETE` → `permission denied`, igual que `EXECUTE snapshot_academy_stats`;
    - `student_stats_daily` ya no existe;
    - `snapshot_academy_stats` no menciona `student_health_info` ni `birth_date` (`pg_get_functiondef`).
  - **Regresión**: `test:classes` (`extendHorizon`), `test:billing`, `test:webhook` (Stripe sandbox), `test:rls` y `test:progress`. `npm run lint` sin errores.
  - **Manual**:
    1. Instalar la línea en el crontab local con la hora de dentro de 2 minutos (y `CRON_TZ=Europe/Madrid`).
    2. Ver en el log del cron que nace la fila de ayer con los mismos recuentos que un `SELECT` a mano sobre `subscriptions`.
    3. Relanzar `npm run nightly` y ver que la fila no cambia.
    4. Dejar la línea a las 03:00 y comprobar al día siguiente la ejecución real. Con eso se cierra «Job corre a las 03:00».
- **Fuera de alcance**:
  - endpoints e informes (B17), incluida la ocupación y la asistencia, que se calculan al leer;
  - el recálculo tras una cancelación retroactiva (pendiente de B6.1): **no hace falta**, porque nada de asistencia se agrega y la foto no depende de las sesiones;
  - rellenar huecos de días pasados (no se puede sin inventar datos);
  - MRR exacto con el precio de cada suscripción (el `shortcut:` de arriba);
  - foto del seguro, desglose por plan o por disciplina, cohortes y retención;
  - avisos de que el cron ha fallado (B20, con la monitorización y los backups);
  - otras tareas por fecha, como el aviso «cumple 18» (B15 la aplaza al flujo de reclamar el perfil); cuando llegue, va en `nightly.js`.
- **Implementación** (migración `023`, 2026-10-31):
  - **Desviaciones del diseño, decididas al implementar (2026-10-31)**:
    - **Función interna `academy_stats_of(date)`**, que calcula la fila de cualquier día con el estado de ahora; `snapshot_academy_stats` comprueba la fecha e inserta su resultado. Sin ella no se pueden probar las altas y las bajas en los cambios de hora (el último fue el 25-10 y la foto solo admite ayer u hoy). Mismo owner `service_role`, sin `EXECUTE` para `app_user`, y tampoco menciona salud ni fecha de nacimiento (comprobado en el test).
  - **Comprobado en el código, sin cambios**: las suscripciones nunca están `incomplete` (solo el seguro lo está; el Checkout de la cuota crea la fila ya `active`), así que una alta que no llegó a pagarse no cuenta. `cancelled_at` es el fin real de la suscripción (`ended_at` de Stripe), no el día en que se pidió la baja, así que la baja cuenta el día en que termina. El seguro vive en `insurances`, fuera de la foto.
  - **Comprobado en el sistema**: el `cron` de Debian y Ubuntu (3.0pl1) **no soporta `CRON_TZ`** y usa la zona del sistema; solo cronie lo entiende. La línea de crontab sigue como en el diseño, y `scripts/README.md` explica que con ese cron la hora sale de la zona del sistema (`timedatectl set-timezone Europe/Madrid`). La fecha de la foto no depende de eso: «ayer de Madrid» se calcula en SQL.
  - **`023`**:
    - `student_stats_daily` y `academy_stats_daily` se borran (vacías) y la segunda se recrea con las siete columnas. Los privilegios por defecto del esquema dan `arwd` a `app_user`: se revocan y solo queda `SELECT`, con la política `academy_stats_daily_select` (admin).
    - Altas y bajas por rango semiabierto `[p_date 00:00, p_date + 1 00:00)` de Madrid, que vale también para los días de 23 y 25 horas. El traspaso se excluye con `NOT EXISTS` sobre `payer_changes` `completed` (sucesora por `stripe_subscription_id` y antigua por `subscription_id`). El `shortcut:` del MRR va en el comentario de la función.
    - `snapshot_academy_stats`: `p_date` nula o distinta de ayer u hoy de Madrid → `invalid_date`; `INSERT … SELECT * FROM academy_stats_of(p_date) ON CONFLICT (date) DO NOTHING` y `RETURN FOUND`.
    - Con su `down`, que recrea las dos tablas como en 001, con la PK y la FK de `student_stats_daily` (probado up → down → up, con el esquema y los privilegios iguales a los de antes).
  - **`scripts/nightly.js`**: `extendHorizon(servicePool)` (también falla si alguna clase sale en `failed`) y después la foto, cada una en su `try`. `--date` va tal cual a SQL: un formato malo o una fecha que no es ayer ni hoy es un error de la foto (código 1). `extend-horizon.js` se queda para lanzarlo a mano.
  - **Tests** (`test:nightly`, 8 casos): las reglas, en una transacción de `servicePool` que se deshace (se borran las fotos de ayer y hoy, y se comparan los recuentos con los de antes de los fixtures). El job, los permisos y la concurrencia usan una foto confirmada de un día libre (hoy o ayer), que se borra al acabar. El job corre `scripts/nightly.js` como proceso aparte, con una clase que choca con una sesión suelta de su profesor; extiende de verdad el horizonte del resto de clases de la base. Comprobado a mano que los tests detectan los fallos: con días UTC, sin excluir traspasos, con el MRR de las impagadas, sin comprobar la fecha y sin `ON CONFLICT` (todo a la vez) fallan 6 de los 8; los permisos no dependen de eso. El de altas y bajas se reforzó porque con días UTC pasaba por casualidad, y ahora falla solo con ese cambio.
  - **Regresión**: `test:classes`, `test:billing`, `test:webhook` (Stripe sandbox), `test:rls` y `test:progress` en verde; `npm run lint` sin errores.
  - **Prueba manual** (2026-10-31, crontab local con `CRON_TZ=Europe/Madrid`, el `PATH` de nvm y la línea a las 15:44; el sistema ya está en Europe/Madrid): el cron lanzó `npm run nightly` y el log dio `sesiones creadas: 0; clases con error: 0` y `foto 2026-10-30: creada`. La fila (`active` 6, `past_due` 0, `unpaid` 0, altas 0, bajas 0, `mrr_cents` 8000) coincide con un `SELECT` a mano sobre `subscriptions` y `plans` (6 activas, ninguna alta ni baja ese día, ningún traspaso). Relanzado a mano: `foto 2026-10-30: ya existía` y la fila igual. Las tablas se consultan como `service_role`: `migrator` ve 0 filas por el RLS `FORCE`. Cerrado sin esperar a la ejecución real de las 03:00: solo cambia la hora de la línea, y la fecha de la foto se calcula en SQL. Si la máquina está apagada a esa hora, el día queda en hueco (rehacerlo esa mañana con `npm run nightly`).
- **Checklist de cierre**:
  - [x] Migración `023`: `student_stats_daily` borrada, `academy_stats_daily` rehecha con RLS `FORCE` y solo lectura del admin, `snapshot_academy_stats` sin `EXECUTE` para `app_user`.
  - [x] Foto de D−1: recuentos por estado, altas y bajas sin traspasos, MRR de las que están en vigor.
  - [x] Idempotente (relanzar, dos a la vez); un día saltado queda en hueco; `--date` solo ayer u hoy.
  - [x] `npm run nightly` lanza `extend-horizon` y la foto, independientes, con código de salida.
  - [x] Job corre a las 03:00 (Europe/Madrid) desde el crontab, documentado en `scripts/README.md`.
  - [x] Datos correctos para un día de prueba (prueba manual).
  - [x] Tests (`test:nightly` y regresión).

### B17 — Endpoints de informes — Diseñado
- **Objetivo**: endpoints de informes para admin y profesor, sobre la foto diaria de B16 (`academy_stats_daily`) y sobre `class_sessions`, `bookings` y `attendance`, calculados al leer (ADR 0012). Términos en `CONTEXT.md` § Informes («Informe», «Foto diaria», «Alta» y «baja», «Ingreso mensual recurrente», «Ocupación») y § Asistencia («Sin registrar»).
- **Desde B16** (2026-10-31): qué informes hay; los endpoints se diseñan aquí.
  - **Admin**:
    - evolución diaria y mensual de suscripciones activas, en gracia e impagadas, altas, bajas y MRR, desde `academy_stats_daily`; un día sin fila es «sin dato»;
    - ocupación por disciplina, clase y mes;
    - asistencia (presentes, faltas, sin registrar, cancelaciones tardías) por disciplina, mes y alumno.
  - **Profesor**: ocupación y asistencia de **sus** sesiones (sustituciones incluidas), sin datos de pago.
  - La ocupación y la asistencia se calculan **al leer** sobre `bookings`, `attendance` y `class_sessions` (`CONTEXT.md` § Informes), en hora de Madrid. La racha y las horas, con las funciones de B14.
  - Nunca salud, edad ni fecha de nacimiento, ni desglose por menor/adulto.
- **Se apoya en**: `academy_stats_daily` (B16), las políticas RLS de `class_sessions` (008), `bookings` (009) y `attendance` (010), `attendance_closed_at` (010), `cancel_reason` `late` (009/021), la cancelación retroactiva (B6.1), `MAX_RANGE_DAYS` y `dateParam` (`services/sessions.js`) y la paginación `limit`/`offset` del directorio y los morosos.
- **Choques con lo existente** (detectados en el diseño, 2026-10-31):
  - **El profesor no ve las disciplinas desactivadas**: `disciplines_select` (007) es `is_active OR admin`. Con el `client` RLS, las sesiones pasadas de una disciplina desactivada se caerían de sus informes por el `JOIN`. Ya le pasa hoy en `/professor/sessions` (`listTrainerSessions` hace `JOIN disciplines`): esas sesiones desaparecen de su calendario pasado. **Se amplía la RLS** (migración `024`): el profesor ve también las disciplinas de sus sesiones. El nombre de una disciplina no es un dato sensible.
  - **«Sin registrar» no casaba con la racha**: `CONTEXT.md` decía «reserva de una sesión cuya lista no se ha cerrado», pero B14 cuenta un presente aunque la lista esté abierta. **Se afina**: sin registrar es la reserva **sin presente** de una lista sin cerrar, y así presentes + faltas + sin registrar = reservas.
  - **El profesor de una sesión es `class_sessions.trainer_id`**: un sustituto pasa a ser el profesor de la sesión, y el habitual la deja de ver. Es justo «las sesiones de un profesor» de `CONTEXT.md`; las políticas de las tres tablas ya lo filtran así.
  - **Las clases no tienen nombre**: se identifican por disciplina, día, hora y profesor habitual.
  - La checklist pedía «Endpoints paginados» en todos: las series ya están acotadas por el rango. Solo se paginan las listas que crecen con alumnos o clases.
- **Reglas** (decididas 2026-10-31):
  - **Lectura**: SQL normal en `src/services/reports.js` con el `client` RLS (`withRlsContext`). Ninguna función `SECURITY DEFINER` nueva y nunca `servicePool`. Las políticas actuales dan al admin todo y al profesor solo sus sesiones (`trainer_id`); las de B14 existen porque un alumno no puede leer la asistencia de otros, y aquí no pasa. La misma consulta sirve al admin y al profesor: la RLS la acota.
  - **Foto** (`subscriptions`):
    - **por día**: una fila por cada día del rango; un día sin foto sale con los seis valores a `null` («sin dato»). No se rellena con otro día.
    - **por mes**: `active`, `past_due`, `unpaid` y `mrr_cents` son los de la **última foto del mes** (su cierre; en el mes en curso, el último día con foto); `new_subscriptions` y `cancelled_subscriptions`, la **suma** de los días con foto. Cada mes lleva `days_with_data` y `days_in_month` (en el mes en curso, los días hasta ayer, que es la última foto posible), para que la UI marque un mes incompleto. Un mes sin ninguna foto, con los valores a `null`.
  - **Qué sesiones cuentan** (ocupación y asistencia): solo las **celebradas** (`status = 'scheduled'` y `ends_at <= now()`). Las canceladas, retroactivas incluidas, las en curso y las futuras no cuentan. Las sueltas, sí. Una sesión cuenta en el **mes de Madrid en que empieza**, como «Horas del mes». Una sesión de una disciplina abierta cuenta solo en su propia disciplina (el reparto de las horas de B14 es para el ranking).
  - **Cifras por grupo** (sobre las sesiones que cuentan):
    - `sessions`: cuántas;
    - `capacity`: Σ aforo;
    - `booked`: reservas `confirmed` (las faltas ocupan igual);
    - `occupancy`: `booked / capacity` (razón de sumas, no media de porcentajes), redondeada a 3 decimales; `null` sin sesiones;
    - `present`: reservas con `attendance.status = 'present'`, con la lista cerrada o no (como la racha);
    - `absent`: `absent` (solo con la lista cerrada);
    - `unrecorded`: reservas sin presente de una sesión con `attendance_closed_at IS NULL`;
    - `late`: reservas con `cancel_reason = 'late'`, en el mes de la sesión, no en el de la cancelación. No están en `booked`.

    `present + absent + unrecorded = booked`.
  - **El profesor solo ve cifras**: por disciplina y por clase de sus sesiones (las sustituciones incluidas), sin desglose por alumno ni nada de la foto (lleva dinero). Los nombres y la lista sesión a sesión ya los tiene en `/professor/sessions/:id`; un informe por alumno sería asistencia agregada, que `CONTEXT.md` le niega en la racha y las horas.
  - **Rangos** (días y meses de Madrid, ambos incluidos):
    - `sessions` y `students`: `from`/`to` en `YYYY-MM`, 12 meses como mucho; por defecto, el mes en curso;
    - `subscriptions?group=day`: `YYYY-MM-DD`, `MAX_RANGE_DAYS` (92) como mucho; por defecto, los últimos 30 días hasta ayer;
    - `subscriptions?group=month`: `YYYY-MM`, 24 meses como mucho; por defecto, los últimos 12 con el en curso;
    - `to < from` o un rango mayor → `400 invalid_range`; un formato malo → `400 invalid_field`. Un rango futuro no es error: ceros en las sesiones y `null` en la foto.
  - **Paginación**: `limit` (1–100, por defecto 25) y `offset` (≥ 0), `400 invalid_pagination` como en `services/profiles.js`; respuesta `{ rows, total, limit, offset }`. Solo en `by=class` y `students`; `by=discipline` y las series van enteras.
  - **Nunca** salud, edad, fecha de nacimiento ni desglose por menor/adulto. Un hijo sale en `students` como cualquier alumno, solo con su nombre, sin tutor ni marca de menor.
- **Endpoints**:
  - `GET /admin/reports/subscriptions?group=day|month&from&to` → `{ group, from, to, rows: [{ date | month, active, past_due, unpaid, new_subscriptions, cancelled_subscriptions, mrr_cents }] }`, y en `month` además `days_with_data` y `days_in_month`. `group` es obligatorio (`invalid_field`).
  - `GET /admin/reports/sessions?by=discipline|class&from&to&discipline_id[&limit&offset]` → `{ by, from, to, rows, total? }`. Cada fila lleva su grupo, `months: [{ month, …cifras }]` (todos los meses del rango, con ceros) y `total: { …cifras }` del rango:
    - `by=discipline`: `{ discipline: { id, name }, months, total }`, por nombre de disciplina; solo las que tienen alguna sesión que cuenta en el rango;
    - `by=class`: `{ class_id, discipline: { id, name }, weekday, start_time, trainer: { id, name }, months, total }` con el profesor habitual y la hora de **ahora** (las sesiones pasadas guardan las suyas); las sueltas, en una fila `class_id: null` por disciplina (sin `weekday`, `start_time` ni `trainer`). Orden por disciplina, día y hora, las sueltas al final de su disciplina. Paginado.
  - `GET /admin/reports/students?from&to&discipline_id&limit&offset` → `{ from, to, rows: [{ id, name, bookings, present, absent, unrecorded, late }], total, limit, offset }`: totales del rango, sin meses. Sale quien tiene en el rango alguna reserva `confirmed` o alguna `late` en una sesión que cuenta; `discipline_id` filtra por la disciplina de la sesión. Por nombre y después `id`. Sin horas ni racha (están en B14).
  - `GET /professor/reports/sessions?by=discipline|class&from&to&discipline_id[&limit&offset]`: la misma función y la misma forma que el admin; la RLS deja solo sus sesiones. En `by=class` le salen las clases en que dio alguna sesión, también como sustituto, aunque el habitual sea otro.
- **Pasos**:
  1. **Migración `024`**: política `disciplines_select_trainer` en `disciplines` (`FOR SELECT TO app_user USING (ROLE = 'profesor' AND EXISTS (SELECT 1 FROM class_sessions s WHERE s.discipline_id = disciplines.id AND s.trainer_id = UID))`), permisiva junto a las de 007 y 012. Con su `down`.
  2. **`src/services/reports.js`**: `getSubscriptionStats`, `getSessionStats` (admin y profesor) y `getStudentStats`, con la validación de rangos y paginación de arriba (reutiliza `dateParam`, `MAX_RANGE_DAYS` y el patrón de `profiles.js`). Los meses y días con `generate_series` en Madrid, para que los huecos salgan.
  3. **`src/routes/admin/reports.js`** (`requireAuth`, `requireRole('admin')`), montado en `/admin/reports` en `src/index.js`; `GET /reports/sessions` en `src/routes/professor.js`.
  4. **`package.json`**: `test:reports`.
  5. **Docs**: `contexto-proyecto.md` (endpoints y `024`), `db-architecture.md` (la política nueva) y `CONTEXT.md` ya actualizado en el diseño.
- **Tests** (`test:reports`, nuevo; fixtures en una transacción que se deshace y fechas en Madrid):
  - **Foto**:
    - por día, un día sin fila sale con `null`, sin rellenar;
    - por mes, los estados y el MRR son los de la última foto del mes, y las altas y bajas la suma; `days_with_data` cuenta los días con foto; un mes sin fotos, `null`.
  - **Sesiones**:
    - una celebrada cuenta; una cancelada, una retroactiva, una en curso y una futura no; una suelta sí, en su fila `class_id: null`;
    - una sesión que empieza el 31 a las 23:30 de Madrid cuenta en ese mes;
    - `occupancy` es razón de sumas (una de 4 plazas llena y una de 30 vacía no dan 0,5), `null` sin sesiones;
    - presentes con la lista abierta cuentan; `present + absent + unrecorded = booked`; una tardía no está en `booked` y cuenta en el mes de la sesión; la de una sesión cancelada después, no;
    - una sesión de una disciplina abierta cuenta solo en ella.
  - **Alumnos**: sale quien tiene una reserva o una tardía en el rango, por nombre; un hijo sale solo con el nombre; paginación (`total`, `limit`, `offset`).
  - **Validación**: `invalid_range` (`to < from`, 13 meses, 93 días, 25 meses), `invalid_field` (formato, `group`, `by`), `invalid_pagination`.
  - **Permisos** (como `app_user`, por HTTP):
    - el profesor solo ve sus sesiones: las de otro profesor no cuentan, y una sesión en la que lo sustituyen deja de ser suya y pasa a la del sustituto;
    - el profesor ve el nombre de la disciplina desactivada de una sesión suya pasada, también en `/professor/sessions`, y no ve las disciplinas desactivadas sin sesiones suyas;
    - profesor, alumno y tutor → `403` en `/admin/reports/*`; alumno, tutor y admin → `403` en `/professor/reports/*`;
    - `services/reports.js` no menciona `student_health_info`, `birth_date` ni `servicePool` (comprobación sobre el fuente).
  - **Regresión**: `test:rls`, `test:classes`, `test:calendar`, `test:attendance`, `test:progress` y `test:nightly`. `npm run lint` sin errores.
- **Fuera de alcance**:
  - UI (B19);
  - agrupación por día de las sesiones (el plan pide mes) y filtros por profesor o por alumno en `sessions`;
  - horas y racha por alumno en los informes (están en `/progress`, B14);
  - desglose de la foto por plan o por disciplina, cohortes y retención (B16);
  - exportar a CSV;
  - eventos (no son sesiones).
- **Checklist de cierre**:
  - [ ] Migración `024`: el profesor ve las disciplinas de sus sesiones.
  - [ ] `/admin/reports/subscriptions` (día y mes, huecos a `null`), `/admin/reports/sessions`, `/admin/reports/students` y `/professor/reports/sessions`.
  - [ ] Paginados donde la lista crece con alumnos o clases (`by=class`, `students`); las series, acotadas por rango.
  - [ ] RLS correcta: lectura por el `client` RLS, el profesor solo sus sesiones y sin foto ni alumnos.
  - [ ] Tests (`test:reports` y regresión).

### B18 — PWA (manifest, Service Worker) — Pendiente
- **Objetivo**: frontend PWA.
- **Entregable**: `manifest.json`, Service Worker, build del frontend.
- **Fuera de alcance**: backend (sin cambios).
- **Checklist de cierre**:
  - [ ] Instalable.
  - [ ] Offline básico.
  - [ ] **Aviso de re-firma pendiente al alumno** (B4.5.1) visible en la PWA.
  - [ ] **Push (B15, ADR 0011)**: pedir permiso y `POST /me/push-subscriptions`; al cerrar sesión, `DELETE /me/push-subscriptions` **antes** de borrar el token (si no, el móvil sigue recibiendo los avisos del usuario anterior); al abrir, comparar la clave de `GET /push/vapid-public-key` y volver a suscribirse si cambió; el Service Worker muestra la notificación con su `tag` y abre su `url`. Prueba manual en Chrome de un push real.
  - [ ] Build reproducible (`npm run build:frontend` o equivalente, a decidir aquí).
  - [ ] **Decidir i18n antes de empezar el frontend** (hoy solo español, también los avisos de B10.6): añadirlo después obliga a repasar cada pantalla.

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
  - [ ] Rate limiting en `/auth/*`, `/admin/agreements/*` y `/tablet/link` (B9).
  - [ ] Auditoría de RLS (revisar todas las políticas, incluidas B4.5 y B4.5.1).
  - [ ] Backups automáticos de BD **y de `AGREEMENTS_STORAGE_PATH`**.
  - [ ] Verificación de checksum al servir `GET /agreements/:type/current` (B4.5.1).
  - [ ] E2E de flujos críticos (incluye flujo MFA completo de B4 con supertest, y flujo B4.5/B4.5.1: subir → publicar → firmar → `requireCompleteProfile`).
  - [ ] `scripts/test-rls.js` y `scripts/test-mfa.js` migrados a BD efímera por test run (no destructivo en local compartido).
  - [ ] **[Alta] `audit_log` insertable por cualquier autenticado** (detectado en B8): la política `audit_log_insert_authenticated` (003) deja a cualquier usuario con `app_user` insertar filas arbitrarias, con lo que la auditoría es inalterable pero no auténtica. Arreglo: quitar la política y el `INSERT` a `app_user`, y mover los `INSERT` directos de `services/catalog.js` y `services/agreements.js` a funciones `SECURITY DEFINER` (las de 009/010 ya no la necesitan).
  - [ ] **[Media] `UPDATE` de cualquier columna propia en `profiles`** (detectado en el diseño de B13): `profiles_update_self_or_admin` deja a cualquiera, a nivel SQL, cambiar sus propias `birth_date`, `stripe_customer_id` o `is_public` sin pasar por la API (que no lo expone). Arreglo: limitar las columnas editables (trigger o funciones `SECURITY DEFINER` por caso) o revisar el `WITH CHECK`.
  - [ ] **[Media] Smoke tests HTTP que matan procesos ajenos** (detectado en B8): en B8 se usó `pkill -f "node src/index.js"` para parar el servidor de prueba y probablemente paró otro servidor que ya escuchaba en el 3999. Arreglo: los E2E arrancan el servidor en un puerto libre (`PORT=0`/supertest) y lo paran por su PID, nunca con `pkill -f`.
  - [ ] **[Media] Llamadas a Stripe dentro de la transacción del webhook** (detectado en B10): `services/stripeWebhook.js` llama a la API de Stripe con la conexión de `servicePool` (máx. 5) abierta; una ráfaga de eventos con Stripe lento puede agotar el pool. Asumible al volumen de un gimnasio. Arreglo si hace falta: leer de Stripe antes de abrir la transacción o subir el pool del webhook.
  - [ ] **[Media] `past_due` → `unpaid` sin test real** (detectado en B10): `test-webhook` cubre la baja (`deleted`) pero no la ventana de reintentos. Arreglo: test con Stripe test clocks (avanzar el reloj hasta agotar los reintentos) que compruebe que `past_due` conserva las reservas y `unpaid` las cancela.
  - [ ] **[Media] Webhooks que agotan los reintentos de Stripe** (detectado en B10.3): un evento que falla (500) se reprocesa en los reintentos de Stripe (unos 3 días); si los agota, se pierde, p. ej. el aviso de renovación del seguro (`invoice.upcoming`). Arreglo: alerta de webhooks fallidos en el Dashboard de producción y reenvío (`stripe events resend`) como procedimiento.
  - [ ] **[Media] Auditar vincular y revocar una tablet** (B9): hoy no queda rastro en `audit_log`.
  - [ ] **[Media] Avisos en *autocommit*** (B10.6, B11): un aviso emitido con `servicePool` fuera de la transacción de la ruta (baja admin, desactivar el seguro, `upgrade_requires_action`, `insurance_cancelled`) se queda aunque la ruta haga rollback. Arreglo: emitirlo con el `client` de la transacción.
  - [ ] **[Baja] Transacción del worker de avisos abierta durante el envío** (B10.6): hasta 20 × 15 s en el peor caso. Arreglo: marcar en curso, confirmar y enviar fuera.
  - [ ] **[Media] Endpoints de B11 sin test HTTP** (el E2E sí pasa por HTTP), en especial el Checkout del cambio de pagador con un perfil incompleto (403).
  - [ ] **[Baja] `scripts/test-attendance.js` falla entre las 00:00 y las 00:05 de Madrid** (detectado en B8): la sesión «de hoy» empieza 5 min antes de `now()` y cae en el día anterior. Arreglo: fijar la hora de la sesión dentro del día de Madrid o inyectar el reloj al migrar a la BD efímera.