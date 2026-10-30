# CONTEXT — Vocabulario de dominio de Kaizen

Solo términos de dominio. Sin detalles de implementación.

## Identidad

- **Perfil**: la persona. Es el único concepto de identidad. En columnas nuevas la FK a la persona se llama siempre `profile_id`; `student_id`, `trainer_id`, `user_id` y `actor_id` ya existentes se leen como "el perfil en ese papel".
- **Rol**: papel de un perfil. Roles: **alumno**, **profesor**, **admin**, **tutor**. Cada perfil tiene exactamente **un** rol. El multi-rol queda aplazado hasta que exista un caso real.
- **Alumno**: perfil que entrena.
- **Profesor**: perfil que imparte clases.
- **Admin**: perfil que gestiona la academia.
- **Tutor**: perfil adulto vinculado a uno o varios hijos mediante una relación tutor→hijo. La capacidad de ser tutor la da la relación y la puede tener cualquier perfil adulto. El rol **tutor** existe solo para quien no entrena (padre o madre que gestiona a sus hijos). Un padre que entrena es alumno y además tutor por la relación. El tutor crea a sus hijos y gestiona todo por ellos: perfil, ficha de salud, acuerdos, suscripción, reservas e inscripciones. Todos los tutores de un hijo tienen los mismos poderes. Quien crea al hijo queda vinculado; los demás tutores los vincula el admin.
- **Hijo** (o **menor**): perfil alumno con menos de 18 años, creado por un tutor. Requiere fecha de nacimiento. **No tiene acceso propio**: ni email ni login. Nunca se registra por sí mismo; solo existe dentro de una cuenta familiar. Siempre tiene al menos un tutor. El tutor lo edita pero no lo borra: la baja la hace el admin.
- **Cuenta familiar**: término de UI. Es lo que ve un tutor: él mismo y sus hijos. No es una entidad del dominio.
- **Sujeto** y **actor**: el sujeto es el perfil sobre el que recae una acción (quien entrena, quien queda inscrito, a quien se le firma). El actor es quien la hace. Coinciden salvo cuando un tutor actúa por un hijo.
- **Pagador**: perfil adulto que paga la suscripción de un alumno: el propio alumno adulto o uno de sus tutores. Cada alumno tiene su propia suscripción; no hay suscripción familiar. El pagador es quien contrata la suscripción. **Cambiar de pagador** solo lo hace el admin, a petición: elige al nuevo pagador (un tutor vinculado o el propio alumno adulto), que debe completar el pago por su cuenta antes de que acabe el periodo en curso; entonces la suscripción antigua termina y empieza una nueva igual pagada por él. Si no lo completa a tiempo, no hay cambio. Al reclamar su perfil, el pagador debe pasar a ser el propio alumno, por la misma vía. Un adulto siempre se paga a sí mismo: no existe el pagador externo de un adulto. Todo lo que paga un mismo pagador se agrupa en su cuenta de la pasarela de pago.
- **Reclamar perfil**: al cumplir 18 años, el hijo deja de estar gestionado. Para seguir entrenando, el ahora adulto recibe una invitación (de un tutor o del admin), obtiene acceso propio y conserva su historial. Hasta que lo reclama, su perfil está incompleto y su tutor solo lo ve en la lista y paga lo que ya pagaba.
- **Registro**: solo un adulto puede registrarse por sí mismo.
- *Usuario* no es término de dominio.

## Acuerdos

