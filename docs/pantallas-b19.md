# Pantallas de B19 (panel admin), para Claude Design

> Fase 1 (técnica) de B19, cerrada el 2026-11-01. Es la entrada de la fase visual (`docs/modelos-por-bloque.md`
> § «Frontend con Claude Design»): qué pantallas tiene el panel, qué datos usa cada una y en qué estados puede estar.
> Los términos son los de `CONTEXT.md`; los endpoints, los de `docs/api.md`. Los marcados **B19.0** o **B19.1** se
> añaden antes de implementar (`plan-de-bloques.md` § B19). Si una pantalla diseñada pide un dato que no está aquí, se
> para y se decide en la fase técnica.

## Para Claude Design

- **El mismo sistema de diseño de B18** (canvas «Kaizen · Sistema de diseño»): tokens, coss ui, tipografías, claro y
  oscuro. El panel es la cara sobria de la app: sin «nivel de poder», sin animaciones expresivas; el naranja `--power`
  no se usa (aquí no hay rachas ni badges).
- **Móvil primero** (decidido el 2026-11-02; antes era «escritorio primero»): cada pantalla tiene que funcionar perfecto a 360, 390 y 430 px y seguir bien a 768, 1024 y 1280. Sin scroll horizontal de la página (solo dentro de un marco, como las pestañas largas); por debajo de 640 px las tablas pasan a tarjetas (cada fila, una tarjeta con el nombre de cada columna) y la barra lateral a un menú en hoja (Sheet) por debajo de 1024 px. Objetivos táctiles de 44 px (los botones ya los dan en pantallas táctiles) y los campos a 16 px para que iOS no haga zoom. Densidad media en escritorio: filas de tabla de 40 px.
- **Componentes de coss ui** que ya están en el repo: Sidebar, Table, Pagination, Tabs, Sheet, Dialog, AlertDialog,
  Combobox, Select, Badge, Card, Meter, Empty, Skeleton, Toast, Field y Form. Sin componentes nuevos de terceros ni
  librería de gráficos: los gráficos son los de HTML y CSS de los informes del profesor (B18.4), con «Ver tabla».
- **Movimiento**: la skill `emil-design-eng`, en su registro más sobrio. Siempre con `prefers-reduced-motion`.

## Reglas de UI

- **Solo español.** Importes en euros (la API da céntimos). Fechas y horas siempre de Madrid.
- **Nunca salud, edad ni fecha de nacimiento** en el panel: ni en la ficha de un alumno, ni en la auditoría, ni en los
  informes. De un menor solo se ve la marca «Menor» y, si cumplió 18 sin reclamar su perfil, «Mayor de edad sin
  reclamar». La salud la rellenan el alumno o su tutor y la ve el profesor el día de la sesión, nunca el panel.
- **Errores** por `code` (mapa de B18 y el de abajo); el `message` de la API nunca se enseña.
- **Toda acción que cobra, da de baja, avisa a alumnos o bloquea a alguien pide confirmación** con un AlertDialog que
  dice qué va a pasar y a quién se avisa (lo que dice cada endpoint en `docs/api.md`). Nunca un botón que actúa al
  primer clic sobre dinero o reservas.
- **Tablas**: cabecera fija, paginación de 25 (`limit`/`offset` de la API, con el total), la búsqueda y los filtros en
  la URL (`?q=&role=&page=`) para poder volver atrás y compartir el enlace.
- **Sin selector de sujeto**: el admin actúa sobre un perfil desde su ficha (`/admin/users/:id`).
- **Sin push**: el admin no recibe avisos; los consulta en «Avisos».

## Estados comunes

Los de `docs/pantallas-b18.md` (cargando, vacío, error, sin conexión, sin permiso, sesión caducada, versión nueva), más:

| Estado | Cuándo | Qué muestra |
|---|---|---|
| Sin MFA | `mfa_enabled: false` en `GET /auth/me` | aviso fijo arriba en Inicio y Cuenta: «Activa el doble factor: protege los datos de la academia» y **Activar** → Configurar el MFA. No bloquea nada; desaparece al activarlo |
| Acceso cambiado | el rol de `GET /me` ya no es el del token (al abrir o tras un `403 insufficient_role`) | cierra la sesión y va a `/login` con «tu acceso ha cambiado; vuelve a entrar». Vale para todos los roles, no solo el admin |
| Sesión del admin caducada | el token del admin dura 12 h | como en B18: a `/login` con «tu sesión ha caducado» y vuelta a donde estaba |

