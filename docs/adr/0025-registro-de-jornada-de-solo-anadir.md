# Registro de jornada de solo añadir

Decisión del 2026-11-10, en el diseño de B31 (migración 059). Marco legal en `docs/research/legal-fichaje-menores.md` §1.

El registro de jornada de los profesores empleados (art. 34.9 ET) tiene que ser fiable ante la Inspección: nadie, ni el
admin, cambia ni borra un fichaje. Por eso las tres tablas (`clock_events`, `clock_corrections` y
`clock_correction_resolutions`) son **de solo añadir** en la base, no solo en la API:

- `app_user` no tiene `UPDATE` ni `DELETE` sobre ellas, y un trigger (`clock_append_only`) rechaza cualquier `UPDATE`,
  `DELETE` o `TRUNCATE` de cualquier rol (también `migrator`), salvo el `DELETE` de `service_role` de filas de más de
  4 años (`at`, `created_at` o `resolved_at`): la purga de la tarea nocturna. El trigger no es `SECURITY DEFINER`
  porque decide por `current_user` (quien borra); su dueño es `service_role` y `PUBLIC` no lo ejecuta.
- **La purga borra jornadas enteras**: solo cuando todas sus filas (fichajes, correcciones y resoluciones) tienen más
  de 4 años; una jornada con la entrada vieja y la salida dentro del plazo, o con una corrección reciente, se queda
  entera. Nunca deja una salida huérfana. Deja en `audit_log` una fila `clock.purge` por profesor con cuántos registros
  borró, con el propio profesor como `actor_id` (la columna es obligatoria y no hay actor «sistema») y
  `changes.by = 'nightly'`.
- **La hora es la del servidor.** `app_user` solo puede insertar `profile_id`, `kind` y `origin` de un fichaje (permiso
  por columna): `at` es siempre `DEFAULT now()`.
- **Una corrección es un registro nuevo** que apunta a un fichaje (con otra hora o anulándolo) o añade el que falta, con
  motivo, autor y fecha. El fichaje al que apunta puede ser original o uno añadido por una corrección aplicada (también
  se corrige o se anula). El original sigue intacto y visible. Solo tiene correcciones el profesor empleado.
- **El estado de una solicitud no se actualiza**: aplicar o rechazar es insertar su única fila en
  `clock_correction_resolutions` (PK = la corrección; una segunda resolución choca y es `409 already_resolved`). Sin
  fila, pendiente. Así el ciclo pendiente → aplicada / rechazada tampoco necesita `UPDATE`.
- Lo que cuenta (totales, estado actual, secuencia) sale de la vista `clock_effective`: cada fichaje con la hora de su
  última corrección aplicada por orden de **resolución** (cuándo se aplicó, no cuándo se pidió), sin los anulados, más
  los añadidos. Una corrección que dejaría la secuencia fuera de orden
  no se aplica.
- RLS en las tres (`ENABLE` y `FORCE`): el profesor lee lo suyo y el admin todo. Solo el profesor **empleado** inserta
  fichajes, y solo los suyos; el autónomo no ficha (`teacher_employment`, sin fila = autónomo).

## Considered Options

- **Columna `status` en la corrección con `UPDATE` controlado** (trigger que solo deja pasar `pending → applied|rejected`):
  igual de cerrado en la práctica, pero abre el `UPDATE` en una tabla que debe ser inalterable y obliga a revisar el
  trigger en cada cambio. Una fila de resolución aparte no deja nada que actualizar.
- **Editar el fichaje y guardar el anterior en `audit_log`**: más simple de leer, pero el registro dejaría de ser de
  solo añadir y la versión original dependería de otra tabla.
- **Hora del cliente** (para fichar sin conexión): descartada; la norma pide un registro fiable y el móvil se puede
  adelantar o atrasar.

## Consequences

- Los días y los meses se cortan en la medianoche de Madrid: una jornada que la cruza se reparte entre los dos días (y
  los dos meses). Los instantes son `timestamptz`, así que los cambios de hora no descuadran los totales.
- La purga y los avisos de jornada abierta (16 h sin salida) los hace la tarea nocturna con `service_role`, una vez al
  día: el aviso puede llegar hasta un día después de las 16 h.
- `migrator`, dueño de las tablas, puede desactivar el trigger (`ALTER TABLE … DISABLE TRIGGER`): la base no protege de
  su dueño. Queda fuera del alcance de la BD y es un control operativo (quién tiene las credenciales de `migrator` y
  revisar las migraciones).
- Fuera de alcance: acceso remoto de la Inspección, nóminas, horas extra y fichaje de admins.