- **Acuerdo** (*Agreement*): documento legal que el alumno debe aceptar.
- **Tipo de acuerdo**: `waiver` (exención de responsabilidad), `data_protection`, `rights_of_image`.
- **Documento de acuerdo**: PDF de un tipo y una versión. No existe "versión" como entidad aparte.
- **Versión**: etiqueta X.Y de un documento dentro de su tipo. Sin semántica: no distingue cambios menores de mayores.
- **Ciclo de vida del documento**: borrador → publicado → retirado. Publicar uno nuevo retira el anterior del mismo tipo. Nunca se borra un documento publicado.
- **Vigente**: el único documento publicado y no retirado de un tipo.
- **Firma**: acto de aceptar un acuerdo en una versión concreta. Es un hecho histórico, solo se añade, nunca se modifica. Guarda IP y user-agent. Un mayor firma por sí mismo.
- **Firma por representación**: firma de un tutor sobre un acuerdo de un hijo. Registra firmante (el tutor, actor) y sujeto (el hijo). Basta **un** tutor vinculado. Desvincular a un tutor no invalida lo que ya firmó.
- **Re-firma**: volver a firmar tras publicarse una versión nueva. **Toda** publicación nueva obliga a re-firmar, sin importar el salto de X.Y, y bloquea de inmediato (sin periodo de gracia).
- *Consentimiento*: no es término de dominio. Solo etiqueta de UI para `data_protection` y `rights_of_image`.
- El `waiver` no es un acuerdo obligatorio para todos: es una de las dos formas de tener **cobertura de riesgo** (ver «Seguro y cobertura de riesgo»).

## Planes y disciplinas

### Catálogo

- **Disciplina**: arte marcial o actividad que imparte la academia (p. ej. BJJ, Muay Thai). Nunca se borra si tiene historial; se desactiva.
- **Disciplina solo menores**: disciplina que solo pueden elegir los menores (p. ej. Muay Thai Kids). Un menor puede elegir cualquier disciplina; un adulto, ninguna solo menores.
- **Plan**: oferta del catálogo de la academia, definida por el admin: nombre, precio, periodo de cobro y **cuántas disciplinas** puede elegir el alumno (1, 2 o todas). El plan no fija qué disciplinas: las elige el alumno entre las elegibles. Kaizen es la fuente de verdad de su precio; un plan existe aunque no haya pasarela de pago.
- **Disciplinas elegibles**: lista opcional de un plan que limita entre qué disciplinas se elige. Sin lista, es elegible cualquier disciplina activa que permita la edad del alumno. No es lo mismo que "cubrir".
- **Plan solo menores**: plan que solo puede contratarse para un menor. Es opcional: por defecto un plan está abierto a todos.
- **Periodo de cobro**: cada cuánto se factura un plan. Es un valor de un conjunto cerrado (hoy solo **mensual**). Un plan tiene un único periodo y un único precio; la misma oferta en otro periodo es otro plan.
- **Precio**: precio final que paga el pagador, impuestos incluidos. Un plan de 0 € no se contrata por la pasarela.
- **Cambio de precio**: el precio de un plan es editable; el nuevo precio se aplica a todos sus suscriptores desde su siguiente facturación. Lo pagado de verdad queda en los recibos.
- **Retirar un plan**: impide contratarlo y cambiar a él. Las suscripciones vigentes siguen igual. Un plan con historial nunca se borra.
- **Catálogo**: las disciplinas y los planes activos. Lo ve cualquier perfil con sesión iniciada; solo el admin lo modifica. Los retirados solo los ve el admin (y el alumno cuya suscripción vigente está en ese plan). "Solo menores" no limita qué se ve, sino qué se contrata.
- *Stripe Price*: no es término de dominio. Es el reflejo técnico de un plan en la pasarela.

### Suscripción

- **Suscripción**: vínculo de un alumno (sujeto) con un plan, pagado por un pagador. Tiene estado. Un alumno tiene como máximo **una** suscripción viva; para tener más disciplinas sube de plan. Las anteriores quedan como historial.
- *Cuota*: no es término de dominio. Solo etiqueta de UI para la suscripción.
- **Contratar**: el pagador elige plan y disciplinas en Kaizen, que valida los requisitos, y paga en la página de la pasarela. La suscripción existe solo cuando la pasarela confirma el pago; volver de la página de pago no da acceso por sí solo. Solo se paga con tarjeta (incluidos los monederos del móvil).
- **Periodo de facturación**: cada suscripción empieza el día en que se contrata y se renueva ese mismo día cada mes (aniversario). No hay un día de cobro común ni prorrateo inicial. «Fin de periodo» es siempre el de cada suscripción.
- **Estados de la suscripción**: son los de la pasarela de pago, sin traducción.
  - **Activa**: al corriente de pago.
  - **En periodo de gracia**: ha fallado un cobro y la pasarela sigue reintentándolo. Dura lo que dura la ventana de reintentos (2 semanas). El alumno no pierde nada mientras tanto.
  - **Impagada**: se agotaron los reintentos sin cobrar. La suscripción no se cancela: se recupera pagando el recibo pendiente. Al pasar a impagada se avisa al pagador, con el enlace para pagar ese recibo. Igual con el seguro.
  - **Cancelada**: terminada. Queda como historial.
  - **Pendiente de pago en efectivo**: reservado para el pago en efectivo, que no está activo.
  _Evitar_: moroso (para el estado; es del pagador), vencida.
