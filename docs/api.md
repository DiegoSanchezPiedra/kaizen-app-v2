# API de Kaizen — inventario para el frontend

> Generado desde `src/routes/` y `src/services/` el 2026-10-31, tras B17. Es la API **tal como está**: el frontend se
> diseña contra ella, y si una pantalla pide un dato que no está aquí, se decide en el diseño técnico (no se improvisa
> un endpoint). Términos en `CONTEXT.md`; reglas de cada bloque en `plan-de-bloques.md`.

## Convenciones

- **Auth**: `Authorization: Bearer <jwt>` (HS256, caduca a los `JWT_EXPIRES_IN`, por defecto 7 días). El token lleva
  `sub` (id del perfil) y `role`. **Un rol por perfil** (ADR 0001): `alumno`, `tutor`, `profesor` o `admin`. No hay
  refresh ni logout en el servidor: cerrar sesión es borrar el token (y antes, darse de baja del push).
- **La tablet** no es usuario: `Authorization: Device <device_token>` (ver § Tablet).
- **Errores**: `{ error, code, message, ...details }`. `error` es la categoría (`bad_request`, `unauthorized`,
  `payment_required`, `forbidden`, `not_found`, `conflict`, `internal_error`); la UI decide por `code`. Los de campo
  traen `field` (`invalid_field`). `message` está en español pero es técnico: la UI pone su propio texto por `code`.
- **Comunes**: `401 missing_token|invalid_token`, `403 forbidden` (rol no permitido), `400 invalid_id` (uuid o id
  numérico mal formado), `404 not_found` (ruta inexistente).
- **Perfil completo** (`requireCompleteProfile`): reservar, contratar y el Checkout del cambio de pagador fallan con
  `403 profile_incomplete { missing: [...] }` si al sujeto (y al tutor que actúa por un hijo) le falta algo.
  `missing` usa `display_name`, `health_info`, `emergency_contact`, `data_protection` y `rights_of_image` (el `waiver` no: cuenta en `risk_cover`). La UI lo evita mirando antes
  `GET /me/profile-status`.
- **`profile_id`**: en las rutas de alumno y tutor, el hijo por el que actúa el tutor. Sin él, el sujeto es quien llama.
  El hijo **no tiene credenciales** (ADR 0002): nunca inicia sesión.
- **Fechas**: instantes en ISO con zona (`timestamptz`); días `YYYY-MM-DD` y meses `YYYY-MM` siempre **de Madrid**.
  Rangos `from`/`to` incluidos. Importes en céntimos (`*_cents`). Ids de catálogo (disciplinas, planes) son enteros
  que a veces llegan como string; perfiles, sesiones, reservas, etc. son uuid.
- **Paginación**: `limit` 1–100 (25 por defecto) y `offset` ≥ 0 → `{ rows|profiles|payers, total, limit, offset }`;
  si no, `400 invalid_pagination`.
- **Privacidad**: la salud solo la ve el propio alumno o su tutor al rellenarla, y el profesor el día de la sesión
  (`/professor/sessions/:id/health`, auditado). Ningún informe enseña salud, edad ni fecha de nacimiento.

## URLs del frontend que el backend ya usa

El backend construye enlaces con `APP_URL`; el frontend **tiene** que servir estas rutas:

| Ruta | Quién la abre |
|---|---|
| `/billing` | vuelta del Portal de Stripe; enlace de los avisos de cobros |
| `/billing/success?session_id=…` y `/billing/cancel` | vuelta del Checkout de la cuota |
| `/billing/payer-changes/:id[?session_id=…]` | aviso al nuevo pagador y vuelta de su Checkout |
| `/bookings` | enlace de los avisos de reservas (push y email) |
| `/agreements` | aviso de re-firma de un documento legal |
| `/reset-password?token=…` | email de recuperar contraseña (el token, en la URL: `Referrer-Policy: same-origin`) |

---

## Público y sesión

