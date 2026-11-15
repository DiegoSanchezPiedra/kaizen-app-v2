# Las direcciones que rebotan o se quejan se suprimen, avisadas por un webhook de Brevo

Decisión del 2026-11-15 (migración 065). Desarrolla el [ADR 0008](0008-avisos-outbox-y-worker.md) (outbox de avisos).

Antes, una dirección que rebotaba se reintentaba (hasta 6 veces por entrega) y dañaba la reputación del dominio de envío.

- **Webhook** `POST /webhooks/brevo` (`src/routes/webhooks.js`, montado antes de `express.json`; nginx lo expone como
  `/api/webhooks/brevo`). Se registra en Brevo por API (`POST /v3/webhooks`, tipo `transactional`, eventos de rebote, bloqueo,
  spam, inválido y baja), no desde el panel.
- **Autenticación**: Brevo no firma el cuerpo. Admite cabeceras propias, `auth` bearer, usuario y contraseña en la URL o lista de
  IPs ([Secured webhooks](https://developers.brevo.com/docs/secured-webhooks)). Se usa una **cabecera propia**
  `x-brevo-secret: <BREVO_WEBHOOK_SECRET>`: el nombre lo fijamos nosotros (la doc de bearer no dice en qué cabecera llega el token) y,
  a diferencia de basic en la URL, el secreto no acaba en logs. Se compara en tiempo constante (SHA-256 de ambos y `timingSafeEqual`).
  Sin secreto válido: `401` sin leer el cuerpo ni tocar la BD; sin `BREVO_WEBHOOK_SECRET` configurado: `500`.
  La lista de IPs de Brevo sería un refuerzo a nivel de nginx, no se aplica.
- **Eventos**: `hard_bounce`, `blocked`, `spam` e `invalid_email` suprimen la dirección. `soft_bounce` (buzón lleno, fallo
  temporal) solo se registra en el log. `unsubscribed` suprime los avisos opcionales (abajo). El resto (`delivered`, `opened`…)
  se acepta con `200` y se ignora. Un cuerpo sin `event` o `email` válidos es `400`. `2xx` solo con el evento procesado (un error deja que el proveedor pueda reintentar; no se ha verificado su política de reintentos).
- **Tabla** `email_suppressions(email PK en minúsculas, reason, event, provider_message_id, created_at)`. Solo `service_role`
  (RLS con FORCE y sin permisos para `app_user`). Una dirección que no es de ningún perfil se guarda igual. Idempotente: un evento
  repetido no cambia la fila; uno duro sustituye a una baja previa, nunca al revés.
- **Obligatorios y opcionales**. Todos los emails de la app son «de servicio» y ninguno lleva enlace de baja (LSSI), así que
  `unsubscribed` casi no llegará; se define igualmente:
  - *Obligatorios* (una baja no los calla): los directos de `auth.js` y `trainers.js` (recuperar contraseña, contraseña cambiada,
    invitación de profesor), los de facturación (`CHANNELS` de `notices.js`) y, aunque estén en `SERVICE`, los del registro de
    jornada, el acceso del menor y la foto quitada.
  - *Opcionales* (una baja los calla): el email de respaldo del resto de `SERVICE` (reservas, sesiones, eventos, re-firma, edad).
  - Un rebote duro, un bloqueo, una queja de spam o una dirección inválida callan **todos**: la dirección no funciona o nos ha denunciado.
- **Punto de corte**: `sendWith(transporte)` en `src/services/email.js` consulta la supresión antes de llamar al transporte; `send` es
  `sendWith` del transporte configurado. Una dirección suprimida lanza un error `suppressed` (no transitorio), sin llamar a Brevo.
  `sendPending` lo deja `skipped` con `last_error = 'email_suppressed'` (sin reintento). Los envíos directos (`auth.js`,
  `trainers.js`) ya registran el fallo y no deshacen nada. El panel del admin (Avisos › Entregas fallidas) lista también estas
  entregas saltadas y enseña el motivo en español.

## Riesgos aceptados

- Una dirección suprimida no se levanta desde la app (ni hay pantalla): se borra la fila con SQL. Una dirección corregida de un
  profesor (`PATCH /admin/trainers/:id`) es otra dirección y no se ve afectada.
- La invitación de un profesor a una dirección suprimida se registra en el log pero el admin no ve el fallo en pantalla: la
  invitación no pasa por el outbox. Lo habitual es un error de tecleo; el admin lo ve porque el profesor no responde.
- El orden de entrega de Brevo no está garantizado: un `unsubscribed` anterior puede llegar después de un duro y se ignora (correcto),
  pero un evento perdido deja la dirección sin suprimir hasta el siguiente rebote.
- Si la BD cae, el webhook responde 5xx y el evento depende de que Brevo lo reintente (política de reintentos sin verificar): hay que comprobarlo antes de producción.
- Aún no se ha comprobado cuál es la cabecera exacta de `auth` bearer, porque no se usa.

## Antes de producción

1. Fijar `BREVO_WEBHOOK_SECRET` (largo y aleatorio, p. ej. `openssl rand -hex 32`) en `.env` del VPS.
2. Registrar el webhook en Brevo con `POST https://api.brevo.com/v3/webhooks`: `type: transactional`, `url:
   https://TU-DOMINIO/api/webhooks/brevo`, `events: [hardBounce, softBounce, blocked, spam, invalid, unsubscribed]` y
   `headers: [{ "key": "x-brevo-secret", "value": "<el secreto>" }]`. Los nombres de `events` al registrar son camelCase; el cuerpo que
   llega usa snake_case (`hard_bounce`).
3. Mandar un evento de prueba desde Brevo y comprobar la fila en `email_suppressions`.