- **Suscripción en vigor**: la que da acceso: activa o en periodo de gracia.
- **Suscripción viva**: la que impide contratar otra para el mismo alumno: activa, en periodo de gracia o impagada. Quien tiene una impagada paga su recibo; no empieza de cero.
- **Moroso**: pagador con alguna suscripción o seguro impagado. Una en periodo de gracia no lo convierte en moroso.
- **Baja**: terminar una suscripción. Solo la hace el admin, a fin de periodo o de inmediato, y se avisa al pagador (si había una bajada programada, el aviso dice que se descarta). Una baja inmediata anula los recibos pendientes: lo no cobrado ya no se cobra y el pagador deja de ser moroso por ella. Igual en la baja inmediata del seguro. El pagador puede, por su cuenta, cambiar su tarjeta y ver sus recibos.
- **Cambio de pagador pendiente**: desde que el admin pide el cambio hasta que se resuelve. El nuevo pagador recibe un enlace a Kaizen y paga por su cuenta antes de la **fecha límite** (poco antes del fin del periodo en curso); al pagar no se le cobra nada hasta ese fin. Hay como mucho uno por suscripción, y mientras dura no se cambia ni el plan ni las disciplinas. Una bajada programada pasa a la suscripción nueva. Termina de una de cuatro formas: **traspaso**, **caducado** (no pagó a tiempo: la suscripción renueva con el pagador de siempre y se avisa al admin), **anulado** por el admin antes de pagarse, o por la baja de la suscripción. Una vez pagado ya no se anula. Si el cambio no termina en traspaso y el nuevo pagador llegó a pagar algo (solo si su pago se procesa tarde, ya pasado el fin del periodo), se le devuelve: corrige un cobro de más, no es un reembolso del servicio.
- **Traspaso**: el momento, al final del periodo, en que la suscripción antigua termina y empieza la nueva con el nuevo pagador, con el mismo plan y las mismas disciplinas (o las de la bajada programada). Las reservas no se tocan: la cobertura no se interrumpe.
- **Pago en efectivo**: reservado. No está activo; cuando se active tendrá su propio bloque.
- **Disciplinas elegidas**: las disciplinas concretas que el alumno escoge al suscribirse, tantas como permite su plan y entre las elegibles. Pertenecen a la suscripción, no al plan.
- **Cubrir**: una suscripción cubre una disciplina si está entre sus disciplinas elegidas o si el plan es de todas y la disciplina es elegible para ese alumno (para un adulto, nunca una solo menores). Cubrir da acceso ilimitado: todas las clases de esa disciplina, todos los días; solo limita el aforo de cada sesión.
- **"Todas" es dinámico**: cubre las disciplinas elegibles en cada momento; una disciplina nueva queda cubierta al darse de alta si es elegible.
- **Baja de disciplina**: al desactivarse una disciplina deja de cubrirse, y quien la tenía elegida puede sustituirla gratis y al instante por otra elegible (no cuenta como cambio de disciplina).
- **Cambio de disciplina**: sustituir una disciplina elegida por otra sin cambiar de plan. Permitido un número limitado de veces por periodo de facturación (hoy, una; puede ser cero); el límite es un parámetro de la academia. Es inmediato y sin coste, y cancela las reservas y esperas futuras de la disciplina abandonada con motivo «cambio de disciplina». Sustituir una disciplina que ya no se cubre (desactivada, o solo menores para un adulto) es gratis y no cuenta para el límite. Elegir disciplinas al subir o bajar de plan no cuenta como cambio de disciplina.
- **Subir de plan** (*upgrade*): pasar a un plan más caro. Es inmediato y se cobra la parte proporcional; el cambio solo se aplica si ese cobro se paga. Cambiar de plan lo hacen el pagador actual o el admin, con la suscripción activa y sin baja programada. Al subir, el alumno puede conservar sus disciplinas y añadir otras o cambiarlas todas.
- **Bajar de plan** (*downgrade*): pasar a un plan del mismo precio o más barato. Se aplica en la siguiente facturación, sin reembolso. Hasta entonces es una **bajada programada**: hay como mucho una, una nueva la sustituye, una subida la anula y el pagador o el admin pueden anularla. Al bajar, el alumno elige las nuevas disciplinas: puede quedarse con alguna de las que ya hacía o escoger otras nuevas.
- **Al cumplir 18**: la suscripción no cambia hasta que el ahora adulto reclama su perfil. Al reclamar, sus disciplinas solo menores se sustituyen gratis y al instante (como una baja de disciplina) y, si su plan es solo menores, debe elegir un plan abierto antes de reservar. Ese cambio es inmediato y con prorrateo, suba o baje.

