# CONTEXT — Vocabulario de dominio de Kaizen

Solo términos de dominio. Sin detalles de implementación.

## Identidad

- **Perfil**: la persona. Es el único concepto de identidad. En columnas nuevas la FK a la persona se llama siempre `profile_id`; `student_id`, `trainer_id`, `user_id` y `actor_id` ya existentes se leen como "el perfil en ese papel".
- **Rol**: papel de un perfil. Roles: **alumno**, **profesor**, **admin**, **tutor**. Cada perfil tiene exactamente **un** rol. El multi-rol queda aplazado hasta que exista un caso real.
- **Cambiar el rol**: solo lo hace el admin, entre alumno, tutor y profesor (y dar el de admin, ver «Admin»), y solo a un perfil con acceso propio (un hijo siempre es alumno). Quien deja de ser profesor no puede seguir siendo profesor habitual de una clase ni profesor de una sesión futura (como en la baja de un profesor); quien deja de ser alumno no puede tener una suscripción viva. Nadie se registra como profesor o tutor: se registra y el admin le cambia el rol. El cambio vale desde ese momento.
- **Alumno**: perfil que entrena.
- **Profesor**: perfil que imparte clases.
- **Admin**: perfil que gestiona la academia. Se le recomienda el doble factor, pero no es obligatorio. Un admin con el doble factor activado puede dar el rol de admin a otro perfil con acceso propio, confirmándolo con su código; quitarlo no se hace desde la app.
- **Tutor**: perfil adulto vinculado a uno o varios hijos mediante una relación tutor→hijo. La capacidad de ser tutor la da la relación y la puede tener cualquier perfil adulto. El rol **tutor** existe solo para quien no entrena (padre o madre que gestiona a sus hijos). Un padre que entrena es alumno y además tutor por la relación. El tutor crea a sus hijos y gestiona todo por ellos: perfil, ficha de salud, acuerdos, suscripción, reservas e inscripciones. Todos los tutores de un hijo tienen los mismos poderes. Quien crea al hijo queda vinculado; los demás tutores los vincula el admin. **Desvincular** a un tutor también lo hace el admin, nunca si deja al hijo sin tutores ni si ese tutor paga la suscripción del hijo (antes se cambia el pagador).
- **Hijo** (o **menor**): perfil alumno con menos de 18 años, creado por un tutor. Requiere fecha de nacimiento. **No tiene acceso propio**: ni email ni login. Nunca se registra por sí mismo; solo existe dentro de una cuenta familiar. Siempre tiene al menos un tutor. El tutor lo edita pero no lo borra: la baja la hace el admin.
- **Cuenta familiar**: término de UI. Es lo que ve un tutor: él mismo y sus hijos. No es una entidad del dominio.
- **Selector de sujeto**: término de UI. Elige por quién actúa ahora quien tiene hijos: un tutor (rol), entre sus hijos; un alumno con hijos, entre él mismo y ellos. Nunca ofrece a un hijo con 18 cumplidos que no ha reclamado su perfil. No es una entidad del dominio.
- **Sujeto** y **actor**: el sujeto es el perfil sobre el que recae una acción (quien entrena, quien queda inscrito, a quien se le firma). El actor es quien la hace. Coinciden salvo cuando un tutor actúa por un hijo.
- **Pagador**: perfil adulto que paga la suscripción de un alumno: el propio alumno adulto o uno de sus tutores. Cada alumno tiene su propia suscripción; no hay suscripción familiar. El pagador es quien contrata la suscripción. **Cambiar de pagador** solo lo hace el admin, a petición: elige al nuevo pagador (un tutor vinculado o el propio alumno adulto), que debe completar el pago por su cuenta antes de que acabe el periodo en curso; entonces la suscripción antigua termina y empieza una nueva igual pagada por él. Si no lo completa a tiempo, no hay cambio. Al reclamar su perfil, el pagador debe pasar a ser el propio alumno, por la misma vía. Un adulto siempre se paga a sí mismo: no existe el pagador externo de un adulto. Todo lo que paga un mismo pagador se agrupa en su cuenta de la pasarela de pago.
- **Reclamar perfil**: al cumplir 18 años, el hijo deja de estar gestionado. Para seguir entrenando, el ahora adulto recibe una invitación (de un tutor o del admin), obtiene acceso propio y conserva su historial. Hasta que lo reclama, su perfil está incompleto y su tutor solo lo ve en la lista y paga lo que ya pagaba.
- **Registro**: solo un adulto puede registrarse por sí mismo.
- *Usuario* no es término de dominio.

## Acuerdos

- **Acuerdo** (*Agreement*): documento legal que el alumno debe aceptar.
- **Tipo de acuerdo**: `data_protection`, `rights_of_image`.
- **Documento de acuerdo**: PDF de un tipo y una versión. No existe "versión" como entidad aparte.
- **Versión**: etiqueta X.Y de un documento dentro de su tipo. Sin semántica: no distingue cambios menores de mayores.
- **Ciclo de vida del documento**: borrador → publicado → retirado. Publicar uno nuevo retira el anterior del mismo tipo. Nunca se borra un documento publicado.
- **Vigente**: el único documento publicado y no retirado de un tipo.
- **Firma**: acto de aceptar un acuerdo en una versión concreta. Es un hecho histórico, solo se añade, nunca se modifica. Guarda IP y user-agent. Un mayor firma por sí mismo.
- **Firma por representación**: firma de un tutor sobre un acuerdo de un hijo. Registra firmante (el tutor, actor) y sujeto (el hijo). Basta **un** tutor vinculado. Desvincular a un tutor no invalida lo que ya firmó.
- **Re-firma**: volver a firmar tras publicarse una versión nueva. **Toda** publicación nueva obliga a re-firmar, sin importar el salto de X.Y, y bloquea de inmediato (sin periodo de gracia).
- *Consentimiento*: no es término de dominio. Solo etiqueta de UI para `data_protection` y `rights_of_image`.