## Estructura

**Barra lateral** (en este orden; el número entre paréntesis es un contador del servidor, solo donde lo hay):

1. **Inicio** `/admin`
2. **Usuarios** `/admin/users`
3. **Cobros** `/admin/billing` (morosos)
4. **Avisos** `/admin/notices`
5. **Horario** `/admin/sessions` · **Clases** `/admin/classes`
6. **Catálogo** `/admin/catalog`
7. **Informes** `/admin/reports`
8. **Documentos legales** `/admin/documents`
9. **Auditoría** `/admin/audit`
10. **Tablets** `/admin/tablets` · **Ajustes** `/admin/settings`
11. Abajo: **Cuenta** `/admin/account` (nombre, doble factor, cerrar sesión)

---

## Acceso

| Pantalla | Endpoints | Estados y errores |
|---|---|---|
| **Login** | los de B18 (`POST /auth/login`, `/auth/google`, `/auth/mfa/verify`) | sin cambios. Un admin con MFA pasa por el código; sin MFA, entra directo al panel |
| **Configurar el MFA** `/admin/mfa` | `POST /auth/mfa/setup`, `POST /auth/mfa/activate` | 3 pasos en una página dentro del panel, con «Ahora no» que vuelve atrás: (1) «Protege la cuenta de administración con un segundo factor» y escanear el QR (`otpauth_uri` pintado con `qrcode` en SVG) con la clave para teclearla a mano (el `secret` de esa URI, en grupos de 4); (2) los 10 códigos de recuperación, que solo se ven aquí: copiar, descargar `.txt` y la casilla «los he guardado» para seguir; (3) el código de 6 cifras → activar → «Doble factor activado» y vuelta a donde estaba (la sesión sigue; desde el próximo login pedirá el código). `invalid_totp` («el código no es correcto; revisa la hora del móvil»), `mfa_already_enabled` (va al panel). Volver a cargar la página repite el paso 1 con un secreto nuevo (el anterior deja de valer) |
| **Cuenta** `/admin/account` | `GET`/`PATCH /me` | nombre y email, doble factor («Activo» o el aviso con **Activar**), cerrar sesión. Sin perfil público ni push. Perder el móvil y los códigos se resuelve fuera de la app (texto: «habla con quien administra el servidor») |

## Inicio `/admin`

Un vistazo y lo que pide atención. Todo enlaza a su pantalla. Sin MFA, el aviso de «Activa el doble factor» va arriba del todo.

- **Cifras** (cuatro tarjetas): suscripciones activas, en periodo de gracia, impagadas y MRR del último día con foto
  (`GET /admin/reports/subscriptions?group=day`, la última fila no nula, con una línea de los 30 días). Día sin foto:
  «sin dato de ayer» y la fecha de la última.
- **Requiere atención** (lista con contadores, cada uno con `limit=1` para leer el `total`):
  - morosos (`GET /admin/billing/delinquents`) y en gracia (`GET /admin/billing/grace`);
  - cambios de pagador caducados en los últimos 30 días (`GET /admin/payer-changes?status=expired&from=`, **B19.1**);
  - entregas fallidas en los últimos 30 días (`GET /admin/notice-deliveries?from=`, **B19.1**);
  - los 3 últimos avisos de la academia (`GET /admin/notices?limit=3`, **B19.1**).
  - Todo a cero: «Nada pendiente».
- **Hoy**: las sesiones de hoy (`GET /sessions/calendar?from=hoy&to=hoy`) con hora, disciplina, profesor y estado
  (programada, en curso, celebrada, cancelada); al tocar, su detalle.

## Usuarios

| Pantalla | Endpoints | Estados y errores |
|---|---|---|
| **Lista** `/admin/users?q&role&page` | `GET /admin/profiles?q&role&limit&offset` (**B19.0**) | búsqueda por nombre o email, filtro por rol (alumno, tutor, profesor, admin). Columnas: nombre, email (un hijo no tiene), rol, marcas «Menor» / «Mayor de edad sin reclamar», estado de la cuota (activa, en gracia, impagada, sin cuota), alta. Vacío con búsqueda: «nadie coincide con …» |
| **Ficha** `/admin/users/:id` | `GET /admin/profiles/:id` (**B19.0**) | cabecera con nombre, rol, marcas y email. Pestañas abajo. `profile_not_found` → «este perfil no existe» |