### Cobros

- **Recibo**: justificante de un cobro, o intento de cobro, de un periodo de una suscripción o de un seguro, emitido al pagador. Guarda lo pagado de verdad. Lo ven el pagador, el alumno, sus tutores vinculados (también los históricos) y el admin; el profesor, no. No es una factura legal.
- **Factura**: documento fiscal legal. La emitirá en el futuro un servicio externo homologado, y se podrá descargar desde Kaizen. Hoy no existe.
  _Evitar_: factura (para un recibo).

### Seguro y cobertura de riesgo

- **Cobertura de riesgo**: lo que todo alumno necesita para entrenar. Se tiene de una de dos formas: con el **seguro de la academia** en vigor o con el **`waiver`** firmado en la versión vigente. No hay una tercera: un seguro propio externo no da cobertura de riesgo; quien lo tenga firma el `waiver`.
  _Evitar_: «ya tiene seguro» como opción a elegir (si tiene el de la academia en vigor, no se le pregunta).
- **Seguro**: seguro de la academia para un alumno (sujeto), pagado por su pagador. Es independiente de la suscripción. Tiene un precio anual por tramo de edad (adulto o menor), editable por el admin. El precio y el tramo de una renovación quedan fijados el día de su aviso: un cambio de precio se aplica desde la primera renovación que se avise después del cambio.
- **Año del seguro**: 12 meses desde el día en que se paga. Se renueva solo, con el tramo que corresponda a la edad el día del aviso. Tiene los mismos estados que la suscripción: **seguro en vigor** es el activo o en periodo de gracia; **seguro vivo**, además, el impagado. Un seguro impagado no da cobertura de riesgo y se recupera pagando su recibo pendiente, sin reiniciar el año. Se avisa al pagador 30 días antes de renovar. El seguro de un hijo que el día de la renovación ya cumplió 18 y no ha reclamado su perfil no se renueva, aunque el aviso dijera lo contrario (se avisa de nuevo al pagador): termina al final de su año y, al reclamar, elige su cobertura como adulto.
- **Elegir la cobertura**: al contratar una suscripción, el pagador elige obligatoriamente entre contratar el seguro o firmar el `waiver`, salvo que el alumno ya tenga cobertura de riesgo. Con el `waiver`, se firma antes de pagar. Con el seguro, se pagan suscripción y seguro seguidos, en un solo paso para el pagador; si el seguro no llega a pagarse, la suscripción sigue contratada, el alumno queda sin cobertura de riesgo y se avisa al pagador. Además, el pagador puede contratar el seguro en cualquier momento para un alumno con suscripción viva que no tenga ya un seguro vivo (con o sin `waiver`); nunca hay dos seguros vivos a la vez para el mismo alumno. Darse de baja del seguro (pasar al `waiver`) lo hace solo el admin. La baja de la suscripción no corta el seguro: sigue en vigor hasta el final de su año, sin reembolso, y entonces termina sin renovarse (si el alumno vuelve, elige otra vez su cobertura al contratar). Subir o bajar de plan no es una baja y no afecta al seguro.
- **Baja del seguro**: terminar un seguro. Solo la hace el admin, a fin de su año (deja de renovarse y sigue en vigor hasta entonces) o de inmediato (p. ej. un seguro impagado, que así deja de contar como deuda). Nunca hay reembolso automático: si la academia devuelve algo, lo hace a mano en la pasarela. No exige tener el `waiver` firmado: si el alumno se queda sin cobertura de riesgo, no puede reservar pero conserva lo reservado. Se avisa al pagador del seguro y, si es otro, al pagador actual de la suscripción.
- **Seguro desactivado**: la academia puede no ofrecer el seguro. Nace desactivado y solo se activa con los dos precios puestos (mayores de 0 €). Desactivado, no se contrata (al contratar la suscripción solo queda el `waiver`) y los seguros vivos terminan al final de su año sin renovarse, con aviso a su pagador.
- **Quién contrata el seguro**: solo el pagador actual de la suscripción del alumno. El `waiver` de un hijo lo puede firmar cualquier tutor vinculado.
- **Seguro y cambio de pagador**: el seguro no cambia de pagador. Desde el traspaso, sigue en vigor hasta el final de su año con quien lo pagó y termina sin renovarse (salvo que ya lo pagara el nuevo pagador); el aviso previo al vencimiento va al pagador actual, que puede firmar el `waiver` o, cuando termine, contratar un seguro nuevo.
- **Quién ve el seguro**: los mismos que ven sus recibos; el profesor, no. El profesor solo ve, en su lista de sesiones del día, qué alumnos con reserva están **sin cobertura de riesgo** (sin la forma, el precio ni el pagador). Kaizen no les impide entrenar: lo decide la academia.
- **Pérdida de cobertura de riesgo**: si el seguro deja de estar en vigor y no hay `waiver` vigente, el alumno no puede reservar, pero no se cancela lo ya reservado (como un perfil incompleto).

