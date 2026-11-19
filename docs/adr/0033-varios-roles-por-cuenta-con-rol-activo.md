# Varios roles por cuenta, con un rol activo

Decisión del 2026-11-19 (migración 073). Sustituye la regla «un perfil, un rol» de CONTEXT y la de que «un profesor que también entrena
tiene otro perfil» (ADR 0028). Desarrolla el [ADR 0032](0032-beta-cerrada-registro-cerrado-y-alta-por-admin.md).

- **Roles asignados**: un perfil tiene uno o varios de alumno, tutor, profesor y admin (`user_roles`, una fila por rol,
  `UNIQUE (user_id, role)`). Todo perfil tiene al menos uno: la migración da una fila `alumno` explícita a quien no tenía ninguna.
- **Rol activo**: la sesión usa un solo rol a la vez. El JWT sigue llevando `role`, que es el activo; `requireAuth` comprueba en cada
  petición que sigue asignado (si no, `401 role_revoked` y el frontend cierra la sesión con «tu acceso ha cambiado») y RLS sigue leyendo un único `app.current_role`. No se suman permisos: cada rol ve su
  interfaz de siempre. Se descartó sumar permisos porque obligaba a reescribir las políticas RLS y mezclaba la interfaz de admin con
  la de alumno, con más superficie de escalada.
- **Cambiar de rol**: `POST /auth/role { role }` da un token nuevo si el rol está asignado. Conserva el doble factor del token actual
  y recalcula la caducidad (la de admin es más corta). Se guarda en `profiles.last_role`; el login entra con el último usado o, si ya no
  lo tiene, con el de mayor prioridad: admin > profesor > tutor > alumno.
- **Asignar y quitar** (`POST /admin/profiles/:id/roles`, `DELETE /admin/profiles/:id/roles/:role`): solo el admin, nunca sobre su
  propio perfil. Quedan `profile.role_add` y `profile.role_remove` en `audit_log`. Reglas:
  - un hijo solo es alumno;
  - profesor no se da ni se quita aquí: se da con el **Alta de profesor** (ADR 0028, correo corporativo y tipo de relación) y se
    desactiva desde Profesores. A un profesor sí se le añaden alumno, tutor o admin;
  - admin no se quita desde la app;
  - no se quita alumno con una suscripción viva ni profesor con sesiones futuras;
  - siempre queda al menos un rol.
- **Profesor que entrena**: una cuenta con correo corporativo puede ser profesor y alumno. No puede reservar una sesión que imparte él.
- **Reversa**: bajar la 073 deja a cada perfil con su rol de mayor prioridad; los demás se pierden.

- **Cambiar de rol no renueva la sesión**: el token nuevo conserva el `iat` del actual. Si con él naciera caducado (pasar a admin,
  12 h, desde una sesión más vieja), responde `401 reauth_required` y el siguiente login entra ya con ese rol.
- **Avisos y comunicados**: quien es admin o profesor pero también alumno o tutor los recibe como alumno o tutor.
- **Desactivar a un profesor** corta la cuenta entera, también sus otros roles: la desactivación es de la cuenta (ADR 0028).

## Riesgos aceptados

- Un admin con sesión robada puede darse a otro perfil cualquier rol (como en el ADR 0032); no puede tocar el suyo. `audit_log` lo registra.
