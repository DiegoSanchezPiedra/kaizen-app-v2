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
- Rediseño 7, 2026-11-18: el admin entra a **revisar y retocar**. Como Usuarios, una fila por elemento hasta `xl` (toda la
  fila abre la hoja) y la tabla solo desde `xl`. En las filas, solo el estado que se sale (Retirada, Desactivada) y las marcas
  Recomendada y Abierta, con icono; en la tabla, Estado siempre. Las **elegibles por nombre** («Elige 1 entre Judo y
  Grappling», «Todas las activas»). `plan_has_subscriptions` en el campo que no se puede cambiar; las confirmaciones de
  precio y de retirar dicen que la app no avisa a los suscriptores.
- **Documentos** (rediseño 7): por tipo, la vigente y los borradores a la vista y los retirados plegados («N versiones
  anteriores»). Sin vigente, solo el aviso rojo. Al subir, los errores en su campo y no antes de elegir el PDF.

## Clases (`/admin/classes`)

- Mismos datos y hojas (crear, cambiar, retirar). Hasta `xl`, tarjetas agrupadas por día de la semana (hora,
  disciplina, profesor, aforo y lugar; vigencia debajo); la tabla (8 columnas, con «Vigencia» y las acciones en «⋯») solo
  desde `xl`: con la barra lateral no cabe antes (rediseño 7, 2026-11-18).

## Horario del admin (`/admin/sessions`, el detalle de sesión y el de evento) — rediseño 7, 2026-11-18

- El admin entra a mirar hoy y abrir una sesión. Un solo **«Nuevo»** con menú (Clase semanal · Clase suelta · Evento, con
  una línea cada una) y un selector **Semana | Clases semanales** (`?vista=clases`, conserva la disciplina).
- Semana en 7 columnas solo desde `xl` (prop `cols="xl"` de `WeekBoard` y `SessionRow`). En las filas, insignia solo para lo
  que se sale (En curso, Celebrada, Cancelada; con icono) y la ocupación con `Seats` («20/20 · Llena»).
- **Detalle de sesión** según el momento: cabecera (cuándo, profesor, lugar, ocupación, espera); antes de empezar, las
  reservas y la espera; desde el inicio, la lista de asistencia (sin repetir las reservas); los datos y Ajustar/Cancelar,
  debajo. Una sesión o un evento que no existe: «Esta sesión no existe» / «Este evento no existe», sin reintentar.
- **Detalle de evento**: cabecera y cifras (inscritos/aforo, cobrado, pendiente, reembolsos con los fallidos en rojo; un
  evento gratis, inscritos e invitados), luego inscritos (estado con icono en la línea gris), asistencia y los datos.

## Usuarios (`/admin/users`)

- **Arriba, la búsqueda** (el admin entra a buscar por nombre o email). Debajo, **chips de estado** (Todos · Activos n ·
  Impago n · Inactivos · 14 d n · Sin plan) con las cifras de `GET /admin/profiles/stats?discipline_id=` (**B22.3**): pulsar
  uno pone `?estado=` y volver a pulsarlo lo quita (rediseño 7, 2026-11-18: sustituyen a las 3 tarjetas, que repetían
  cifras del Inicio). En móvil, en una fila desplazable dentro de su marco. Si falla `/stats`, chips sin cifra.
- **Filtros**: rol, disciplina y plan (`q`, `role`, `discipline`, `plan`, `estado`, `page` en la URL, filtrados en el
  servidor); debajo, «N personas» y «Quitar filtros» si hay alguno. Al cambiar un filtro se queda la lista anterior atenuada.
- **Lista**: columnas nombre, rol (con las marcas), plan, estado (con icono) y última asistencia. La tabla solo desde
  `xl` (con la barra lateral no cabe antes); por debajo, una fila por persona que abre la ficha. «Nuevo profesor» va junto al título.
- **Estados**: cargando, sin resultados (con «Quitar filtros»), error, y las cifras a 0 si no hay alumnos.

## Cobros (`/admin/billing`) — rediseño 7, 2026-11-18

- El admin entra a **ver cuánto se debe y quién**; enviar el recibo y la baja son secundarias. Siguen las **tres
  pestañas** (`?tab=delinquents|grace|payer-changes`).
- **Morosos y En gracia**: arriba, «N pagadores deben» / «N pagadores en gracia» (el `total` de la API; el importe de
  todas las páginas no lo da). Un bloque por pagador con **su total** (suma de sus recibos abiertos) y «N recibos» a la
  derecha del nombre, o «Sin recibos abiertos». Debajo, cada cuota (alumno → ficha, estado con icono, plan y fin de periodo
  o «Stripe sigue reintentando…») con **sus recibos debajo** (importe, intentos, siguiente, «Último error: …» y «Abrir el
  recibo», que avisa de que abre otra pestaña). La baja inmediata solo en Morosos, en pequeño, y su confirmación nombra al
  alumno, el plan y a quién se avisa.
- **Cambios de pagador**: **En curso** primero; En curso | Caducados con los chips de Usuarios (`?view=expired`). Estado
  con icono (Pendiente de pago, Pagado, Caducado). Hasta `xl`, una fila por cambio; la tabla solo desde `xl`.
- Al cambiar de página se queda la lista anterior atenuada.