## Perfil completo

Estado del alumno, calculado siempre a partir de los datos (un alumno recién registrado ya está incompleto):
- tiene `display_name`;
- tiene ficha de salud con contacto de emergencia;
- tiene `data_protection` y `rights_of_image` firmados en la versión vigente.

El `waiver` no forma parte del perfil completo: cuenta para la cobertura de riesgo.

Es el requisito para reservar (B7) y pagar (B10). Profesor y admin siempre están completos. Un **tutor** (rol) está completo con `display_name` y su propio `data_protection` (no entrena: no necesita ficha ni `rights_of_image`). `missing` es la lista de lo que falta: `display_name`, `health_info`, `emergency_contact`, `data_protection`, `rights_of_image`.

Cuando un tutor actúa por un hijo, deben estar completos **los dos**: el hijo (sujeto) y el tutor (actor).

Para un **hijo**, los acuerdos los firma y la ficha la rellena un tutor vinculado. Al cumplir 18 años los poderes del tutor caen y las firmas del tutor dejan de contar: el perfil queda incompleto hasta que el ahora adulto reclame su perfil, firme los acuerdos y confirme su ficha. El estado se calcula con la fecha de nacimiento, sin ningún proceso que cambie datos.

**Fecha de nacimiento y Google**: el registro local la exige y debe ser de un adulto. El alta con Google no la trae: queda vacía y el perfil se trata como adulto hasta que el onboarding («Completar Perfil») la pide; si declara ser menor, se rechaza y debe darlo de alta un tutor.

## Clases y sesiones

- **Clase**: entrada del horario semanal de la academia: disciplina, profesor habitual, día de la semana, hora, duración y aforo (p. ej. «BJJ Fundamentos, lunes 19:00, Carlos, 20 plazas»). La clase no se reserva: se reservan sus sesiones.
  Su hora es la hora local de la academia (Europa/Madrid) todo el año, con cambio de horario incluido.
  Tiene fecha de inicio (por defecto, hoy) y, opcionalmente, fecha de fin (p. ej. un horario de verano); sin fecha de fin dura hasta que se retira.
  _Evitar_: plantilla, horario (para una sola entrada).
