# Cambiar o restablecer la contraseña invalida los tokens emitidos antes

Decisión del 2026-11-06, en el diseño de B24.

Los tokens duran 7 días (12 h el del admin) y no hay sesiones en el servidor (ADR 0014). Sin nada más, un token robado sigue
valiendo aunque se cambie la contraseña.

Se hace así:

- `auth_credentials.credentials_changed_at` (nula al empezar). `requireAuth` ya lee la base en cada petición, para el rol;
  ahora además rechaza con `401 session_revoked` un token cuyo `iat` (la hora a la que se emitió, que ya lleva todo JWT) sea
  anterior a esa hora.
- Cambiar la contraseña (`POST /me/password`) o restablecerla con el email (B18.0) la pone a la hora de la base. La sesión
  desde la que se cambia recibe un token nuevo con ese mismo `iat` (de la base, para que el reloj del servidor no importe) y
  sigue abierta; las demás se cierran.
- Con la columna nula (todo lo de antes de esto), ningún token se rechaza: desplegar no cierra la sesión de nadie.

## Considered Options

- **Una versión en el token (`tv`)**: obliga a que todo lo que firma tokens (login, Google, MFA, registro) lea y pase la
  versión. La hora del cambio frente al `iat` funciona sin tocar a quien firma.
- **Sesiones en el servidor o lista de tokens revocados**: más tablas y limpieza para lo mismo.
- **Tokens más cortos con renovación**: no cierra al momento y cambia el login de todos los clientes.
- **No invalidar**: el cambio de contraseña no protegería de una sesión robada durante 7 días.

## Consequences

- Una lectura más por petición, en la misma consulta que ya lee el rol.
- El `iat` va en segundos: un token emitido en el mismo segundo que el cambio, antes de él, seguiría valiendo. Se asume.
- «Cerrar sesión en todos los dispositivos» se podría añadir poniendo la hora sin cambiar la contraseña.