| Método y ruta | Rol | Cuerpo / query | Respuesta |
|---|---|---|---|
| `GET /health` | — | — | `{ status: ok\|degraded, uptime, db, timestamp }` |
| `POST /auth/register` | — | `{ email, password, displayName, birthDate }` | `201 { token, user: { id, email, role: 'alumno' } }`. Errores: `email_taken`, `weak_password`, `invalid_birth_date`, `minor_cannot_register`, `invalid_payload` |
| `POST /auth/login` | — | `{ email, password }` | `{ token, user }` o, con MFA, `{ mfa_required: true, mfa_token }`. `401 invalid_credentials` |
| `POST /auth/google` | — | `{ id_token }` (Google Identity Services) | como `/auth/login`. `invalid_google_token` |
| `POST /auth/mfa/verify` | — (con `mfa_token`) | `{ mfa_token, code }` | `{ token, user }`. `401 invalid_mfa_code` |
| `POST /auth/password/forgot` | — | `{ email }` | `204` **siempre** (no dice si el email existe). Si existe, email con el enlace a `/reset-password?token=…`, válido 1 h y una vez; pedir otro anula los anteriores |
| `POST /auth/password/reset` | — | `{ token, password }` | `204`. `400 invalid_reset_token` (caducado, usado o inexistente), `weak_password`. Un perfil solo con Google se pone así contraseña |
| `GET /auth/me` | cualquiera | — | `{ user: { id, role }, mfa_enabled, rls_context }` |
| `POST /auth/mfa/setup` | admin | — | `201` con el secreto y el `otpauth://` para el QR |
| `POST /auth/mfa/activate` | admin | `{ code }` | activa el MFA. `invalid_totp`, `mfa_not_setup`, `mfa_already_enabled` |

**Solo un alumno adulto se registra** (un menor lo da de alta su tutor). El rol `tutor`, `profesor` y `admin` no se
crea por la API (hoy, a mano en la base; la gestión de usuarios es de B19).

## Perfil y onboarding (`/me`)

| Método y ruta | Rol | Cuerpo / query | Respuesta |
|---|---|---|---|
| `GET /me` | cualquiera | — | `{ id, role, display_name, email, birth_date, has_password }` (`birth_date` y `display_name` pueden ser `null` tras el alta con Google) |
| `PATCH /me` | cualquiera | `{ display_name?, birth_date? }` | como `GET /me`. `display_name` no vacío (`invalid_field_type`); `birth_date` solo si estaba vacía (`409 birth_date_already_set`) y de un adulto (`minor_cannot_register`, `invalid_birth_date`); `no_fields` |
| `GET /me/profile-status?profile_id=` | cualquiera | — | `{ ok, missing?, risk_cover? }` (`risk_cover`: tiene seguro o waiver) |
| `GET /me/health?profile_id=` | cualquiera (propia o de un hijo) | — | `{ health }` (los campos de `POST /me/health` y `updated_at`) o `{ health: null }`. `403 not_guardian` |
| `POST /me/health` | alumno, tutor | `{ profile_id?, injuries?, conditions?, previous_experience?, previous_discipline?, medication?, allergies?, emergency_contact_name?, emergency_contact_phone? }` (strings o null) | `{ health }`. `no_fields`, `invalid_field_type`, `403 not_guardian` |
| `GET /agreements/:type/current` | cualquiera | `type`: `waiver`, `data_protection`, `rights_of_image` | el PDF (`X-Agreement-Version`). `404 no_current_document` |
| `POST /me/agreements` | alumno, tutor | `{ type, version, profile_id? }` (`version` = la vigente) | `{ agreement }`. `409 agreement_already_signed`, `invalid_version`, `403 not_allowed_to_sign` |
| `GET /me/children` | cualquiera (un alumno también puede tener hijos) | — | `{ children: [{ id, display_name, birth_date, pending_claim }] }` (`pending_claim`: cumplió 18, solo lectura) |
| `POST /me/children` | cualquier adulto | `{ display_name, birth_date }` | `201 { child }`. `child_must_be_minor`, `invalid_birth_date` |
| `PATCH /me/children/:id` | cualquiera (su tutor) | `{ display_name?, birth_date? }` | `{ child }`. `child_not_found` |
| `GET /me/profile` | cualquiera | — | `{ is_public, eligible, visible_fields, bio, social_links }` |
| `PATCH /me/profile` | cualquiera | `{ is_public?, visible_fields?, bio? (≤500), social_links? (https) }` | igual. `403 not_eligible` |
| `GET /me/progress?profile_id=&month=YYYY-MM` | alumno, tutor (hijo), admin | — | `{ streak: { current, best }, badges: [{ code, earned_at }], hours: { month, disciplines: [{ id, name, hours }] } }` |
| `POST /me/push-subscriptions` | alumno, tutor | `{ endpoint, keys: { p256dh, auth } }` (de `PushManager.subscribe`) | `201 { ok }` |
| `DELETE /me/push-subscriptions` | alumno, tutor | `{ endpoint }` | `204` (llamar **antes** de borrar el token) |
| `GET /push/vapid-public-key` | cualquiera | — | `{ key }`; `503 push_disabled` |