- **Horizonte**: cuánto tiempo por delante de hoy hay siempre sesiones generadas a partir de las clases. Es deslizante: avanza solo cada día. Es un parámetro de la academia, por defecto 1 año; reducirlo no borra sesiones ya generadas.
- **Sesión suelta**: sesión que no sale de ninguna clase (p. ej. un open mat puntual).
- **Sesión**: una ocurrencia concreta de entrenamiento en una fecha y hora, de una disciplina e impartida por un profesor. Se accede a ella porque la suscripción del alumno **cubre** su disciplina, y se **reserva**.
  Sale de una clase o es una sesión suelta. Se puede ajustar por separado (cancelarla, poner un profesor sustituto, cambiar su aforo).
  _Evitar_: clase (para una ocurrencia concreta), evento.
- **Retirar una clase**: darla de baja a partir de una fecha (por defecto, hoy). Sus sesiones desde esa fecha se cancelan (ver «Cancelar una sesión»); las anteriores se conservan. Una clase con sesiones celebradas nunca se borra. Desactivar una disciplina retira todas sus clases y cancela sus sesiones sueltas futuras.
- **Aforo**: número de plazas de una sesión. Siempre existe y es mayor que 0; no hay sesiones ilimitadas. Nunca puede quedar por debajo de las reservas de la sesión.
- **Duración**: obligatoria en toda clase y sesión; fija la hora de fin.
- **Lugar**: texto libre opcional de una sesión (p. ej. «tatami 2»). No hay salas definidas.
- **Solape**: un profesor no puede impartir dos sesiones que se solapen en el tiempo. No se controlan solapes de lugar.
- **Profesor de la sesión**: quien la imparte: el profesor habitual de su clase o, si hay un ajuste, el **sustituto**. Las **sesiones de un profesor** son las que imparte, sustituciones incluidas. El profesor solo ve en el calendario sus sesiones y no crea ni ajusta clases ni sesiones: eso es del admin.
- **Baja de un profesor**: no se permite mientras sea profesor habitual de alguna clase no retirada o profesor de alguna sesión futura; antes hay que reasignarlas (cambio de clase, ajuste de sesión) o retirarlas.
- **Ajuste de sesión**: cambio hecho a mano en una sesión concreta (cancelarla, profesor sustituto, otra hora, otro aforo). Gana sobre los cambios de su clase, campo a campo.
- **Cambio de clase**: modificar una clase a partir de una fecha elegida (por defecto, hoy). Se aplica a sus sesiones futuras desde esa fecha, salvo en los campos que tengan un ajuste de sesión; el pasado nunca cambia. Las reservas siguen a su sesión: el alumno recibe un aviso y puede cancelar sin que cuente como cancelación tardía. No se permite si deja alguna sesión afectada con menos aforo que reservas; hay que elegir una fecha a partir de la cual quepan.
- **Estado de una sesión**: **programada** o **cancelada**. No hay más estados guardados.
- **Sesión celebrada**: sesión no cancelada cuya hora de fin ya pasó. Se calcula, nunca se marca. Que se pase lista o no, no cambia que se haya celebrado.
  _Evitar_: completada, finalizada.
- **Cancelar una sesión**: anula todas sus reservas y su lista de espera con el motivo «sesión cancelada», que no cuenta como cancelación del alumno ni como falta. Se avisa a cada afectado (a sus tutores si es un hijo). Se puede deshacer mientras la sesión no haya pasado, pero las reservas no vuelven: cada alumno vuelve a reservar.
- **Cancelación retroactiva**: el admin cancela una sesión ya pasada que no llegó a darse, indicando un motivo. Deja de contar como celebrada.
- **Calendario**: las sesiones de la academia. Alumnos, tutores y admin ven el calendario completo, incluidas las disciplinas solo menores, aunque no tengan suscripción; el profesor solo ve sus sesiones. Junto a cada sesión se indica si su suscripción la cubre para el sujeto (para un tutor, por cada hijo); ver no da derecho a reservar.
- **Evento**: actividad extraordinaria fuera del horario regular (seminario, torneo, examen de grado, quedada). No depende de cubrir: es gratis o se paga aparte, y admite a alumnos aunque su suscripción no cubra nada. Puede no tener disciplina ni profesor de la academia. A un evento uno se **inscribe**, no lo reserva. Un evento no es una sesión.
  _Evitar_: sesión especial.

## Reservas

- **Reserva**: plaza de un alumno (sujeto) en una sesión. Ocupa aforo. Se puede volver a reservar la misma sesión tras cancelar.
  _Evitar_: inscripción (es de eventos), anular, baja.