## Planes y disciplinas

### Catálogo

- **Disciplina**: arte marcial o actividad que imparte la academia (p. ej. BJJ, Muay Thai). Nunca se borra si tiene historial; se desactiva.
- **Rango de edad de una disciplina**: edad mínima y máxima, opcionales e inclusive, en años cumplidos, que fija el admin (p. ej. Muay Thai Kids, 5–12). Sin rango, cualquier edad. Al contratar, elegir o cambiar de disciplina cuenta la edad de hoy y solo la máxima: un niño de 4 puede contratar una de 5–12. Al reservar, entrar en espera o ser promovido cuenta la edad el día de la sesión, mínima y máxima: ese niño reserva desde el día que cumple 5; la promoción salta (sin sacarlo de la lista) a quien no la cumple. Un perfil sin fecha de nacimiento cuenta como adulto. Lo que antes era «solo menores» es «máxima 17».
  _Evitar_: disciplina solo menores.
- **Superar la máxima**: un mes antes del cumpleaños con el que un alumno deja el rango de una disciplina que le cubre, se avisa a su tutor (o a él si no tiene). Desde ese día se cancelan sus reservas y esperas futuras de esa disciplina con motivo «fuera de edad», con aviso, y sustituirla es gratis.
- **Disciplina abierta**: disciplina que cubre cualquier suscripción, sin elegirla ni ocupar hueco del plan (p. ej. el sparring, libre para quien practique cualquier disciplina). También respeta su rango de edad.
- **Plan**: oferta del catálogo de la academia, definida por el admin: nombre, precio, periodo de cobro y **cuántas disciplinas** puede elegir el alumno (1, 2 o todas). El plan no fija qué disciplinas: las elige el alumno entre las elegibles. Kaizen es la fuente de verdad de su precio; un plan existe aunque no haya pasarela de pago.
- **Disciplinas elegibles**: lista opcional de un plan que limita entre qué disciplinas se elige. Sin lista, es elegible cualquier disciplina activa que permita la edad del alumno. No es lo mismo que "cubrir".
- **Plan solo menores**: plan que solo puede contratarse para un menor. Es opcional: por defecto un plan está abierto a todos.
- **Periodo de cobro**: cada cuánto se factura un plan. Es un valor de un conjunto cerrado (hoy solo **mensual**). Un plan tiene un único periodo y un único precio; la misma oferta en otro periodo es otro plan.
- **Precio**: precio final que paga el pagador, impuestos incluidos. Un plan de 0 € no se contrata por la pasarela.
- **Cambio de precio**: el precio de un plan es editable; el nuevo precio se aplica a todos sus suscriptores desde su siguiente facturación. Lo pagado de verdad queda en los recibos.
- **Retirar un plan**: impide contratarlo y cambiar a él. Las suscripciones vigentes siguen igual. Un plan con historial nunca se borra.
- **Catálogo**: las disciplinas y los planes activos. Lo ve cualquier perfil con sesión iniciada; solo el admin lo modifica. Los retirados solo los ve el admin (y el alumno cuya suscripción vigente está en ese plan). "Solo menores" y el rango de edad no limitan qué se ve, sino qué se contrata y se reserva.
- *Stripe Price*: no es término de dominio. Es el reflejo técnico de un plan en la pasarela.

### Suscripción

- **Suscripción**: vínculo de un alumno (sujeto) con un plan, pagado por un pagador. Tiene estado. Un alumno tiene como máximo **una** suscripción viva; para tener más disciplinas sube de plan. Las anteriores quedan como historial.
- *Cuota*: no es término de dominio. Solo etiqueta de UI para la suscripción.
- **Contratar**: el pagador elige plan y disciplinas en Kaizen, que valida los requisitos, y paga en la página de la pasarela. La suscripción existe solo cuando la pasarela confirma el pago; volver de la página de pago no da acceso por sí solo. Solo se paga con tarjeta (incluidos los monederos del móvil).
- **Periodo de facturación**: cada suscripción empieza el día en que se contrata y se renueva ese mismo día cada mes (aniversario). No hay un día de cobro común ni prorrateo inicial. «Fin de periodo» es siempre el de cada suscripción.
- **Estados de la suscripción**: son los de la pasarela de pago, sin traducción.
  - **Activa**: al corriente de pago.
  - **En periodo de gracia**: ha fallado un cobro y la pasarela sigue reintentándolo. Dura lo que dura la ventana de reintentos (2 semanas). El alumno no pierde nada mientras tanto.
  - **Impagada**: se agotaron los reintentos sin cobrar. La suscripción no se cancela: se recupera pagando el recibo pendiente. Al pasar a impagada se avisa al pagador, con el enlace para pagar ese recibo.
  - **Cancelada**: terminada. Queda como historial.
  - **Pendiente de pago en efectivo**: reservado para el pago en efectivo, que no está activo.
  _Evitar_: moroso (para el estado; es del pagador), vencida.
