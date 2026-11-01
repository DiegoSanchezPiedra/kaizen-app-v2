# El MFA del admin es opcional y el panel lo fomenta; el rol admin nunca se da ni se quita desde la app

El panel (B19) da al admin la gestión de usuarios y roles, las bajas, los cambios de plan y de pagador, los documentos legales y la auditoría, y la RLS le deja leer casi todo (también fichas de salud de menores). Aun así, **el MFA del admin sigue siendo opcional** (como en B4): no tenerlo no impide entrar ni usar el panel. Decidido por el usuario el 2026-11-01: un admin que pierde el móvil o los códigos de recuperación no puede quedarse fuera de la academia, y los tokens de admin que ya existen siguen valiendo.

Lo que sí se hace:

- **Se fomenta**: mientras `GET /auth/me` diga `mfa_enabled: false`, Inicio y Cuenta muestran un aviso fijo («Activa el doble factor: protege los datos de la academia») con un botón a Configurar el MFA. No bloquea nada y desaparece al activarlo.
- **El token del admin caduca a las 12 horas** (`ADMIN_JWT_EXPIRES_IN`), no a los 7 días del resto: el panel se usa en un ordenador de recepción, no en un móvil personal. Los tokens emitidos antes siguen hasta su caducidad.
- **El panel nunca da ni quita el rol `admin`** (`PUT /admin/profiles/:id/role` lo rechaza). Crear un admin, quitarle el rol o resetear su MFA sigue siendo a mano en la base de datos, con acceso al servidor.

## Considered Options

- **MFA obligatorio exigido por la API** (un claim `mfa: 'verified'` en el token y `requireAuth` rechazando al admin sin él): es lo más seguro, pero bloquea al admin que pierde el segundo factor, invalida los tokens de admin al desplegar y obliga a cambiar los 14 scripts de test que los firman. Descartado.
- **MFA obligatorio solo en el frontend**: bloquea igual al admin y no protege de un token robado o de `curl`.
- **Sin aviso**: el MFA existe desde B4 y nadie lo activaría.
- **Que el panel gestione admins**: un admin con la sesión robada podría crear otro admin persistente. Hay uno o dos admins: no compensa.

## Consequences

La seguridad del panel depende de la contraseña del admin (o de su cuenta de Google) mientras no active el MFA; las 12 horas acotan cuánto vale un token robado. Hacer el MFA obligatorio más adelante es posible con la opción descartada de arriba, al precio que dice.
