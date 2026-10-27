# CONTEXT — Vocabulario de dominio de Kaizen

Solo términos de dominio. Sin detalles de implementación.

## Identidad

- **Perfil**: la persona. Es el único concepto de identidad. En columnas nuevas la FK a la persona se llama siempre `profile_id`; `student_id`, `trainer_id`, `user_id` y `actor_id` ya existentes se leen como "el perfil en ese papel".
- **Rol**: papel de un perfil. Roles: **alumno**, **profesor**, **admin**, **tutor**. Cada perfil tiene exactamente **un** rol. El multi-rol queda aplazado hasta que exista un caso real.
- **Alumno**: perfil que entrena.
- **Profesor**: perfil que imparte clases.
- **Admin**: perfil que gestiona la academia.
- **Tutor**: perfil adulto vinculado a uno o varios hijos mediante una relación tutor→hijo. La capacidad de ser tutor la da la relación y la puede tener cualquier perfil adulto. El rol **tutor** existe solo para quien no entrena (padre o madre que gestiona a sus hijos). Un padre que entrena es alumno y además tutor por la relación. El tutor crea a sus hijos y gestiona todo por ellos: perfil, ficha de salud, acuerdos, cuota, reservas e inscripciones. Todos los tutores de un hijo tienen los mismos poderes. Quien crea al hijo queda vinculado; los demás tutores los vincula el admin.
- **Hijo** (o **menor**): perfil alumno con menos de 18 años, creado por un tutor. Requiere fecha de nacimiento. **No tiene acceso propio**: ni email ni login. Nunca se registra por sí mismo; solo existe dentro de una cuenta familiar. Siempre tiene al menos un tutor. El tutor lo edita pero no lo borra: la baja la hace el admin.
- **Cuenta familiar**: término de UI. Es lo que ve un tutor: él mismo y sus hijos. No es una entidad del dominio.
- **Sujeto** y **actor**: el sujeto es el perfil sobre el que recae una acción (quien entrena, quien queda inscrito, a quien se le firma). El actor es quien la hace. Coinciden salvo cuando un tutor actúa por un hijo.
- **Pagador**: perfil adulto que paga la cuota de un alumno: el propio alumno adulto o uno de sus tutores. Cada alumno tiene su propia cuota; no hay cuota familiar.
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
- *Seguro*: fuera de B4.5. La tabla heredada `subscription_agreements` (con `insurance_type`) está huérfana; se decide su destino en B10/B12.

## Perfil completo

Estado del alumno, calculado siempre a partir de los datos (un alumno recién registrado ya está incompleto):
- tiene `display_name`;
- tiene ficha de salud con contacto de emergencia;
- tiene los 3 acuerdos firmados en la versión vigente.

Es el requisito para reservar (B7) y pagar (B10). Profesor y admin siempre están completos. Un **tutor** (rol) está completo con `display_name` y su propio `data_protection` (no entrena: no necesita ficha, `waiver` ni `rights_of_image`). `missing` es la lista de lo que falta: `display_name`, `health_info`, `emergency_contact`, `waiver`, `data_protection`, `rights_of_image`.

Cuando un tutor actúa por un hijo, deben estar completos **los dos**: el hijo (sujeto) y el tutor (actor).

Para un **hijo**, los acuerdos los firma y la ficha la rellena un tutor vinculado. Al cumplir 18 años los poderes del tutor caen y las firmas del tutor dejan de contar: el perfil queda incompleto hasta que el ahora adulto reclame su perfil, firme los 3 acuerdos y confirme su ficha. El estado se calcula con la fecha de nacimiento, sin ningún proceso que cambie datos.

**Fecha de nacimiento y Google**: el registro local la exige y debe ser de un adulto. El alta con Google no la trae: queda vacía y el perfil se trata como adulto hasta que el onboarding («Completar Perfil») la pide; si declara ser menor, se rechaza y debe darlo de alta un tutor.