**Pestañas de la ficha** (`?tab=`):

- **Resumen**: alta, cómo entra (contraseña, Google o ninguna en un hijo), perfil público (sí/no) y **Despublicar**
  (`POST /admin/profiles/:id/unpublish`, con confirmación: «el dueño puede volver a publicarlo»). Para un alumno, el
  estado del perfil (`status.missing` como en B18: qué le falta) y la cobertura de riesgo (sí/no, sin la forma).
  **Cambiar el rol** (Select con alumno, tutor, profesor; `PUT /admin/profiles/:id/role`, **B19.0**), con
  confirmación «el cambio es inmediato; si tiene la app abierta, tendrá que volver a entrar». No sale para un admin ni para un hijo. Errores:
  `same_role`, `admin_role_locked`, `child_role_locked`, `trainer_has_sessions` («antes, reasigna o retira sus
  clases y sesiones futuras» con enlace a Clases), `student_has_subscription` («tiene una cuota o un seguro vivos;
  dalos de baja antes»).
- **Familia**: para un hijo, sus tutores (nombre y email) con **Vincular otro tutor** (Combobox que busca adultos con
  `GET /admin/profiles?q`; `POST /admin/profiles/:id/guardians`, **B19.0**) y **Desvincular** (`DELETE …/guardians/:tutorId`,
  con confirmación). Para un adulto, sus hijos (enlace a su ficha). Errores: `not_a_child`, `already_guardian`,
  `invalid_guardian` (un hijo o alguien sin acceso propio), `last_guardian` («un hijo siempre tiene al menos un
  tutor»), `guardian_is_payer` («paga su cuota o su seguro: cambia antes el pagador»).
- **Cuota y seguro** (solo alumnos): la suscripción viva (plan, disciplinas, estado, fin de periodo, baja programada,
  bajada programada, cambios de disciplina que quedan, **pagador** con enlace a su ficha, cambio de pagador en curso) y
  el seguro (tramo, estado, fin del año, renovación, pagador). Sin cuota: «no tiene cuota» (el admin no contrata por
  el alumno: lo hace el pagador). Acciones, cada una con su confirmación:

  | Acción | Endpoint | Confirmación y errores |
  |---|---|---|
  | Baja a fin de periodo / inmediata | `POST /admin/subscriptions/:id/cancel-at-period-end` \| `cancel-now` | «se avisa al pagador»; la inmediata, además, «anula los recibos pendientes y cancela sus reservas futuras». Si había una bajada programada, «se descarta» |
  | Cambiar de plan | `POST /admin/subscriptions/:id/plan` (con `GET /admin/plans`, `GET /admin/disciplines`) | plan y disciplinas (los solo menores solo para un menor). Subida: «se cobra ya la parte proporcional al pagador»; `requires_payer_action` → «el pagador recibirá un email para autorizar el pago». Bajada: «se aplica el …». `same_plan`, `upgrade_pending`, `period_ending_soon`, `payer_change_pending`, `discipline_not_eligible`, `plan_minors_only` |
  | Anular la bajada programada | `DELETE /admin/subscriptions/:id/plan/scheduled` | — |
  | Cambiar de disciplina | `POST /admin/subscriptions/:id/disciplines` | «es inmediato y cancela sus reservas de la disciplina que deja»; gratis si ya no se cubría. `discipline_change_limit`, `payer_change_pending` |
  | Cambiar de pagador | `POST /admin/subscriptions/:id/payer-change` (candidatos: sus tutores o él mismo si es adulto, de `guardians`) | «el nuevo pagador recibe un email y tiene hasta el … para pagar; si no, sigue pagando …». `same_payer`, `invalid_payer`, `period_ending_soon`, `upgrade_pending`, `cancel_scheduled`, `payer_change_paid` |
  | Anular el cambio de pagador | `DELETE /admin/subscriptions/:id/payer-change` | solo si no está pagado (`payer_change_paid`) |
  | Baja del seguro a fin de año / inmediata | `POST /admin/insurances/:id/cancel-at-period-end` \| `cancel-now` | «sin reembolso; se avisa a quien lo paga»; la inmediata, «anula sus recibos pendientes». Si se queda sin cobertura de riesgo: «no podrá reservar hasta firmar la exención o contratar otro» |

