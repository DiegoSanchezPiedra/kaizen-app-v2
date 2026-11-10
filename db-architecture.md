# db-architecture.md — Esquema de base de datos, roles e índices

## Visión general
PostgreSQL en VPS con RLS habilitado y FORCE ROW LEVEL SECURITY en todas las tablas. Tres roles de base de datos:
- `migrator`: propietario de las tablas, ejecuta migraciones.
- `app_user`: rol de la aplicación. Sin BYPASSRLS, no propietario. Usado por el backend para consultas con contexto de usuario.
- `service_role`: usado solo por tareas internas (webhook Stripe, cron de agregaciones). Puede saltar RLS.

## Enums
- `app_role`: alumno, profesor, admin
- `sub_status`: active, pending_cash, past_due, cancelled, grace_period, incomplete
- `booking_status`: confirmed, waitlisted, cancelled
- `session_status`: scheduled, cancelled, completed
- `attendance_status`: present, absent
- `attendance_method`: manual, qr
- `payment_method`: stripe, cash (cash reservado para futuro)

## Tablas

### user_roles
| Columna | Tipo | Notas |
|---|---|---|
| id | bigint PK | |
| user_id | uuid FK auth | UNIQUE junto con role |
| role | app_role | |

Índice: `(user_id)`.

### profiles
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK FK auth | |
| display_name | text | |
| phone | text | |
| avatar_url | text | |
| bio | text | |
| social_links | jsonb | |
| is_public | boolean default false | |
| visible_fields | jsonb | flags por campo |
| created_at | timestamptz | |

Índice: `(is_public) WHERE is_public = true`.

### user_mfa
| Columna | Tipo |
|---|---|
| id | uuid PK |
| user_id | uuid FK UNIQUE |
| totp_secret_encrypted | text |
| recovery_codes_encrypted | text |
| mfa_enabled | boolean default false |
| created_at / updated_at | timestamptz |

Índice: `(user_id)`.

### disciplines
| Columna | Tipo |
|---|---|
| id | bigint PK |
| name | text UNIQUE |
| is_active | boolean |
| is_open | boolean NOT NULL DEFAULT false (disciplina abierta, B14) |

### plans
| Columna | Tipo |
|---|---|
| id | bigint PK |
| name | text |
| price_cents | integer |
| billing_period | text |
| is_active | boolean |

### plan_disciplines
PK compuesta `(plan_id, discipline_id)`.

### subscriptions
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| student_id | uuid FK profiles | |
| plan_id | bigint FK plans | |
| status | sub_status | |
| payment_method | payment_method default 'stripe' | |
| current_period_start / end | timestamptz | |
| cancel_at_period_end | boolean default false | |
| cancelled_at | timestamptz NULL | |
| stripe_subscription_id | text NULL | |
| created_at | timestamptz | |

Índices: `(student_id)`, `(status)`, `(stripe_subscription_id)`.

### cash_payments (creada vacía, reservada para futuro)
| Columna | Tipo |
|---|---|
| id | uuid PK |
| subscription_id | uuid FK |
| student_id | uuid FK |
| admin_id | uuid FK |
| amount_cents | integer |
| period_start / end | date |
| received_at | timestamptz |
| notes | text NULL |

### invoices
| Columna | Tipo |
|---|---|
| id | uuid PK |
| student_id | uuid FK |
| subscription_id | uuid FK NULL |
| stripe_invoice_id | text UNIQUE |
| external_pdf_url | text |
| amount_due_cents / paid_cents | integer |
| status | text |
| paid_at | timestamptz |

Índice: `(student_id)`, `(stripe_invoice_id)`.

### class_sessions
| Columna | Tipo |
|---|---|
| id | uuid PK |
| discipline_id | bigint FK |
| trainer_id | uuid FK profiles |
| starts_at | timestamptz |
| duration_min | integer |
| capacity | integer |
| location | text |
| status | session_status |

Índices: `(starts_at)`, `(trainer_id, starts_at)`, `(discipline_id, starts_at)`.

### bookings
| Columna | Tipo |
|---|---|
| id | uuid PK |
| session_id | uuid FK |
| student_id | uuid FK |
| status | booking_status |
| created_at | timestamptz |

Restricción: `UNIQUE (session_id, student_id) WHERE status != 'cancelled'`.
Índices: `(student_id, created_at DESC)`, `(session_id, status)`.

