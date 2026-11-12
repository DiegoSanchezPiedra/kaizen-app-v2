# Acceso propio del menor: lo da el tutor, con límites en la ruta y en la base

Decisión del 2026-11-11, en el diseño de B32 (migración 061). Sustituye al ADR 0002. Marco legal en
`docs/research/legal-fichaje-menores.md` §2.

El ADR 0002 dejaba al hijo sin acceso propio. Ahora **cualquier tutor vinculado** puede darle acceso, a cualquier edad, y
quitárselo cuando quiera; los demás tutores reciben un aviso. Activarlo es el consentimiento del tutor (art. 7 LOPDGDD,
art. 8 RGPD: el tutor ya está identificado por su relación con la academia) y queda registrado: quién, cuándo, IP y
versión del texto informativo.

- **Credenciales en `auth_credentials`**: `username` (lo elige el tutor; único; en minúsculas, de 3 a 30 letras, números,
  `.`, `_` o `-`, así que nunca tiene forma de email) y contraseña. `email` pasa a ser opcional: por debajo de 14 años el
  menor no tiene; desde los 14, el tutor le puede poner uno. Sin Google. La contraseña la pone y la restablece el tutor
  (el email de restablecer no sirve para un menor); el menor la puede cambiar con su sesión, como cualquiera.
- **Login** por email o por usuario en el mismo campo (`email` con `@` busca el email; sin `@`, el usuario), con el límite
  por IP y el mismo límite por cuenta. La sesión dura 7 días.
- **Revocar** borra las credenciales y los dispositivos de push del menor. `requireAuth` rechaza (`401 session_revoked`)
  el token de un hijo (perfil con tutores) sin credenciales: la sesión abierta cae al momento, también si después cumple
  18. Restablecer la contraseña pone `credentials_changed_at` (ADR 0020); activar también, así un token de un acceso
  anterior no vuelve a valer.
- **El rol sigue siendo alumno** (ADR 0001). `requireAuth`, que ya lee la base en cada petición, añade `req.user.minor`
  (`{ can_book, can_publish }` o `null`): con su acceso, el menor es actor y sujeto de lo suyo, y el tutor sigue
  pudiendo actuar por él. El menor no actúa por nadie más: el `profile_id` de un hermano da el error de siempre de cada
  ruta (`403 not_guardian`) o, en lo bloqueado, `403 minor_restricted`.
- **Bloqueado siempre** (`403 minor_restricted`) en la ruta **y** en la base: pagos (contratar, cambiar plan o
  disciplina, portal, cambio de pagador, eventos de pago), pausas, ver la cuota, firmar acuerdos, la ficha de salud (leer
  y escribir), su nombre visible, su fecha de nacimiento, su email, crear o editar hijos y el acceso de otros. En la base:
  la RLS de salud, recibos, suscripción y firmas excluye al menor como actor; `profiles_update_guard` le impide cambiar
  su nombre; `register_event` rechaza un importe mayor que 0 y `change_discipline` un actor menor; `ensureCustomer` no
  crea cliente de pago para un menor; y la firma ya exigía un adulto (RLS de `user_agreements`).
- **Permiso de reservar** (`auth_credentials.can_book`, por defecto sí): sin él, el menor no reserva, no cancela y no se
  inscribe ni se da de baja en eventos (tampoco en `booking_can_act`); su tutor sí, por él. Lo cambia cualquier tutor.
- **Perfil público, rankings y foto pública** de un menor: desactivados por defecto. Por debajo de 14 los decide solo su
  tutor; desde los 14, también el menor. Vale para cualquier menor, con acceso o sin él (`can_be_public` admite al menor;
  el tutor cambia `is_public` y `visible_fields`, no la bio ni las redes). Cambia la regla de B24 de que la foto de un
  menor nunca es pública. A validar con el abogado (LO 1/1996 art. 4.3).