- **Suscripción en vigor**: la que da acceso: activa o en periodo de gracia.
- **Suscripción viva**: la que impide contratar otra para el mismo alumno: activa, en periodo de gracia o impagada. Quien tiene una impagada paga su recibo; no empieza de cero.
- **Moroso**: pagador con alguna suscripción impagada. Una en periodo de gracia no lo convierte en moroso.
- **Baja**: terminar una suscripción. Solo la hace el admin, a fin de periodo o de inmediato, y se avisa al pagador (si había una bajada programada, el aviso dice que se descarta). Una baja inmediata anula los recibos pendientes: lo no cobrado ya no se cobra y el pagador deja de ser moroso por ella. El pagador puede, por su cuenta, cambiar su tarjeta y ver sus recibos.
- **Cambio de pagador pendiente**: desde que el admin pide el cambio hasta que se resuelve. El nuevo pagador recibe un enlace a Kaizen y paga por su cuenta antes de la **fecha límite** (poco antes del fin del periodo en curso); al pagar no se le cobra nada hasta ese fin. Hay como mucho uno por suscripción, y mientras dura no se cambia ni el plan ni las disciplinas. Una bajada programada pasa a la suscripción nueva. Termina de una de cuatro formas: **traspaso**, **caducado** (no pagó a tiempo: la suscripción renueva con el pagador de siempre y se avisa al admin), **anulado** por el admin antes de pagarse, o por la baja de la suscripción. Una vez pagado ya no se anula. Si el cambio no termina en traspaso y el nuevo pagador llegó a pagar algo (solo si su pago se procesa tarde, ya pasado el fin del periodo), se le devuelve: corrige un cobro de más, no es un reembolso del servicio.
- **Traspaso**: el momento, al final del periodo, en que la suscripción antigua termina y empieza la nueva con el nuevo pagador, con el mismo plan y las mismas disciplinas (o las de la bajada programada). Las reservas no se tocan: la cobertura no se interrumpe.
- **Pago en efectivo**: reservado. No está activo; cuando se active tendrá su propio bloque.
- **Disciplinas elegidas**: las disciplinas concretas que el alumno escoge al suscribirse, tantas como permite su plan y entre las elegibles. Pertenecen a la suscripción, no al plan.
- **Cubrir**: una suscripción cubre una disciplina si está entre sus disciplinas elegidas o si el plan es de todas y la disciplina es elegible para ese alumno, o si es una disciplina abierta; siempre que el alumno no supere hoy la edad máxima de la disciplina (y, si es adulto, que el plan no sea solo menores). Cubrir da acceso ilimitado: todas las clases de esa disciplina, todos los días; solo limita el aforo de cada sesión.
- **"Todas" es dinámico**: cubre las disciplinas elegibles en cada momento; una disciplina nueva queda cubierta al darse de alta si es elegible.
- **Baja de disciplina**: al desactivarse una disciplina deja de cubrirse, y quien la tenía elegida puede sustituirla gratis y al instante por otra elegible (no cuenta como cambio de disciplina).
- **Cambio de disciplina**: sustituir una disciplina elegida por otra sin cambiar de plan. Permitido un número limitado de veces por periodo de facturación (hoy, una; puede ser cero); el límite es un parámetro de la academia. Es inmediato y sin coste, y cancela las reservas y esperas futuras de la disciplina abandonada con motivo «cambio de disciplina». Sustituir una disciplina que ya no se cubre (desactivada, o cuya edad máxima ya superó el alumno) es gratis y no cuenta para el límite. Elegir disciplinas al subir o bajar de plan no cuenta como cambio de disciplina.
- **Subir de plan** (*upgrade*): pasar a un plan más caro. Es inmediato y se cobra la parte proporcional; el cambio solo se aplica si ese cobro se paga. Cambiar de plan lo hacen el pagador actual o el admin, con la suscripción activa y sin baja programada. Al subir, el alumno puede conservar sus disciplinas y añadir otras o cambiarlas todas.
- **Bajar de plan** (*downgrade*): pasar a un plan del mismo precio o más barato. Se aplica en la siguiente facturación, sin reembolso. Hasta entonces es una **bajada programada**: hay como mucho una, una nueva la sustituye, una subida la anula y el pagador o el admin pueden anularla. Al bajar, el alumno elige las nuevas disciplinas: puede quedarse con alguna de las que ya hacía o escoger otras nuevas.
- **Al cumplir 18**: la suscripción no cambia hasta que el ahora adulto reclama su perfil. Las disciplinas cuya edad máxima supera (las de máxima 17, el día que cumple 18) se pueden sustituir gratis (ver Superar la máxima) y, si su plan es solo menores, debe elegir un plan abierto antes de reservar. Ese cambio es inmediato y con prorrateo, suba o baje.

### Cobros

- **Recibo**: justificante de un cobro, o intento de cobro, de un periodo de una suscripción, emitido al pagador. Guarda lo pagado de verdad. Lo ven el pagador, el alumno, sus tutores vinculados (también los históricos) y el admin; el profesor, no. No es una factura legal.
- **Factura**: documento fiscal legal. La emitirá en el futuro un servicio externo homologado, y se podrá descargar desde Kaizen. Hoy no existe.
  _Evitar_: factura (para un recibo).

## Perfil completo

Estado del alumno, calculado siempre a partir de los datos (un alumno recién registrado ya está incompleto):
- tiene `display_name`;
- tiene ficha de salud con contacto de emergencia;
- tiene `data_protection` y `rights_of_image` firmados en la versión vigente.

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
- **Sesión suelta**: sesión que no sale de ninguna clase (p. ej. un open mat puntual). En el panel del admin el botón dice «Clase suelta».
- **Sesión**: una ocurrencia concreta de entrenamiento en una fecha y hora, de una disciplina e impartida por un profesor. Se accede a ella porque la suscripción del alumno **cubre** su disciplina, y se **reserva**.
  Sale de una clase o es una sesión suelta. Se puede ajustar por separado (cancelarla, poner un profesor sustituto, cambiar su aforo).
  _Evitar_: clase (para una ocurrencia concreta), evento.
