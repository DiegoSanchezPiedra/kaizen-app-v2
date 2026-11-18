# El admin con MFA puede generar códigos de recuperación nuevos

Decisión del 2026-11-18 (rediseño de Cuenta, grupo 7). Desarrolla el [ADR 0016](0016-mfa-del-admin-opcional-y-fomentado.md)
(MFA del admin) y sigue la confirmación de B20 (contraseña o login reciente).

Antes, los 10 códigos de recuperación solo se veían al activar el MFA. Si el admin los perdía, los gastaba o sospechaba que
alguien los había visto, la única salida era que quien administra el servidor le quitara el MFA a mano.

- **Endpoint** `POST /auth/mfa/recovery-codes { password }` → `201 { recovery_codes }`. Solo admin y con el MFA activo
  (`409 mfa_not_enabled`). Pide lo mismo que empezar el MFA (`assertMfaReauth`): la contraseña actual (`400 invalid_field`,
  `wrong_password`) o, en una cuenta solo con Google, un login de hace ≤ 10 min (`403 reauth_required`). Con el límite del login.
- **Efecto**: sustituye todos los códigos (también los no usados); los anteriores dejan de valer al momento. El secreto TOTP no
  cambia, así que la app de autenticación sigue igual.
- **Sesiones**: no se cierran. No cambia el factor ni la contraseña (ADR 0020 no aplica); quien tiene el token ya pasó el MFA.
- **Auditoría**: `audit_log` `auth.mfa_recovery_regenerate`, que el panel enseña en Auditoría › Acceso con «Generó códigos de
  recuperación nuevos» (junto a `auth.mfa_enable` y `auth.password_change`, que antes salían sin traducir).
- **Interfaz**: en Cuenta, con el MFA activo, «Generar códigos nuevos» abre un diálogo: confirmar con la contraseña, ver los 10
  códigos (copiar o descargar `.txt`) y «Los he guardado» para cerrarlo. Los códigos viven solo en el estado del diálogo: ni
  React Query ni almacenamiento.

Descartado: **desactivar el MFA** desde la app. Quitar el segundo factor de la única cuenta con acceso a todo es justo lo que
haría quien robase la sesión; perder el móvil y los códigos sigue resolviéndose fuera de la app.
