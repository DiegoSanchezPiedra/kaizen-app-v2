# Kaizen App — Contexto del proyecto

> Documento vivo. Refleja **dónde estamos**. Se actualiza al cerrar cada bloque.
> La hoja de ruta completa está en `plan-de-bloques.md`.

Última actualización: cierre de B1 + esquema real de BD + decisión `auth_credentials` para B2 + segmentación de billing (B10.1/B10.2/B10.6) y política pasiva de morosos.

---

## 0. Instrucciones para el agente de IA

Al terminar cada bloque:

1. **Devuelve `contexto-proyecto.md` completo actualizado**:
   - Mueve el bloque terminado de "EN CURSO" a "CERRADO" en §4.
   - Añade el detalle de lo implementado (archivos, endpoints, verificación manual).
   - Actualiza §6 si hay tablas/columnas nuevas (migraciones aplicadas).
   - Actualiza §8 (pendientes) y §9 (riesgos): tacha resueltos, añade nuevos.
   - Actualiza §5 si surgió alguna decisión de diseño nueva.
2. **Devuelve `plan-de-bloques.md` actualizado** solo si el bloque cambió su alcance
   (nuevos entregables, nuevas dependencias, nuevos sub-bloques). Si no cambió, dilo
   explícitamente y no lo reescribas.
3. **No avances al siguiente bloque** sin confirmación explícita del usuario.
4. **Formato de entrega**: dos bloques ```markdown ... ``` separados, uno por documento,
   listos para copiar/pegar. No reescribas los docs enteros desde cero: solo las secciones
   afectadas, manteniendo el resto idéntico.

---

## 1. Stack

- **Backend**: Node.js + Express, **ESM** (`"type": "module"`). Sin `require`.
- **BD**: PostgreSQL 16 en Docker local (contenedor `kaizen-postgres`), puerto `5432` solo en `127.0.0.1`. Despliegue futuro en VPS propio.
- **Auth**: JWT propio (`sub` + `role`: `alumno | profesor | admin`). Middleware `SET LOCAL` para RLS.
- **Auth externa**: Google OIDC (Sign in with Google) — ID Token verificado en backend.
- **Pagos**: Stripe (solo tarjeta; efectivo reservado para futuro).
- **Email transaccional**: proveedor a decidir en B10.6 (Resend, Postmark o SMTP propio).
- **Migraciones**: `node-pg-migrate` + `dotenv-cli`.
- **Roles BD**: `migrator` (DDL), `app_user` (RLS, NOBYPASSRLS), `service_role` (BYPASSRLS).
- **Hash password**: argon2 (preferido) o bcrypt.
- **JWT**: `jsonwebtoken`. **Google**: `google-auth-library`. **MFA admin (B4)**: `otplib` + `qrcode`. **Stripe (B10)**: `stripe`.

---

## 2. Convenciones

- ESM puro: `import` / `export`, nunca `require`.
- Estructura `src/`: `config/`, `middleware/`, `routes/`, `services/`.
- Rutas finas, lógica en `services/`.
- **Nunca** conectar con `DATABASE_URL` (migrator) desde la app. Solo `DATABASE_URL_APP` y `DATABASE_URL_SERVICE`.
- `SET LOCAL` **siempre** dentro de transacción (`BEGIN … COMMIT`), nunca `pool.query` suelto.
- Errores: lanzar objetos con `status`/`code`/`message`; `errorHandler` los formatea.
- **UUIDs**: `profiles.id` es `uuid` **sin default**. La app genera con `crypto.randomUUID()` (Node ≥ 19) o `gen_random_uuid()` en SQL.
- **Roles**: viven en `user_roles` (tabla separada), no en `profiles`. Se leen al emitir JWT.
- **Credenciales**: viven en `auth_credentials` (tabla separada, B2), no en `profiles`.

---

## 3. Variables de entorno (`.env`, no versionado)

```
PORT=3000
DATABASE_URL=postgresql://migrator:...@localhost:5432/kaizen_db
DATABASE_URL_APP=postgresql://app_user:...@localhost:5432/kaizen_db
DATABASE_URL_SERVICE=postgresql://service_role:...@localhost:5432/kaizen_db
# B2:
JWT_SECRET=...
JWT_EXPIRES_IN=7d
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...   # solo si se hace code exchange; para ID token basta CLIENT_ID
# B10:
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
# B10.6:
EMAIL_PROVIDER_API_KEY=...   # Resend/Postmark/SMTP según decisión
EMAIL_FROM=...
```

