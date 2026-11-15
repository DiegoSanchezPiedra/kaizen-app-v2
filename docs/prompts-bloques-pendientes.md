# Prompts de los bloques pendientes de producción

> Escrito el 2026-11-15, tras los commits de despliegue (netcup, TLS en el contenedor `web`, Borg, health checks) y de Brevo. Un prompt por bloque, para pegar en un chat nuevo. Modelo y esfuerzo siguen `docs/modelos-por-bloque.md` (dinero, RLS, menores o migraciones suben el nivel).

## Orden y reglas

Un solo chat escribe el repo cada vez: no lances dos bloques a la vez. Cada bloque termina en commit local; push y PR solo si lo pides.

| Orden | Bloque | Modelo y esfuerzo | Depende de | Riesgo principal |
|---|---|---|---|---|
| 1 | **P1** Rebotes de Brevo | Opus, **alto** | commit `feat(email): transporte Brevo` | Webhook público sin sesión: si la autenticación falla, cualquiera marca emails como inválidos y deja sin avisos a usuarios reales |
| 2 | **P2** Latido SSE de la tablet | Sonnet, medio | — | Tocar el stream de check-in; un bucle mal cerrado deja temporizadores vivos |
| 3 | **P3** `logrotate` | Haiku, medio | — | Rotar un fichero que el contenedor sigue escribiendo (hace falta `copytruncate`) |
| 4 | **P0** ADR de producción | Sonnet, medio | P1–P3, para citarlos | Contradecir el ADR 0017 sin marcarlo como sustituido en parte |
| 5 | **P4** HSTS | Sonnet, medio | **HTTPS probado en el VPS** (paso manual) | Un HSTS con un HTTPS roto deja a los usuarios sin poder entrar hasta que caduque; por eso empieza con 300 s |

Fuera de esta tanda, a propósito: IP real de Cloudflare (solo si se activa el proxy), `/health` mínimo y un segundo stack de staging en el mismo VPS (el compose actual no lo admite: ver `deploy/staging/README.md` § 9).

## Regla común (pégala al inicio de cada prompt)

```
Reglas de trabajo:
- Antes de buscar o leer código, ejecuta `graphify query "<pregunta>"` (y `graphify path` / `graphify explain` para relaciones). Lee ficheros crudos solo en las líneas que el grafo ya haya localizado. Si lanzas subagentes que exploren código, incluye esta regla en su prompt.
- Docs en español. Un ADR por decisión en `docs/adr/`. Commits Conventional Commits en español.
- Una sola escritora del repo: no abras otras ramas ni lances otros bloques.
- Al terminar: ejecuta los tests que cites, `graphify update .` y haz commit local. No hagas push ni abras PR sin que yo lo confirme.
- Si una verificación falla, dime qué falló y con qué salida; no la des por buena ni la saltes.
```

---

## P1 — Rebotes de Brevo (Opus, esfuerzo alto)

