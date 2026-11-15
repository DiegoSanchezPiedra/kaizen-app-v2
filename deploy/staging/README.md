# Staging por Tailscale Funnel (para que el cliente pruebe)

Una instancia aparte de la de desarrollo, en tu máquina, publicada por Tailscale Funnel (antes ngrok: su página de aviso del plan gratuito
rompía la app instalada en iPhone). No es el despliegue final (VPS, ADR 0017):
sirve para enseñar la app y que el cliente pruebe todo. **Stripe siempre en modo prueba** (la cuenta es la de maat).

```
cliente ──https──▶ Funnel ─▶ nginx :8080 ──┬─▶ frontend/dist (PWA)
                                           └─▶ /api → API :3100 ──▶ Postgres :5433
                    Stripe (sandbox) ──webhooks──▶ stripe listen ──▶ API :3100
```

| Pieza | Dónde | Notas |
|---|---|---|
| BD | Docker `kaizen-staging-db`, `127.0.0.1:5433`, base `kaizen_staging` | aparte de la de desarrollo (`:5432`) |
| nginx | Docker `kaizen-staging-nginx`, `:8080` | la **misma config de producción** (`deploy/nginx.conf`): un solo origen, la API bajo `/api` |
| API | `npm run staging:api`, `:3100` | lee `.env.staging` (no el `.env` de desarrollo); no choca con la de desarrollo (`:3000`) |
| Frontend | `frontend/dist`, servido por nginx | se compila con `npm run staging:build`; no usa Vite en marcha |

Todos los comandos, desde la raíz del repo.

---

## 1. Preparar (una sola vez)

### 1.1 `.env.staging`

```bash
cp deploy/staging/.env.staging.example .env.staging   # está en .gitignore: nunca se sube
```

Rellénalo:

- **Contraseñas de la BD** (`POSTGRES_PASSWORD`, `MIGRATOR_PASSWORD`, `APP_PASSWORD`, `SERVICE_PASSWORD`) y las **mismas** dentro
  de las tres `DATABASE_URL*`. Genéralas con `openssl rand -hex 24`: sin `@ : / # %`, que rompen las URLs.
- **Secretos de la API** (`JWT_SECRET`, `QR_HMAC_SECRET`, `TOTP_ENCRYPTION_KEY`, `MFA_ENCRYPTION_KEY`): `openssl rand -base64 32`.
- `GOOGLE_CLIENT_ID`: obligatoria para arrancar. Sin login con Google, déjala en `staging-sin-google` (ver § Google).
- `TRUST_PROXY=2` (Funnel + nginx). Sin esto, todos los clientes cuentan como la misma IP en el límite de intentos.
- `APP_URL` = la URL https de Funnel (paso 1.2). De ella salen los enlaces de los emails y las vueltas de Stripe.
- **Stripe**: `STRIPE_SECRET_KEY` **solo `sk_test_` o `rk_test_`** (el seed se niega con otra). `STRIPE_WEBHOOK_SECRET` en el
  paso 1.3. `STRIPE_PORTAL_CONFIGURATION_ID`: copia el `bpc_…` de tu `.env` de desarrollo (es del mismo sandbox; lo usa
  «Gestionar pagos»).
- **Emails**: `EMAIL_TRANSPORT=resend` y `RESEND_API_KEY` (ver § Emails). Con `log` solo van a `storage-staging/emails.log`.
- **Push**: `PUSH_TRANSPORT=webpush` y las claves de `npx web-push generate-vapid-keys`.
- `SEED_PASSWORD`: la contraseña de todas las cuentas de demo (≥ 8 caracteres).

### 1.2 Tailscale Funnel (URL fija y gratis, sin página de aviso)