`visible_fields` admite `bio`, `social_links`, `disciplines`, `member_since`, `achievements` y `ranking`.

## Catálogo, calendario y reservas

| Método y ruta | Rol | Cuerpo / query | Respuesta |
|---|---|---|---|
| `GET /disciplines` | cualquiera | — | `{ disciplines: [{ id, name, minors_only, is_active, is_open }] }` (activas; las desactivadas solo si las ve por suscripción o por sus sesiones) |
| `GET /plans` | cualquiera | — | `{ plans: [{ id, name, price_cents, billing_period, max_disciplines, minors_only, is_active, eligible_discipline_ids }] }` |
| `GET /sessions/calendar?from&to&discipline_id&profile_id` | alumno, tutor, admin (`profile_id`: el admin, o quien sea tutor de ese perfil; si no, `403 not_guardian`) | rango ≤ 92 días, por defecto hoy + 30 | `{ sessions: [{ id, starts_at, ends_at, discipline: { id, name }, trainer: { id, display_name }, location, capacity, status, held, covered, booking }] }`. Al tutor sin `profile_id`, `covered` y `booking` vienen **por hijo** (objeto por id); con `profile_id`, planos para ese sujeto |
| `GET /bookings?profile_id&from&to` | alumno, tutor, admin | rango ≤ 92 días | `{ bookings: [{ id, session_id, student_id, booked_by, status, cancel_reason, discipline_id, discipline_name, starts_at, ends_at, location, session_status }] }` |
| `POST /bookings` | alumno, tutor, admin (perfil completo) | `{ session_id, profile_id? }` | `201 { booking }` con `status` `confirmed` o `waitlisted` |
| `POST /bookings/:id/cancel` | alumno, tutor, admin | — | `{ booking }` (también sale de la espera; `cancel_reason` `late` si es tardía) |

Errores de reservas: `403 not_covered`, `403 no_risk_cover`, `409 session_not_bookable`, `409 outside_booking_window`,
`409 already_booked`, `409 booking_overlap`, `409 booking_not_active`, `409 session_started`,
`409 booking_conflict_retry` (reintentar), `404 session_not_found|booking_not_found`, `403 not_allowed`.

## Check-in (móvil del alumno o del tutor)

| Método y ruta | Rol | Cuerpo | Respuesta |
|---|---|---|---|
| `POST /checkin` | alumno, tutor | `{ code, booking_id? }` (`code` = el QR de la tablet) | `{ status: 'checked_in', booking_id, session_id, … }` o `{ status: 'choose', candidates: [{ booking_id, student_id, display_name, discipline, starts_at }] }` → repetir con `booking_id` |

Errores: `400 invalid_qr`, `404 no_candidates`, `409 attendance_closed`.

## Pagos (`/billing`, alumno y tutor)

| Método y ruta | Cuerpo / query | Respuesta |
|---|---|---|
| `GET /billing/subscription?profile_id=` | — | `{ id, status, plan: { id, name, price_cents, max_disciplines }, disciplines: [{ id, name }], current_period_end, cancel_at_period_end, scheduled_change, discipline_changes_left, payer_change }` |
| `POST /billing/checkout` (perfil completo) | `{ plan_id, discipline_ids?, profile_id?, insurance? }` | `201 { url }` → redirigir a Stripe Checkout |
| `POST /billing/portal` | — | `{ url }` → Portal de Stripe (método de pago, facturas, baja) |
| `GET /billing/insurance?profile_id=` | — | `{ id, status, bracket, current_period_end, cancel_at_period_end }` |
| `POST /billing/insurance` (perfil completo) | `{ profile_id? }` | `201 { id, status, payment_status?, client_secret? }` → `stripe.handleNextAction` si hay 3DS |
| `POST /billing/subscriptions/:id/plan` | `{ plan_id, discipline_ids }` | subida `{ change: 'upgrade', status: 'applied'\|'requires_action', client_secret? }`; bajada `202 { change: 'downgrade', scheduled_at }` |
| `DELETE /billing/subscriptions/:id/plan/scheduled` | — | `204` (anula la bajada programada) |
| `POST /billing/subscriptions/:id/disciplines` | `{ from_id, to_id }` | `{ disciplines, changes_left, free }` |
| `GET /billing/payer-changes/:id` | — | `{ id, status, student: { id, name }, plan: { id, name }, price_cents, disciplines, starts_at, deadline }` |
| `POST /billing/payer-changes/:id/checkout` (nuevo pagador, perfil completo) | — | `{ url }` (Checkout de 0 € hoy) |

