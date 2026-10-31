# Pantallas de B18 — para Claude Design

> Fase 1 (técnica) de B18, cerrada el 2026-11-01. Es la entrada de la fase visual (`docs/modelos-por-bloque.md`
> § «Frontend con Claude Design»): qué pantallas hay, qué datos usa cada una y en qué estados puede estar. Los términos
> son los de `CONTEXT.md`; los endpoints, los de `docs/api.md` (los marcados **B18.0** se añaden antes de implementar).
> Si una pantalla diseñada pide un dato que no está aquí, se para y se decide en la fase técnica.

## Para Claude Design

- **Componentes**: coss ui (`coss.com/ui`, sobre Base UI, Tailwind CSS v4). Diseñar con sus componentes; su
  documentación para asistentes está en `coss.com/ui/llms.txt`. El sistema de diseño se traduce a sus tokens de CSS.
- **Referencias**: el logo y la web de la academia, y los ejemplos de coss ui.
- **Movimiento y acabado**: la skill `emil-design-eng` (`npx skills add https://github.com/emilkowalski/skills --skill emil-design-eng`), en Claude Design y después al implementar. Animaciones del día a día cortas y sobrias; las más expresivas, solo en los momentos de «nivel de poder» (subir la racha, conseguir un badge). Siempre con `prefers-reduced-motion`.
- **Estilo**: base, el logo y la web de la academia. Inspiración Dragon Ball: energía, colores intensos, tipografía con
  fuerza, la racha y los badges como «nivel de poder». **Nunca** personajes, logos ni tipografías de la franquicia.
- **Primero el sistema de diseño** (único para B18 y B19) y las pantallas de login (las necesita B18.1); después,
  las de cada sub-bloque (B18.2 alumno y tutor, B18.3 cuota, B18.4 profesor, B18.5 tablet, B18.6 avisos e instalación).

## Reglas de UI

- **Solo español.** Importes en euros con «impuestos incluidos» (la API da céntimos). Fechas y horas siempre de
  Madrid, aunque el móvil esté en otra zona.
- **Nunca salud, edad ni fecha de nacimiento**, salvo en: la ficha de salud que rellena el alumno o su tutor; las fichas
  del día del profesor; la fecha de nacimiento en «Mis datos» y al dar de alta o editar un hijo. La edad nunca se
  calcula ni se enseña. Un hijo nunca aparece en Comunidad.
- **Errores**: la UI pone su texto por `code` (mapa abajo); el `message` de la API nunca se enseña.
- **Móvil primero**: botones de 44 px como mínimo, contraste AA, foco visible. En escritorio, la barra inferior pasa a
  barra lateral. La lista del profesor, con interruptores grandes (se pasa lista en el tatami). La tablet, en horizontal
  y a pantalla completa.
- **Push**: el texto lo pone el backend (nombre del alumno y lo imprescindible de la sesión o del acuerdo). Solo se
  diseña el icono de la notificación.
- **El admin** no tiene pantallas en B18 (son de B19): tras el login ve una pantalla de espera.

## Estados comunes

Toda pantalla con datos tiene:

| Estado | Cuándo | Qué muestra |
|---|---|---|
| Cargando | la primera petición | esqueletos con la forma del contenido |
| Vacío | lista sin filas | qué significa y la acción siguiente («aún no tienes reservas → ver calendario») |
| Error | fallo de red o `500` | «algo ha fallado» y reintentar |
| Sin conexión | el navegador está offline | «sin conexión» y reintentar; nada se guarda para después |
| Sin permiso | `403 forbidden` | «no tienes acceso a esto» y volver al inicio |
| Sesión caducada | `401` | va a `/login` con «tu sesión ha caducado»; al entrar vuelve donde estaba |
| Versión nueva | hay una versión nueva de la app | aviso no intrusivo «hay una versión nueva, actualizar» |

**Estados de bloqueo** (siempre con el porqué y el siguiente paso):

