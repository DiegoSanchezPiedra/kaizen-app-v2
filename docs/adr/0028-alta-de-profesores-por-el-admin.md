# Los profesores los da de alta el admin, con correo corporativo y enlace de un solo uso

Decisión del 2026-11-13 (migración 064). Desarrolla el [ADR 0001](0001-rol-unico-por-perfil.md).

- **Dos perfiles, no dos roles**: un profesor que también entrena tiene un perfil de alumno (email personal, cuota, reservas) y
  otro de profesor (correo corporativo). No hay vínculo entre ambos en la BD.
- **Correo corporativo**: lo crea el admin a mano en el proveedor (Zoho). La app solo lo recibe y exige que sea del dominio
  `CORPORATE_EMAIL_DOMAIN` (minúsculas, exacto tras la última `@`, sin subdominios). Los emails los envía el transporte configurado (Brevo, `EMAIL_TRANSPORT=brevo`; también existen `resend` y `log`), no Zoho.
  Fuera de producción, sin la variable no se valida el dominio; con `NODE_ENV=production` la app no arranca sin ella.
- **Alta** (`POST /admin/trainers`): nombre, correo corporativo y tipo de relación (`employee`/`self_employed`, por defecto autónomo).
  Sin contraseña temporal: se envía un enlace de un solo uso (72 h, 32 bytes aleatorios; en la BD solo el SHA-256).
  Reenviar invalida el anterior. Aceptarlo fija la contraseña y marca `email_verified`. Reutiliza `password_resets`
  (columna `kind`: `reset`|`invite`) y `POST /auth/password/reset`.
- **Registro público**: rechaza el dominio corporativo (`409 email_domain_reserved`). `profesor` deja de ser destino de
  `PUT /admin/profiles/:id/role`; si el perfil ya es profesor, `409 trainer_role_locked`.
- **Autenticación**: solo email y contraseña. `loginGoogle` rechaza perfiles profesor y el dominio corporativo (no se vincula
  `google_sub` por coincidencia de email).
- **Ciclo de vida**: editar, desactivar, reactivar; nunca borrar (el registro de jornada se conserva 4 años). Desactivar da
  `409 trainer_has_sessions` si es profesor habitual de una clase activa o de una sesión futura (misma comprobación que
  `changeRole`). Un desactivado no entra, no recibe restablecer y su sesión viva muere en la siguiente petición
  (`requireAuth` lee `auth_credentials.disabled_at`).
- **Cambiar el correo** (`PATCH /admin/trainers/:id { email }`) conserva id e historial y anula contraseña y `google_sub`,
  cierra las sesiones y envía una invitación nueva. Es también la vía para convertir en sitio a un profesor existente.
- **Un solo nivel de admin.** Todo en `audit_log` (`trainer.create|invite|update|deactivate|reactivate`), solo ids, nunca el email.
  Las escrituras son funciones SECURITY DEFINER que comprueban dentro que quien llama es admin; `disabled_at` es columna
  protegida (`app_user` la lee, no la escribe).
- **Permisos del profesor sin cambios** (`CONTEXT.md`).

## Riesgos aceptados

- Profesor sin 2FA con fichas de salud de menores (2FA del profesor fuera de alcance). Mitigación operativa: 2FA de Zoho obligatorio.
- Un buzón Zoho comprometido es una cuenta tomada.
- El admin no necesita MFA para crear profesores (endurecimiento opcional: exigir su código). Desde el [ADR 0032](0032-beta-cerrada-registro-cerrado-y-alta-por-admin.md) tampoco lo pide dar el rol de admin; y el reenvío de la invitación devuelve `200 { invite_url }` en vez de `204`.

## Antes de producción

1. Contratar el dominio corporativo y Zoho; crear los buzones con 2FA de Zoho.
2. Verificar SPF/DKIM del dominio de envío en Resend (hoy `EMAIL_FROM` es `onboarding@resend.dev`).
3. Fijar `CORPORATE_EMAIL_DOMAIN` y `EMAIL_TRANSPORT=brevo` (con `log`, el enlace queda en `emails.log`: solo local).
4. Convertir a los profesores reales con `PATCH /admin/trainers/:id { email }` (conserva id, clases, sesiones y fichajes) y comprobar que cada uno acepta su invitación.
5. Probar una invitación real de extremo a extremo (llega al buzón Zoho, el enlace fija la contraseña, el profesor entra).