```
Contexto: Express (Node 22), Postgres 16 con RLS (roles migrator, app_user, service_role), Brevo como transporte de email (`EMAIL_TRANSPORT=brevo`, `src/services/email.js`). Los avisos salen de un outbox (`notice_deliveries`, ADR 0008) con un worker en la API (`src/services/notices.js`: `mark()`, `RETRY_MIN`, entregas `pending|sent|failed|skipped`). Hoy no hay ningún tratamiento de rebotes: una dirección que rebota se reintenta y daña la reputación del dominio.

Objetivo: recibir los eventos de rebote de Brevo, marcar la dirección como no entregable y dejar de enviarle.

Haz esto:
1. Lee la documentación OFICIAL actual de webhooks transaccionales de Brevo (eventos `hard_bounce`, `soft_bounce`, `blocked`, `spam`, `unsubscribed`, `invalid_email`; formato del cuerpo; qué autenticación admite el endpoint). No te fíes de tu memoria. Dime qué opciones de autenticación hay antes de implementar.
2. Endpoint `POST /webhooks/brevo` en `src/routes/webhooks.js` (se monta en `src/app.js` antes de `express.json`; nginx lo expone como `/api/webhooks/brevo`). Autenticación: la que ofrezca Brevo; si solo hay un secreto compartido, `BREVO_WEBHOOK_SECRET` comparado en tiempo constante. Sin autenticación válida: 401 y sin tocar la BD. Responde 2xx solo si el evento queda procesado.
3. Migración 065 (`migrations/065_email_suppressions.js`): tabla `email_suppressions(email text primary key en minúsculas, reason, event, provider_message_id, created_at)`. RLS: solo `service_role` lee y escribe; ni `app_user` ni nadie más. Con `down`. Sigue el patrón de `064_trainer_invites.js`.
4. Reglas: `hard_bounce`, `blocked`, `spam` e `invalid_email` suprimen la dirección; `soft_bounce` no (solo se registra en el log). `unsubscribed` suprime los avisos opcionales: decide qué avisos son obligatorios (verificación, recuperar contraseña, cobro) y cuáles opcionales (`CONTEXT.md` distingue los avisos operativos de los de cobro, firmas y salud; `src/services/notices.js` los tipifica) y dime la decisión antes de aplicarla.
5. `src/services/email.js` (o el punto de `notices.js` que llama a `send`) consulta la supresión ANTES de enviar: si la dirección está suprimida, la entrega queda `skipped` con `error: 'email_suppressed'`, sin llamar a Brevo. Que el panel de avisos del admin (`frontend/src/pages/admin/notices.tsx`, entregas fallidas) enseñe ese motivo.
6. Un evento repetido no falla (idempotente). Un email que no es de ningún perfil se guarda igual.
7. Documenta `BREVO_WEBHOOK_SECRET` (si aplica) en `.env.example`, `deploy/.env.prod.example`, `docker-compose.prod.yaml` (la lista de variables de la API) y en `deploy/staging/README.md` § 7. Añade el endpoint a `docs/api.md` y la decisión a un ADR nuevo en `docs/adr/`.

Tests: `scripts/test-brevo-webhook.js` con `scripts/with-temp-db.js` (patrón de `scripts/test-trainers.js`): secreto malo → 401; cada evento; idempotencia; una dirección suprimida no llega a `send` (stub del transporte); RLS (`app_user` no lee la tabla). Añade el script como `test:brevo-webhook` en `package.json` (`scripts/run-tests.js` lo descubre solo, por el prefijo `test:`; envuélvelo con `with-temp-db.js` como `test:trainers`). Actualiza `scripts/test-migrations.js` (nombre de la última migración y el número de `down`). Ejecuta también `test:notices`, `test:rls`, `test:migrations`, `test:trainers`.

Verificación: arranca la API en local y envía un evento de prueba con `curl` (con y sin secreto); comprueba la fila en `email_suppressions`; envía un email de prueba real por Brevo a una dirección tuya con la clave de pruebas y confirma que llega. Cierra con `graphify update .` y commit local.
```

---

## P2 — Latido SSE de la tablet (Sonnet, esfuerzo medio)

```
Contexto: `GET /tablet/active-sessions` (`src/routes/tablet.js`) abre un stream SSE que emite un evento `feed` cada `period` segundos (el periodo del QR, `qrPeriod()` en `src/services/checkin.js`). Nginx (`deploy/nginx.conf`, `location /api/tablet/`) lo expone con `proxy_buffering off` y `proxy_read_timeout 1h`. Si algún día un proxy corta conexiones sin datos (Cloudflare lo hace a los ~100 s, dato sin verificar hoy) y `period` es largo, la tablet se queda sin stream.

Objetivo: que el stream nunca esté más de ~25 s sin escribir.

Haz esto:
1. Añade un comentario SSE (`: ping\n\n`) cada 25 s con su propio `setInterval`, que se limpia en `req.on('close')` junto al temporizador existente y también cuando el stream termina por `revoked` o `error` (hoy solo `clearInterval(timer)` y `res.end()`). Ningún temporizador puede quedar vivo.
2. No cambies el formato de los eventos `feed`, `revoked` ni `error`, ni el cliente (`frontend/src/pages/tablet.tsx`): un comentario SSE lo ignora `EventSource`. Compruébalo leyendo el cliente.
3. Extrae el intervalo a una constante exportada para poder probarlo con un valor pequeño.

Tests: amplía `scripts/test-checkin.js` (o el script de tablet que ya exista; localízalo con el grafo): con el intervalo reducido, el stream recibe `: ping` entre dos `feed`; tras cerrar el cliente, no quedan temporizadores. Ejecuta `test:checkin` y `test:ratelimit`.

Verificación: `curl -N -H 'Authorization: Device <token>' http://localhost:3000/tablet/active-sessions` y observa los `: ping`. Cierra con `graphify update .` y commit local.
```

---

## P3 — `logrotate` del host (Haiku, esfuerzo medio)

```
Contexto: el cron de producción escribe en `/var/log/kaizen/nightly.log` y `/var/log/kaizen/backup.log` (ver `deploy/README.md`, paso 5). Los logs de Docker ya rotan (`x-logging` en `docker-compose.prod.yaml`). Los de esos dos ficheros no.

Objetivo (lista cerrada, sin decisiones): rotarlos semanalmente.

Haz esto:
1. Crea `deploy/logrotate-kaizen.conf` con un bloque para `/var/log/kaizen/*.log`: semanal, `rotate 8`, `compress`, `delaycompress`, `missingok`, `notifempty`, `copytruncate`, `create 0640 root root`.
2. En `deploy/README.md`, sección «Host y DNS (antes del primer despliegue)», sustituye la línea de `logrotate` por: `sudo install -m 644 deploy/logrotate-kaizen.conf /etc/logrotate.d/kaizen`.
3. Verifica con `logrotate -d deploy/logrotate-kaizen.conf` (modo simulación; si no tienes `logrotate`, dilo y no lo des por verificado). No ejecutes nada que escriba en `/etc` ni en `/var/log`.