Errores frecuentes: `409 subscription_exists`, `409 risk_cover_required` (sin seguro hace falta el waiver firmado),
`409 plan_not_purchasable`, `409 plan_minors_only`, `409 discipline_not_eligible`, `409 discipline_change_limit`,
`409 same_plan`, `409 upgrade_pending`, `409 period_ending_soon`, `409 insurance_disabled|insurance_exists`,
`402 payment_failed`, `403 not_payer`, `403 not_new_payer`, `409 payer_change_expired|payer_change_paid`,
`503 portal_not_configured`.

## Comunidad

| Método y ruta | Rol | Query | Respuesta |
|---|---|---|---|
| `GET /profiles?q&role&discipline_id&limit&offset` | cualquiera | — | `{ profiles: [ficha], total, limit, offset }` |
| `GET /profiles/:id` | cualquiera | — | `{ profile: { id, display_name, role, bio?, social_links?, disciplines?, member_since?, achievements? } }` (solo lo visible; `404 profile_not_found` si no es público) |
| `GET /rankings/:disciplineId?month&limit&offset` | cualquiera | — | `{ discipline: { id, name }, month, rows: [{ rank, id, display_name, hours }], total, limit, offset }` |

## Profesor

| Método y ruta | Query / cuerpo | Respuesta |
|---|---|---|
| `GET /professor/sessions?from&to` | días, ≤ 92 (por defecto hoy + 30) | `{ sessions: [{ id, class_id, discipline_id, discipline_name, starts_at, ends_at, duration_min, capacity, location, status }] }` (las suyas, sustituciones incluidas) |
| `GET /professor/sessions/:id` | — | `{ session }` |
| `GET /professor/sessions/:id/health` | — | `{ students: [...] }` lesiones, condiciones, alergias, medicación y contacto de emergencia; **solo hoy** y auditado |
| `GET /professor/reports/sessions` | como `/admin/reports/sessions` | solo sus sesiones, sin dinero ni alumnos |

**Lista (profesor de la sesión y admin)** — montadas en `/sessions`:

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| `GET /sessions/:id/attendance` | — | `{ closed_at, students: [{ booking_id, student_id, display_name, status, method, corrected_at, correction_reason, risk_cover }] }` |
| `PUT /sessions/:id/attendance/:studentId` | `{ present: boolean }` | `{ student_id, present }` (antes del cierre) |
| `POST /sessions/:id/attendance/close` | — | `{ present, absent }` |
| `POST /sessions/:id/attendance/:studentId/correct` | `{ status: 'present'\|'absent', reason (≤500) }` | `{ attendance }` |

Errores: `409 session_not_started`, `409 session_cancelled`, `409 attendance_closed`, `409 attendance_not_closed`,
`404 no_active_booking`, `409 no_change`, `403 correction_window_expired`.

## Tablet

| Método y ruta | Auth | Respuesta |
|---|---|---|
| `POST /tablet/link` `{ code }` | — (código de un solo uso del admin) | `201 { device_token }` (solo esta vez; guardarlo en la tablet). `400 invalid_link_code` |
| `GET /tablet/active-sessions` | `Device <token>` | **SSE**: evento `feed` `{ qr, expires_in, sessions: [{ id, name, starts_at, ends_at }] }` cada periodo del QR; `revoked` si la revocan. Sin nombres de alumnos |

## Admin

Todas exigen `role = admin` (y el admin entra con MFA si lo tiene activado).

