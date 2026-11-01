# El admin solo opera con el MFA verificado, y es la API la que lo exige en el token

El panel (B19) da al admin la gestión de usuarios y roles, las bajas, los cambios de plan y de pagador, los documentos legales y la auditoría, y la RLS le deja leer casi todo (también fichas de salud de menores). Hasta ahora el MFA del admin era opcional (B4): un admin sin MFA recibía un token completo. Desde B19 **el MFA es obligatorio para operar como admin, y lo comprueba la API**, no solo el frontend:

- El token que sale de `POST /auth/mfa/verify` lleva `mfa: 'verified'`. `POST /auth/mfa/activate`, que valida un código TOTP, devuelve también un token nuevo con ese claim (así quien acaba de configurarlo no tiene que volver a entrar).
- `requireAuth` rechaza con `403 mfa_setup_required` cualquier token de rol `admin` sin ese claim, **salvo** en `GET /auth/me`, `POST /auth/mfa/setup` y `POST /auth/mfa/activate`. Es una lista de permitidas, no de prohibidas: una ruta nueva queda cerrada por defecto, también las que no viven en `/admin` (`/sessions/calendar`, `/bookings`, `/me/*`) y que la RLS abre al admin.
- El token del admin caduca a las **12 horas** (`ADMIN_JWT_EXPIRES_IN`), no a los 7 días del resto: el panel se usa en un ordenador de recepción, no en un móvil personal.
- **El panel nunca da ni quita el rol `admin`** (`PUT /admin/profiles/:id/role` lo rechaza). Crear un admin, quitarle el rol o resetear su MFA si pierde el móvil y los códigos de recuperación sigue siendo a mano en la base de datos, con acceso al servidor.

Un admin creado a mano entra con su contraseña, recibe un token sin el claim, y lo único que puede hacer es configurar el MFA.

## Considered Options

- **Exigirlo solo en el frontend** (llevar al admin sin MFA a configurarlo): un token robado o un `curl` se lo saltan, y la RLS le da todo al rol `admin`.
- **Comprobar `user_mfa.mfa_enabled` en cada petición del admin**: una consulta más por petición, y no prueba que *esta* sesión pasara por el segundo factor (un token emitido antes de activarlo seguiría valiendo).
- **Poner el control en `requireRole('admin')`**: deja fuera las rutas de otros roles que también admiten al admin y las que solo llevan `requireAuth`, donde la RLS sigue viendo `role = admin`.
- **Que el panel gestione admins**: un admin con la sesión robada podría crear otro admin persistente. Hay uno o dos admins: no compensa.

## Consequences

Los tokens de admin emitidos antes de B19 dejan de valer en cuanto se despliega (hay que volver a entrar). Los scripts de test que firman tokens de admin a mano tienen que añadir el claim. Quitar la exigencia después es fácil; lo difícil sería ponerla con admins acostumbrados a entrar sin MFA. Sin revocación de tokens en el servidor, un admin degradado a mano conserva su rol hasta 12 horas.