| Estado | Fuente | Qué muestra |
|---|---|---|
| Perfil incompleto | `GET /me/profile-status` → `missing` | lo que falta en lista (nombre, ficha de salud, contacto de emergencia, cada acuerdo) y «Completar perfil» |
| Acuerdo pendiente | `missing` con `data_protection` o `rights_of_image` | «tienes que firmar …» y firmar (`/agreements`). La API no distingue una primera firma de una re-firma: el mismo texto vale para las dos |
| Sin suscripción | `GET /billing/subscription` → `404 subscription_not_found` | «contrata una cuota para reservar» y contratar |
| No cubierta | `covered: false` en la sesión | «tu cuota no incluye esta disciplina» |
| Sin cobertura de riesgo | `risk_cover: false`, `403 no_risk_cover` | «necesitas el seguro o firmar la exención» y las dos salidas |
| Fuera de la ventana | `409 outside_booking_window` o sesión más allá de la ventana | se ve, pero «aún no se puede reservar» |
| Cobro en gracia / impagado | `status` `past_due` / `unpaid` | «hay un cobro pendiente» y «Gestionar pagos» (Portal). Si el Portal responde `404 no_billing_account`, «lo gestiona quien paga la cuota» (la API no dice quién es el pagador) |

## Selector de sujeto

Fijo arriba en las pantallas que actúan por un sujeto (calendario, reservas, progreso, ficha de salud, acuerdos, cuota,
estado del perfil). Un tutor (rol) elige entre sus hijos; un alumno con hijos, entre él y sus hijos; un alumno sin
hijos no lo ve. Los hijos con `pending_claim` no salen. Al abrir: el propio alumno o, para un tutor, su primer hijo.
Cambiarlo recarga la pantalla para ese sujeto. El check-in no lo usa (elige entre las candidatas).

---

## Sin sesión

| Pantalla | Endpoints | Estados y errores |
|---|---|---|
| **Login** `/login` | `POST /auth/login`, `POST /auth/google` (botón de Google Identity Services) | `invalid_credentials`, `invalid_google_token`, `link_required` («ya hay una cuenta con ese email: entra con tu contraseña»). Enlaces a registro y a recuperar contraseña |
| **Código MFA** (paso 2 del login, solo admin) | `POST /auth/mfa/verify` | código TOTP o de recuperación; `invalid_mfa_code`; `invalid_mfa_token` → vuelve al paso 1 («el código ha caducado, vuelve a entrar») |
| **Registro** `/register` | `POST /auth/register` | email, contraseña, nombre, fecha de nacimiento. `email_taken`, `weak_password`, `invalid_birth_date`, `minor_cannot_register` («un menor lo da de alta su padre, madre o tutor») |
| **Recuperar contraseña** `/forgot-password` | `POST /auth/password/forgot` (**B18.0**) | email; siempre «si existe una cuenta, te hemos enviado un enlace» |
| **Nueva contraseña** `/reset-password?token=` | `POST /auth/password/reset` (**B18.0**) | `invalid_reset_token` (caducado o usado: pedir otro), `weak_password`; al acabar, a `/login` |
| **Espera del admin** | — | «el panel de la academia llega pronto» y cerrar sesión |

## Completar perfil `/onboarding` (alumno y tutor)

Se entra cuando `missing` no está vacío; se puede salir y volver. Los pasos salen de `missing`:

1. **Mis datos**: nombre y, si vino de Google sin ella, fecha de nacimiento (`PATCH /me`, **B18.0**;
   `minor_cannot_register` si es menor).
2. **Ficha de salud** (solo alumno): lesiones, condiciones, experiencia y disciplina previas, medicación, alergias y
   contacto de emergencia (`GET /me/health`, **B18.0**, y `POST /me/health`). El contacto de emergencia es obligatorio.
3. **Acuerdos**: `data_protection` y, el alumno, `rights_of_image`. Ver el PDF (`GET /agreements/:type/current`, su
   versión en `X-Agreement-Version`) y firmar (`POST /me/agreements`). `404 no_current_document` → «la academia aún no
   ha publicado este documento».