---

## 4. Estado actual

### B0 — CERRADO
- Docker + PostgreSQL 16 en `kaizen-postgres` (127.0.0.1:5432, healthy, volumen persistente).
- Roles verificados por psql: `app_user` (`rolbypassrls=f`), `service_role` (`rolbypassrls=t`), `migrator` (`rolbypassrls=f`).
- `.env` con las tres URLs apuntando a roles distintos.
- Migración `001_initial_setup` ejecutada: 23 tablas, owner `migrator`, RLS desactivado (correcto hasta B3).
- `package.json` con scripts `migrate`/`migrate:down`/`migrate:create` vía `dotenv-cli`.

### B1 — CERRADO
- `src/config/database.js`:
  - Dos pools independientes: `appPool` ← `DATABASE_URL_APP` (`app_user`), `servicePool` ← `DATABASE_URL_SERVICE` (`service_role`).
  - `import 'dotenv/config'` al inicio; `pool.on('error')` no letal; `application_name` `kaizen-app`/`kaizen-service`.
  - `pingPool(pool)` → `{ ok: boolean, error?: string }` (forma consistente en éxito y fallo).
  - `pingAll()` → `{ app, service }`, cada uno `{ ok, error? }`.
  - `closePools()` con `Promise.allSettled`.
- `src/middleware/errorHandler.js`:
  - `notFound(req,res)` → 404 JSON `{ error:'not_found', path }`.
  - `errorHandler(err,req,res,next)` con firma de 4 args; mensaje genérico en 500 si `NODE_ENV=production`.
- `src/index.js`:
  - `import 'dotenv/config'` primero; `express.json({limit:'1mb'})`; `trust proxy 1`.
  - `GET /health` → pinga ambos pools, 200 con `{ status:'ok', uptime, db:{app:{ok:true},service:{ok:true}}, timestamp }` o 503 `degraded`.
  - `notFound` + `errorHandler` montados al final.
  - Cierre limpio en `SIGINT`/`SIGTERM`: `server.close()` + `closePools()` + `process.exit(0)`.
- Verificado: `/health` → 200 `ok`, ruta inexistente → 404 JSON, logs de arranque muestran `app_user` y `service_role`.

### B2 — EN CURSO
Auth base (local + Google OIDC) + JWT + middleware `SET LOCAL`.
Detalle en `plan-de-bloques.md` §B2.

### B3–B20 — PENDIENTES
Ver `plan-de-bloques.md`.

---

## 5. Decisiones de diseño consolidadas

### Auth
| Decisión | Valor |
|---|---|
| Tabla de credenciales | **`auth_credentials` separada** de `profiles` (B2) |
| Métodos de login | email+password local **y** Google OIDC (no excluyentes) |
| Token de Google a verificar | **ID Token** (OIDC), no access token |
| Librería Google | `google-auth-library` (`OAuth2Client.verifyIdToken`) |
| Vinculación por email | **NO automática**. Exigir login local previo para vincular. |
| Usuario nuevo vía Google | `password_hash = NULL`, `google_sub` seteado |
| JWT propio | `sub` (`profiles.id`) + `role` (de `user_roles`), sin "limitado" en B2 |
| Refresh tokens | Fuera de B2 (B2.5 o B20) |
| MFA | Tabla `user_mfa` ya existe; B4 solo añade endpoints |

### Datos de salud
| Decisión | Valor |
|---|---|
| Ubicación | **Tabla separada** `student_health_info` (no columnas en `profiles`) |
| Campos | lesiones, condiciones físicas, experiencia previa (y disciplina), medicación, alergias, contacto de emergencia |
| Flujo | Google/registro crean usuario "desnudo"; health info se completa en onboarding |
| Bloqueo | Backend bloquea reservas (B7), checkout (B10) y operaciones de alumno activo hasta que exista fila |
| Implementación del bloqueo | B4.5 (no en B2) |

### Billing y pagos fallidos
| Decisión | Valor |
|---|---|
| Evento Stripe clave | `invoice.payment_failed` (también `invoice.payment_action_required`, `customer.subscription.updated/deleted`) |
| Datos en `invoices` | Añadir `stripe_invoice_id`, `status`, `attempt_count`, `next_payment_attempt`, `last_payment_error` (jsonb), `hosted_invoice_url` |
| Notificación al alumno | **Email transaccional** en `invoice.payment_failed` (B10.6). Push en B15. |
| Notificación al admin | **Pasiva**: lista en panel (B10.2 + UI en B19). Sin email diario ni push al admin. |
| Lista de morosos | `GET /admin/billing/failed-payments` sobre `invoices` con `status IN ('open','past_due','uncollectible')` |
| Segmentación | B10.1 (modelo + webhook), B10.2 (endpoint admin), B10.6 (emails), B19 (UI) |

