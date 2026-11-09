# Auditoría de RLS — B20 (2026-11-09)

Revisión de todas las tablas, vistas y funciones `SECURITY DEFINER` del esquema `public`, sacadas de la base local con
todas las migraciones aplicadas (hasta la `038`): `pg_class` (`relrowsecurity`, `relforcerowsecurity`), `pg_policies`,
`information_schema.table_privileges` de `app_user` y `PUBLIC`, `pg_default_acl`, la ACL del esquema y de la base, y
`pg_proc` (`prosecdef`, `proconfig`, `proacl`). Contrastado con `CONTEXT.md`.

## Modelo de amenaza

El contexto de la RLS (`app.current_user_id`, `app.current_role`) lo pone cada transacción con `set_config`. La RLS
protege, por tanto, de **consultas con fallos** (un filtro olvidado, un `UPDATE` con columnas de más, un id que no
toca), no de **SQL arbitrario** con `app_user` (una inyección o la URL de `app_user` filtrada): quien lo tenga puede
ponerse `admin`. Por eso lo que solo se aprovecha con SQL arbitrario queda en Media y no en Alta.

## Hallazgos

| Id | Gravedad | Hallazgo | Estado |
| --- | --- | --- | --- |
| A1 | Alta | `profiles`: `UPDATE` de cualquier columna propia (`stripe_customer_id`, `birth_date`…) | Arreglado (`038`) |
| M1 | Media | Funciones `SECURITY DEFINER` sin `pg_temp` al final del `search_path` y `TEMPORARY` para todos | Arreglado (`039`) |
| M2 | Media | Privilegios por defecto: `SELECT, INSERT, UPDATE, DELETE` a `app_user` en toda tabla nueva | Arreglado (`040`) |
| M3 | Media | `cash_payments` sin RLS y con todos los permisos para `app_user` | Arreglado (`041`) |
| M4 | Media | `pgmigrations` sin RLS y con todos los permisos para `app_user` | Arreglado (`042`) |
| M5 | Media | `auth_credentials`: `UPDATE` de cualquier columna propia (`email`, `email_verified`, `google_sub`…) | Arreglado (`043`) |
| M6 | Media | El profesor lee la fila entera de `profiles` de sus alumnos (también `birth_date` de menores) | Arreglado (`044`) |
| B1 | Baja | `has_risk_cover`, `profile_missing` y `discipline_changes_used` responden sobre cualquier perfil | Checklist |
| B2 | Baja | El admin cambia por SQL el contenido del perfil de otro | Arreglado (`045`) |
| B3 | Baja | El admin da o quita el rol `admin` por SQL | Checklist |
| B4 | Baja | `profiles_insert_self` deja insertar cualquier columna al registrarse | Checklist |
| B5 | Baja | El tutor escribe por SQL `bio`, `social_links` y `visible_fields` de su hijo | Arreglado (`045`) |
| B6 | Baja | `medal_views` y `webhook_events` sin RLS | Checklist |
| B7 | Baja | El tutor sigue leyendo reservas, asistencia y progreso del hijo con 18 sin reclamar | Checklist (a confirmar) |
| B8 | Baja | El admin cambia un documento de acuerdo ya publicado | Checklist |
| B9 | Baja | El admin lee `password_hash` y el secreto MFA cifrado de cualquiera | Checklist |
| B10 | Baja | El profesor ve todas las clases | Checklist |

### A1 — `profiles`: cualquier columna propia (Alta, arreglado)

`profiles_update_self_or_admin` (003) dejaba a cualquiera cambiar con `app_user` todas las columnas de su perfil, entre
ellas `stripe_customer_id` (enlaza a cada persona con sus cobros) y `birth_date` (decide si es menor). Escrituras de la
app comprobadas: `PATCH /me` (`display_name`; `birth_date` solo si está vacía), `PATCH /me/profile` (`is_public`,
`visible_fields`, `bio`, `social_links`), `PATCH /me/children/:id` (`display_name`, `birth_date`), la foto (`avatar`) y
despublicar (`is_public`), todas con `app_user`; `stripe_customer_id` lo pone `ensureCustomer` con el `servicePool`.

Arreglo (`038`): `app_user` solo tiene `UPDATE` sobre esas siete columnas (`stripe_customer_id`, `id`, `created_at`,
`phone` y `avatar_url` quedan fuera, también para el admin) y un trigger limita `birth_date`: un adulto pone la suya
solo si está vacía (alta con Google) y de adulto; la de un hijo, su tutor (el `WITH CHECK` la deja menor); el admin la
corrige (no hay ruta, pero `test:minors` la usa para simular que un hijo cumple 18). Tests en `test:rls`.

### M1 — `pg_temp` delante en las funciones `SECURITY DEFINER` (Media)

