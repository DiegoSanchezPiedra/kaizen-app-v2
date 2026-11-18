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

## Avisos (`/admin/notices`) y Auditoría (`/admin/audit`) — rediseño 7, 2026-11-18

- **Avisos** sigue con dos pestañas (`?tab=academy|deliveries`; `deliveries` es lo que enlaza el Inicio). «Entregas
  fallidas» lleva la cifra de los últimos 30 días, la misma consulta que «Requiere atención» del Inicio. Es un registro:
  sin «leído», orden cronológico.
- **Lo grave** (riesgo de Stripe, reembolso rechazado, jornada abierta pasado `OPEN_HOURS`; `noticeUrgent` en `lib/admin.ts`):
  icono de alerta y etiqueta «Revisar» con texto, sin sacarlo del orden. El resto, campana atenuada.
- **Entregas fallidas**: el texto fijo de b19 se queda. Hasta `xl`, una fila por entrega (destinatario → ficha, canal con
  icono y texto, aviso · fecha, «N intentos · error» entero); la tabla solo desde `xl`, con el error partido en líneas.
- **Auditoría**: el admin viene a buscar quién hizo un cambio. Categoría y Desde/Hasta a la vista (en móvil, fechas en dos
  columnas con la etiqueta encima). La persona se elige con el embudo de cada fila (44 px); los filtros de persona y de
  recurso salen como chips «Solo lo de <nombre> ×» y «Solo esta ficha ×» (nunca el id). Vacío con filtros: «Quitar los
  filtros». Hasta `xl`, una fila por línea (qué y fecha; quién · sobre qué; el detalle entero debajo); tabla desde `xl`.
- Fechas de los registros con año (`formatLogDate`: «18 nov 2026 · 10:30»). El detalle del precio en euros españoles y el
  documento publicado con su nombre («Protección de datos v2.0»). «Vio las fichas de salud» enseña la acción, nunca el dato.
- **«Ver su auditoría»** (b19) en la cabecera de la ficha y de la sesión (`AuditLink` en `shell.tsx`; a 375 solo el icono):
  abre el registro filtrado por ese recurso. El chip de persona toma el nombre de su ficha, también sin filas.
- `?tab=failed` (nombre antiguo) sigue abriendo las entregas fallidas.
- Al cambiar de página o de filtro se queda la lista anterior atenuada, como en Cobros.
- **Comunicados** (`?tab=communiques`, ADR 0030): «Nuevo comunicado» abre una hoja con Título, Texto, Para (radio) y, si son
  socios, sus disciplinas; Canales con la nota LSSI junto al email. «Enviar» confirma con la vista previa de la ventana y
  «Se enviará a N personas (M por email)». Historial: para, fecha, canales, «Visto por X de Y», «Compartir en WhatsApp» y
  «Retirar». La ventana del usuario (`CommuniqueDialog`) va en `AppShell`, abajo en móvil, y no sale en `/checkin`.

## Tablets (`/admin/tablets`) y Ajustes (`/admin/settings`) — rediseño 7, 2026-11-18

- **Tablets**: el admin entra a ver si alguna dejó de conectarse y, a veces, a dar de alta una. Hasta `xl`, una fila por
  tablet (nombre, estado y una línea: cuándo se vio o cuándo caduca, caducó o se revocó); la tabla solo desde `xl`, sin
  scroll y con el nombre partido en líneas. Fechas con año (`formatLogDate`).
- Cinco estados con icono y texto (`tabletStatus` en `lib/catalog.ts`): Esperando vinculación, **Código caducado**,
  Vinculada, **Sin conexión** (vinculada y sin verse más de 24 h; la tablet pide el QR cada pocos segundos, así que noches y
  domingos caben) y Revocada. Las «Sin conexión» salen también en «Requiere atención» del Inicio («Tablets sin
  conexión», enlaza aquí; sin email ni push).
- Sin portapapeles (sin permiso o sin HTTPS), «Copiar» deja el código seleccionado y lo dice en el diálogo.
- Cierre de Dialog y Sheet, tema y menú del panel: con ratón, zona de 44 px con un `::after` invisible (`pointer-fine`;
  con dedo ya la daba Button). 0 % de diferencia visual.