El tutor (rol) solo tiene nombre y `data_protection`, y al acabar «Añade a tus hijos» (`POST /me/children`). Para un
hijo, los pasos 2 y 3 los hace el tutor desde Cuenta con el selector de sujeto.

## Alumno y tutor — barra inferior con 5 pestañas

### 1. Inicio `/`

- **Próximas reservas** (`GET /bookings` desde hoy) del sujeto.
- **Avisos de estado**, con su enlace: perfil incompleto, acuerdo pendiente, sin suscripción, cobro en gracia o
  impagado, sin cobertura de riesgo (fuentes en la tabla de bloqueo).
- **Tarjeta de avisos push** (solo si el navegador tiene push y el permiso no está decidido; ver B18.6).
- **Racha** actual (`GET /me/progress`), con el estilo de «nivel de poder».
- Vacío: sin reservas → «ver calendario».

### 2. Calendario `/calendar`

`GET /sessions/calendar?from&to&discipline_id&profile_id` (el `profile_id` del tutor y del alumno con hijos es
**B18.0**). Vista por semanas, filtro por disciplina. Cada sesión: hora, disciplina, profesor, lugar, y su estado para
el sujeto:

| Estado de la sesión | Fuente | Acción |
|---|---|---|
| Disponible | `covered`, sin `booking`, futura dentro de la ventana | reservar (`POST /bookings`) |
| Reservada | `booking.status = confirmed` | cancelar (`POST /bookings/:id/cancel`) |
| En espera | `booking.status = waitlisted` | salir de la espera (cancelar) |
| No cubierta | `covered: false` | ninguna; «tu cuota no la incluye» |
| Fuera de la ventana | futura, más allá de la ventana | ninguna; «aún no se puede reservar» |
| Cancelada | `status = cancelled` | ninguna |
| Celebrada | `held` | ninguna |

No se muestran las plazas libres (la API no las da). Al reservar, si vuelve `waitlisted`: «la sesión está llena, estás
en la lista de espera». Errores: `not_covered`, `no_risk_cover`, `profile_incomplete`, `session_not_bookable`,
`outside_booking_window`, `already_booked`, `booking_overlap` («ya tienes otra reserva a esa hora»), `session_started`,
`booking_conflict_retry` (se reintenta solo una vez y, si no, «inténtalo de nuevo»).

### 3. Reservas `/bookings` (la URL de los avisos)

`GET /bookings?profile_id&from&to`: próximas y pasadas (por tramos de ≤ 92 días). Cada una con su estado y, si está
cancelada, el motivo (cancelada por ti, tardía, por la academia, sesión cancelada, sin cobertura, cambio de disciplina).
Cancelar con confirmación: «si falta poco para empezar, puede contar como cancelación tardía» (la API no da el plazo).
`booking_not_active`, `session_started`.

**Check-in** `/checkin`, botón en Reservas: abre la cámara y lee el QR de la tablet (`POST /checkin { code }`).
`checked_in` → confirmación con la sesión; `choose` → lista de candidatas (nombre del alumno, disciplina y hora) para
elegir y repetir con `booking_id`. Errores: `invalid_qr` («el código ha caducado, vuelve a escanear»), `no_candidates`
(«no tienes ninguna reserva con el check-in abierto»), `attendance_closed` («la lista ya está cerrada; habla con el
profesor»). Sin permiso de cámara: cómo darlo.

### 4. Progreso `/progress`

`GET /me/progress?profile_id&month`: racha actual y mejor, badges con su fecha, horas del mes por disciplina (con
selector de mes). Vacío: «tu primera sesión empieza la racha».

**Comunidad** (dentro de Progreso): directorio `/profiles` (`GET /profiles?q&role&discipline_id`, paginado, búsqueda
por nombre y filtros), ficha `/profiles/:id` (solo los campos visibles; `profile_not_found` → «este perfil no existe o
no es público») y rankings `/rankings/:id` (`GET /rankings/:disciplineId?month`, por disciplina, sin las abiertas).
Lo ve cualquier rol con sesión.

### 5. Cuenta `/account`