Si algo exige una decisión (p. ej. otra ruta de logs), para y pregunta. Cierra con `graphify update .` y commit local.
```

---

## P0 — ADR de producción (Sonnet, esfuerzo medio)

```
Contexto: el ADR 0017 (`docs/adr/0017-un-vps-con-docker-compose-y-nginx.md`) decidió un VPS con Docker Compose y «HTTPS con certbot» en el nginx del host. Se ha implementado distinto (commits `feat(deploy): producción en netcup…` y `feat(email): transporte Brevo…`; decisiones también en `deploy/README.md` y en la memoria `produccion-netcup-piloto`):
- VPS netcup Lite 3 (8 vCores, 16 GB, 320 GB, 16,66 €/mes con IVA, ubicación no elegible).
- Cloudflare solo como DNS (nube gris), sin registros AAAA (Docker enmascara la IP IPv6 y el rate limit por IP deja de servir), `TRUST_PROXY=1`.
- TLS terminado en el contenedor `web` (certbot webroot en el host, `deploy/tls-init.sh`); un solo salto de proxy; la config 443 se deriva de `deploy/nginx.conf` en el `Dockerfile`, porque el staging la reutiliza.
- Health checks y `up --wait`; backup con Borg a BorgBase (UE) + healthchecks.io; email por Brevo (remitente de un subdominio, SPF único con Zoho); push por Web Push con VAPID, sin FCM; monitorización con UptimeRobot.
- Alternativa descartada y por qué: Cloudflare con proxy (rompe `req.ip` salvo `real_ip` de nginx con los rangos de Cloudflare, obliga a cerrar el origen a esos rangos, a reglas de caché para `sw.js`, a desactivar Rocket Loader y Email Obfuscation por la CSP, y puede desafiar los webhooks con el WAF). Se retoma si hay tráfico o ataques.

Objetivo: documentarlo.

Haz esto con la skill `ecc:architecture-decision-records` (formato de los ADR existentes: lee el 0017 y el 0028 antes):
1. `docs/adr/0029-produccion-en-netcup-tls-en-web-y-cloudflare-solo-dns.md`, con Considered Options y Consequences. Cita P1–P3 solo si ya están commiteados (míralo con `git log`).
2. En el 0017, añade al principio una nota «Parcialmente sustituido por el ADR 0029 (TLS y copias)» y no reescribas su historia.
3. Actualiza `CONTEXT.md` solo si define algo de despliegue que ahora sea falso (grep de «certbot», «OVH», «WEB_BIND»).
No toques código. Cierra con `graphify update .` y commit local `docs(adr): …`.
```

---

## P4 — HSTS (Sonnet, esfuerzo medio) — solo tras probar HTTPS en el VPS

```
Requisito previo (lo confirmo yo antes de lanzarte): el VPS sirve HTTPS válido con el certificado de Let's Encrypt, la renovación probada con `certbot renew --dry-run` y ningún subdominio sin HTTPS.

Contexto: `deploy/nginx.conf` repite `add_header` dentro de cada `location` (nginx no hereda `add_header` si el bloque define alguno propio). El `Dockerfile` (etapa `web`) genera la variante de producción con `sed` desde ese fichero; el staging usa el fichero tal cual, sin TLS propio.

Objetivo: HSTS solo en producción, empezando con `max-age=300`.

Haz esto:
1. En la etapa `web` del `Dockerfile`, añade al `sed` una regla que inserte `add_header Strict-Transport-Security "max-age=300" always;` detrás de CADA `add_header Referrer-Policy "same-origin" always;` (aparece en el `server` y en `/api/`, `/api/avatars/` y `/`). No toques `deploy/nginx.conf`.
2. Sin `includeSubDomains` ni `preload`.
3. Documenta en `deploy/README.md` la subida escalonada: 300 s → 1 día → 6 meses, con la comprobación de cada paso (`curl -sI https://<dominio>/ | grep -i strict`) y el aviso de que un HTTPS roto con HSTS largo bloquea a los usuarios.

Verificación: genera la config como lo hace el `Dockerfile` y valídala con `docker run --rm --add-host api:127.0.0.1 -v $PWD/deploy:/d:ro -v <certs>:/etc/nginx/certs:ro nginx:1.27-alpine nginx -t` (certificado autofirmado temporal); cuenta con `grep -c Strict-Transport` que sale en las 4 ubicaciones. Comprueba que `deploy/nginx.conf` no ha cambiado (`git diff --stat`). Cierra con `graphify update .` y commit local.
```