- **Retirar una clase**: darla de baja a partir de una fecha (por defecto, hoy; nunca pasada). Sus sesiones desde esa fecha que no han empezado se cancelan (ver «Cancelar una sesión»); las anteriores y las ya empezadas se conservan. Una clase con sesiones celebradas nunca se borra. Desactivar una disciplina retira todas sus clases y cancela sus sesiones sueltas futuras.
- **Aforo**: número de plazas de una sesión. Siempre existe y es mayor que 0; no hay sesiones ilimitadas. Nunca puede quedar por debajo de las reservas de la sesión.
- **Duración**: obligatoria en toda clase y sesión; fija la hora de fin.
- **Lugar**: texto libre opcional de una sesión (p. ej. «tatami 2»). No hay salas definidas.
- **Solape**: un profesor no puede impartir dos sesiones que se solapen en el tiempo. No se controlan solapes de lugar.
- **Profesor de la sesión**: quien la imparte: el profesor habitual de su clase o, si hay un ajuste, el **sustituto**. Las **sesiones de un profesor** son las que imparte, sustituciones incluidas. El profesor solo ve en el calendario sus sesiones y no crea ni ajusta clases ni sesiones: eso es del admin.
- **Baja de un profesor**: no se permite mientras sea profesor habitual de alguna clase no retirada o profesor de alguna sesión futura; antes hay que reasignarlas (cambio de clase, ajuste de sesión) o retirarlas.
- **Ajuste de sesión**: cambio hecho a mano en una sesión concreta que no ha empezado (cancelarla, profesor sustituto, otro inicio, también otro día, otra duración, otro aforo, otro lugar). Gana sobre los cambios de su clase, campo a campo. Las reservas siguen a su sesión, como en un cambio de clase.
- **Cambio de clase**: modificar una clase a partir de una fecha elegida (por defecto, hoy; nunca pasada ni más allá del horizonte). Se puede cambiar el profesor habitual, la hora, la duración, el aforo y el lugar; la disciplina y el día de la semana no: para eso se retira la clase y se crea otra. Se aplica a sus sesiones desde esa fecha que no han empezado, salvo en los campos que tengan un ajuste de sesión; el pasado nunca cambia. Las reservas siguen a su sesión. No se permite si deja alguna sesión afectada con menos aforo que reservas; hay que elegir una fecha a partir de la cual quepan.
- **Cambio que afecta a la sesión**: un cambio de clase o un ajuste que cambia el inicio, la duración o el profesor de una sesión programada. Quien tenía ya una reserva o estaba en espera recibe un aviso (sus tutores, si es un hijo) y puede cancelar sin que cuente como cancelación tardía hasta el inicio, por muchos cambios que se sucedan. Cambiar el lugar o el aforo no afecta a la sesión: no avisa ni exime (subir el aforo promociona la lista de espera, con su propio aviso).
- **Estado de una sesión**: **programada** o **cancelada**. No hay más estados guardados.
- **Sesión celebrada**: sesión no cancelada cuya hora de fin ya pasó. Se calcula, nunca se marca. Que se pase lista o no, no cambia que se haya celebrado.
  _Evitar_: completada, finalizada.
- **Cancelar una sesión**: anula todas sus reservas y su lista de espera con el motivo «sesión cancelada», que no cuenta como cancelación del alumno ni como falta. Se avisa a cada afectado (a sus tutores si es un hijo). El admin puede indicar un motivo, que solo ve él (nunca va en el aviso). Se puede recuperar mientras no haya empezado.
- **Recuperar una sesión**: deshacer la cancelación de una sesión que no ha empezado. Las reservas no vuelven: cada alumno vuelve a reservar; se avisa a quienes esa cancelación dejó sin reserva o sin espera. No se puede si su clase está retirada en esa fecha (se crea una sesión suelta) ni si su disciplina está desactivada.
  _Evitar_: reactivar, descancelar.
- **Cancelación retroactiva**: el admin cancela una sesión que ya ha empezado (también en curso) y que no llegó a darse, indicando siempre un motivo. Deja de contar como celebrada, anula su lista y sus asistencias, no avisa a nadie y no se recupera. No tiene plazo.
- **Deshacer un ajuste**: devolver un campo de una sesión a lo que dice su clase para esa sesión, con los cambios de clase que le aplican (el inicio, a la hora que le toca). Desde entonces el campo vuelve a seguir los cambios de su clase. Si cambia el inicio, la duración o el profesor, es un cambio que afecta a la sesión; si sube el aforo, promociona. No existe en una sesión suelta.
- **Calendario**: las sesiones de la academia. Alumnos, tutores y admin ven el calendario completo, incluidas las disciplinas con rango de edad, aunque no tengan suscripción; el profesor solo ve sus sesiones. Junto a cada sesión se indica si su suscripción la cubre para el sujeto (para un tutor, por cada hijo); ver no da derecho a reservar.
- **Evento**: actividad extraordinaria fuera del horario regular (seminario, torneo, examen de grado, quedada). No depende de cubrir: es gratis o se paga aparte, y admite a alumnos aunque su suscripción no cubra nada. Puede no tener disciplina ni profesor de la academia. A un evento uno se **inscribe**, no lo reserva. Un evento no es una sesión (ver «Eventos»).
  _Evitar_: sesión especial.

## Reservas

- **Reserva**: plaza de un alumno (sujeto) en una sesión. Ocupa aforo. Se puede volver a reservar la misma sesión tras cancelar.
  _Evitar_: inscripción (es de eventos), anular, baja.