### Operativas (heredadas)
1. Solo pago con tarjeta vía Stripe. `cash_payments` vacía para futuro.
2. Cancelación de suscripciones SOLO admin (`cancel-now` / `cancel-at-period-end`).
3. MFA TOTP para admin (`otplib` + `qrcode`); tabla `user_mfa` ya existe.
4. Asistencia: manual por profesor + QR dinámico en tablet fija.
   - Tablet autentica con `device_token` (no JWT de usuario).
   - Token hasheado en BD (`device_tokens`).
   - Polling/SSE a `/api/tablet/active-sessions`.
   - QR rota cada N segundos, incluye `session_id`.
   - Ventana de check-in configurable (default 30 min antes, 10 min después).
5. Perfiles públicos con flags granulares (`visible_fields jsonb`, ya en `profiles`).
6. Informes con tablas de agregación nocturna (`student_stats_daily`, `academy_stats_daily` ya existen).
7. Upgrade: prorrateo inmediato (`always_invoice` + `pending_if_incomplete`), disciplinas al instante.
8. Downgrade: sin reembolso, al final del periodo (Subscription Schedule 2 fases), disciplinas al transicionar.
9. Consentimientos: seguro/waiver, protección de datos, derechos de imagen. Menores requieren tutor.
10. `student_health_info` en tabla separada (ver arriba).

---

## 6. Esquema de BD (23 tablas de `001_initial_setup`)

Owner de todas las tablas: `migrator`. RLS desactivado (se activa en B3).

### Tablas

| Tabla | Tipo | Notas |
|---|---|---|
| `academy_settings` | configuración | parámetros globales de la academia |
| `academy_stats_daily` | agregación | stats diarias de academia (B16) |
| `activity_feed` | social | feed de actividad (B14) |
| `attendance` | operativa | asistencia a sesiones (B8) |
| `audit_log` | auditoría | trazas de acciones admin |
| `bookings` | operativa | reservas (B7) |
| `cash_payments` | pagos | vacía, reservada para futuro |
| `class_sessions` | operativa | sesiones de clase (B6) |
| `disciplines` | catálogo | disciplinas (B5) |
| `event_registrations` | eventos | inscripciones a eventos |
| `events` | eventos | eventos especiales |
| `invoices` | pagos | facturas (ampliar en B10.1) |
| `pgmigrations` | sistema | control de migraciones (`node-pg-migrate`) |
| `plan_disciplines` | catálogo | relación plan ↔ disciplina (B5) |
| `plans` | catálogo | planes de suscripción (B5) |
| `profiles` | usuarios | **tabla de identidad pública** (ver abajo) |
| `push_subscriptions` | notificaciones | suscripciones push (B15) |
| `student_stats_daily` | agregación | stats diarias por alumno (B16) |
| `subscription_agreements` | consentimientos | waiver/consentimientos (B4.5) |
| `subscriptions` | pagos | suscripciones Stripe (B10) |
| `user_mfa` | auth | secretos TOTP admin (B4) |
| `user_roles` | auth | roles por usuario (ver abajo) |
| `webhook_events` | pagos | idempotencia webhooks Stripe (B10) |

### `profiles` (identidad pública)

```
id             uuid  NOT NULL  (PK)   ← sin default; la app genera
display_name   text
phone          text
avatar_url     text
bio            text
social_links   jsonb
is_public      boolean  DEFAULT false
visible_fields jsonb
created_at     timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
```

Índices: `profiles_pkey` (id), `profiles_is_public_index` parcial `WHERE is_public = true`.
FKs entrantes desde: `activity_feed`, `attendance` (student y recorded_by), `audit_log` (actor), `bookings`, `cash_payments` (admin y student), `class_sessions` (trainer), `event_registrations`, `invoices`, `student_stats_daily`, `subscription_agreements`, `subscriptions`.
**No** contiene `email`, `password_hash`, `google_sub` ni `role`.

### `user_roles`

```
id      bigint   NOT NULL  (PK)   ← sin default; revisar en B2
user_id uuid     NOT NULL
role    app_role NOT NULL
```