- **Avisos al menor**: solo los operativos de reservas, sesiones y eventos (`notice_recipients`), por push o, si tiene,
  email, y siguen llegando a sus tutores. Los de cobertura perdida, pausa y cambio de disciplina, los de cobro, impago,
  firmas y salud, solo a los tutores o al pagador. Cuando el menor cambia su foto, sus tutores reciben un aviso.
- **Al cumplir 18 con acceso** reclama su perfil sin invitación: los poderes del tutor caen solos (como antes) y el perfil
  queda incompleto hasta que añade su email (`PATCH /me`, una vez), firma los acuerdos y confirma la ficha de salud que
  rellenó su tutor (guardándola). Conserva su historial.
- **LOPIVI**: no hay canal privado profesor↔menor; la app sigue sin mensajería.

## Considered Options

- **Tabla propia del acceso** (`minor_access` con el permiso, quién y cuándo): duplicaba «tiene acceso» con la fila de
  credenciales. El acceso es la fila; el consentimiento y cada cambio, el aviso en `audit_log` (que solo se añade).
- **Un rol «menor»**: rompía el rol único (ADR 0001) y todas las reglas que miran «alumno».
- **Usuario y email en el mismo campo de la base**: obligaba a validar la forma en cada lectura; con dos columnas, la
  regla «sin `@`» basta para que nunca se confundan.
- **Revocar desactivando en vez de borrar**: dejaba un usuario ocupado y una fila que `requireAuth` tendría que
  distinguir; sin credenciales, un hijo no tiene sesión.

## Consequences

- Dos lecturas más en la consulta de `requireAuth` (vínculo y edad), en la misma consulta del rol.
- `email` nulo es posible: lo que envía emails ya salta a quien no tiene (los avisos quedan `skipped`).
- Un menor con email no puede restablecer la contraseña por email aunque lo tenga: se lo pide a su tutor.
- La versión del texto informativo vive en el backend (`MINOR_ACCESS_NOTICE_VERSION`) y el frontend la manda al activar.

## Revisión de la RLS con el menor como actor

Todas las políticas que distinguen sujeto y actor o usan `is_guardian_of`. El menor no es tutor de nadie
(`create_child` exige un adulto), así que `is_guardian_of` nunca le da nada.

| Tabla | Antes | Con su acceso (061) |
| --- | --- | --- |
| `profiles` | Lee la suya; la de sus hijos | Solo la suya (ni hermanos ni tutores). Edita su foto, su bio y sus redes; su nombre, no; su visibilidad, desde los 14 |
| `auth_credentials` | La suya | La suya. El tutor lee la del hijo (sin la contraseña) |
| `guardianships` | Las suyas (`minor_id`) | Igual: ve qué tutores tiene (ids), no sus datos. `requireAuth` lo usa |
| `student_health_info` | La suya | Ninguna (ni leer ni escribir) |
| `user_agreements` | Las suyas | Ninguna (firma y lee su tutor) |
| `subscriptions`, `subscription_disciplines`, `pauses` | La suya | Ninguna (la cobertura la calculan funciones `SECURITY DEFINER`) |
| `invoices`, `payer_changes` | Las suyas | Ninguna (nunca es pagador) |
| `bookings`, `attendance`, `event_registrations` | Las suyas | Las suyas |
| `push_subscriptions`, `user_mfa`, `user_roles`, `medal_views` | Las suyas | Las suyas |
| `clock_*`, `teacher_employment`, `audit_log`, `notice_deliveries`, `device_tokens` | Profesor o admin | Nada |
| Catálogo, sesiones, eventos, perfiles públicos | Cualquiera con sesión | Igual |

Funciones `SECURITY DEFINER` con actor: `booking_can_act` (y con ella `book_session`, `cancel_booking`,
`register_event`, `cancel_event_registration`) exige el permiso de reservar al menor; `register_event` y
`change_discipline` rechazan al menor como pagador; `check_in`, `student_progress` y `mark_medals_seen` le dejan lo
suyo; `visible_profile_missing` le dice qué le falta a su perfil (sin el contenido de la ficha ni de las firmas).