### attendance
| Columna | Tipo |
|---|---|
| id | uuid PK |
| session_id | uuid FK |
| student_id | uuid FK |
| status | attendance_status |
| method | attendance_method |
| recorded_by | uuid FK NULL |
| recorded_at | timestamptz |
| corrected_at | timestamptz NULL |
| correction_reason | text NULL |

Restricción: `UNIQUE (session_id, student_id)`.
Índices: `(student_id, recorded_at DESC)`, `(session_id)`.

### events (B21.0, `028`; las tablas de `001` se borraron, vacías, con el enum `event_payment_status`)
| Columna | Tipo |
|---|---|
| id | uuid PK |
| title | text (1–120) |
| description | text NULL (≤ 2000) |
| starts_at, ends_at | timestamptz (`ends_at > starts_at`) |
| location | text (1–200) |
| discipline_id | bigint FK disciplines NULL |
| trainer_id | uuid FK profiles NULL (profesor; lo comprueba el servicio) |
| capacity | integer NULL (> 0; NULL = sin límite) |
| audience | text `all\|minors\|adults` (por defecto `all`) |
| price_cents | integer (0 o ≥ 50) |
| member_price_cents | integer NULL (0 o ≥ 50, ≤ `price_cents`) |
| registration_deadline | timestamptz NULL (≤ `starts_at`) |
| status | text `scheduled\|cancelled` |
| cancel_note | text NULL (≤ 500, solo admin) |
| created_by | uuid FK profiles |
| created_at, updated_at | timestamptz |

Índices: `(starts_at)`, `(trainer_id)`. Nunca se borra (sin `DELETE` para `app_user`): se cancela.

### event_registrations (B21.0, `028`)
| Columna | Tipo |
|---|---|
| id | uuid PK |
| event_id | uuid FK events |
| profile_id | uuid FK profiles (sujeto) |
| actor_id | uuid FK profiles |
| payer_id | uuid FK profiles NULL (NULL si el importe es 0) |
| status | text `pending\|confirmed\|cancelled` (pendiente solo con importe > 0) |
| amount_cents | integer ≥ 0 (lo pagado; 0 si `guest`) |
| guest | boolean (invitado del admin) |
| cancel_reason | text NULL `student\|admin\|event_cancelled\|checkout_expired` (obligatorio si cancelada, con `cancelled_at`) |
| checkout_session_id | text NULL UNIQUE |
| payment_intent_id | text NULL UNIQUE |
| refund_status | text NULL `requested\|refunded\|failed` |
| refunded_cents | integer (lo devuelto según `charge.refunded`) |
| attended | boolean NULL (sin marcar) |
| created_at, cancelled_at | timestamptz |

Índices: `UNIQUE (event_id, profile_id) WHERE status IN ('pending','confirmed')` (una viva), `(event_id)`, `(profile_id)`.
Escriben solo las funciones `SECURITY DEFINER` (owner `service_role`) `register_event`, `attach_event_checkout`,
`cancel_event_registration`, `cancel_event`, `mark_event_attendance` y el `servicePool` (webhook y reembolsos).
`event_taken` da las plazas ocupadas sin leer inscripciones ajenas; `event_notice` crea los avisos de eventos (solo
admin); `professor_event_health` da las fichas el día del evento con `health.view`. `teaches_student` (017) incluye a
los inscritos en los eventos del profesor, que así ve sus nombres.

### webhook_events
| Columna | Tipo |
|---|---|
| id | text PK (Stripe event ID) |
| type | text |
| processed_at | timestamptz |
| payload | jsonb |

### academy_settings
| Columna | Tipo |
|---|---|
| key | text PK |
| value | jsonb |

Claves: `qr_rotation_seconds`, `qr_activation_minutes_before`, `qr_deactivation_minutes_after`, `cancellation_hours_before`, `grace_period_days`.

### audit_log
| Columna | Tipo |
|---|---|
| id | uuid PK |
| actor_id | uuid FK |
| action | text |
| resource_type | text |
| resource_id | text |
| changes | jsonb |
| created_at | timestamptz |

Índice: `(actor_id, created_at DESC)`, `(resource_type, resource_id)`.

### academy_stats_daily (foto diaria, B16)
| Columna | Tipo |
|---|---|
| date | date PK (día de Madrid) |
| active | integer NOT NULL |
| past_due | integer NOT NULL |
| unpaid | integer NOT NULL |
| new_subscriptions | integer NOT NULL |
| cancelled_subscriptions | integer NOT NULL |
| mrr_cents | integer NOT NULL |