- **Requisitos para reservar**: perfil completo (sujeto y actor), **cobertura de riesgo** del sujeto y **suscripción en vigor** que cubra la disciplina de la sesión. No hay clase suelta ni prueba: el **pase** queda aplazado.
- **Quién reserva**: el alumno adulto para sí; cualquier tutor vinculado por sus hijos (y puede cancelar lo que reservó otro tutor); el admin por cualquier alumno, con los mismos requisitos. El profesor no reserva ni cancela.
- **Ventana de reserva**: solo se reservan sesiones que empiezan dentro de los próximos N días (parámetro de la academia, por defecto 14). Las más lejanas se ven pero no se reservan. El admin no tiene ventana. Reservar y entrar en espera se cierran al inicio de la sesión; una sesión cancelada o empezada nunca se reserva.
- **Aforo** (en reservas): inviolable para todos, admin incluido. Para hacer sitio el admin sube el aforo con un ajuste de sesión, lo que promociona la lista de espera.
- **Solape de reservas**: un alumno no puede tener dos reservas que se solapen en el tiempo.
- **En espera** (lista de espera): si la sesión está llena, el alumno queda en espera. No ocupa aforo. Puede estar en espera de una sesión que se solapa con otra que tiene reservada.
- **Promoción**: al liberarse una plaza (cancelación o subida de aforo), el primero en espera por orden de llegada pasa automáticamente a reserva y se le avisa. Ocurre hasta el inicio de la sesión. Antes se re-comprueban los requisitos: si su suscripción no cubre la sesión, sale de la lista con motivo «sin cobertura»; si tiene una reserva que se solapa, o le falta el perfil completo o la cobertura de riesgo, se le salta y sigue en la lista. Quien es promocionado ya dentro del plazo de cancelación puede cancelar sin que sea tardía.
- **Plazo de cancelación**: hasta N antes del inicio (parámetro de la academia, por defecto 1 hora) se cancela sin consecuencias. Siempre se puede cancelar hasta el inicio.
- **Cancelación tardía**: cancelación del alumno o tutor fuera de plazo. Solo queda registrada; no hay sanción automática, el admin decide a mano.
  _Evitar_: penalización.
- **Falta**: ver «Asistencia».
- **Pérdida de cobertura**: si la suscripción deja de estar en vigor (pasa a impagada o cancelada) o deja de cubrir una disciplina (p. ej. al aplicarse una bajada de plan; lo reservado mientras estaba programada también), se cancelan sus reservas y esperas futuras no cubiertas con motivo «sin cobertura», con aviso al pagador y a sus tutores si es un hijo. No vuelven al recuperar la cobertura. Un perfil incompleto o la pérdida de cobertura de riesgo impiden reservar pero no cancelan lo ya reservado.
- **Aviso de cobro fallido**: cuando falla un cobro se avisa solo al pagador, nunca al hijo, en cada intento fallido. Los avisos de facturación siempre van al pagador (ver «Avisos»).
- **Motivo de cancelación**: toda reserva cancelada o espera retirada tiene exactamente uno:
  - **cancelada por el alumno** (alumno o tutor, en plazo; también tras un cambio de clase que afecta a la sesión, aunque sea fuera de plazo);
  - **cancelación tardía** (alumno o tutor, fuera de plazo);
  - **cancelada por el admin** (nunca es tardía);
  - **sesión cancelada**;
  - **sin cobertura**;
  - **cambio de disciplina**.

## Asistencia

- **Asistencia**: si un alumno con reserva en una sesión estuvo o no. Solo existe sobre una reserva activa: quien no reservó no tiene asistencia, aunque se presente.
  _Evitar_: check-in (para la asistencia en sí).
- **Pasar lista**: el profesor marca a los presentes de su sesión. Se puede desde el inicio de la sesión. Antes del cierre, marcar y desmarcar es libre y no deja rastro.
- **Cerrar la lista**: confirmar la lista de una sesión. Al cerrarla, toda reserva sin presente pasa a **falta**. Se puede desde el inicio de la sesión y sin límite posterior. Pasan lista y la cierran el profesor de la sesión (sustituto incluido) y el admin; ningún otro profesor.
- **Sin registrar**: reserva de una sesión cuya lista no se ha cerrado. No es falta ni presencia.
- **Falta**: reserva sin presente en una lista cerrada. Nunca se genera sola por pasar la hora.
  _Evitar_: ausencia, no-show.
