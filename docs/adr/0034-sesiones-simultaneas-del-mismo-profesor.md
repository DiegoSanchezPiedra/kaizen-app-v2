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

Se descartó un formulario de «varias disciplinas a la vez» porque crear dos clases separadas ya funciona.
También se descartó comprobar el solape en JS, porque la base de datos ya lo hacía sin carreras.