- **Reservas** (solo alumnos): `GET /bookings?profile_id&from&to` por tramos de ≤ 92 días (próximas y pasadas), con
  estado y motivo de cancelación; **Cancelar** (`POST /bookings/:id/cancel`, motivo «cancelada por la academia», nunca
  tardía). Reservar por él se hace desde el detalle de la sesión.

## Cobros `/admin/billing` (`?tab=`)

| Pestaña | Endpoints | Estados y errores |
|---|---|---|
| **Morosos** | `GET /admin/billing/delinquents?limit&offset` | un bloque por pagador (nombre → su ficha): sus suscripciones y seguros impagados o en gracia (alumno → su ficha, plan o tramo, estado, fin de periodo) y sus recibos pendientes (importe, intentos, siguiente reintento, último error en texto pequeño, **Abrir el recibo** → `hosted_invoice_url` en otra pestaña, para enviárselo al pagador). Acción por elemento: baja inmediata (con la confirmación de la ficha). Vacío: «nadie debe nada» |
| **En gracia** | `GET /admin/billing/grace?limit&offset` | igual, solo `past_due`: «Stripe sigue reintentando el cobro hasta el …». Sin acciones de baja destacadas (aún no es moroso) |
| **Cambios de pagador** | `GET /admin/payer-changes?status&limit&offset` (**B19.1**) | dos vistas: **En curso** (`requested`, `paid`) y **Caducados** (`expired`). Cada fila: alumno, pagador actual → nuevo, plan, desde (D), fecha límite, estado. En curso y sin pagar: **Anular**. Caducado: «no pagó a tiempo; sigue pagando …» y **Volver a pedirlo** (abre la ficha en «Cuota y seguro»). Vacío: «no hay cambios en curso» / «ninguno ha caducado» |

## Avisos `/admin/notices` (`?tab=`)

| Pestaña | Endpoints | Estados y errores |
|---|---|---|
| **De la academia** | `GET /admin/notices?limit&offset` (**B19.1**) | los avisos cuyo destinatario es el admin, del más nuevo al más viejo: riesgo de Stripe (disputa o aviso de fraude: «revísalo en el Dashboard de Stripe»), carrera de dos Checkouts reembolsada, cambio de pagador caducado. Fecha, qué pasó en una línea y enlace a la ficha o la suscripción. Sin «leído»: es un registro. Vacío: «la academia no tiene avisos» |
| **Entregas fallidas** | `GET /admin/notice-deliveries?from&limit&offset` (**B19.1**) | cada entrega que no llegó: fecha, aviso (su nombre en español, p. ej. «Cobro fallido»), canal (email o push), destinatario (→ su ficha), intentos y el último error (texto pequeño). Texto fijo arriba: «no se reintentan: un aviso caduca a las 24 h; si importa, avisa a la persona por otro medio». Vacío: «todo se ha entregado» |

## Horario

| Pantalla | Endpoints | Estados y errores |
|---|---|---|
| **Sesiones** `/admin/sessions?semana=` | `GET /sessions/calendar?from&to&discipline_id` | semana de lunes a domingo (filas por día o rejilla en escritorio), filtro por disciplina; cada sesión con hora, disciplina, profesor, lugar, aforo y estado (programada, cancelada, celebrada; los ajustes solo se ven en el detalle: el calendario no los da). **Sesión suelta** (`POST /admin/sessions`, con `GET /admin/disciplines` y los profesores de `GET /admin/profiles?role=profesor`). `trainer_overlap`, `discipline_inactive` |
| **Detalle de sesión** `/admin/sessions/:id` | `GET /admin/sessions/:id` (**B19.1**) | datos con los campos ajustados marcados y lo que dice su clase al lado; **reservas** (nombre → ficha, desde cuándo) y **lista de espera** en orden. Acciones: **Ajustar** (profesor, inicio, duración, aforo, lugar; `PATCH /admin/sessions/:id`), **Deshacer el ajuste** de un campo (`POST …/reset`, no en una suelta), **Cancelar** (`POST …/cancel`, motivo obligatorio si ya empezó: «cancelación retroactiva: anula la lista y no avisa»), **Recuperar** (`POST …/restore`), **Reservar a un alumno** (Combobox con `GET /admin/profiles?q&role=alumno`; `POST /bookings { session_id, profile_id }`, sin ventana para el admin) y cancelar una reserva. Confirmaciones con a quién se avisa (`notified`) y cuántos pasan de la espera (`promoted`). Errores: `capacity_below_bookings` («hay N reservas»), `trainer_overlap`, `session_not_adjustable`, `slot_passed`, `loose_session`, `class_retired`, `discipline_inactive`, y los de reservas de B18 |
| **Lista** (en el detalle, desde el inicio) | `GET /sessions/:id/attendance`, `PUT …/:studentId`, `POST …/close`, `POST …/:studentId/correct` | la misma lista del profesor (B18.4) en escritorio; el admin corrige siempre (sin plazo) |
| **Clases** `/admin/classes?discipline_id` | `GET /admin/classes`, `POST /admin/classes`, `PATCH /admin/classes/:id`, `POST …/retire` | tabla por día de la semana y hora (disciplina, profesor, hora, duración, aforo, lugar, desde, hasta). Crear y cambiar en un Sheet: el cambio pide **desde qué fecha** («no cambia el pasado ni los campos ajustados de cada sesión») y dice después cuántas sesiones cambió, a cuántos avisó y cuántos promocionó. **Retirar** con fecha y confirmación («cancela sus sesiones desde esa fecha y avisa a quien tenía reserva»). `capacity_below_bookings { fits_from }` («cabe desde el …»), `trainer_overlap`, `class_retired`, `already_retired`, `discipline_inactive` |