Una fila por día con el estado de las suscripciones; no cambia nunca y un día sin fila es un hueco (ADR 0012). Altas y bajas sin traspasos; `mrr_cents` de las `active` y `past_due`. La escribe `snapshot_academy_stats(date)` desde `scripts/nightly.js`. `mrr_cents` se sigue escribiendo, pero la app ya no lo lee (B24.2: los ingresos se ven en Stripe); `academy_stats_now()` (029) se borró en `032`. `student_stats_daily` (001) se borró en `023`: la asistencia se calcula al leer.

### push_subscriptions
| Columna | Tipo |
|---|---|
| id | uuid PK |
| user_id | uuid FK |
| endpoint | text |
| keys | jsonb |
| created_at | timestamptz |

Índice: `(user_id)`.

### password_resets (B18.0, `025`)
| Columna | Tipo |
|---|---|
| id | uuid PK |
| profile_id | uuid FK profiles (CASCADE) |
| token_hash | text UNIQUE (SHA-256 del token; el token en claro solo va en el email) |
| expires_at | timestamptz (1 h) |
| used_at | timestamptz (usado, o anulado al pedir otro) |
| created_at | timestamptz |

Índice: `(profile_id)`. Sin acceso para `app_user`: solo `create_password_reset(email, token_hash)` y `consume_password_reset(token_hash, password_hash)` (`SECURITY DEFINER`, owner `service_role`).

## Vistas
- `public_profiles`: expone solo columnas públicas de filas con is_public=true y flags activos.

## Resumen de políticas RLS por tabla
Convención desde B20 (`docs/auditoria-rls-b20.md`): sin privilegios por defecto para `app_user` (`040`), así que cada tabla nueva lleva RLS en `ENABLE` y `FORCE`, sus políticas y su `GRANT … TO app_user` explícito; si solo la usa el `servicePool`, va en `SERVICE_ONLY` de `scripts/test-rls.js`. Las funciones `SECURITY DEFINER`: owner `service_role`, `SET search_path = public`, `REVOKE ALL … FROM PUBLIC` y el actor comprobado dentro (`app_user` no crea tablas temporales, `039`).
- `profiles`: alumno lee/edita el suyo; profesor lee nombre y foto de alumnos de sus sesiones y eventos por `student_names` (`044`); admin todo. Lectura pública solo a través de `public_profiles`.
- `bookings`: alumno sus propias; profesor las de sus sesiones; admin todas.
- `attendance`: alumno lee las suyas; profesor inserta/edita en sus sesiones; admin todas.
- `subscriptions`, `invoices`: alumno lee las suyas; profesor ninguna; admin todas. Escritura solo service_role y admin vía RPC. `cash_payments`: solo `service_role` hasta que el efectivo tenga su bloque (`041`).
- `class_sessions`: lectura para authenticated; escritura solo admin.
- `disciplines`: las activas para cualquier autenticado y todas para el admin (007); el suscriptor, las de su suscripción viva (012); el profesor, también las de sus sesiones aunque estén desactivadas (`disciplines_select_trainer`, `024`, B17).
- `user_mfa`: solo el propio usuario y service_role.
- `password_resets`: RLS forzada sin políticas y sin privilegios para `app_user`; solo por sus dos funciones (`025`).
- `audit_log`: solo admin lectura; `app_user` no inserta (027): escribe `write_audit(actor, action, resource_type, resource_id, changes)` (`SECURITY DEFINER`, owner `service_role`), que exige que el actor sea el de la sesión, deja al admin anotar cualquier acción y al resto solo `subscription.upgrade|downgrade|downgrade_cancel`; el servicePool y las funciones `SECURITY DEFINER` escriben directo.
- `notice_deliveries`: RLS forzada; solo el admin lee (`026`, B19.0, para las entregas fallidas del panel); escribe solo `servicePool` y `enqueue_notice`.
- `academy_stats_daily`: solo el admin lee (lleva dinero, también en `/admin/reports/subscriptions`); el profesor y el alumno, nada. Sin escritura para `app_user`: la escribe `snapshot_academy_stats` (sin `EXECUTE` para `app_user`) con `servicePool`.
- `events`: lectura para cualquier autenticado (qué ve cada uno lo filtra el servicio); `INSERT`/`UPDATE` solo admin; sin `DELETE` (`028`).
- `event_registrations`: leen el sujeto, sus tutores (`is_guardian_of(…, true)`), el profesor del evento y el admin; `app_user` no escribe (`028`).
- `webhook_events`: solo service_role.