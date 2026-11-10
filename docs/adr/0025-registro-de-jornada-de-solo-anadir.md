# Registro de jornada de solo añadir

Decisión del 2026-11-10, en el diseño de B31 (migración 059). Marco legal en `docs/research/legal-fichaje-menores.md` §1.

El registro de jornada de los profesores empleados (art. 34.9 ET) tiene que ser fiable ante la Inspección: nadie, ni el
admin, cambia ni borra un fichaje. Por eso las tres tablas (`clock_events`, `clock_corrections` y
`clock_correction_resolutions`) son **de solo añadir** en la base, no solo en la API:

- `app_user` no tiene `UPDATE` ni `DELETE` sobre ellas, y un trigger (`clock_append_only`) rechaza cualquier `UPDATE`,
  `DELETE` o `TRUNCATE` de cualquier rol (también `migrator`), salvo el `DELETE` de `service_role`: la purga de la
  tarea nocturna, que borra lo de más de 4 años y deja en `audit_log` cuántos registros borró (`clock.purge`).
- **La hora es la del servidor.** `app_user` solo puede insertar `profile_id`, `kind` y `origin` de un fichaje (permiso
  por columna): `at` es siempre `DEFAULT now()`.
- **Una corrección es un registro nuevo** que apunta al fichaje (con otra hora o anulándolo) o añade el que falta, con
  motivo, autor y fecha. El original sigue intacto y visible.
- **El estado de una solicitud no se actualiza**: aplicar o rechazar es insertar su única fila en
  `clock_correction_resolutions` (PK = la corrección; una segunda resolución choca y es `409 already_resolved`). Sin
  fila, pendiente. Así el ciclo pendiente → aplicada / rechazada tampoco necesita `UPDATE`.
- Lo que cuenta (totales, estado actual, secuencia) sale de la vista `clock_effective`: cada fichaje con la hora de su
  última corrección aplicada, sin los anulados, más los añadidos. Una corrección que dejaría la secuencia fuera de orden
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

- La jornada se cuenta en el día de Madrid de la entrada, aunque acabe pasada la medianoche; los instantes son
  `timestamptz`, así que los cambios de hora no descuadran los totales.
- Una corrección solo apunta a un fichaje original: un fichaje añadido por corrección no se puede corregir otra vez
  (si hiciera falta, se añadiría ese caso).
- La purga y los avisos de jornada abierta (16 h sin salida) los hace la tarea nocturna con `service_role`, una vez al
  día: el aviso puede llegar hasta un día después de las 16 h.
- Fuera de alcance: acceso remoto de la Inspección, nóminas, horas extra y fichaje de admins.