## Catálogo `/admin/catalog` (`?tab=`)

| Pestaña | Endpoints | Estados y errores |
|---|---|---|
| **Disciplinas** | `GET`/`POST /admin/disciplines`, `PATCH /admin/disciplines/:id` | nombre, solo menores, abierta, activa. **Desactivar** con confirmación fuerte: «retira todas sus clases, cancela sus sesiones futuras y avisa; quien la tenía elegida puede cambiarla gratis» y el resultado (`retired_classes`, `cancelled_sessions`) |
| **Planes** | `GET`/`POST /admin/plans`, `PATCH /admin/plans/:id`, `GET`/`PUT /admin/plans/:id/disciplines` | nombre, precio («impuestos incluidos»), cuántas disciplinas (1, 2… o todas), solo menores, activo, disciplinas elegibles (vacío = todas las activas que permita la edad). Cambiar el precio: «se aplica a todos sus suscriptores desde su siguiente cobro». Retirar: «ya no se contrata; las suscripciones siguen igual». Un plan a 0 € con suscriptores no se puede (`409`) |

## Informes `/admin/reports` (`?tab=`)

Las métricas de B17, con los gráficos y «Ver tabla» de B18.4. Sin salud, edad ni fecha de nacimiento.

| Pestaña | Endpoints | Estados y errores |
|---|---|---|
| **Suscripciones** | `GET /admin/reports/subscriptions?group=day\|month&from&to` | por días (≤ 92) o por meses (≤ 24): activas, en gracia, impagadas, altas, bajas y MRR. Un hueco sin foto se ve como hueco («sin dato»), nunca como cero; un mes incompleto dice «N de M días» |
| **Sesiones** | `GET /admin/reports/sessions?by=discipline\|class&from&to&discipline_id` | como el del profesor, pero de toda la academia y con el profesor de cada clase |
| **Alumnos** | `GET /admin/reports/students?from&to&discipline_id&limit&offset` | tabla paginada: reservas, presentes, faltas, sin registrar y tardías por alumno (nombre → ficha) |

Errores: `invalid_range` («revisa las fechas: como mucho 92 días o 24 meses»).

## Documentos legales `/admin/documents`

| Pantalla | Endpoints | Estados y errores |
|---|---|---|
| **Documentos** | `GET /admin/agreements/documents`, `GET /admin/agreements/documents/:id/file` (**B19.1**) | por tipo (exención de responsabilidad, protección de datos, derechos de imagen): la **vigente**, los **borradores** y los **retirados**, cada uno con versión, fechas y **Ver el PDF**. Un tipo sin vigente: «aún no hay documento publicado: nadie puede completar su perfil» en rojo |
| **Subir** (Dialog) | `POST /admin/agreements/documents?type&version` (cuerpo crudo PDF) | tipo, versión X.Y y el PDF (≤ 10 MB). Queda como borrador. `duplicate_document`, `version_exists_different_content`, `invalid_type`, `invalid_version` o `invalid_file` (la API no usa `invalid_field` aquí), archivo que no es PDF o muy grande (se comprueba antes de enviar) |
| **Publicar** (en un borrador) | `POST /admin/agreements/documents/:id/publish` | confirmación fuerte: «retira la versión vigente; **todos** los que la firmaron tendrán que volver a firmar y no podrán reservar hasta hacerlo; se les avisa». Retirar un documento **solo** se hace publicando otro del mismo tipo: no hay botón de retirar a secas (dejaría a todos sin poder completar el perfil) |

