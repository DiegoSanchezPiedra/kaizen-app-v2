# API de Kaizen — inventario para el frontend

> Generado desde `src/routes/` y `src/services/` el 2026-10-31, tras B17. Es la API **tal como está**: el frontend se
> diseña contra ella, y si una pantalla pide un dato que no está aquí, se decide en el diseño técnico (no se improvisa
> un endpoint). Términos en `CONTEXT.md`; reglas de cada bloque en `plan-de-bloques.md`.

## Convenciones

- **Auth**: `Authorization: Bearer <jwt>` (HS256, caduca a los `JWT_EXPIRES_IN`, por defecto 7 días; el del admin a los `ADMIN_JWT_EXPIRES_IN`, por defecto 12 h). El token lleva
  `sub` (id del perfil) y `role`; la API usa el rol de la base (`user_roles`) en cada petición, no el del token: un cambio de rol vale al momento, y sin fila el perfil es `alumno`. Si `GET /me` o `GET /auth/me` dan un rol distinto del del token, el frontend cierra la sesión. **Un rol por perfil** (ADR 0001): `alumno`, `tutor`, `profesor` o `admin`. No hay
  refresh ni logout en el servidor: cerrar sesión es borrar el token (y antes, darse de baja del push).
- **La tablet** no es usuario: `Authorization: Device <device_token>` (ver § Tablet).
- **Errores**: `{ error, code, message, ...details }`. `error` es la categoría (`bad_request`, `unauthorized`,
  `payment_required`, `forbidden`, `not_found`, `conflict`, `internal_error`); la UI decide por `code`. Los de campo
  traen `field` (`invalid_field`). `message` está en español pero es técnico: la UI pone su propio texto por `code`.
- **Rate limiting** (B20): por IP, `429 rate_limited` (`error: too_many_requests`) con `Retry-After` en segundos. `POST /auth/register`,
  `/auth/login`, `/auth/google`, `/auth/mfa/verify` y `/auth/password/reset`: 30 cada 15 min (contador común); `/auth/password/forgot`:
  5 por hora; `/tablet/link`: 10 cada 15 min; todo `/admin/agreements/*`: 60 cada 15 min. La IP sale de `TRUST_PROXY` (saltos de proxy:
  1 en el VPS con Nginx, 2 en el staging con Tailscale Funnel + Nginx).