- **Mis datos**: nombre y email (`GET /me` / `PATCH /me`, **B18.0**); fecha de nacimiento solo si falta.
- **Perfil público** (solo si `eligible`; nunca para un tutor ni un hijo): publicar, campos visibles, bio (≤ 500),
  redes (`https`) (`GET`/`PATCH /me/profile`). `not_eligible`.
- **Mis hijos**: lista (`GET /me/children`), alta y edición de nombre y fecha de nacimiento (`POST`/`PATCH`).
  `child_must_be_minor`, `invalid_birth_date`, `child_not_found`. Un hijo con `pending_claim`, en solo lectura: «ya es
  mayor de edad; para seguir, contacta con la academia».
- **Ficha de salud** del sujeto (`GET /me/health` **B18.0**, `POST /me/health`). `not_guardian`.
- **Acuerdos** `/agreements` (URL del aviso de re-firma): `data_protection` y `rights_of_image` del sujeto, firmado o
  pendiente según `missing`; ver el PDF y firmar. El `waiver` aparece como «exención de responsabilidad» solo si el
  sujeto no tiene cobertura de riesgo (`risk_cover: false`), con firmarla o contratar el seguro. Un tutor (rol) solo
  ve su `data_protection`. `agreement_already_signed`, `invalid_version` (se publicó otra mientras tanto: recargar),
  `not_allowed_to_sign`.
- **Cuota** `/billing` (abajo).
- **Avisos**: estado del push y activarlo (B18.6).
- **Cerrar sesión**.

### Cuota `/billing` (dentro de Cuenta)

| Pantalla | Endpoints | Estados y errores |
|---|---|---|
| **Mi cuota** `/billing` | `GET /billing/subscription`, `GET /billing/insurance`, `POST /billing/portal` | sin suscripción → contratar; estado (activa, en gracia, impagada), plan, disciplinas, fin de periodo, baja programada, bajada programada, cambios de disciplina que quedan, cambio de pagador pendiente. Seguro: estado y renovación. «Gestionar pagos» (tarjeta, recibos) → Portal; `portal_not_configured`, `no_billing_account` |
| **Contratar** | `GET /plans`, `GET /disciplines`, `POST /billing/checkout` | plan → disciplinas (tantas como permite, entre las elegibles) → cobertura: **seguro** o **firmar la exención** (salvo que ya tenga cobertura de riesgo) → Stripe Checkout. `subscription_exists`, `risk_cover_required`, `plan_not_purchasable`, `plan_minors_only`, `discipline_not_eligible`, `profile_incomplete` |
| **Volviendo del pago** `/billing/success?session_id=` | `GET /billing/subscription` con reintentos | «confirmando el pago…» hasta que aparece la suscripción; si tarda, «puede tardar unos minutos» |
| **Pago cancelado** `/billing/cancel` | — | «no se ha cobrado nada» y volver a intentarlo |
| **Cambiar de plan** | `POST /billing/subscriptions/:id/plan`, `DELETE …/plan/scheduled` | subida: inmediata con cobro proporcional (`requires_action` → 3DS con Stripe.js; `payment_failed`); bajada: «se aplica el …» y anularla. `same_plan`, `upgrade_pending`, `period_ending_soon`, `not_payer` |
| **Cambiar de disciplina** | `POST /billing/subscriptions/:id/disciplines` | cuántos cambios quedan; «es inmediato y cancela tus reservas de la disciplina que dejas»; gratis si la que se deja ya no se cubre. `discipline_change_limit` |
| **Contratar el seguro** | `POST /billing/insurance` | precio por tramo; 3DS si hace falta. `insurance_disabled`, `insurance_exists` |
| **Cambio de pagador** `/billing/payer-changes/:id[?session_id=]` | `GET /billing/payer-changes/:id`, `POST …/checkout` | para el nuevo pagador: alumno, plan, precio, desde cuándo y fecha límite; pagar (0 € hoy). `not_new_payer`, `payer_change_expired`, `payer_change_paid`, `profile_incomplete` |

## Profesor — barra inferior con 4 pestañas

