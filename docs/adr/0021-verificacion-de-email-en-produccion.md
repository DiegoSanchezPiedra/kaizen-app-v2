# En producción, el email se verifica al registrarse y el cambio de contraseña se confirma por email

Decisión del 2026-11-06, en el diseño de B24. **Solo diseñada**: se construye en su propio bloque antes de producción.

- **Registro**: la cuenta nace sin verificar y recibe un enlace de un solo uso. Las cuentas creadas con Google cuentan como
  verificadas (Google ya lo comprueba).
- **Sin verificar** se puede entrar, completar el perfil y ver el calendario, pero no reservar, contratar una cuota ni
  inscribirse en un evento: lo que cuesta dinero u ocupa plaza espera a la verificación.
- **Cambiar la contraseña** con la sesión iniciada pedirá, además de la actual, confirmar con un enlace del email. Recuperarla
  ya pasa por el email (B18.0).
- **Piezas que ya existen y se reutilizan**: la columna `auth_credentials.email_verified` (de la migración 002, sin usar todavía), los tokens de un solo uso con solo su SHA-256 guardado (`password_resets`,
  migración 025), el envío directo de emails (`send`) y la invalidación de tokens del ADR 0020.

## Considered Options

- **Construirlo ya, apagado con un ajuste**: código sin usar que envejece antes de encenderse.
- **Bloquear la cuenta entera hasta verificar**: impide completar el perfil y probar la app; no hace falta para proteger nada.

## Consequences

- Hasta ese bloque, el staging y el desarrollo funcionan sin verificación; B24 deja el cambio de contraseña con la actual y un
  email de aviso.