- **Revocar** (borde rojo, 44 px) siempre con confirmación. La revocada no lo tiene.
- **Código**: grande en Geist Mono, «Copiar» y «Caduca a las 18:40 (en 30 min); solo se ve ahora». Si caduca con el
  diálogo abierto, lo dice y desactiva «Copiar». El código sigue sin pasar por React Query ni el almacenamiento.
- **Ajustes**: cuatro grupos (también Rankings), un «Guardar» por grupo (un PUT cada uno). El grupo con cambios lo marca con
  «Cambios sin guardar» (punto y texto) y «Descartar»; con un valor inválido, «Guardar» desactivado y «Corrige el campo en
  rojo para guardar». Los `invalid_field` de la API van en su campo con el texto del rango.
- **Confirman antes del PUT**: el check-in (cambia al momento las listas y el QR de las tablets), el primer precio de la
  pausa («podrás cambiar el precio, pero no quitarlo»), un precio nuevo (las pausas pedidas siguen con el suyo) y las
  pausas por año a 0. Vaciar un precio ya puesto se explica en el campo y no se guarda.
- **Salir con cambios**: «¿Salir sin guardar?» al navegar dentro de la app (`useBlocker`), con los grupos que se pierden;
  al recargar o cerrar, el aviso del navegador.

## Informes (`/admin/reports`) — rediseño 7, 2026-11-18

- El admin viene a ver **cómo va la academia** y a comparar: abre en **Suscripciones**. Sin CSV: basta «Ver tabla».
- **URL**: `?tab`, `?rango=30d|92d|12m|24m` (Suscripciones) y `?periodo`, `?desde`, `?hasta`, `?disciplina` (Sesiones y
  Alumnos, compartidos). Cambiar de pestaña los conserva; cambiar un filtro quita `?page`. Un valor desconocido vale el de
  por defecto (una disciplina que ya no existe, «todas»). El profesor sigue con los filtros en memoria
  (`useReportFilters({ url })` y `SessionsReport urlFilters`, opcionales).
- **Suscripciones**: línea de periodo con año; dos tarjetas de 3 cifras, «Última foto · 17 nov 2026» (activas, en gracia,
  impagadas; «· N de M días» si el mes va incompleto, y «Sin dato de ayer» con icono) y «En el periodo» (altas, bajas,
  entrenaron). **Sin foto** = columna con contorno punteado (3:1 medido) y «Sin dato» en el tooltip y la tabla, nunca una
  barra de 0; **mes incompleto** = punto bajo la etiqueta y «N de M días». La leyenda solo lleva las marcas que aparecen.
  Eje: por meses, el año en enero (« ’26»); 92 días, el mes en su día 1; 30 días, «17 nov» cada 7 sin los extremos.
  Tooltip y tabla de días llevan año si el rango abarca dos. «Ver tabla»: una fila por día o mes hasta `xl` (cifras 3×2),
  la tabla desde `xl`. `invalid_range`: «Revisa las fechas: como mucho 92 días o 24 meses.», sin «Reintentar».
- **Gráficas** (`MonthBars`, también del profesor): el puntero (ratón o dedo en horizontal) elige la columna por su `x`;
  con más de 40 columnas, `gap-px` y el hueco sin dato es una sola línea de puntos (dos bordes en 2 px parecían una barra). Props opcionales `gap` y `mark`; /professor/reports queda igual (0 % de diferencia).
- **Alumnos**: por nombre (orden del servidor; ordenar por columna pediría cambiar la API). Línea de periodo como Sesiones.
  Hasta `xl`, una fila por alumno que abre la ficha (cifras en negrita con su palabra: «12 reservas · 1 falta…», nombre
  largo partido); tabla desde `xl`. Paginar atenúa la lista anterior; vacío con «Quitar la disciplina» si la hay.
- `Pager` del panel: «Anterior» y «Siguiente» a 44 px (Usuarios, Cobros, Avisos y Auditoría también).

## Cuenta (`/admin/account`) y Configurar el MFA (`/admin/mfa`) — rediseño 7, 2026-11-18

