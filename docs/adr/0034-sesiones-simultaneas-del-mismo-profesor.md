# Sesiones simultáneas del mismo profesor

Decisión del 2026-11-19 (migración 074). Relaja la regla «Solape» de CONTEXT, que venía de la migración 008.

Hay días en que un profesor da dos clases a la vez en el mismo sitio (p. ej. boxeo y muay thai en el mismo tatami).
Hasta ahora la restricción `class_sessions_trainer_no_overlap` lo impedía siempre.

- **Regla**: dos sesiones programadas del mismo profesor pueden solaparse solo si tienen **el mismo inicio, la misma duración y el
  mismo lugar**. El lugar se compara sin mayúsculas y sin espacios en los extremos, y dos sesiones sin lugar cuentan como el mismo.
  El solape parcial, otra duración u otro lugar (también uno vacío y otro no) siguen dando `409 trainer_overlap`.
- **Dónde vive**: en la misma restricción de exclusión, con una tercera columna `session_slot_key(starts_at, ends_at, location)
  WITH <>`. Así vale igual para crear y cambiar clases, sesiones sueltas, ajustes y recuperar una sesión. Mover o cambiar el lugar
  de solo una de las dos se rechaza.
- **Lo que no cambia**: cada clase tiene su aforo; un alumno no puede reservar las dos (`booking_overlap`); no se controla el lugar
  entre profesores distintos; no hay configuración por disciplina ni confirmación en la interfaz: se crean como dos clases.
- **Cambiar la pareja** (migración 075): cambiar la hora, la duración o el lugar de una sola rompe la pareja y choca, así que
  `PATCH /admin/classes/:id` y `PATCH /admin/sessions/:id` aceptan `with_twins: true`, que lleva esos tres campos a las
  simultáneas (las clases no retiradas en `from`; las sesiones de ese día que no han empezado). El profesor y el aforo nunca se
  arrastran. Todo va en una transacción con la restricción aplazada (`DEFERRABLE INITIALLY IMMEDIATE` y `SET CONSTRAINTS …
  DEFERRED`), que se comprueba al final, con todas ya movidas. En la interfaz es la casilla «Cambiar también …», marcada por
  defecto. Se descartó moverlas siempre, porque entonces no se podrían separar.

Se descartó un formulario de «varias disciplinas a la vez» porque crear dos clases separadas ya funciona.
También se descartó comprobar el solape en JS, porque la base de datos ya lo hacía sin carreras.
