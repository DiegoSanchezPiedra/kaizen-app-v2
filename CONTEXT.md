# CONTEXT — Vocabulario de dominio de Kaizen

Solo términos de dominio. Sin detalles de implementación.

## Identidad

- **Perfil**: la persona. Es el único concepto de identidad. En columnas nuevas la FK a la persona se llama siempre `profile_id`; `student_id`, `trainer_id`, `user_id` y `actor_id` ya existentes se leen como "el perfil en ese papel".
- **Rol**: papel de un perfil. Roles: **alumno**, **profesor**, **admin**, **tutor**. Cada perfil tiene exactamente **un** rol. El multi-rol queda aplazado hasta que exista un caso real.
- **Alumno**: perfil que entrena.
- **Profesor**: perfil que imparte clases.
- **Admin**: perfil que gestiona la academia.
- **Tutor**: perfil vinculado a uno o varios menores mediante una relación tutor→menor. La capacidad de ser tutor la da la relación y la puede tener cualquier perfil. El rol **tutor** existe solo para quien no entrena (padre o madre que gestiona al menor). Un padre que entrena es alumno y además tutor por la relación.
- **Menor**: perfil alumno con menos de 18 años. Requiere fecha de nacimiento. Tiene login propio, pero no firma acuerdos ni edita su ficha de salud: lo hace un tutor vinculado.
- *Usuario* no es término de dominio.

## Acuerdos

- **Acuerdo** (*Agreement*): documento legal que el alumno debe aceptar.
- **Tipo de acuerdo**: `waiver` (exención de responsabilidad), `data_protection`, `rights_of_image`.
- **Documento de acuerdo**: PDF de un tipo y una versión. No existe "versión" como entidad aparte.
- **Versión**: etiqueta X.Y de un documento dentro de su tipo. Sin semántica: no distingue cambios menores de mayores.
- **Ciclo de vida del documento**: borrador → publicado → retirado. Publicar uno nuevo retira el anterior del mismo tipo. Nunca se borra un documento publicado.
- **Vigente**: el único documento publicado y no retirado de un tipo.
- **Firma**: acto de aceptar un acuerdo en una versión concreta. Es un hecho histórico, solo se añade, nunca se modifica. Guarda IP y user-agent. Un mayor firma por sí mismo.
- **Firma por representación**: firma de un tutor sobre un acuerdo de un menor. Registra firmante (el tutor) y sujeto (el menor). Basta **un** tutor vinculado. Desvincular a un tutor no invalida lo que ya firmó.
- **Re-firma**: volver a firmar tras publicarse una versión nueva. **Toda** publicación nueva obliga a re-firmar, sin importar el salto de X.Y, y bloquea de inmediato (sin periodo de gracia).
- *Consentimiento*: no es término de dominio. Solo etiqueta de UI para `data_protection` y `rights_of_image`.
- *Seguro*: fuera de B4.5. La tabla heredada `subscription_agreements` (con `insurance_type`) está huérfana; se decide su destino en B10/B12.

## Perfil completo

Estado del alumno, calculado siempre a partir de los datos (un alumno recién registrado ya está incompleto):
- tiene `display_name`;
- tiene ficha de salud con contacto de emergencia;
- tiene los 3 acuerdos firmados en la versión vigente.

Es el requisito para reservar (B7) y pagar (B10). Solo aplica al rol alumno; profesor, admin y tutor siempre están completos. `missing` es la lista de lo que falta: `display_name`, `health_info`, `emergency_contact`, `waiver`, `data_protection`, `rights_of_image`.

Para un **menor**, los datos de salud y los acuerdos los aporta un tutor vinculado. Al cumplir 18 años las firmas del tutor dejan de contar y el perfil queda incompleto hasta que el propio alumno firme los 3 acuerdos y confirme su ficha. El estado se calcula con la fecha de nacimiento, sin ningún proceso que cambie datos.
