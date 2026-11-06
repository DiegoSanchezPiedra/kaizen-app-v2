# Pantallas de B22 (rediseño)

> **Ver también `docs/auditoria-b22.md`** (B22.0, aprobada el 2026-11-06): la composición de cada pantalla (§ 4) y las
> decisiones (§ 5) concretan lo de aquí.

> Fase técnica de B22, cerrada el 2026-11-06 (`plan-de-bloques.md` § B22). **Móvil primero**: cada pantalla se diseña a
> 375 px y después se amplía con `sm:`/`lg:`. Mismo sistema de diseño de B18; las reglas de UI de `docs/pantallas-b19.md`
> siguen valiendo (solo español, nada de salud ni edad en el panel, errores por `code`, confirmación en lo que cobra o avisa).

## Calendario semanal (componente compartido)

- **Datos**: `/sessions/calendar` (alumno y tutor, con `profile_id`), las sesiones del profesor y las del Horario del admin.
  Sin endpoints nuevos.
- **URL**: `?semana=AAAA-MM-DD` (lunes, por `weekStart`) y `?dia=AAAA-MM-DD`; se conservan `?para=` y la disciplina.
- **Tira**: 7 botones de 44 px como mínimo (inicial del día y número), el elegido relleno, hoy marcado, punto si hay clases,
  pasados atenuados. Flechas a los lados, deslizar en táctil, «Hoy» si no se está en la semana actual.
- **Móvil**: la tira y, debajo, las tarjetas del día. **`lg`**: la tira encima de la rejilla de 7 columnas.
- **Estados**: cargando (esqueleto del día), vacío del día («No hay clases el martes» y «Ver el día siguiente con clases»),
  vacío de la semana, error con reintentar.
- **Movimiento**: el cambio de día y de semana con un desplazamiento corto (emil-design-eng), y nada con
  `prefers-reduced-motion`.
- **Por rol**, la tarjeta igual y cambia la acción: Reservar o Cancelar (alumno y tutor), Asistentes (profesor), Editar
  (admin).

## Membresías (`/admin/memberships`) y Disciplinas (`/admin/disciplines`)

- Lo que hoy son las pestañas de `/admin/catalog`, cada una con su entrada en el menú (Membresías primero). Mismos
  endpoints (`/admin/plans`, `/admin/disciplines`, `PUT /admin/plans/:id/disciplines`).
- Por debajo de `sm`, la tabla pasa a tarjetas. Estados: cargando, vacío con «Crear la primera», error, validación en línea
  en las hojas de crear y editar.

## Clases (`/admin/classes`)

- Mismos datos y hojas (crear, cambiar, retirar). Por debajo de `sm`, tarjetas agrupadas por día de la semana (hora,
  disciplina, profesor, aforo y lugar; vigencia debajo) en vez de la tabla de 9 columnas. La composición exacta, según la
  auditoría de B22.0.

## Usuarios (`/admin/users`)

- **Arriba**: un selector de disciplina y 3 tarjetas (Activos, Impago, Inactivos · 14 días) de
  `GET /admin/profiles/stats?discipline_id=` (**B22.3**). Pulsar una tarjeta pone `?estado=` en la URL; volver a pulsarla
  lo quita. En móvil, las tarjetas en una fila desplazable dentro de su marco.
- **Lista**: búsqueda y filtros de rol, disciplina, plan y estado en la URL (`q`, `role`, `discipline`, `plan`, `estado`,
  `page`), filtrados en el servidor. Columnas: nombre, rol, plan, estado y última asistencia. En móvil, una tarjeta por
  persona.
- **Estados**: cargando, sin resultados (con «Quitar filtros»), error, y las cifras a 0 si no hay alumnos.