**Catálogo**

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| `GET /admin/disciplines` | — | `{ disciplines }` (todas) |
| `POST /admin/disciplines` | `{ name, minors_only?, is_active?, is_open? }` | `201 { discipline }` |
| `PATCH /admin/disciplines/:id` | `{ name?, minors_only?, is_active?, is_open? }` | `{ discipline }` (+ `{ retired_classes, cancelled_sessions }` al desactivar) |
| `GET /admin/plans` | — | `{ plans }` (todos) |
| `POST /admin/plans` | `{ name, price_cents, max_disciplines (null = todas), billing_period?, minors_only?, is_active? }` | `201 { plan }` |
| `PATCH /admin/plans/:id` | campos del plan | `{ plan }` |
| `GET/PUT /admin/plans/:id/disciplines` | PUT `{ discipline_ids }` | `{ discipline_ids }` |

**Clases y sesiones**

| Método y ruta | Cuerpo / query | Respuesta |
|---|---|---|
| `GET /admin/classes?discipline_id` | — | `{ classes: [{ id, discipline_id, discipline_name, trainer_id, trainer_name, weekday (1=lun), start_time (HH:MM), duration_min, capacity, location, starts_on, ends_on }] }` |
| `POST /admin/classes` | `{ discipline_id, trainer_id, weekday, start_time, duration_min, capacity, location?, starts_on?, ends_on? }` | `201 { class }` (genera las sesiones a un año) |
| `PATCH /admin/classes/:id` | `{ from?, trainer_id?, start_time?, duration_min?, capacity?, location? }` | `{ class, sessions_changed, notified, promoted }` |
| `POST /admin/classes/:id/retire` | `{ date? }` | `{ class: { …, cancelled_sessions } }` |
| `POST /admin/sessions` | `{ discipline_id, trainer_id, starts_at, duration_min, capacity, location? }` | `201 { session }` (sesión suelta) |
| `PATCH /admin/sessions/:id` | `{ trainer_id?, starts_at?, duration_min?, capacity?, location? }` | `{ session, sessions_changed, notified, promoted }` |
| `POST /admin/sessions/:id/cancel` | `{ note? }` (obligatoria si ya empezó) | `{ session, retroactive, cancelled_bookings, notified }` |
| `POST /admin/sessions/:id/restore` | — | `{ session, notified }` |
| `POST /admin/sessions/:id/reset` | `{ fields: [...] }` | `{ session, sessions_changed, notified, promoted }` |

El admin ve el calendario con `GET /sessions/calendar` (y el de un alumno con `profile_id`), pasa lista con las rutas
de `/sessions/:id/attendance` y reserva por cualquiera con `POST /bookings { profile_id }`.
Errores: `409 trainer_overlap`, `409 capacity_below_bookings { sessions, fits_from }`, `409 session_not_adjustable`,
`409 class_retired`, `409 discipline_inactive`, `409 slot_passed`, `409 already_retired`, `409 loose_session`.

**Cobros**

| Método y ruta | Cuerpo / query | Respuesta |
|---|---|---|
| `GET /admin/billing/delinquents?limit&offset` | — | `{ payers: [{ payer_id, display_name, items, invoices }], total, limit, offset }` (con algo `unpaid`) |
| `GET /admin/billing/grace?limit&offset` | — | igual, solo `past_due` |
| `POST /admin/subscriptions/:id/cancel-now` \| `cancel-at-period-end` | — | `{ subscription }` |
| `POST /admin/insurances/:id/cancel-now` \| `cancel-at-period-end` | — | `{ id, stripe_status, ends_at, risk_cover }` |
| `POST /admin/subscriptions/:id/plan` | `{ plan_id, discipline_ids }` | como el del alumno; `409 requires_payer_action` si pide 3DS |
| `DELETE /admin/subscriptions/:id/plan/scheduled` | — | `204` |
| `POST /admin/subscriptions/:id/disciplines` | `{ from_id, to_id }` | `{ disciplines, changes_left, free }` |
| `POST /admin/subscriptions/:id/payer-change` | `{ payer_id }` | `201 { id, status, new_payer_id, plan_id, discipline_ids, starts_at, deadline }` |
| `GET /admin/payer-changes/:id` | — | como el del alumno |
| `DELETE /admin/subscriptions/:id/payer-change` | — | `204` |

