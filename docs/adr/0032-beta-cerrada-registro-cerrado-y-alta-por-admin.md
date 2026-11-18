# Beta cerrada: registro cerrado y alta de usuarios por el admin, sin MFA

Decisión del 2026-11-18 (migración 072). Desarrolla el [ADR 0028](0028-alta-de-profesores-por-el-admin.md).

- **Registro cerrado**: `REGISTRATION_OPEN` (`true`/`false`); sin ella, abierto fuera de producción y **cerrado con `NODE_ENV=production`**.
  Cerrado, `POST /auth/register` y el alta nueva por Google dan `403 registration_closed`; las cuentas ya vinculadas siguen entrando.
- **Alta por el admin** (`POST /admin/users`): alumno, tutor o admin, con nombre, email (no del dominio corporativo de los
  profesores) y fecha de nacimiento de adulto (opcional solo para el admin). Mismo mecanismo que los profesores: sin contraseña, invitación
  de 72 h en `password_resets` (`kind` `invite`; en la BD solo el SHA-256), aceptar con `POST /auth/password/reset`, que verifica el
  email. Las escrituras son funciones `SECURITY DEFINER` (`admin_create_user`, `admin_user_invite`) que comprueban dentro que quien
  llama es admin y dejan `profile.create` y `profile.invite` en `audit_log` con ids y rol, nunca el email.
- **Enlace copiable**: el email sale tras el COMMIT y la respuesta trae también `invite_url` (`Cache-Control: no-store`), para que el admin lo
  copie si el correo no llega. Lo mismo en `/admin/trainers` (el reenvío pasa de `204` a `200 { invite_url }`). El enlace no se loguea
  ni va a `audit_log`. Reinvitar (`POST /admin/users/:id/invite`) solo a quien nunca activó la cuenta (`invite_pending` en la ficha).
- **Tutor**: nace con `can_create_children` (ADR 0027). **Menores**: solo los crea el tutor; el admin no da de alta menores.
- **Sin MFA** para crear usuarios ni para dar el rol admin: `changeRole` ya no pide el código y la migración 072 quita la exigencia
  del doble factor de las políticas de `user_roles` (la 051). Quitar admin sigue sin hacerse desde la app.

## Riesgos aceptados

- Una sesión robada de un admin crea admins (antes hacía falta su código del doble factor). El `audit_log` registra quién y cuándo.
- El enlace de invitación viaja en la respuesta y en el email: quien lo vea antes que el invitado entra como él.
