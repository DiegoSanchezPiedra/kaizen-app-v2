# db-architecture.md — Esquema de base de datos, roles e índices

## Visión general
PostgreSQL en VPS con RLS habilitado y FORCE ROW LEVEL SECURITY en todas las tablas. Tres roles de base de datos:
- `migrator`: propietario de las tablas, ejecuta migraciones.
- `app_user`: rol de la aplicación. Sin BYPASSRLS, no propietario. Usado por el backend para consultas con contexto de usuario.
- `service_role`: usado solo por tareas internas (webhook Stripe, cron de agregaciones, waiver). Puede saltar RLS.

## Enums
- `app_role`: alumno, profesor, admin
- `sub_status`: active, pending_cash, past_due, cancelled, grace_period, incomplete
- `booking_status`: confirmed, waitlisted, cancelled
- `session_status`: scheduled, cancelled, completed
- `attendance_status`: present, absent
- `attendance_method`: manual, qr
- `payment_method`: stripe, cash (cash reservado para futuro)
- `event_payment_status`: free, pending, paid, cash

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

### insurances (B10.3; `subscription_agreements` se borró en 013)
| Columna | Tipo |
|---|---|
| id | uuid PK |
| student_id | uuid FK profiles |
| payer_id | uuid FK profiles |
| status | sub_status |
| bracket | text (`adult` / `minor`) |
| stripe_subscription_id | text UNIQUE NOT NULL |
| current_period_start / current_period_end | timestamptz |
| cancel_at_period_end | boolean |
| cancelled_at | timestamptz |
| created_at | timestamptz |

Índices: `(payer_id)`, único parcial `(student_id)` con estado vivo. `invoices.insurance_id` apunta aquí.

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

### events / event_registrations
`events`: id, title, description, starts_at, ends_at, capacity, price_cents, location.
`event_registrations`: id, event_id, student_id, payment_status.
Índice: `(event_id)`, `(student_id)`.

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

### student_stats_daily (agregación)
| Columna | Tipo |
|---|---|
| student_id | uuid |
| date | date |
| classes_attended | integer |
| streak_weeks | integer |

PK `(student_id, date)`.

### academy_stats_daily (agregación)
| Columna | Tipo |
|---|---|
| date | date PK |
| active_students | integer |
| new_students | integer |
| cancelled_students | integer |
| mrr_cents | integer |
| occupancy_rate | numeric |

### push_subscriptions
| Columna | Tipo |
|---|---|
| id | uuid PK |
| user_id | uuid FK |
| endpoint | text |
| keys | jsonb |
| created_at | timestamptz |

Índice: `(user_id)`.

## Vistas
- `public_profiles`: expone solo columnas públicas de filas con is_public=true y flags activos.

## Resumen de políticas RLS por tabla
- `profiles`: alumno lee/edita el suyo; profesor lee nombre de alumnos de sus sesiones; admin todo. Lectura pública solo a través de `public_profiles`.
- `bookings`: alumno sus propias; profesor las de sus sesiones; admin todas.
- `attendance`: alumno lee las suyas; profesor inserta/edita en sus sesiones; admin todas.
- `subscriptions`, `invoices`, `cash_payments`: alumno lee las suyas; profesor ninguna; admin todas. Escritura solo service_role y admin vía RPC.
- `class_sessions`: lectura para authenticated; escritura solo admin.
- `user_mfa`: solo el propio usuario y service_role.
- `audit_log`: solo admin lectura; escritura solo service_role.
- `student_stats_daily` / `academy_stats_daily`: alumno lee las suyas; admin todas.
- `webhook_events`: solo service_role.