- El admin viene a **la seguridad**: orden Doble factor · Contraseña · Tus datos · Cerrar sesión. La tarjeta «Doble factor»
  lleva el estado con icono y texto («Activo» o «Sin activar») y, sin MFA, **Activar el doble factor**; sustituye aquí al
  aviso de `MfaNotice`, que sigue en el Inicio. Con el MFA activo, **Generar códigos nuevos** (ADR 0031): diálogo con la
  contraseña (`wrong_password` en el campo; solo Google sin login reciente, «Vuelve a entrar»), los 10 códigos con copiar y
  descargar, y «Hecho» solo tras «Los he guardado» (sin cerrar con fuera ni sin la casilla). Desactivar el MFA no se ofrece.
  Auditoría tiene la categoría **Acceso** (`auth.*`) con sus textos.
- Si cae `/me`, un solo error con «Reintentar» en lugar de Contraseña y Tus datos; «Cerrar sesión» sigue.
- Cambiar la contraseña se queda en Cuenta con el formulario vacío (`PasswordSection onDone`; /account sigue igual).
  Solo Google: «Contraseña» se queda y explica cómo crearla.
- **MFA**: indicador de 3 pasos (Escanear · Códigos · Activar; `aria-current="step"`, hecho con check) y «Ahora no» en la
  cabecera. Al cambiar de paso, el foco va al título. En los pasos 2 y 3, salir pide «¿Salir sin activar?» (y el navegador
  avisa al recargar o cerrar): los códigos solo se ven ahí y el secreto cambia en cada visita.
- El secreto y los códigos no pasan por React Query ni por el almacenamiento (estado de la página). Solo Google pide el
  secreto al abrir, una vez (StrictMode incluido).
- `invalid_totp`: el texto de b19 en el campo, casillas vacías y foco en la primera. `mfa_already_enabled`: «El doble factor
  ya está activo» y vuelta a donde estaba. Al activar, vuelta a donde estaba con el toast; desde Cuenta se ve «Activo».
- «Copiar» sin portapapeles deja los códigos seleccionados y lo dice. Botones del flujo y de Cuenta a 44 px también con ratón;
  el ojo de la contraseña, zona de 44 px con ratón (`pointer-fine:after`, 0 % de diferencia en /account). En Cuenta, también
  los campos de los formularios compartidos a 44 px (solo aquí; /account y el Inicio, 0 %).

## Jornada (`/admin/clock`, `/admin/clock/print`) — rediseño 7, 2026-11-18

- El admin viene a **revisar correcciones**; cerrar e imprimir el mes es secundario.
- **Lista**: «N profesores empleados» y, en cada fila (enlace de 64 px con chevron), su estado con icono y texto:
  «N correcciones pendientes» (aviso), «Jornada abierta desde el 17 nov a las 8:00» (aviso, pasado `OPEN_HOURS`, como «Lo grave» del
  Inicio), «En jornada desde las 16:30» o «Al día» (atenuados). Arriba los que tienen pendientes o una jornada que pasa el umbral;
  luego, por nombre. `GET /admin/clock/employees` trae `pending`, `open_since` y `open_late` (cambio aditivo; el umbral
  lo pone la API con `OPEN_HOURS`, el mismo que `notice.clock_open`; el texto del aviso no nombra las horas). Coste medido: ~9 ms por profesor con 4 años de fichajes.
- **Mes**: el nombre (`h2`, con Empleado/Autónomo) va encima de MonthNav. «Por revisar · N» es lo primero del lateral (en
  móvil, lo primero de la página); las aplicadas y rechazadas van en «Correcciones del mes», después de las acciones. Aplicar
  con confirmación (avisa por email); Rechazar, con motivo obligatorio.
- **Salida olvidada** (jornada abierta de un día anterior, en cualquier mes): el resumen dice «Falta la salida del martes 17 ·
  Entró a las 08:00» con «Añadir la salida», que abre la hoja con el día y la salida puestos. En el día queda solo el
  aviso «Falta la salida» (el botón, una vez).
- **Movimiento**: la corrección recién aplicada o rechazada entra en «Correcciones del mes» con `enter-soft` (200 ms,
  `--ease-out`; con reduced-motion, solo opacidad). Al cargar no se mueve nada.
- **Acciones**: «Añadir fichaje» a lo ancho y debajo Imprimir y «Descargar CSV» en dos columnas (`onCsv` de ClockLog; el
  profesor no lo ve). Autónomo: nota, Imprimir y CSV, sin corregir.
- **Hoja de imprimir**: la vuelta dice «Jornada de <nombre>». Lo demás, como en el grupo 5. /clock y /clock/print del
  profesor, 0 % de diferencia.