## Auditoría `/admin/audit`

| Pantalla | Endpoints | Estados y errores |
|---|---|---|
| **Registro** `/admin/audit?category&actor&from&to&page` | `GET /admin/audit?action&actor_id&resource_type&resource_id&from&to&limit&offset` (**B19.1**) | tabla del más nuevo al más viejo: fecha, quién (→ ficha), qué (en español: «Cerró la lista», «Corrigió una asistencia», «Vio las fichas de salud», «Canceló una sesión», «Dio de baja una suscripción», «Cambió el rol», «Publicó un documento»…), sobre qué (enlace a la sesión, la ficha o la suscripción) y el detalle en una línea (una corrección: de → a y el motivo; un cambio de rol: de → a). Filtros: categoría (asistencia, salud, sesiones y clases, catálogo, cobros, usuarios, documentos, ajustes, reservas), persona y fechas. Desde una ficha o una sesión, «Ver su auditoría» abre el registro filtrado por ese recurso. Los avisos no salen aquí (están en «Avisos»). Vacío: «nada registrado con estos filtros» |

## Tablets `/admin/tablets` y Ajustes `/admin/settings`

| Pantalla | Endpoints | Estados y errores |
|---|---|---|
| **Tablets** | `GET /admin/tablets`, `POST /admin/tablets`, `POST /admin/tablets/:id/revoke` | nombre, estado (esperando vinculación, vinculada, revocada), vinculada el, vista por última vez. **Nueva tablet**: nombre → el **código** en grande (Geist Mono) con «caduca a las …; solo se ve ahora» y cómo usarlo (`/tablet` en la tablet). **Revocar** con confirmación («la tablet deja de mostrar el QR al momento») |
| **Ajustes** | `GET /admin/settings` (**B19.1**), `PUT /admin/settings/checkin`, `PUT /admin/settings/insurance`, `PUT /admin/settings/discipline-changes` | tres grupos, cada uno con su «Guardar»: **check-in** (abre N min antes, cierra N min después, el QR cambia cada N s; 1–1440), **seguro** (precio adulto, precio menor, ofrecerlo: «no se puede activar sin los dos precios»; desactivarlo: «los seguros vivos no se renuevan y se avisa a sus pagadores»), **cambios de disciplina por periodo** (0 o más). `invalid_field` en su campo |

## Mapa de errores nuevos por `code`

Los de B18 siguen valiendo. Texto de la UI para los nuevos y los del admin que la UI de B18 no tenía:

| `code` | Texto |
|---|---|
| `insufficient_role` | «no tienes acceso a esto» |
| `invalid_totp` | «el código no es correcto; revisa la hora del móvil» |
| `profile_not_found` | «este perfil no existe» |
| `same_role` | «ya tiene ese rol» |
| `admin_role_locked` | «el rol de administración no se cambia desde la app» |
| `child_role_locked` | «un hijo siempre es alumno» |
| `trainer_has_sessions` | «antes, reasigna o retira sus clases y sesiones futuras» |
| `student_has_subscription` | «tiene una cuota o un seguro vivos; dalos de baja antes» |
| `not_a_child`, `invalid_guardian` | «solo se vincula un adulto con acceso propio a un menor» |
| `already_guardian` | «ya es su tutor» |
| `last_guardian` | «un hijo siempre tiene al menos un tutor» |
| `guardian_is_payer` | «paga su cuota o su seguro: cambia antes el pagador» |
| `requires_payer_action` | «el pagador recibirá un email para autorizar el pago» |
| `capacity_below_bookings` | «hay más reservas que ese aforo» (con `fits_from`: «cabe desde el …») |
| `trainer_overlap` | «ese profesor ya tiene otra sesión a esa hora» |
| `duplicate_document` | «ese PDF ya está subido» |
| `version_exists_different_content` | «esa versión ya existe con otro PDF; usa otra versión» |