Índices: `user_roles_pkey` (id), `user_roles_user_id_index` (user_id).
El `role` es de tipo enum `app_role` (`alumno | profesor | admin`).

### `user_mfa`

```
id                       uuid  NOT NULL  (PK)
user_id                  uuid  NOT NULL  (UNIQUE)
totp_secret_encrypted    text
recovery_codes_encrypted text
mfa_enabled              boolean DEFAULT false
created_at               timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
updated_at               timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
```

Índices: `user_mfa_pkey` (id), `user_mfa_user_id_index` (user_id), `user_mfa_user_id_key` UNIQUE (user_id).

### `subscriptions`

```
id                     uuid  NOT NULL  (PK)
student_id             uuid  NOT NULL  (FK profiles.id ON DELETE CASCADE)
plan_id                bigint NOT NULL (FK plans.id ON DELETE RESTRICT)
status                 sub_status NOT NULL
payment_method         payment_method DEFAULT 'stripe'
current_period_start   timestamptz
current_period_end     timestamptz
cancel_at_period_end   boolean DEFAULT false
cancelled_at           timestamptz
stripe_subscription_id text
created_at             timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
```

Índices: `subscriptions_pkey`, `subscriptions_status_index`, `subscriptions_stripe_subscription_id_index`, `subscriptions_student_id_index`.
Referenciada por: `cash_payments.subscription_id`, `invoices.subscription_id`.

### `invoices` (a ampliar en B10.1)

<!-- PENDIENTE: pegar salida de `\d invoices` para rellenar columnas actuales.
     En B10.1 se añadirán: stripe_invoice_id, status, attempt_count,
     next_payment_attempt, last_payment_error, hosted_invoice_url. -->

---

## 7. Estructura del repo

```
kaizen-app-v2/
├── src/
│   ├── config/
│   │   └── database.js          ← dos pools (appPool, servicePool)
│   ├── middleware/
│   │   └── errorHandler.js      ← notFound + errorHandler
│   ├── routes/                  ← (B2+)
│   ├── services/                ← (B2+)
│   └── index.js                 ← GET /health, cierre limpio
├── migrations/
│   └── 001_initial_setup.js     ← 23 tablas
├── scripts/
│   └── migrate.js               ← placeholder a borrar
├── db-architecture.md
├── docker-compose.yaml
├── contexto-proyecto.md         ← este documento
├── plan-de-bloques.md           ← hoja de ruta
├── README.md
├── .env                         ← no versionado
└── package.json
```

---

## 8. Pendientes inmediatos (antes de escribir B2)

- [ ] Confirmar `"type": "module"` en `package.json`.
- [ ] Confirmar versión de Express (4.x → `asyncHandler(fn)`; 5.x → propaga solo).
- [ ] Borrar `scripts/migrate.js` (placeholder).
- [ ] Revisar `user_roles.id bigint` sin default: ¿se inserta con `nextval` manual o se migra a `GENERATED BY DEFAULT AS IDENTITY` en `002`?
- [ ] Confirmar que existe el enum `app_role` con valores `alumno`, `profesor`, `admin`.
- [ ] Confirmar que existen los enums `sub_status` y `payment_method`.
- [ ] Pegar `\d invoices` para rellenar §6 antes de B10.1.

---

## 9. Riesgos conocidos

- **UUID sin default en `profiles`**: si la app olvida generarlo, `INSERT` falla. Centralizar en un helper `newProfileId()`.
- **`user_roles.id` sin default**: mismo riesgo; usar `nextval` o migrar a IDENTITY.
- **Mezclar pools**: si alguna ruta usa `servicePool` sin necesidad, se salta RLS (B3).
- **`SET LOCAL` fuera de transacción**: no aplica y RLS no filtra. Siempre `BEGIN … COMMIT`.
- **Google OAuth sin verificar `audience`**: aceptar tokens de otras apps. Siempre `audience: GOOGLE_CLIENT_ID`.
- **Vinculación automática por email**: account takeover. No hacerlo.
- **Health info en `profiles`**: filtra datos sensibles en perfiles públicos. Tabla separada.
- **No meter `password_hash`/`google_sub` en `profiles`**: mezcla público con secreto y complica RLS. Van en `auth_credentials`.
- **Webhook Stripe sin idempotencia**: replay duplica facturas. Usar `webhook_events` (B10).
- **Emails de billing sin proveedor decidido**: B10.6 depende de elegir Resend/Postmark/SMTP antes de empezar.