**Ajustes de la academia** (solo escritura: devuelven los valores vigentes)

| Método y ruta | Cuerpo |
|---|---|
| `PUT /admin/settings/checkin` | `{ opens_minutes?, closes_minutes?, qr_seconds? }` |
| `PUT /admin/settings/insurance` | `{ price_adult_cents?, price_minor_cents?, enabled? }` |
| `PUT /admin/settings/discipline-changes` | `{ per_period }` |

**Tablets, documentos y perfiles**

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| `GET /admin/tablets` | — | `{ tablets: [{ id, name, link_expires_at, created_at, linked_at, last_seen_at, revoked_at }] }` |
| `POST /admin/tablets` | `{ name }` | `201 { tablet: { …, link_code } }` (el código solo se ve aquí) |
| `POST /admin/tablets/:id/revoke` | — | `{ tablet }` |
| `GET /admin/agreements/documents` | — | `{ documents: [{ id, type, version, checksum, created_at, published_at, retired_at, status }] }` |
| `POST /admin/agreements/documents?type&version` | **cuerpo crudo** `application/pdf`, ≤ 10 MB | `201 { document }` |
| `POST /admin/agreements/documents/:id/publish` | — | `{ document }` (retira la vigente y avisa para re-firmar) |
| `POST /admin/profiles/:id/unpublish` | — | `{ id, is_public: false }` |

**Informes** (B17)

| Método y ruta | Respuesta |
|---|---|
| `GET /admin/reports/subscriptions?group=day\|month&from&to` | `{ group, from, to, rows: [{ date\|month, active, past_due, unpaid, new_subscriptions, cancelled_subscriptions, mrr_cents, days_with_data?, days_in_month? }] }`; día o mes sin foto → `null`. Día ≤ 92 días (por defecto los 30 hasta ayer); mes ≤ 24 (por defecto 12) |
| `GET /admin/reports/sessions?by=discipline\|class&from&to&discipline_id[&limit&offset]` | `{ by, from, to, rows: [{ discipline: { id, name }, class_id?, weekday?, start_time?, trainer?, months: [{ month, …cifras }], total: { …cifras } }], total?, limit?, offset? }`. Cifras: `sessions, capacity, booked, occupancy (0–1, null sin sesiones), present, absent, unrecorded, late`. Meses `YYYY-MM`, ≤ 12 |
| `GET /admin/reports/students?from&to&discipline_id&limit&offset` | `{ from, to, rows: [{ id, name, bookings, present, absent, unrecorded, late }], total, limit, offset }` |

Errores: `400 invalid_range`, `400 invalid_field`, `400 invalid_pagination`.

## Webhook

`POST /webhooks/stripe`: solo Stripe (firma). El frontend no lo usa, pero de él dependen los estados que la UI ve tras
volver de Stripe: hasta que llega, la suscripción puede no existir aún (la UI de `/billing/success` debe esperar o
reintentar `GET /billing/subscription`).

---

## Huecos conocidos (para el diseño técnico)

Lo que una pantalla podría pedir y la API **no da hoy**. Se decide en el diseño de B18/B19 si se añade o se rodea:

- **Cuenta**: verificar el email, cambiar email o contraseña con sesión, reclamar el perfil al cumplir 18
  (`pending_claim`). No hay logout de servidor ni revocación de tokens.
- **Admin, usuarios**: listar y buscar perfiles, ver la ficha de un alumno (sus datos, su suscripción, su seguro),
  crear profesores y tutores, cambiar roles. Hoy el admin no tiene cómo encontrar el `id` de una suscripción salvo por
  los morosos o un cambio de pagador.
- **Admin, lectura de ajustes**: `checkin`, `insurance` y `discipline-changes` solo tienen `PUT` (devuelven los
  valores al guardar, pero no hay `GET` para pintar el formulario).
- **Admin, B19**: consultar `audit_log`, entregas de avisos fallidas y cambios de pagador caducados.
- **Admin, sesiones**: no hay lista de sesiones propia (usa el calendario) ni detalle de una sesión con sus reservas
  y su lista de espera.
- **Alumno**: no hay detalle de una sesión aparte del calendario; tampoco su historial de recibos (lo da el Portal).
- **Eventos**: no implementados (no son sesiones).