Las 67 funciones `SECURITY DEFINER` (owner `service_role`) fijan `search_path = public`, pero PostgreSQL busca en el
esquema temporal **antes** que en los del `search_path` si no se pone `pg_temp` al final, y `PUBLIC` tiene `TEMPORARY`
en la base. Comprobado en local (con `ROLLBACK`): `app_user` crea `pg_temp.guardianships` y `pg_temp.profiles`, da
`SELECT` a `service_role` y `is_guardian_of()` le devuelve `true` sobre un perfil inventado. Exige SQL arbitrario, que ya
permite ponerse `admin`, pero además salta reglas que viven dentro de las funciones y que ni el admin se salta (p. ej.
`register_event` leyendo un evento falso a 0 €, `book_session` sin cobertura).

Arreglado en la `039`: `REVOKE TEMPORARY ON DATABASE … FROM PUBLIC` (la base es de `migrator`, también en staging por
`init-roles.sh`; la migración falla si `app_user` lo conserva). Sin tablas temporales no hay `pg_temp` que tape nada,
tampoco en las funciones que vengan; nadie las usaba. `migrator` conserva el suyo. `test:rls` lo cubre.

### M2 — Privilegios por defecto (Media)

`deploy/staging/init-roles.sh` da a `app_user` `SELECT, INSERT, UPDATE, DELETE` en toda tabla nueva de `migrator`. Es la
causa de `events` en la 028, de M3 y M4, y de que muchas tablas tengan permisos más amplios que sus políticas
(inofensivo con `FORCE`, pero confunde al auditar). Arreglo: quitar ese privilegio por defecto y dar los permisos en
cada migración; para lo ya creado, revocar lo que ninguna política usa.

Arreglado en la `040`: quita a `app_user` los privilegios por defecto de tablas y secuencias de `migrator`. Va en una
migración y no en `init-roles.sh` porque las 001–039 los necesitan en una base nueva; desde la 040, cada migración da
sus permisos a `app_user` explícitamente. Lo ya creado no cambia: los permisos que ninguna política usa son inofensivos
con `FORCE`. `test:rls`: una tabla nueva de `migrator` no da nada a `app_user`, ni su secuencia.

### M3 — `cash_payments` (Media)

Creada vacía en la 001 para el pago en efectivo (reservado, sin uso en el código), sin RLS y con todos los permisos para
`app_user`: cualquiera lee y escribe pagos en efectivo. Hoy nada la lee. Arreglo: `ENABLE` y `FORCE` y `REVOKE ALL`
a `app_user` hasta que tenga bloque. Toca dinero: se decide antes de arreglarlo.

Arreglado en la `041`: RLS en `ENABLE` y `FORCE` sin políticas y `REVOKE ALL` a `app_user`: hasta que el efectivo tenga su bloque, solo el `servicePool`. No borra nada. `test:rls`: ni el admin la lee ni la escribe con `app_user`.

### M4 — `pgmigrations` (Media)

Sin RLS y con todos los permisos para `app_user`: con SQL arbitrario se puede marcar como aplicada una migración (p. ej.
una de seguridad, que no llegaría a ejecutarse) o borrar el historial. Arreglo: `REVOKE ALL ON pgmigrations,
pgmigrations_id_seq FROM app_user`.

Arreglado en la `042`: `REVOKE ALL ON pgmigrations, pgmigrations_id_seq FROM app_user`; solo la toca `migrator`, su dueño. Sin RLS (con `FORCE` se aplicaría también a `migrator`). `test:rls`: ni el admin la lee, la borra ni lee su secuencia.

### M5 — `auth_credentials`: cualquier columna propia (Media)

`auth_credentials_update_self_or_admin` deja cambiar por SQL `email`, `email_verified` (se saltaría la verificación del
ADR 0021), `google_sub` y `credentials_changed_at` de la propia fila. La app solo actualiza `password_hash` y
`credentials_changed_at` (cambio de contraseña); el resto lo escriben el registro (`INSERT`) o el `servicePool`.
Arreglo: `UPDATE` por columna, como en A1.

Arreglado en la `043`: `app_user` solo tiene `UPDATE` sobre `password_hash` y `credentials_changed_at` (el cambio de contraseña), también el admin; `email`, `email_verified`, `google_sub`, `profile_id`, `created_at` y `updated_at` (lo pone su trigger) quedan fuera. Queda que alguien mueva atrás su propio `credentials_changed_at`: solo revive tokens suyos ya emitidos. `test:rls`.

### M6 — El profesor lee la fila entera de sus alumnos (Media)

`profiles_select` deja al profesor leer **toda** la fila de los alumnos de sus sesiones y eventos (`teaches_student`):
`birth_date` (también de menores), `stripe_customer_id`, `bio`, `social_links`. `CONTEXT.md` le da solo el nombre (y la
foto). Ninguna ruta lo devuelve hoy. Arreglo: que lea por una vista o función que proyecte nombre y foto, como
`public_profiles`. Cambia lo que ve un rol y toca menores: se decide antes de arreglarlo.