- **Comunes**: `401 missing_token|invalid_token`, `403 insufficient_role` (rol no permitido), `400 invalid_id` (uuid o id
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
| `/events/:id` | enlace de los avisos de eventos y del email de reembolso; `cancel_url` del Checkout de un evento |
| `/events/:id?pago=ok` | vuelta del Checkout de un evento (la inscripción se confirma con el webhook: releer `GET /events/:id`) |
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

## Eventos (B21.0)

Un evento no es una sesión: uno se **inscribe** (CONTEXT § Eventos). Lo ve cualquiera con sesión: los programados que no han
terminado, aquellos en los que el sujeto estuvo inscrito y, el profesor, los que imparte (el admin, todos). Forma de un
evento (`event`): `{ id, title, description, starts_at, ends_at, location, discipline: { id, name } | null, trainer: { id,
display_name } | null, capacity (null = sin límite), taken (pendientes + confirmadas), audience ('all'|'minors'|'adults'),
requires_risk_cover, price_cents (0 = gratis), member_price_cents | null, registration_deadline | null, status
('scheduled'|'cancelled'), registration: { id, status ('pending'|'confirmed'|'cancelled'), amount_cents } | null }`.
`registration` es la del sujeto (la viva o, si no, la última). La edad no sale nunca: el público se comprueba al inscribirse.

| Método y ruta | Rol | Cuerpo / query | Respuesta |
|---|---|---|---|
| `GET /events?profile_id&registered` | cualquiera (`profile_id`: el admin o su tutor; si no, `403 not_guardian`) | `registered=true`: solo en los que el sujeto tiene inscripción (de cualquier estado) | `{ events: [event] }` por inicio |
| `GET /events/:id?profile_id` | cualquiera | — | `{ event }`. `404 event_not_found` (también si no lo ve) |
| `POST /events/:id/registrations` | alumno, tutor | `{ profile_id? }` | importe 0 (gratis o socio a 0 €): `201 { registration }` confirmada; con importe: `201 { registration, url }` pendiente (ocupa plaza) → redirigir al Checkout (caduca a los 30 min). `registration`: `{ id, event_id, profile_id, actor_id, payer_id, status, amount_cents, guest, created_at }` |
| `DELETE /events/registrations/:id` | alumno, tutor | — | `204`. Solo gratis o pendiente (su Checkout se caduca), hasta el inicio |

Importe: el precio de socio si el sujeto tiene suscripción en vigor al inscribirse y el evento lo tiene; si no, el precio.
Lo pagado queda en la inscripción. Perfil completo del sujeto y del actor (`403 profile_incomplete { missing }`, como
`requireCompleteProfile`) y cobertura de riesgo solo si `requires_risk_cover`.
Errores: `403 not_guardian` (también el hijo con 18 sin reclamar), `403 profile_incomplete`, `403 no_risk_cover`,
`404 event_not_found|registration_not_found`, `409 event_cancelled`, `409 registration_closed` (fecha límite o inicio),
`409 event_full`, `409 already_registered`, `409 audience_mismatch`, `409 not_a_student` (un tutor no se inscribe a sí
mismo), `409 paid_registration` (pagada: «pídelo a la academia»), `409 event_started`, `409 already_cancelled`.

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
| `GET /professor/events?from&to` | días, ≤ 92 (por defecto hoy + 30) | `{ events: [event] }` los que imparte (`registration` siempre `null`) |
| `GET /professor/events/:id` | — | `{ event, students: [{ profile_id, display_name, attended (null = sin marcar), risk_cover }] }` (inscritos confirmados). `404 event_not_found` |
| `GET /professor/events/:id/health` | — | `{ students: [...] }` como el de sesiones, de los inscritos confirmados; **solo los días del evento** (Madrid) y auditado (`health.view`, `resource_type: 'event'`). `404 event_not_found` |

**Lista de un evento (profesor del evento y admin)**: `PUT /events/:id/attendance/:profileId { present: boolean }` →
`{ profile_id, present }`, desde el inicio, sin cerrar ni corregir (se puede volver a marcar). No cuenta para racha, horas,
badges, ranking ni informes. `404 registration_not_found` (sin inscripción confirmada o no es su evento),
`409 event_not_started`, `409 event_cancelled`.

**Lista (profesor de la sesión y admin)** — montadas en `/sessions`:

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| `GET /sessions/:id/attendance` | — | `{ closed_at, students: [{ booking_id, student_id, display_name, status, method, corrected_at, correction_reason, risk_cover }] }` |
| `PUT /sessions/:id/attendance/:studentId` | `{ present: boolean }` | `{ student_id, present }` (antes del cierre) |
| `POST /sessions/:id/attendance/close` | — | `{ present, absent }` |
| `POST /sessions/:id/attendance/:studentId/correct` | `{ status: 'present'\|'absent', reason (≤500) }` | `{ attendance }` |

Errores: `409 session_not_started`, `409 session_cancelled`, `409 attendance_closed`, `409 attendance_not_closed`,
`404 no_active_booking`, `409 no_change`, `403 correction_window_expired`, `400 reason_required` (lo lanza `correct_attendance`; la ruta ya rechaza un motivo vacío con `400 invalid_field`).

## Tablet

| Método y ruta | Auth | Respuesta |
|---|---|---|
| `POST /tablet/link` `{ code }` | — (código de un solo uso del admin) | `201 { device_token }` (solo esta vez; guardarlo en la tablet). `400 invalid_link_code` |
| `GET /tablet/active-sessions` | `Device <token>` | **SSE**: evento `feed` `{ qr, expires_in, sessions: [{ session_id, discipline, starts_at, ends_at }] }` cada periodo del QR (`discipline` es el nombre de la disciplina); `revoked` (`{ code: 'device_not_found' }`) si la revocan; y `error` (`{ code }`) si falla la lectura, tras lo cual el servidor cierra el stream. Sin nombres de alumnos |

## Admin

Todas exigen `role = admin` (y el admin entra con MFA si lo tiene activado). El MFA del admin es opcional (ADR 0016). El token del admin caduca a las 12 h.

**Usuarios y roles** (B19.0). Nunca devuelven `birth_date` ni salud: de la edad, solo `is_minor` y `pending_claim` (cumplió 18 sin reclamar su perfil).

| Método y ruta | Cuerpo / query | Respuesta |
|---|---|---|
| `GET /admin/profiles?q&role&discipline_id&plan_id&estado&limit&offset` | `q` en nombre y email, sin distinguir mayúsculas; `role` `alumno\|tutor\|profesor\|admin`; `discipline_id` (alumnos cuya suscripción viva, también la impagada, cubre la disciplina: la regla de cubrir); `plan_id` (el de la viva); `estado` `activo\|impago\|inactivo\|sin_plan` (`activo` incluye los inactivos, como el KPI) | `{ profiles: [{ id, display_name, email, role, is_minor, pending_claim, created_at, subscription_status, plan_id, plan_name, estado, last_attendance_at }], total, limit, offset }` por nombre; `email` `null` en un hijo; `subscription_status`, `plan_id` y `plan_name` los de la viva o `null`; `estado` solo de un alumno (`null` en el resto), el más fuerte: `impago` (sale en Morosos) > `inactivo` (en vigor sin asistencia en 14 días) > `activo` > `sin_plan`; `last_attendance_at` inicio de la última sesión no cancelada con presente, o `null`. `400 invalid_field` (rol, ids, estado), `invalid_pagination` |
| `GET /admin/profiles/stats?discipline_id` | `discipline_id` como en la lista | `{ activos, impago, inactivos }`: solo alumnos (menores incluidos). `activos` con suscripción en vigor y sin impago; `impago` los alumnos distintos con algo en gracia o impagado de un pagador moroso (los de `GET /admin/billing/delinquents`; cuenta alumnos, no pagadores); `inactivos` los activos sin asistencia en 14 días. `400 invalid_field` |
| `GET /admin/profiles/:id` | — | `{ profile: { id, display_name, email, role, created_at, is_minor, pending_claim, is_public, has_password, has_google }, status: { ok, missing?, risk_cover } \| null (solo de un alumno), guardians: [{ id, display_name, email }], children: [{ id, display_name, pending_claim }], subscription: { …como GET /billing/subscription, payer: { id, display_name } } \| null, insurance: { …como GET /billing/insurance, payer } \| null }`. `404 profile_not_found` |
| `PUT /admin/profiles/:id/role` | `{ role }` (`alumno`, `tutor` o `profesor`) | `{ profile }` (como en la ficha). Vale en la siguiente petición del afectado. `audit_log` `profile.role_change` `{ from, to }`. `400 invalid_field`; `404 profile_not_found`; `409 same_role`, `admin_role_locked`, `child_role_locked` (sin acceso propio), `trainer_has_sessions` (profesor habitual de una clase no retirada o de una sesión futura no cancelada), `student_has_subscription` (alumno con suscripción o seguro vivos que pasaría a tutor o profesor) |
| `POST /admin/profiles/:id/guardians` | `{ tutor_id }` | `201 { guardians }`. `audit_log` `guardian.add`. `400 invalid_field`; `404 profile_not_found`; `409 not_a_child` (`:id` tiene acceso propio), `invalid_guardian` (el tutor no existe, no tiene acceso propio o es menor), `already_guardian` |
| `DELETE /admin/profiles/:id/guardians/:tutorId` | — | `204`. `audit_log` `guardian.remove`. `404 profile_not_found` (también si no es su tutor); `409 not_a_child`, `last_guardian`, `guardian_is_payer` (paga su suscripción o su seguro vivos: antes, cambio de pagador) |

**Catálogo**

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| `GET /admin/disciplines` | — | `{ disciplines }` (todas) |
| `POST /admin/disciplines` | `{ name, minors_only?, is_active?, is_open? }` | `201 { discipline }` |
| `PATCH /admin/disciplines/:id` | `{ name?, minors_only?, is_active?, is_open? }` | `{ discipline }`; al desactivar, `discipline` trae además `retired_classes` y `cancelled_sessions` |
| `GET /admin/plans` | — | `{ plans }` (todos) |
| `POST /admin/plans` | `{ name, price_cents, max_disciplines (null = todas), billing_period?, minors_only?, is_active? }` | `201 { plan }` |
| `PATCH /admin/plans/:id` | campos del plan | `{ plan }` |
| `GET/PUT /admin/plans/:id/disciplines` | PUT `{ discipline_ids }` | `{ discipline_ids }` |

**Clases y sesiones**

| Método y ruta | Cuerpo / query | Respuesta |
|---|---|---|
| `GET /admin/classes?discipline_id` | — | `{ classes: [{ id, discipline_id, discipline_name, trainer_id, trainer_name, weekday (1=lun), start_time (HH:MM), duration_min, capacity, location, starts_on, ends_on (YYYY-MM-DD, días de Madrid; `ends_on` el último día de la clase o `null`) }] }` |
| `POST /admin/classes` | `{ discipline_id, trainer_id, weekday, start_time, duration_min, capacity, location?, starts_on?, ends_on? }` | `201 { class }` (genera las sesiones a un año) |
| `PATCH /admin/classes/:id` | `{ from?, trainer_id?, start_time?, duration_min?, capacity?, location? }` | `{ class, sessions_changed, notified, promoted }` |
| `POST /admin/classes/:id/retire` | `{ date? }` | `{ class: { …, cancelled_sessions } }` |
| `GET /admin/sessions/:id` | — | `{ session: { id, class_id, starts_at, ends_at, discipline: { id, name }, trainer: { id, display_name }, location, capacity, duration_min, status, held, adjusted_fields, class_values: { trainer_id, starts_at (el slot), duration_min, capacity, location } \| null (sesión suelta), cancel_note }, bookings: [{ id, student: { id, display_name }, status (confirmed\|waitlisted), created_at }] }`: primero las confirmadas y luego la espera, cada grupo por orden de llegada. `404 session_not_found` |
| `POST /admin/sessions` | `{ discipline_id, trainer_id, starts_at, duration_min, capacity, location? }` | `201 { session }` (sesión suelta) |
| `PATCH /admin/sessions/:id` | `{ trainer_id?, starts_at?, duration_min?, capacity?, location? }` | `{ session, sessions_changed, notified, promoted }` |
| `POST /admin/sessions/:id/cancel` | `{ note? }` (obligatoria si ya empezó) | `{ session, retroactive, cancelled_bookings, notified }` |
| `POST /admin/sessions/:id/restore` | — | `{ session, notified }` |
| `POST /admin/sessions/:id/reset` | `{ fields: [...] }` | `{ session, sessions_changed, notified, promoted }` |

El admin ve el calendario con `GET /sessions/calendar` (y el de un alumno con `profile_id`), pasa lista con las rutas
de `/sessions/:id/attendance` y reserva por cualquiera con `POST /bookings { profile_id }`.
Errores: `409 trainer_overlap`, `409 capacity_below_bookings { sessions, fits_from }`, `409 session_not_adjustable`,
`409 class_retired`, `409 discipline_inactive`, `409 slot_passed`, `409 already_retired`, `409 loose_session`.

**Eventos** (B21.0). Cada acción queda en `audit_log` (`event.create`, `event.update` `{ from, to }`, `event.cancel`,
`event_registration.guest`, `event_registration.cancel` `{ from, refund }`, `event_registration.refund`). Los reembolsos se
piden a Stripe tras confirmar la base (siempre del importe entero) y el email al pagador sale al llegar `charge.refunded`.

| Método y ruta | Cuerpo / query | Respuesta |
|---|---|---|
| `GET /admin/events?from&to&status&limit&offset` | días de Madrid sobre `starts_at`; `status` `scheduled\|cancelled` | `{ events: [event + cancel_note, created_at, updated_at], total, limit, offset }` por inicio, cancelados incluidos |
| `POST /admin/events` | `{ title (1–120), starts_at (futuro), ends_at, location (1–200), description? (≤2000), discipline_id?, trainer_id? (profesor), capacity? (≥1 o null), audience?, requires_risk_cover? (true), price_cents? (0 o ≥50), member_price_cents? (null, 0 o ≥50, ≤ precio), registration_deadline? (≤ inicio) }` | `201 { event }` (se publica al crearlo; sin aviso) |
| `GET /admin/events/:id` | — | `{ event, registrations: [{ id, student: { id, display_name }, status, amount_cents, guest, payer: { id, display_name } \| null, refund_status (null\|requested\|refunded\|failed), refunded_cents, attended, cancel_reason (student\|admin\|event_cancelled\|checkout_expired), created_at }] }` por orden de llegada |
| `PATCH /admin/events/:id` | los campos de `POST`, solo lo que cambia | `{ event, notified }`. Cambiar inicio, fin o lugar avisa a los inscritos vivos (`notice.event_changed`); precio, público y cobertura no tocan a quien ya está dentro. `409 capacity_below_registrations { taken }`, `409 event_cancelled` |
| `POST /admin/events/:id/cancel` | `{ note? }` (≤500, solo la ve el admin) | `{ refunded, refund_failed, notified }`: cancela todas las inscripciones, devuelve todo lo pagado, caduca los Checkouts abiertos y avisa a los inscritos. `409 event_cancelled` |
| `POST /admin/events/:id/registrations` | `{ profile_id }` | `201 { registration }` invitado (`guest`, importe 0): sin cierre de inscripciones, con requisitos y aforo |
| `POST /admin/event-registrations/:id/cancel` | `{ refund: boolean }` | `{ registration: { …, cancel_reason, refund_status, refunded_cents } }`. Con `refund`, devuelve el importe entero (si estaba pagada) y avisa (`notice.event_registration_cancelled`). Sobre una ya cancelada y pagada, `refund: true` con `refund_status` `null` o `failed` reintenta el reembolso; si no, `409 already_cancelled` |

Un reembolso que Stripe rechaza, al pedirlo o más tarde (`refund.failed`), deja `refund_status: 'failed'` y un
`notice.event_refund_failed` en `GET /admin/notices`. Uno que se quedó en `requested` (el proceso cayó antes de llamar a
Stripe) lo pide la tarea nocturna. En el extracto, el cobro sale con el prefijo de la cuenta y el sufijo de
`STRIPE_STATEMENT_DESCRIPTOR` (sus 10 primeros caracteres).

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
| `GET /admin/payer-changes?status&from&subscription_id&limit&offset` | `status` admite varios (`requested,paid`; `requested\|paid\|completed\|expired\|cancelled`), `from` es un día sobre `updated_at`, `subscription_id` limita a una suscripción | `{ rows: [{ id, status, subscription_id, student: { id, display_name }, old_payer: { … }, new_payer: { … }, plan: { id, name }, starts_at, deadline, cancel_reason, updated_at }], total, limit, offset }`, el más reciente primero. Un `requested` pasada su fecha límite sale (y se filtra) como `expired`, aunque el webhook aún no lo haya marcado. `400 invalid_field`, `invalid_pagination` |
| `GET /admin/payer-changes/:id` | — | como el del alumno |
| `DELETE /admin/subscriptions/:id/payer-change` | — | `204` |

**Ajustes de la academia** (los `PUT` devuelven `{ settings }` con los valores vigentes)

| Método y ruta | Cuerpo |
|---|---|
| `GET /admin/settings` | — → `{ checkin: { opens_minutes, closes_minutes, qr_seconds }, insurance: { enabled, price_adult_cents, price_minor_cents }, discipline_changes: { per_period } }`: lo mismo que devuelve cada `PUT` en `settings` |
| `PUT /admin/settings/checkin` | `{ opens_minutes?, closes_minutes?, qr_seconds? }` |
| `PUT /admin/settings/insurance` | `{ price_adult_cents?, price_minor_cents?, enabled? }` |
| `PUT /admin/settings/discipline-changes` | `{ per_period }` |

**Auditoría, avisos de la academia y entregas fallidas** (B19.1). Todas paginadas (`limit` 1–100, 25 por defecto; `offset`) y del más nuevo al más viejo; `from` y `to` son días de Madrid, ambos incluidos. `400 invalid_pagination`, `invalid_field`.

| Método y ruta | Respuesta |
|---|---|
| `GET /admin/audit?action&actor_id&resource_type&resource_id&from&to&limit&offset` | `{ rows: [{ id, created_at, action, actor: { id, display_name }, resource_type, resource_id, changes }], total, limit, offset }`. `action` son prefijos separados por comas (`session.,class.`). **Nunca** devuelve `notice.*` (ni filtrando por ellos). `400 invalid_range` si `to < from` |
| `GET /admin/home` | — | Inicio en vivo (B23): `{ figures: { active, past_due, unpaid, new_subscriptions, cancelled_subscriptions, mrr_cents }` (las de la foto, pero de ahora: `academy_stats_now()`, que solo deja pasar al admin), `students: { activos, impago, inactivos }` (como `/admin/profiles/stats`), `attendance: { today, last_week }` (entradas `present` de las sesiones no canceladas de hoy y del mismo día de hace 7, días de Madrid), `sessions: [{ id, starts_at, ends_at, discipline, trainer, location, capacity, status, booked, present }]` (las de hoy, también las canceladas), `next` (la próxima programada que no ha empezado, o `null`) } |
| `GET /admin/notices?limit&offset` | `{ rows: [{ id, created_at, action, resource_type, resource_id, details }], total, limit, offset }`: los `notice.*` con algún admin entre sus destinatarios (`stripe_risk`, la carrera de Checkouts, `payer_change_expired`…); `details` es `changes` sin `recipients` |
| `GET /admin/notice-deliveries?from&limit&offset` | `{ rows: [{ id, created_at, action, channel, recipient: { id, display_name }, attempts, last_error }], total, limit, offset }`: solo las `failed` (no se reintentan); `from` sobre `created_at` |