- **Requisitos para reservar**: perfil completo (sujeto y actor) y **suscripción en vigor** que cubra la disciplina de la sesión. No hay clase suelta ni prueba: el **pase** queda aplazado.
- **Quién reserva**: el alumno adulto para sí; cualquier tutor vinculado por sus hijos (y puede cancelar lo que reservó otro tutor); el admin por cualquier alumno, con los mismos requisitos. El profesor no reserva ni cancela.
- **Ventana de reserva**: solo se reservan sesiones que empiezan dentro de los próximos N días (parámetro de la academia, por defecto 14). Las más lejanas se ven pero no se reservan. El admin no tiene ventana. Reservar y entrar en espera se cierran al inicio de la sesión; una sesión cancelada o empezada nunca se reserva.
- **Aforo** (en reservas): inviolable para todos, admin incluido. Para hacer sitio el admin sube el aforo con un ajuste de sesión, lo que promociona la lista de espera.
- **Solape de reservas**: un alumno no puede reservar (ni ser promocionado a) una sesión que se solape en el tiempo con otra que tiene reservada. Un cambio que afecta a la sesión sí puede dejarle dos reservas solapadas: no se impide ni se cancela ninguna; el aviso le deja elegir cuál cancelar.
- **En espera** (lista de espera): si la sesión está llena, el alumno queda en espera. No ocupa aforo. Puede estar en espera de una sesión que se solapa con otra que tiene reservada.
- **Promoción**: al liberarse una plaza (cancelación o subida de aforo), el primero en espera por orden de llegada pasa automáticamente a reserva y se le avisa. Ocurre hasta el inicio de la sesión. Antes se re-comprueban los requisitos: si su suscripción no cubre la sesión, sale de la lista con motivo «sin cobertura»; si tiene una reserva que se solapa, le falta el perfil completo o no tiene la edad de la disciplina el día de la sesión, se le salta y sigue en la lista. Quien es promocionado ya dentro del plazo de cancelación puede cancelar sin que sea tardía.
- **Plazo de cancelación**: hasta N antes del inicio (parámetro de la academia, por defecto 1 hora) se cancela sin consecuencias. Siempre se puede cancelar hasta el inicio.
- **Cancelación tardía**: cancelación del alumno o tutor fuera de plazo. Solo queda registrada; no hay sanción automática, el admin decide a mano.
  _Evitar_: penalización.
- **Falta**: ver «Asistencia».
- **Pérdida de cobertura**: si la suscripción deja de estar en vigor (pasa a impagada o cancelada) o deja de cubrir una disciplina (p. ej. al aplicarse una bajada de plan; lo reservado mientras estaba programada también), se cancelan sus reservas y esperas futuras no cubiertas con motivo «sin cobertura», con aviso al pagador y a sus tutores si es un hijo. No vuelven al recuperar la cobertura. Un perfil incompleto impide reservar pero no cancela lo ya reservado.
- **Aviso de cobro fallido**: cuando falla un cobro se avisa solo al pagador, nunca al hijo, en cada intento fallido. Los avisos de facturación siempre van al pagador (ver «Avisos»).
- **Motivo de cancelación**: toda reserva cancelada o espera retirada tiene exactamente uno:
  - **cancelada por el alumno** (alumno o tutor, en plazo; también fuera de plazo si la reserva es anterior a un cambio que afecta a la sesión);
  - **cancelación tardía** (alumno o tutor, fuera de plazo);
  - **cancelada por el admin** (nunca es tardía);
  - **sesión cancelada**;
  - **sin cobertura**;
  - **cambio de disciplina**;
  - **fuera de edad** (ver Superar la máxima).

## Eventos

- **Evento** (ver «Clases y sesiones»): tiene un inicio y un fin (un solo tramo, aunque dure varios días), lugar, y opcionalmente disciplina, profesor de la academia, aforo y fecha límite de inscripción. Lo crea, cambia y cancela solo el admin; se publica al crearlo y nunca se borra. Lo ve cualquier perfil con sesión iniciada.
- **Público del evento**: todos, solo menores o solo adultos, según la edad del sujeto al inscribirse.
- **Inscripción**: plaza de un alumno (sujeto) en un evento. Está **pendiente** mientras se paga, **confirmada** o **cancelada**; la pendiente ya ocupa plaza. Hay como mucho una viva por alumno y evento; tras cancelar se puede volver a inscribir.
  _Evitar_: reserva (es de sesiones).
- **Quién se inscribe**: el alumno adulto para sí, cualquier tutor vinculado por sus hijos y el admin por cualquier alumno. Nadie sin perfil: quien no tiene cuenta se registra antes. Un tutor (rol) y un profesor no se inscriben.
- **Requisitos para inscribirse**: perfil completo (sujeto y actor). No hace falta suscripción.
- **Aforo** (en eventos): opcional; sin aforo no hay límite. Sin lista de espera: un evento lleno está **completo**.
- **Cierre de inscripciones**: en la fecha límite del evento o, si no tiene, al empezar. El admin inscribe sin cierre.
- **Precio del evento**: gratis o un precio, impuestos incluidos, y opcionalmente un **precio de socio**. **Socio** es el alumno (sujeto) con suscripción en vigor al inscribirse. Lo pagado queda en la inscripción; un cambio de precio solo vale para las nuevas.
- **Pagador de una inscripción**: el adulto que la paga: el propio alumno adulto o el tutor que inscribe a su hijo. Paga una vez, en la página de la pasarela; la inscripción solo se confirma cuando la pasarela confirma el pago.
- **Invitado**: inscripción que hace el admin sin cobro.
- **Cancelar una inscripción**: el alumno o su tutor cancela, hasta el inicio, una inscripción gratis o pendiente; una pagada no la cancela él: lo pide a la academia. El admin cancela cualquiera y decide si devuelve el importe entero o nada.
- **Cancelar un evento**: lo hace el admin. Cancela todas sus inscripciones, devuelve entero todo lo pagado y avisa a los inscritos. Cambiar la fecha, la hora o el lugar no devuelve nada: se avisa y quien no pueda venir lo pide a la academia.
- **Reembolso de una inscripción**: devolución del importe entero de una inscripción pagada. Nunca parcial. Se avisa al pagador.
- **Asistencia a un evento**: lista de presentes que pasan el profesor del evento y el admin, sin cerrar ni corregir y sin check-in. No cuenta para la racha, las horas, los badges, el ranking ni los informes.
- **Ficha de salud en un evento**: la ve el profesor del evento, de sus inscritos y solo el día del evento, como en sus sesiones.

## Asistencia