Arreglado en la `044`: `profiles_select` pierde la rama del profesor (solo ve su fila) y la vista `student_names` (`id`, `display_name`, `avatar`; `security_barrier`, owner `service_role`, como `trainer_names`) le da nombre y foto de los alumnos de sus sesiones y eventos (`teaches_student`); la lee también el admin. Las dos consultas del profesor que leían alumnos, `getAttendance` y `getTrainerEvent`, leen la vista. `test:profiles` (y `test:attendance`, `test:events`).

### Bajas

- **B1**: `has_risk_cover(p_id)` y `profile_missing(p_id)` responden sobre cualquier perfil (si tiene cobertura de
  riesgo, ficha de salud, contacto de emergencia y acuerdos firmados) y `discipline_changes_used(p_subscription)` sobre
  cualquier suscripción. Hace falta el UUID. Las usan el propio perfil, el tutor, el profesor de la sesión o del evento
  (`risk_cover`) y otras funciones: el arreglo tiene que mantener a esos.
- **B2**: con `profiles_update_self_or_admin` el admin cambia por SQL `display_name`, `bio`, `social_links`,
  `visible_fields` o `is_public = true` de otro; `CONTEXT.md`: «no edita su contenido» (despublica y quita la foto).
  Arreglado en la `045`: el trigger `profiles_update_guard` (sustituye al de la 038, con la misma regla de `birth_date`) no deja al admin cambiar en un perfil ajeno `display_name`, `bio`, `social_links` ni `visible_fields`, publicarlo ni ponerle una foto: solo despublica, quita la foto y corrige la fecha. `test:rls`.
- **B3**: `user_roles_insert_self_alumno_or_admin` y `user_roles_update_admin` dejan al admin poner o quitar `admin`;
  la API lo impide (`admin_role_locked`) y la base no.
- **B4**: `profiles_insert_self` deja a la transacción de registro insertar cualquier columna (`stripe_customer_id`,
  `is_public`, una `birth_date` de menor). Solo vale para un id nuevo y solo la usa `createUser`, con columnas fijas.
- **B5**: `profiles_update_guardian` deja al tutor escribir `bio`, `social_links` y `visible_fields` de su hijo. No se ven
  nunca (un hijo no puede ser público).
  Arreglado en la `045`: el mismo trigger deja al tutor cambiar de su hijo solo `display_name`, `birth_date` y la foto; `bio`, `social_links` y `visible_fields` no. `test:rls`.
- **B6**: `medal_views` y `webhook_events` sin RLS. Hoy sin permisos para `app_user`; con M2, una regresión las abriría.
- **B7**: `is_guardian_of(…, true)` deja al tutor de un hijo con 18 sin reclamar leer sus reservas, asistencia,
  inscripciones, acuerdos y progreso; `CONTEXT.md`: «su tutor solo lo ve en la lista y paga lo que ya pagaba». Los
  recibos sí son a propósito («también los históricos»). Cambia lo que ve un rol: a confirmar.
- **B8**: `agreement_documents_update_admin` deja cambiar `version`, `checksum` o `storage_path` de un documento ya
  publicado, no solo retirarlo. Las firmas apuntan a tipo y versión.
- **B9**: el admin lee `password_hash` de `auth_credentials` y el secreto MFA (cifrado) de `user_mfa` de cualquiera; la
  API solo necesita el email.
- **B10**: `classes_select` deja a cualquier autenticado, también al profesor, ver todas las clases; en el calendario el
  profesor solo ve sus sesiones. Es el horario semanal.

## Tablas

`E+F`: RLS en `ENABLE` y `FORCE`. Permisos de `app_user`: `S` select, `I` insert, `U` update, `D` delete.

