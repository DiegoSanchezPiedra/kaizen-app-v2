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

El seed es repetible e imprime las cuentas (contraseña: `SEED_PASSWORD`): admin, 2 profesores, 2 alumnos y un tutor con un hijo
menor; 3 disciplinas, 4 planes (crean Products y Prices en el sandbox), el seguro con sus precios, 5 clases (con sus sesiones a
un año) y los 3 documentos legales publicados (PDFs de prueba). **El perfil del alumno sale incompleto a propósito** (ficha
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
| `.env.staging` | reinicia la API (solo lo lee al arrancar). Si cambias `VITE_*`, también `npm run staging:build` |

**La PWA no se actualiza sola, a propósito**: el navegador sigue con la versión que tenía guardada hasta que la persona toca el
aviso **«Hay una versión nueva · Actualizar»**. Si no sale, cerrar todas las pestañas de la URL y volver a abrirla; en último
caso, DevTools → Application → Service workers → «Unregister» y recargar. Díselo al cliente: si un error ya arreglado le sigue
saliendo, es esto. (Para saber qué versión tiene: el nombre `index-XXXX.js` del error debe coincidir con el de `frontend/dist/assets`.)

(Con ngrok gratis el aviso no salía nunca en iPhone: el navegador pedía `sw.js`, ngrok le contestaba con su página de aviso en
HTML y la actualización fallaba en silencio. Por eso se pasó a Tailscale Funnel. Cualquier túnel o proxy que meta una página
intermedia rompe igual las actualizaciones de la PWA.)

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
`EMAIL_FROM=Kaizen <avisos@tu-dominio>`. Reinicia la API.

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

## Cuidado

- La URL de Funnel es **pública**: cualquiera que la tenga ve la pantalla de entrada. Pasa solo las cuentas de demo y no metas
  datos reales de clientes de maat.
- Solo claves de **prueba** de Stripe. Nada de este staging toca la cuenta live.
- `frontend/vite.config.ts` no necesita `allowedHosts` para esto: nginx sirve el `dist` compilado. Solo haría falta para exponer el
  servidor de Vite (`npm run dev`) por el túnel.

---

## Datos de demo

`npm run staging:demo` llena el staging con una academia mediana de 3 meses, para ver el panel del admin con cifras. Necesita el
seed hecho (`npm run staging:seed`: disciplinas, planes, clases y profes) y la BD de staging en marcha. Crea:

- 40 alumnos adultos con cuota (30 activas, 3 en gracia `past_due`, 3 impagadas `unpaid`, 4 bajas repartidas en los 3 meses), 6 tutores
  con 10 menores (cuota Infantil activa), altas repartidas en 90 días y 3 de hoy. 6 alumnos activos no vienen desde hace más de 14 días.
- Sesiones pasadas (90 días) de las clases que ya hay, reservas confirmadas (sin pasar el aforo) en pasadas y futuras (hasta +14 días)
  y asistencia `present`/`absent` (~80 % presentes) en las que ya han empezado.
- 3 eventos: 2 próximos (uno gratis, otro de pago) con inscritos confirmados, y 1 pasado.
- Auditoría `subscription.create` / `subscription.cancel_now` por cada alta y baja (alimenta «Hoy en la academia»), y las fotos diarias
  de `academy_stats_daily` de los 90 días anteriores a ayer (sintéticas); ayer y hoy salen de `academy_stats_of`.

Es **repetible**: todo lo de demo lleva un id que empieza por `de0a0000-` (emails `@demo.kaizen.test`, sin contraseña: no se puede
entrar con ellos) y cada ejecución lo borra y lo recrea en una transacción; lo que no es de demo no se toca (ni las cuentas del seed).
Se niega a correr si la `DATABASE_URL_SERVICE` no es `kaizen_staging` en el `:5433` o si la clave de Stripe no es de prueba.

**No toca Stripe.** Las cuotas llevan ids falsos (`sub_test_demo_*`, `cus_test_demo_*`): no tienen portal de facturación ni reciben
webhooks, y no hay facturas. Sirven para mirar, no para cobrar, cancelar ni cambiar de plan desde la app.