- **Asistencia**: si un alumno con reserva en una sesión estuvo o no. Solo existe sobre una reserva activa: quien no reservó no tiene asistencia, aunque se presente.
  _Evitar_: check-in (para la asistencia en sí).
- **Pasar lista**: el profesor marca a los presentes de su sesión. Se puede desde el inicio de la sesión. Antes del cierre, marcar y desmarcar es libre y no deja rastro.
- **Cerrar la lista**: confirmar la lista de una sesión. Al cerrarla, toda reserva sin presente pasa a **falta**. Se puede desde el inicio de la sesión y sin límite posterior. Pasan lista y la cierran el profesor de la sesión (sustituto incluido) y el admin; ningún otro profesor.
- **Sin registrar**: reserva sin presente de una sesión cuya lista no se ha cerrado. No es falta ni presencia. Presentes, faltas y sin registrar suman todas las reservas de una sesión.
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

## Registro de jornada

- **Registro de jornada**: lo que la academia guarda de cuándo trabaja cada profesor empleado (art. 34.9 ET). Lo consultan el propio profesor, en cualquier momento, y el admin; el admin lo exporta por profesor y mes. Ningún profesor ve el de otro.
- **Tipo de relación**: si un profesor es **empleado** o **autónomo**. Lo marca el admin; hasta entonces, autónomo. Solo el empleado ficha y aparece en el registro: al autónomo nunca se le controla el horario. Quien pasa a empleado ficha desde ese momento. Solo profesores; el admin no ficha.
- **Fichaje**: hecho de que un profesor empleado **entra**, **sale**, **empieza una pausa** o **vuelve** de ella, con la hora de la academia en ese momento, nunca la del móvil. Se ficha con un botón en la app o escaneando el QR de check-in de una tablet. Sin ubicación ni biometría. Va en orden: tras entrar, salir o pausar; en pausa, solo volver; fuera, solo entrar. Un fichaje fuera de orden se rechaza.
  _Evitar_: marcaje, check-in (para el fichaje).
- **Jornada**: lo fichado desde una entrada hasta su salida, sin las pausas. Cuenta en el día (hora de Madrid) en que empezó, aunque acabe pasada la medianoche. El total del mes suma las jornadas cerradas que empezaron en él.
- **Corrección** (de un fichaje): un fichaje nunca se cambia ni se borra. Corregir es añadir un registro que apunta al fichaje (con otra hora, o anulándolo) o que añade el que falta, siempre con motivo, autor y fecha. El profesor la **solicita** y queda pendiente hasta que el admin la **aplica** o la **rechaza** con motivo; el admin también corrige directamente y entonces se avisa al profesor. Lo original sigue a la vista junto a la corrección. Una corrección que dejaría los fichajes fuera de orden no se aplica.
  _Evitar_: edición, ajuste.
- **Jornada abierta**: una entrada que a las 16 horas sigue sin salida. Se avisa al profesor y al admin para que la corrijan.
- **Conservación**: el registro se guarda 4 años; lo más antiguo se borra solo y queda constancia de cuántos registros se borraron.

## Racha y logros

- **Semana**: de lunes a domingo, en hora de Madrid.
- **Racha**: cuántas semanas seguidas ha estado un alumno **presente** en al menos una sesión, de cualquier disciplina. Cuenta un presente aunque la lista no esté cerrada; una reserva, una falta o una sesión sin registrar no cuentan. Una semana sin ningún presente la rompe (vacaciones propias, suscripción impagada o baja incluidas), salvo una semana en que la academia no celebró ninguna sesión (un cierre de la academia), que se salta: ni suma ni rompe. La semana en curso no la rompe mientras no termine. Una corrección o una cancelación retroactiva la cambian también hacia atrás. Mide la constancia, no cuánto se entrena.
  _Evitar_: racha por sesiones.
- **Racha de una disciplina**: la misma cuenta, solo con los presentes en esa disciplina; se salta la semana en que esa disciplina no dio clase (aunque la academia diera otras). Es la de sus medallas de constancia; la **racha** a secas es la general.
- **Racha actual** y **mejor racha**: la que lleva ahora y la más larga que ha tenido.
- **Horas entrenadas**: la suma de la duración de las sesiones en que un alumno estuvo presente (una clase de 1 h 30 suma 1,5). Cuenta igual que la racha: un presente aunque la lista no esté cerrada, y las correcciones la cambian hacia atrás.
- **Horas del mes**: las horas entrenadas de un mes natural (hora de Madrid), por disciplina. Una sesión cuenta en el mes en que empieza. Las horas de una disciplina abierta suman, enteras, en cada disciplina en que el alumno estuvo presente ese mes; si ese mes solo hizo la abierta, no suman en ninguna.
- **Ranking mensual**: la tabla de los alumnos de una disciplina ordenados por sus horas del mes en ella. Hay uno por disciplina, salvo las abiertas, que no tienen. No hay ranking general.
  _Evitar_: racha (para las horas), clasificación.
- **Badge**: logro de un alumno de una lista cerrada que fija la academia en Kaizen (no la edita el admin). Sale siempre de sus datos de asistencia: se tiene o no se tiene, y la fecha en que se consiguió es la del presente que cruzó el umbral. No caduca ni se pierde por dejar de entrenar; solo desaparece si una corrección o una cancelación retroactiva quita el dato que lo dio. Nadie lo da a mano.
  _Evitar_: logro manual, grado (para un badge).
- **Medalla**: cómo ve un alumno un badge de una disciplina (ADR 0022): cada disciplina en que ha estado presente, también la abierta, tiene su escalera de 11, **horas** (primera sesión y 10, 50, 100, 250, 500 y 1000 h en esa disciplina) y **constancia** (4, 12, 26 y 52 semanas de su mejor racha de esa disciplina). Las horas de una disciplina no suman en otra. Su nombre y su arte los da la temática de la disciplina.
  _Evitar_: medalla de la academia, medalla global.