| Tabla | RLS | `app_user` | Lee | Escribe con `app_user` | Hallazgos |
| --- | --- | --- | --- | --- | --- |
| `academy_settings` | E+F | SIUD | autenticados | admin | — |
| `academy_stats_daily` | E+F | S | admin | — (nightly) | — |
| `agreement_documents` | E+F | SIU | publicados: cualquiera; borradores: admin | admin | B8 |
| `attendance` | E+F | S | alumno, tutor, admin, profesor de la sesión | funciones | B7 |
| `audit_log` | E+F | S | admin | `write_audit()` y funciones | — (027) |
| `auth_credentials` | E+F | SIUD | propia, admin | registro, propia, admin | M5, B9 |
| `bookings` | E+F | S | alumno, tutor, admin, profesor de la sesión | funciones | B7 |
| `cash_payments` | — | SIUD | todos | todos | M3 |
| `class_sessions` | E+F | SI | autenticados; profesor, las suyas | admin y funciones | — |
| `classes` | E+F | SIUD | autenticados | admin | B10 |
| `device_tokens` | E+F | — | — | funciones | — |
| `disciplines` | E+F | SIU | activas; inactivas: admin, suscritos, su profesor | admin | — |
| `event_registrations` | E+F | S | inscrito, tutor, admin, profesor del evento | funciones | B7 |
| `events` | E+F | SIU | autenticados | admin | — (028) |
| `guardianships` | E+F | SIUD | tutor, hijo, admin | admin, `create_child` | — |
| `insurances` | E+F | S | alumno, tutor, pagador, admin | `servicePool` | — |
| `invoices` | E+F | S | alumno, tutor, pagador, admin | `servicePool` | — |
| `medal_themes` | E+F | S | autenticados | — | — |
| `medal_views` | — | — | funciones | `mark_medals_seen` | B6 |
| `notice_deliveries` | E+F | S | admin | `servicePool` | — |
| `password_resets` | E+F | — | — | funciones | — |
| `payer_changes` | E+F | S | pagador viejo y nuevo, admin | `servicePool` | — |
| `pgmigrations` | — | SIUD | todos | todos | M4 |
| `plan_disciplines` | E+F | SIUD | autenticados | admin | — |
| `plans` | E+F | SIU | activos; retirados: admin y su suscriptor | admin | — |
| `profiles` | E+F | SID, U por columna | propio, tutor, admin, profesor de sus alumnos | propio, tutor (hijo menor), admin | A1, M6, B2, B4, B5 |
| `push_subscriptions` | E+F | SD | propias | `save_push_subscription`, borrar propias | — |
| `student_health_info` | E+F | SIUD | propia, tutor (menor), admin; profesor por función | propia, tutor (menor), admin | — (B4.5) |
| `subscription_disciplines` | E+F | S | quien ve la suscripción | `servicePool` | — |
| `subscriptions` | E+F | S | alumno, tutor, pagador, admin | `servicePool` | — |
| `user_agreements` | E+F | SI | sujeto, firmante, tutor, admin | firma de adulto o de su tutor | — (B4.5) |
| `user_mfa` | E+F | SIUD | propio, admin | propio, admin | B9 |
| `user_roles` | E+F | SIUD | propio, admin | registro (`alumno`), admin | B3 |
| `webhook_events` | — | — | — | `servicePool` | B6 |

Vistas: `public_profiles` y `trainer_names`, owner `service_role`, `security_barrier`, solo con sesión iniciada; la
primera proyecta solo lo público (`can_be_public` y los campos visibles). Sin hallazgos.

Esquema y base: `app_user` solo tiene `USAGE` en `public` (no crea objetos); `PUBLIC` tenía `TEMPORARY` en la base (M1,
quitado en la `039`).
Las secuencias dan `SELECT, USAGE` a `app_user` (también la de `pgmigrations`, M4).

## Funciones `SECURITY DEFINER`

67, todas con owner `service_role`, `search_path = public` (sin `pg_temp` al final: M1, cerrado quitando `TEMPORARY`) y
sin `EXECUTE` para `PUBLIC`.
21 solo las ejecuta `service_role` (las llaman otras funciones). Las 46 que ejecuta `app_user`:

- **Solo admin** (`app.current_role = 'admin'`): `adjust_session`, `agreement_notice`, `cancel_event`, `cancel_session`,
  `change_class`, `event_notice`, `reset_session`, `restore_session`, `retire_class`, `revoke_open_discipline`.
- **Admin o profesor de la sesión o del evento**: `close_attendance`, `correct_attendance`, `mark_attendance` (por
  `attendance_session`), `mark_event_attendance`; `professor_session_health` y `professor_event_health` (solo el
  profesor y solo ese día, con auditoría).
- **Propio, tutor o admin** (`booking_can_act`, `is_guardian_of`): `book_session`, `cancel_booking`, `check_in`,
  `register_event`, `cancel_event_registration`, `session_coverage`, `student_progress`, `mark_medals_seen`;
  `attach_event_checkout` (el actor de la inscripción); `create_child` (adulto); `save_push_subscription` (con sesión);
  `write_audit` (027).
- **Con sesión y solo lo público**: `can_be_public`, `public_achievements`, `public_disciplines`, `monthly_ranking`,
  `medal_ranking`; `teaches_student` e `is_guardian_of` solo responden sobre quien llama.
- **Sin actor, a propósito**: `create_password_reset`, `consume_password_reset`, `link_tablet` y `tablet_feed` (las
  protege un secreto: el token o el código), `session_taken`, `event_taken`, `checkin_qr_seconds`,
  `discipline_change_limit` (datos no personales).
- **Sin actor y con datos de otros**: `has_risk_cover`, `profile_missing`, `discipline_changes_used` (B1).