- **Corrección**: cambio de una asistencia (presente ↔ falta) después de cerrar la lista. Exige motivo y queda fechada. La hace el profesor de la sesión dentro del **plazo de corrección** (parámetro de la academia, contado desde el cierre) y el admin siempre. Alumno y tutor no corrigen: lo piden a la academia.
- **Check-in**: método de marcar presente escaneando con el móvil el QR de check-in de una tablet de la academia. Mismas reglas que la lista manual: exige una reserva activa, solo se admite dentro de la ventana de check-in (incluso antes del inicio) y nunca tras el cierre. Al escanear se buscan las reservas candidatas: si hay una se marca; si hay varias, quien escanea elige. Sin candidatas se rechaza: el check-in nunca crea reservas. Un tutor lo hace por sus hijos desde su móvil; si no hay tutor, el profesor marca a mano. El hijo nunca tiene QR ni credencial propia. El profesor ve en su lista qué presentes llegaron por check-in y puede desmarcarlos antes del cierre como cualquier marca.
- **Reserva candidata**: reserva activa de quien escanea, o de uno de sus hijos, en una sesión con la ventana de check-in abierta.
- **Ventana de check-in**: tramo alrededor del inicio de una sesión en el que se admite el check-in: empieza antes del inicio y acaba poco después. Ambos límites son parámetros de la academia que ajusta el admin. Fuera de la ventana solo marca el profesor.
- **QR de check-in**: código que muestra la tablet y que cambia cada pocos segundos (parámetro de la academia). Solo prueba que quien lo escanea está en la academia en ese momento; no identifica ninguna sesión. Vale el código actual y el inmediatamente anterior.
  _Evitar_: QR de sesión.
- **Tablet**: dispositivo fijo de la academia que muestra el QR de check-in y las sesiones con la ventana abierta, sin nombres de alumnos. No es un usuario ni tiene login. El admin la vincula con un código de un solo uso y la revoca cuando quiere; puede haber varias.
  _Evitar_: kiosko, lector, dispositivo (a secas).
- **Sesión cancelada**: no tiene lista. La cancelación retroactiva anula su lista y sus asistencias.
- **Ficha de salud vista por el profesor**: lesiones, condiciones, alergias, medicación y contacto de emergencia. Solo de los alumnos con reserva activa en sus sesiones del día (sustituciones incluidas) y solo ese día. Nunca experiencia ni disciplina previa.
- **Auditoría**: registro inalterable que solo lee el admin. Recoge cada cierre de lista, cada corrección (qué cambió y motivo) y cada consulta de una ficha de salud por un profesor. No recoge el marcado previo al cierre.

## Avisos

- **Aviso**: comunicación a uno o varios perfiles (sus **destinatarios**) de algo que les afecta: un cobro fallido, una reserva cancelada, una renovación… Queda registrado aunque no llegue a enviarse.
  _Evitar_: notificación (para el aviso; es la del navegador o el móvil).
- **Canal**: vía por la que se entrega un aviso: **email** o **push**. Cada tipo de aviso tiene sus canales; un mismo aviso puede ir por varios.
- **Aviso de facturación**: aviso sobre el dinero de una suscripción o de un seguro (cobro fallido, impagada, baja, renovación o no renovación del seguro, cambio de plan…). Va siempre al **pagador**, nunca al hijo, y siempre por **email**. Es un email de servicio: no se puede dar de baja de él. Nunca incluye datos de salud, edad ni fecha de nacimiento.
- **Aviso de reservas**: aviso sobre una reserva o una espera (sin cobertura, promoción, sesión cancelada, cambio de disciplina). Va al alumno o, si es un hijo, a todos sus tutores, por push.
- El admin no recibe avisos por email ni push: los consulta en su panel. Las disputas y los avisos de fraude los notifica además la pasarela de pago a la cuenta.
- **Idioma**: los avisos, como la app, solo en español.