- **Temática**: el aspecto de las medallas de una disciplina: nombre de cada una, forma, paleta y kanji (p. ej. Hajime no Ippo para Boxeo: cinturón de campeón). El repertorio es una lista de la academia (`medal_themes`, se amplía con una migración y su arte en `frontend/src/lib/themes/`); el admin elige una por disciplina, o ninguna (la neutra **Kaizen**). Una temática está en una sola disciplina activa a la vez; al desactivarla queda libre y la desactivada la conserva. Cambiarla solo cambia el aspecto: lo conseguido no se pierde ni se vuelve a celebrar. Hoy los nombres y el arte son los de las series (solo pruebas) y se cambian por los de género antes de producción (`docs/research/medallas-shonen.md`); los códigos no cambian.
  _Evitar_: tema, skin, set (para una temática).
- **Medalla nueva**: una (de una disciplina) que quien mira (el alumno, cada tutor o el admin, por separado) aún no ha celebrado en ese perfil, sea cual sea su fecha (una lista pasada tarde da una fecha anterior); si nunca cerró una, solo las de los últimos 14 días. Al cerrarla quedan celebradas todas las que tiene. Se celebra una vez, en Inicio o en Progreso, la más reciente y «+N» si hay más; el visto vive en el servidor, no en el dispositivo (ADR 0015).
- **Grado** (cinturón, *kruang*): no existe todavía en Kaizen; no es un badge.
- **Ranking de medallas**: el de una disciplina y de siempre, por número de medallas en ella y, empatadas, por sus horas en ella (también de las abiertas). No hay uno de toda la academia. Salen los mismos que en el mensual (quien enseña su ranking; un hijo nunca) con alguna medalla. Qué medallas tiene cada uno (y su medalla más alta junto al nombre: en Comunidad, la más alta de todas sus disciplinas, con el arte de la suya) solo se ve si enseña sus logros. Tras una medalla nueva, a quien aún no compite se le invita a enseñarlas.
- **Quién ve la racha, las horas y los badges**: siempre el propio alumno, los tutores de un hijo y el admin, sea público o no; el profesor, no. El resto de la academia, solo los de un alumno que los enseña (campos visibles ranking y logros). Un ranking mensual lo ve cualquiera con sesión iniciada y solo lista a quienes enseñan su ranking: ordena entre quienes participan, no entre todos. Un hijo nunca aparece.

## Perfil público y directorio

- **Perfil público**: la parte de un perfil que su dueño decide enseñar al resto de la academia. Es *opt-in*: todo perfil nace no público. Solo pueden serlo los **alumnos adultos con acceso propio** y los **profesores**. Nunca un hijo, tampoco el que ya cumplió 18 sin reclamar su perfil (no tiene acceso propio); ni un tutor (rol) ni el admin.
- **Público** significa visible para la academia: lo ve cualquier perfil con sesión iniciada (alumnos, tutores, profesores y admin), nunca alguien de fuera sin sesión.
  _Evitar_: público como «en internet».
- **Campos visibles**: lo que enseña un perfil público. El nombre y el papel (alumno o profesor) van siempre. El resto lo elige el dueño, campo a campo, de una lista cerrada: bio, redes sociales (en bloque), disciplinas, «miembro desde» (mes y año), **ranking** (aparecer en los rankings mensuales) y **logros** (racha actual, mejor racha y badges en su ficha). Las disciplinas de un alumno son las que cubre su suscripción en vigor (ninguna si no tiene); las de un profesor, las de las clases que imparte como profesor habitual. Ranking y logros solo tienen sentido para un alumno. Al hacerse público, solo se ve el nombre. La **foto** (B24) es un campo visible más, apagado por defecto. Nunca se enseñan, se elija lo que se elija: teléfono, email, fecha de nacimiento o edad, salud, suscripción, pagos, reservas ni el detalle de la asistencia (qué sesiones, presentes o faltas). Las horas, la racha y los badges son asistencia agregada: solo salen con su campo visible.
- **Foto de perfil** (B24, ADR 0019): una por perfil, cuadrada. La sube, cambia o quita su dueño; la de un hijo, su tutor. El admin solo la quita (por inadecuada) y el dueño o el tutor reciben un aviso sin el motivo. La ven su dueño, el tutor de un menor, el admin y el profesor de las sesiones del alumno; en el perfil público, solo si su campo está visible, y nunca la de un menor. Sin foto se enseñan las iniciales.
- **Cambio de contraseña** (B24, ADR 0020): con la sesión iniciada, pide la actual. Cierra las demás sesiones (los tokens emitidos antes dejan de valer) y avisa por email. Una cuenta solo con Google no cambia: crea su contraseña con el email de «restablecer contraseña». En producción, además, se confirmará por email y el registro verificará el email (ADR 0021).
- **Publicar** y **despublicar**: solo el dueño hace público su perfil y elige sus campos visibles; un tutor nunca lo hace por un hijo. El admin puede despublicar cualquier perfil (p. ej. por una bio ofensiva), pero no edita su contenido; el dueño puede volver a publicarlo. Un hijo que reclama su perfil empieza no público.
- **Directorio**: la lista de los perfiles públicos de la academia, ordenada por nombre. Se busca por nombre y se filtra por papel y por disciplina, pero un filtro solo mira lo que cada perfil enseña: quien oculta sus disciplinas no aparece al filtrar por disciplina. Un perfil que no es público no se distingue de uno que no existe.
- **Qué se ve de un perfil que no es público**: todo, el propio perfil, sus tutores (el de un hijo) y el admin. El profesor, solo el nombre de los alumnos que han reservado alguna de sus sesiones. El nombre del profesor de una sesión lo ve cualquiera con sesión iniciada, sea público o no: es parte del horario, no una ficha.

## Informes