**Tablets, documentos y perfiles**

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| `GET /admin/tablets` | — | `{ tablets: [{ id, name, link_expires_at, created_at, linked_at, last_seen_at, revoked_at }] }` |
| `POST /admin/tablets` | `{ name }` | `201 { tablet: { …, link_code } }` (el código solo se ve aquí) |
| `POST /admin/tablets/:id/revoke` | — | `{ tablet }` |
| `GET /admin/agreements/documents` | — | `{ documents: [{ id, type, version, checksum, created_at, published_at, retired_at, status }] }` |
| `POST /admin/agreements/documents?type&version` | **cuerpo crudo** `application/pdf`, ≤ 10 MB | `201 { document }` (borrador). `400 invalid_type`, `invalid_version` (X.Y), `invalid_file` (no empieza por `%PDF-`); `409 duplicate_document` (mismo PDF), `version_exists_different_content` |
| `GET /admin/agreements/documents/:id/file` | — | el PDF (`application/pdf`, con `X-Agreement-Type` y `X-Agreement-Version`) de cualquier estado: borrador, vigente o retirado. `404 document_not_found` |
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
reintentar `GET /billing/subscription`). Igual con un evento: la inscripción queda `pending` hasta `checkout.session.completed`
(o se cancela con `checkout.session.expired`).

Eventos de Stripe que hay que suscribir en el endpoint (sandbox, staging y producción): los de `HANDLED_EVENTS`
(`src/services/stripeWebhook.js`), que desde B21.0 incluyen **`checkout.session.expired`** y **`refund.failed`** (un
reembolso que Stripe da por fallido después de aceptarlo vuelve a `refund_status: 'failed'` con su aviso de la academia).

---

## Huecos conocidos (para el diseño técnico)

Lo que una pantalla podría pedir y la API **no da hoy**. Se decide en el diseño de B18/B19 si se añade o se rodea
(los de admin se resolvieron en B19.0 y B19.1: ver «Admin» arriba):

- **Cuenta**: verificar el email, cambiar email o contraseña con sesión, reclamar el perfil al cumplir 18
  (`pending_claim`). No hay logout de servidor ni revocación de tokens.
- **Alumno**: no hay detalle de una sesión aparte del calendario; tampoco su historial de recibos (lo da el Portal).