1. Instala Tailscale ([tailscale.com/download](https://tailscale.com/download)) y entra: `sudo tailscale up`.
2. `sudo tailscale funnel --bg 8080`. La primera vez da un enlace para activar Funnel (y HTTPS) en la consola de Tailscale.
   `--bg` lo deja puesto también tras reiniciar; `tailscale funnel status` enseña la URL y `tailscale funnel --https=443 off`
   lo quita.
3. Pon `APP_URL=https://TU-MAQUINA.TU-RED.ts.net` en `.env.staging`. La URL es la del nombre de la máquina: no cambia al
   reiniciar, y no se rompen los enlaces de los emails ya enviados.

### 1.3 Webhook de Stripe

La API es local, así que Stripe no puede llamarla directamente: los eventos (pago confirmado, cuota activada, cobro fallido)
llegan por `stripe listen`. No hace falta registrar ningún endpoint en el Dashboard. `stripe listen` sin `--events` reenvía
todos los eventos, también `checkout.session.expired` (B21: libera la plaza de una inscripción a un evento sin pagar) y
`refund.failed` (un reembolso de un evento que falla después); si lo limitas con `--events`, inclúyelos junto a los de
`HANDLED_EVENTS` (`src/services/stripeWebhook.js`).

```bash
stripe listen --print-secret    # el whsec_… (es el mismo para cualquier `stripe listen` de tu máquina)
```

Ponlo en `STRIPE_WEBHOOK_SECRET`.

### 1.4 Base de datos, frontend y datos de demo

```bash
npm run staging:db          # crea la BD y, en el primer arranque, sus roles (init-roles.sh)
sleep 8                     # hasta que Postgres acepte conexiones (docker ps → «healthy»)
npm run staging:migrate     # todas las migraciones
mkdir -p storage-staging/agreements
npm run staging:build       # compila el frontend en frontend/dist
npm run staging:web         # nginx
npm run staging:api         # la API (déjala en su terminal)
npm run staging:seed        # en otra terminal, con la API ya en marcha
```

El seed es repetible e imprime las cuentas (contraseña: `SEED_PASSWORD`): admin, 2 profesores (Marc Soler, empleado: ficha su jornada; Sensei Marta, autónoma), 2 alumnos y un tutor con dos hijos
menores con acceso propio (B32: **Hugo Hijo**, 11 años, usuario `hugo`, y **Lara Hija**, 15 años, usuario `lara`; los dos con la contraseña `SEED_PASSWORD`, sin email y con permiso de reservar: se entra en `/login` con el usuario); 4 disciplinas con su temática de medallas (Boxeo, BJJ/Grappling, Muay Thai y Muay Thai Kids, solo menores), 4 planes (crean
Products y Prices en el sandbox), 8 clases (2 a la semana por disciplina, con sus sesiones a un año) y los 2 documentos legales publicados (PDFs de prueba). **El perfil del alumno sale incompleto a propósito** (ficha
médica, acuerdos): es parte de lo que el cliente prueba.

---

## 2. Encender (cada vez)

Tres terminales, más los contenedores:

```bash
# Contenedores (BD y nginx)
npm run staging:db && npm run staging:web

# Terminal 1 · la API
npm run staging:api

# Terminal 2 · webhooks de Stripe hacia la API de staging
stripe listen --forward-to localhost:3100/webhooks/stripe

# Funnel no necesita terminal: con --bg sigue puesto (paso 1.2)
```

Comprueba: `docker ps` enseña `kaizen-staging-db` (healthy) y `kaizen-staging-nginx`; `curl localhost:8080/api/health` da
`"status":"ok"`; y `https://TU-MAQUINA.TU-RED.ts.net` enseña el login.

> **Un solo `stripe listen` a la vez.** Si tienes el de desarrollo (`--forward-to localhost:3000/…`) abierto, páralo (Ctrl+C):
> con los dos, cada evento del sandbox llega a las dos APIs y cada una recibe pagos que no conoce.

Para apagar: Ctrl+C en las tres terminales y
`docker compose -f deploy/staging/docker-compose.staging.yaml --env-file .env.staging stop`.

---

## 3. Publicar un cambio

| Qué cambia | Qué hacer |
|---|---|
| Frontend | `npm run staging:build`: nginx sirve el `dist` nuevo al momento |
| Backend | Ctrl+C y `npm run staging:api` |
| Migraciones nuevas | `npm run staging:migrate` y reinicia la API |
| `deploy/nginx.conf` | `docker restart kaizen-staging-nginx` (la config se copia al arrancar). Ojo: el service worker guarda `index.html` con sus cabeceras; un cambio de CSP no llega a quien ya tiene la app hasta el siguiente build del frontend |
| `.env.staging` | reinicia la API (solo lo lee al arrancar). Si cambias `VITE_*`, también `npm run staging:build` |

**La PWA no se actualiza sola, a propósito**: el navegador sigue con la versión que tenía guardada hasta que la persona toca el
aviso **«Hay una versión nueva · Actualizar»**. Si no sale, cerrar todas las pestañas de la URL y volver a abrirla; en último
caso, DevTools → Application → Service workers → «Unregister» y recargar. Díselo al cliente: si un error ya arreglado le sigue
saliendo, es esto. (Para saber qué versión tiene: el nombre `index-XXXX.js` del error debe coincidir con el de `frontend/dist/assets`.)

(Con ngrok gratis el aviso no salía nunca en iPhone: el navegador pedía `sw.js`, ngrok le contestaba con su página de aviso en
HTML y la actualización fallaba en silencio. Por eso se pasó a Tailscale Funnel. Cualquier túnel o proxy que meta una página
intermedia rompe igual las actualizaciones de la PWA.)

**Cuándo busca la versión nueva** (`watchForUpdates`, `frontend/src/lib/sw-update.ts`): al abrir la app, al volver a ella desde
otra app o desde la pantalla de bloqueo, y cada hora con la app a la vista. El navegador por sí solo solo busca `sw.js` al
navegar, y la app instalada en el iPhone vuelve del segundo plano sin navegar: antes de esto el aviso solo salía en Safari.
Para comprobarlo en el iPhone: con la app instalada y abierta, publica un cambio (`npm run staging:build`), pasa a otra app y
vuelve; en unos segundos tiene que salir «Hay una versión nueva · Actualizar». La versión nueva solo se activa al tocarlo.

---

## 4. Antes de pasarle la URL al cliente

Ensayo de punta a punta, con las cuentas del seed:

- [ ] Entrar con cada rol (admin, profesor, alumno, tutor) y el hijo desde el selector del tutor.
- [ ] Completar el perfil de un alumno (ficha médica y acuerdos) y reservar una sesión.
- [ ] Contratar una cuota con la tarjeta de prueba `4242 4242 4242 4242` (cualquier fecha futura y CVC; 3DS:
      `4000 0025 0000 3155`) y ver que pasa a **«Activa»**: eso prueba que el webhook llega.
- [ ] «He olvidado mi contraseña»: que llegue el email de verdad (ver § Emails).
- [ ] Check-in: vincular una tablet en `/tablet` (otro dispositivo) con el código de Admin › Tablets y escanear el QR.
- [ ] Push: instalar la app (en iPhone, desde la pantalla de inicio) y activar los avisos en Cuenta.
- [ ] Acceso propio del menor: entrar en `/login` con `hugo` (o `lara`) y la contraseña del seed; ver que no hay Cuota, Acuerdos, Salud ni Mis hijos, y que el tutor lo gestiona en Cuenta › Mis hijos.
- [ ] El panel admin en el móvil.

## 5. Qué necesita cada prueba

| Para probar | Hace falta |
|---|---|
| Entrar, reservar, calendario, check-in con QR, progreso, panel | nada más |
| Pagos | `stripe listen` en marcha y `STRIPE_WEBHOOK_SECRET` correcto; `STRIPE_PORTAL_CONFIGURATION_ID` para «Gestionar pagos» |
| Emails | Resend (ver abajo) |
| Push | claves VAPID; solo con HTTPS (Funnel) y la app instalada |
| Login con Google | ver abajo |
| Tablet | otro dispositivo con `/tablet` |

### Emails

Con el remitente de pruebas de Resend (`EMAIL_FROM=Kaizen <onboarding@resend.dev>`), **Resend solo entrega a la dirección de tu
propia cuenta de Resend**. Para que le lleguen al cliente: verifica un dominio tuyo en Resend (Domains) y pon
`EMAIL_FROM=Kaizen <avisos@tu-dominio>`. Reinicia la API. Con **Brevo** (`EMAIL_TRANSPORT=brevo`, `BREVO_API_KEY`): el remitente tiene que
ser de un dominio autenticado en Brevo; con `onboarding@resend.dev` la API se niega a arrancar. Sin idempotencia en Brevo, un reintento tras
una caída puede duplicar un email.

### Google

En Google Cloud, un cliente OAuth (Web) con `https://TU-MAQUINA.TU-RED.ts.net` como origen de JavaScript autorizado. Su id va en
`GOOGLE_CLIENT_ID` (`.env.staging`) y en `VITE_GOOGLE_CLIENT_ID` (`frontend/.env.production`) **antes** de
`npm run staging:build`. Sin eso, el botón de Google no sale y se entra con email y contraseña.

---

## 6. Problemas conocidos

| Síntoma | Causa y arreglo |
|---|---|
| La API no arranca: `Falta GOOGLE_CLIENT_ID` | ponla en `.env.staging` (vale `staging-sin-google`) |
| `password authentication failed` al migrar o arrancar | las `DATABASE_URL*` no llevan las contraseñas con que se crearon los roles. O las corriges, o cambias las de los roles: `docker exec -it kaizen-staging-db psql -U postgres -c "ALTER ROLE migrator PASSWORD '…';"` (y `app_user`, `service_role`), o reinicias de cero (abajo) |
| `502 Bad Gateway` en `/api` | la API de staging no está en marcha o no escucha en el `:3100` |
| Pagas y la cuota no pasa a «Activa» | `stripe listen` parado, apuntando a otro puerto, o `STRIPE_WEBHOOK_SECRET` distinto del de `stripe listen --print-secret` |
| Un error ya arreglado sigue saliendo | la PWA guardada: § 3 |
| iPhone: «Unexpected Application Error!» o no deja entrar tras un cambio | versión vieja guardada en Safari. Desde la versión con «Actualizar y recargar» en la pantalla de error basta con tocarlo; si el iPhone aún tiene una anterior, una vez a mano: Ajustes → Safari → Avanzado → Datos de sitios web → borrar el dominio de staging (y, si la añadiste a la pantalla de inicio, borrar el icono y volver a añadirla) |
| iPhone (app en pantalla de inicio): entra y vuelve al login con «Tu acceso ha cambiado», o «Algo ha fallado» en bucle | algo delante de nginx contesta con una página propia (así pasaba con el aviso de ngrok gratis). Para comprobarlo: `curl -A 'iPhone' <url>/api/me` y `<url>/sw.js` deben dar JSON y JavaScript, no HTML |
| `429` «Demasiados intentos» | límite por IP (30 entradas cada 15 min; 5 «olvidé la contraseña» por hora). Una oficina comparte IP; reiniciar la API pone los contadores a cero |
| El email no llega | remitente de pruebas de Resend: § Emails. Mira también `storage-staging/emails.log` y la terminal de la API |

### Reiniciar de cero

Borra **solo** el staging (la BD de desarrollo no se toca):

```bash
docker compose -f deploy/staging/docker-compose.staging.yaml --env-file .env.staging down -v   # contenedores y volumen
rm -rf storage-staging/agreements && mkdir -p storage-staging/agreements                        # PDFs huérfanos
```

Y repite el paso 1.4. Los roles de la BD solo se crean cuando el volumen está vacío: si cambias sus contraseñas en
`.env.staging`, hace falta este reinicio (o el `ALTER ROLE` de arriba).

---

## 7. Variables de entorno

Se leen del `.env.staging` (la API, el seed y las migraciones; solo al arrancar) salvo las **de compilación**, que entran en el
frontend al hacer `npm run staging:build` y viven en `frontend/.env.production` (copia `frontend/.env.example`). «Secreto» = no se
sube nunca al repo ni se pega en chats o tickets. Con el `.env` de producción del VPS (`deploy/.env.prod.example`) valen las mismas
variables; lo que cambia está en la columna «Staging local / VPS».

| Variable | Para qué sirve | Quién la genera | Dónde | Secreto | Staging local / VPS |
|---|---|---|---|---|---|
| `POSTGRES_USER`, `DB_NAME` | superusuario y nombre de la base | tú | `.env.staging` / `.env` | no | `postgres`, `kaizen_staging` / `postgres`, `kaizen` |
| `POSTGRES_PASSWORD`, `MIGRATOR_PASSWORD`, `APP_PASSWORD`, `SERVICE_PASSWORD` | contraseñas de los 4 roles de la BD | `openssl rand -hex 24` (sin `@ : / # %`) | `.env.staging` / `.env` | **sí** | igual |
| `DATABASE_URL`, `DATABASE_URL_APP`, `DATABASE_URL_SERVICE` | conexión de migrator, API y worker; repiten las contraseñas de arriba | tú | `.env.staging` / `.env` | **sí** | host `localhost:5433` / host `db:5432` |
| `NODE_ENV`, `PORT` | `production`; puerto de la API | fijo | `.env.staging`; en el VPS los fija el compose | no | `3100` / `3000` |
| `TRUST_PROXY` | saltos de proxy para `req.ip` (el rate limit depende de ella) | tú | `.env.staging` / `.env` | no | `2` (Funnel + nginx) / `1` (nginx del contenedor `web`) |
| `APP_URL` | URL https pública; salen de ella los enlaces de emails, Stripe y recuperar contraseña | tú | `.env.staging` / `.env` | no | URL de Funnel / `https://tu-dominio` |
| `JWT_SECRET`, `QR_HMAC_SECRET`, `TOTP_ENCRYPTION_KEY` | firma de sesiones, del QR y cifrado de TOTP | `openssl rand -base64 32` | `.env.staging` / `.env` | **sí** | igual |
| `MFA_ENCRYPTION_KEY` | cifra el secreto MFA de los admins; **si se pierde, los admins pierden el MFA** | `openssl rand -base64 32` | `.env.staging` / `.env` | **sí** | igual; en el VPS, también en el backup |
| `MFA_TOKEN_EXPIRES_IN`, `MFA_TOTP_ISSUER`, `MFA_RECOVERY_CODE_COUNT` | ajustes del MFA | tú | `.env.staging` / `.env` | no | valores del ejemplo |
| `AGREEMENTS_STORAGE_PATH` | dónde se guardan PDFs legales y fotos | tú | `.env.staging`; en el VPS lo fija el compose | no | `./storage-staging/agreements` |
| `GOOGLE_CLIENT_ID` | id OAuth de Google; **obligatoria para arrancar** (vale `staging-sin-google`) | Google Cloud (§ Google) | `.env.staging` / `.env` **y** `frontend/.env.production` como `VITE_GOOGLE_CLIENT_ID` (compilación) | no (es público) | igual |
| `VITE_STRIPE_PUBLISHABLE_KEY` | clave publicable de Stripe para el formulario de tarjeta | Stripe (sandbox) | `frontend/.env.production` (compilación); en el VPS, `.env` (el compose la pasa al build) | no (es pública) | `pk_test_…` siempre |
| `STRIPE_SECRET_KEY` | API de Stripe | Stripe › sandbox › claves restringidas | `.env.staging` / `.env` | **sí** | **solo `sk_test_` o `rk_test_`** (el seed se niega con otra) |
| `STRIPE_WEBHOOK_SECRET` | firma de los webhooks | local: `stripe listen --print-secret`; VPS: Stripe › Webhooks › endpoint `https://tu-dominio/api/webhooks/stripe` | `.env.staging` / `.env` | **sí** | distinto en cada entorno |
| `STRIPE_PORTAL_CONFIGURATION_ID` | portal «Gestionar pagos» (`bpc_…`) | `npm run stripe-portal-config` | `.env.staging` / `.env` | no | del mismo sandbox |
| `STRIPE_STATEMENT_DESCRIPTOR` | texto en el extracto (5–22 caracteres) | tú | `.env.staging` / `.env` | no | `"KAI ZEN TRAINING CAMP"` |
| `EMAIL_TRANSPORT` | `log` (a fichero), `resend` o `brevo` | tú | `.env.staging` / `.env` | no | `resend` o `log` / `brevo` |
| `RESEND_API_KEY` o `BREVO_API_KEY` | clave del proveedor de email | panel de Resend o de Brevo (SMTP y API › claves API) | `.env.staging` / `.env` | **sí** | la del transporte elegido |
| `EMAIL_FROM`, `EMAIL_REPLY_TO` | remitente y buzón de respuestas | tú | `.env.staging` / `.env` | no | Resend: `onboarding@resend.dev` solo entrega a tu cuenta (§ Emails). **Brevo: un remitente de un dominio autenticado; con el de Resend la API no arranca** |
| `CORPORATE_EMAIL_DOMAIN` | dominio del correo de los profesores (ADR 0028); **obligatoria con `NODE_ENV=production`** | tú | `.env.staging` / `.env` | no | `academia.test` / el dominio real |
| `PUSH_TRANSPORT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push (sin Firebase); necesita HTTPS | `npx web-push generate-vapid-keys`; el subject, `mailto:` de la academia | `.env.staging` / `.env` | privada: **sí**; pública: no | `webpush`. Rotar = cambiar las dos y vaciar `push_subscriptions` |
| `EMAIL_LOG_PATH`, `PUSH_LOG_PATH` | ficheros de log del transporte `log` | tú | `.env.staging`; en el VPS los fija el compose | no | `./storage-staging/*.log` |
| `SEED_PASSWORD`, `SEED_EMAIL_DOMAIN`, `SEED_TRAINER_EMAIL` | contraseña de las cuentas de demo (≥ 8), dominio de sus emails y el correo del profesor dado de alta | tú | `.env.staging` | `SEED_PASSWORD`: **sí** | `SEED_TRAINER_EMAIL` solo si el transporte entrega a ese buzón |

`WEB_BIND` ya no existe: el contenedor `web` publica el 80 y el 443. Solo en el VPS, fuera del `.env`: `/etc/kaizen/backup.env`
(Borg y healthchecks: `deploy/backup.env.example`) y `/etc/kaizen/certs` (certificado TLS, lo deja `deploy/tls-init.sh`).

## 8. Cuentas externas y pasos manuales

| Cuenta | Para qué | Cuándo | Qué haces tú |
|---|---|---|---|
| **Tailscale** | Funnel (staging local) | solo staging local | instalar, `sudo tailscale up`, activar Funnel (§ 1.2) |
| **Stripe** (sandbox de maat) | pagos de prueba | siempre | claves `sk_test_`/`rk_test_`/`pk_test_`; `stripe listen` en local, o un endpoint de webhook en el VPS. **Nunca claves live** hasta B10.7 |
| **Google Cloud** (OAuth) | botón «Entrar con Google» | opcional | cliente Web con la URL de staging como origen autorizado (§ Google) |
| **Resend** o **Brevo** | emails | siempre | Resend: dominio verificado si el cliente debe recibirlos. Brevo: autenticar `mail.tu-dominio` (SPF, DKIM, DMARC) y validar el remitente |
| **netcup, dominio y Cloudflare (solo DNS)** | VPS y nombre | solo VPS | contratar, registro `A` sin `AAAA`, nube gris; pasos en `deploy/README.md` § Host y DNS |
| **BorgBase y healthchecks.io** | copia cifrada fuera del VPS y aviso de backup | solo VPS | repositorio UE con clave append-only, `/etc/kaizen/backup.env`, probar una restauración |
| **UptimeRobot** | aviso si cae `https://tu-dominio/api/health` | solo VPS | una comprobación cada 5 min (plan gratis; uso comercial permitido en sus términos de 2026) |
| **Zoho Mail** | buzones corporativos de profesores | solo si pruebas el alta de profesores con correo real | centro de datos UE; MX y SPF conjuntos con Brevo |

## 9. Staging en el VPS de netcup

Hoy el compose de producción (`docker-compose.prod.yaml`) tiene el proyecto `kaizen`, los puertos 80/443 y los volúmenes con
nombre fijos: **no admite un segundo stack en el mismo VPS** sin cambiarlo. Mientras tanto, el VPS es el entorno de prueba antes
de abrir: se despliega como producción (`deploy/README.md`), con claves de Stripe de **test**, `EMAIL_TRANSPORT=brevo` y un
dominio o subdominio propio; el staging local por Funnel sigue siendo el de las demos. Orden:

1. Host y DNS (`deploy/README.md` § Host y DNS).
2. `.env` desde `deploy/.env.prod.example` con las variables de § 7 (columna VPS).
3. `sudo deploy/tls-init.sh <dominio> <email>`, `deploy/deploy.sh` y otra vez `tls-init.sh`.
4. Webhook de Stripe (sandbox) hacia `https://<dominio>/api/webhooks/stripe` y su `whsec_…` en `.env`; luego `docker compose -f docker-compose.prod.yaml up -d api`.
5. Backup y restauración probados antes de dar acceso a nadie.
6. La lista de § 4. `npm run staging:seed` apunta al staging local: en el VPS, crea las cuentas desde el panel de admin.

## Cuidado

- La URL de Funnel es **pública**: cualquiera que la tenga ve la pantalla de entrada. Pasa solo las cuentas de demo y no metas
  datos reales de clientes de maat.
- Solo claves de **prueba** de Stripe. Nada de este staging toca la cuenta live.
- `frontend/vite.config.ts` no necesita `allowedHosts` para esto: nginx sirve el `dist` compilado. Solo haría falta para exponer el
  servidor de Vite (`npm run dev`) por el túnel.

---

## Datos de demo

`npm run staging:reset` (`staging:migrate` + `staging:seed` + `staging:demo` + `staging:medals`) lo deja todo montado con la API de
staging en marcha. **No borra nada**: la BD vacía la dejas tú antes, a mano (solo staging; la de desarrollo no se toca):

```bash
docker exec -it kaizen-staging-db psql -U postgres -d kaizen_staging <<'SQL'
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT USAGE, CREATE ON SCHEMA public TO migrator, service_role;
GRANT USAGE ON SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public GRANT SELECT, USAGE ON SEQUENCES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
SQL
```

(Son los `GRANT` y `ALTER DEFAULT PRIVILEGES` de `init-roles.sh`; los roles y la base no se tocan.) Luego `npm run staging:reset`, que también deja las medallas de la demo (abajo).

**En local** (BD de desarrollo `:5432`): arranca una API aparte, `PORT=3001 npx dotenv -e .env -- node src/index.js`, y en otra
terminal `npm run local:seed`, `local:demo` y `local:medals` (como los de staging, con el `.env` y la API en `:3001`). La
contraseña de las cuentas es `SEED_PASSWORD` si la exportas, o `kaizen-local-1`. Los scripts solo aceptan `kaizen_staging` (`:5433`)
o `kaizen_db` (`:5432`).

`npm run staging:medals [-- <código>]` crea o rehace dos cuentas (contraseña `SEED_PASSWORD`), con las once medallas en cada disciplina:

- **`medallas@staging.test`** (adulto «Demo Medallas»): asistencia de 2024 en Boxeo, BJJ/Grappling y Muay Thai (1060 h y 53 semanas
  seguidas en cada una). Al entrar salen **3 medallas nuevas**, una por disciplina (`<código>`, por defecto `hours_1000`); las demás
  se ven tocándolas en Progreso. Es pública y compite, con 8 rivales (los alumnos adultos de `staging:demo` con más horas pasan a
  públicos con ranking y logros; tras otro `staging:demo`, se repite este).
- **`tutor.medallas@staging.test`** (tutor) con su hijo **Nico** (2016) y las once en Muay Thai Kids. Para enseñarlo: entrar como
  tutor, **elegir a Nico** en el selector y sale su medalla nueva. Nico nunca es público.

Es la historia de 2024, fuera del calendario y de los informes recientes. La disciplina de la versión anterior («Demo medallas (no
tocar)») se desactiva y se le quitan sus sesiones. Volver a ejecutarlo repite el momento. Necesita la API en marcha.

`npm run staging:demo` llena el staging con una academia mediana de 6 meses, para ver el panel del admin con cifras. Necesita el
seed hecho (`npm run staging:seed`: disciplinas, planes, clases y profes) y la BD de staging en marcha. Crea:

- 40 alumnos adultos con cuota (30 activas, 3 en gracia `past_due`, 3 impagadas `unpaid`, 4 bajas repartidas en los 6 meses), 6 tutores
  con 10 menores (cuota Infantil activa), altas repartidas en 180 días y 3 de hoy. 6 alumnos activos no vienen desde hace más de 14 días.
- Sesiones pasadas (180 días) de las clases que ya hay, reservas confirmadas (sin pasar el aforo) en pasadas y futuras (hasta +14 días)
  y asistencia `present`/`absent` (~80 % presentes) en las que ya han empezado.
- 3 eventos: 2 próximos (uno gratis, otro de pago) con inscritos confirmados, y 1 pasado.
- Auditoría `subscription.create` / `subscription.cancel_now` por cada alta y baja (alimenta «Hoy en la academia»), y las fotos diarias
  de `academy_stats_daily` de los 180 días anteriores a ayer (sintéticas); ayer y hoy salen de `academy_stats_of`.

Es **repetible**: todo lo de demo lleva un id que empieza por `de0a0000-` (emails `@demo.kaizen.test`, sin contraseña: no se puede
entrar con ellos) y cada ejecución lo borra y lo recrea en una transacción; lo que no es de demo no se toca (ni las cuentas del seed).
Se niega a correr si la `DATABASE_URL_SERVICE` no es `kaizen_staging` en el `:5433` (ni `kaizen_db` en el `:5432`) o si la clave de Stripe no es de prueba.

**No toca Stripe.** Las cuotas llevan ids falsos (`sub_test_demo_*`, `cus_test_demo_*`): no tienen portal de facturación ni reciben
webhooks, y no hay facturas. Sirven para mirar, no para cobrar, cancelar ni cambiar de plan desde la app.

## Fotos de perfil (B24)

Se guardan en `storage-staging/avatars/` (junto a `agreements/`) y se sirven en `/api/avatars/<nombre>` sin token (ADR 0019).
Si reinicias staging de cero, borra también esa carpeta: las fotos huérfanas no se limpian solas.