- **Informe**: vista agregada de la actividad de la academia para el admin o el profesor. El profesor solo ve las sesiones que imparte, y solo en cifras (nunca el desglose por alumno), y nunca nada de dinero. Ningún informe enseña salud, edad ni fecha de nacimiento.
- **Foto diaria**: el estado de las suscripciones al cierre de cada día (cuántas activas, en periodo de gracia e impagadas, altas, bajas e ingreso mensual recurrente). Se toma una vez por la noche y no cambia nunca después: es lo que había ese día. Un día sin foto es un hueco («sin dato»); no se rellena después.
  Lo demás (asistencia, ocupación, horas) no se fotografía: se calcula siempre sobre los datos actuales, así que una corrección o una cancelación retroactiva cambian también los informes pasados.
- **Alta** y **baja** (en informes): una suscripción que se contrata o que termina (ver «Baja»). Un traspaso no es ni una baja ni un alta: la cobertura sigue.
- **Ingreso mensual recurrente** (MRR): la suma de los precios de las suscripciones en vigor. Las impagadas no suman. La foto lo sigue guardando, pero la app no lo enseña: los ingresos se ven en Stripe.
- **Alumno que entrenó** (en un periodo): un alumno, también un hijo, con al menos una asistencia «presente» en una sesión no cancelada que empieza dentro del periodo, contado en días de Madrid. Cada alumno cuenta una vez por periodo, entrene cuantas veces entrene. Cuenta aunque la lista no se haya cerrado; los eventos no cuentan. Como el resto de la asistencia, se calcula sobre los datos actuales, nunca de la foto.
  _Evitar_: activo (un alumno activo es el que tiene una suscripción en vigor).
- **Ocupación**: plazas reservadas entre el aforo de las sesiones celebradas. Una reserva que acabó en falta ocupa igual; quién vino lo mide la asistencia. Las sesiones canceladas, también las retroactivas, no cuentan; una sesión cuenta en el mes de Madrid en que empieza.

## Avisos

- **Aviso**: comunicación a uno o varios perfiles (sus **destinatarios**) de algo que les afecta: un cobro fallido, una reserva cancelada, una renovación… Queda registrado aunque no llegue a enviarse.
  _Evitar_: notificación (para el aviso; es la del navegador o el móvil).
- **Canal**: vía por la que se entrega un aviso: **email** o **push**. Cada tipo de aviso tiene sus canales; un mismo aviso puede ir por varios.
- **Aviso de facturación**: aviso sobre el dinero de una suscripción (cobro fallido, impagada, baja, cambio de plan…). Va siempre al **pagador**, nunca al hijo, y siempre y solo por **email** (nunca por push). Es un email de servicio: no se puede dar de baja de él. Nunca incluye datos de salud, edad ni fecha de nacimiento.
- **Aviso de reservas**: aviso sobre una reserva o una espera (sin cobertura, promoción, sesión cancelada, sesión recuperada, cambio de disciplina, cambio que afecta a la sesión). Va al alumno o, si es un hijo, a todos sus tutores, por push. Caduca al empezar la sesión: lo que llega tarde ya no se envía. Si un mismo cambio afecta a varias reservas de un alumno, sale un solo aviso con todas; caduca al empezar la última y solo cuenta las que aún no han empezado.
- **Aviso de eventos**: aviso sobre una inscripción (evento cambiado de fecha, hora o lugar, evento cancelado, inscripción cancelada por el admin). Como los de reservas: al alumno o a sus tutores, por push, y caduca al empezar el evento. El reembolso de una inscripción es un aviso de facturación al pagador de esa inscripción. No se avisa de un evento nuevo.
- **Aviso de re-firma**: al publicarse una versión nueva de un acuerdo, se avisa a quien queda bloqueado: quien había firmado la versión anterior y sigue con una suscripción viva (por un hijo, sus tutores). No se avisa por un hijo con 18 cumplidos sin reclamar su perfil, ni en la primera publicación de un tipo. Por push, como los de reservas.
- **Dispositivo de push**: navegador o móvil en el que un perfil acepta recibir push. Un perfil puede tener varios; cada uno es de un solo perfil a la vez (si otra persona inicia sesión y acepta en él, pasa a ser suyo). Deja de serlo al cerrar sesión o cuando el navegador lo retira. No es la tablet.
  _Evitar_: dispositivo (a secas).
- **Email de respaldo**: un aviso por push le llega por email a quien no tiene ningún dispositivo de push cuando se crea el aviso. Es un email de servicio, como los de facturación.
- **Entrega**: el envío de un aviso a uno de sus destinatarios por un canal. Se reintenta un tiempo y después queda **fallida**; una entrega fallida no se vuelve a enviar (el aviso ya habría perdido sentido): el admin la ve en su panel y, si importa, avisa a la persona por otro medio.
- **Avisos de la academia**: los avisos cuyo destinatario es el admin (riesgo de fraude o disputa, un cobro duplicado reembolsado, un cambio de pagador caducado, una corrección de fichaje solicitada, una jornada abierta). No se le entregan: los lee en su panel.
- **Quién no se avisa**: quien provoca el aviso no se avisa a sí mismo (p. ej. el tutor que cambia la disciplina de su hijo; los demás tutores, sí). El admin no recibe avisos por email ni push: los consulta en su panel. El profesor solo recibe los del registro de jornada (una corrección del admin y la jornada abierta), por email. Las disputas y los avisos de fraude los notifica además la pasarela de pago a la cuenta.
- **Contenido**: un push se ve en la pantalla de bloqueo: lleva el nombre del alumno y lo imprescindible de la sesión o del acuerdo, nunca salud, edad ni fecha de nacimiento.
- **Sin preferencias**: no se elige qué avisos recibir. Para dejar el push basta con quitarle el permiso al navegador; entonces llega el email de respaldo.
- **Idioma**: los avisos, como la app, solo en español.