| Pantalla | Endpoints | Estados y errores |
|---|---|---|
| **Sesiones** `/professor` (entrada) | `GET /professor/sessions?from&to` | sus sesiones (sustituciones incluidas), hoy y los próximos días; ir hacia atrás para las pasadas. Vacío: «no tienes sesiones estos días» |
| **Detalle de sesión** `/professor/sessions/:id` | `GET /professor/sessions/:id`, `GET /sessions/:id/attendance` | datos y **lista**: nombre, presente, «llegó por check-in», «sin cobertura de riesgo» (sin más detalle). Antes del inicio, solo lectura (`session_not_started`). Cancelada: «sesión cancelada», sin lista |
| **Pasar lista** (en el detalle) | `PUT /sessions/:id/attendance/:studentId`, `POST …/close` | desde el inicio: interruptores grandes; cerrar con confirmación («quien no esté marcado pasa a falta»). `attendance_closed`, `no_active_booking` |
| **Corregir** (en el detalle, lista cerrada) | `POST …/:studentId/correct` | presente ↔ falta con motivo obligatorio (≤ 500). `correction_window_expired` («pídelo a la academia»), `no_change`, `attendance_not_closed` |
| **Fichas de salud** (en el detalle, solo una sesión de hoy no cancelada) | `GET /professor/sessions/:id/health` | botón «Ver fichas de salud» con «esta consulta queda registrada»; solo se piden al tocarlo y no se guardan: lesiones, condiciones, alergias, medicación y contacto de emergencia por alumno. Vacío: «nadie ha indicado nada» |
| **Informes** `/professor/reports` | `GET /professor/reports/sessions?by&from&to&discipline_id` | por disciplina o por clase, por mes (≤ 12): sesiones, ocupación, presentes, faltas, sin registrar, tardías. Sin dinero ni alumnos. `trainer.name: null` → «otro profesor». `invalid_range` |
| **Comunidad** | como el alumno | — |
| **Cuenta** | `GET`/`PATCH /me`, `GET`/`PATCH /me/profile` | mis datos, perfil público, cerrar sesión. Sin avisos push (el profesor no recibe) |

## Tablet `/tablet` (sin login de usuario, pantalla completa, horizontal)

| Estado | Qué muestra |
|---|---|
| Sin vincular | campo para el código del admin (`POST /tablet/link`); `invalid_link_code` |
| Funcionando | el QR en grande (cambia cada pocos segundos) y las sesiones con la ventana de check-in abierta (nombre y hora), **sin nombres de alumnos**. Sin sesiones abiertas: el QR igual y «no hay sesiones con el check-in abierto» |
| Sin conexión | **el QR se oculta** (un código viejo no vale) y «reconectando…» |
| Revocada | vuelve a «sin vincular» con «esta tablet se ha desvinculado; pide un código nuevo» |

## Avisos e instalación (B18.6)

- **Tarjeta de avisos** (Inicio y Cuenta, alumno y tutor): «Activa los avisos para enterarte si cancelan o cambian tu
  sesión» y un botón. En iOS sin instalar: cómo añadir la app a la pantalla de inicio. Permiso denegado: «te
  avisaremos por email». Sin push en el servidor: no sale.
- **Icono** de la app y de la notificación, y la pantalla de bienvenida del manifest (nombre, colores).

## Mapa de errores por `code`

Texto de la UI para los `code` que no tienen ya el suyo arriba:

| `code` | Texto |
|---|---|
| `invalid_payload`, `invalid_field`, `invalid_field_type`, `no_fields` | «revisa los datos» (con el `field` resaltado si viene) |
| `invalid_id`, `not_found`, `session_not_found`, `booking_not_found` | «no lo encontramos» |
| `not_allowed`, `not_guardian`, `forbidden` | «no tienes acceso a esto» |
| `push_disabled` | (no se muestra nada) |
| `invalid_range`, `invalid_pagination` | «revisa las fechas» |
| `internal_error` y cualquier `code` desconocido | «algo ha fallado; inténtalo de nuevo» |
