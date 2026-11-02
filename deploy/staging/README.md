# Staging por ngrok (para que el cliente pruebe)

Una instancia aparte de la de desarrollo: BD propia (`:5433`), API en el `:3100`, nginx con la **misma config de producción**
(`deploy/nginx.conf`: un solo origen, la API bajo `/api`) en el `:8080`, y ngrok apuntando a `:8080`. Todo con **Stripe en
modo prueba**. No es el despliegue final (VPS, ADR 0017); sirve para enseñar la app.

```
cliente ──https──▶ ngrok ──▶ nginx :8080 ──┬─▶ frontend/dist (PWA)
                                           └─▶ /api → API :3100 ──▶ Postgres :5433
```

## Una vez

1. `cp deploy/staging/.env.staging.example .env.staging` y rellénalo (está en `.gitignore`). Secretos: `openssl rand -base64 32`;
   claves VAPID: `npx web-push generate-vapid-keys`; `STRIPE_SECRET_KEY` **solo `sk_test_`/`rk_test_`** (el seed se niega si no).
2. `APP_URL` = la URL https de ngrok (de ella salen los enlaces de los emails y las vueltas de Stripe). Con un dominio fijo de
   ngrok no cambia al reiniciar.
3. `npm run staging:db` (crea los roles y la base con `init-roles.sh`; solo el primer arranque) y `npm run staging:migrate`.
4. `npm run staging:build` (frontend compilado; el login con Google solo sale si compilas con `VITE_GOOGLE_CLIENT_ID`).
5. `mkdir -p storage-staging/agreements`.

## Cada vez que lo enciendes

```bash
npm run staging:db && npm run staging:web   # BD y nginx (Docker)
npm run staging:api                         # la API, en otra terminal
stripe listen --forward-to localhost:3100/webhooks/stripe   # otra terminal; pon su whsec_ en STRIPE_WEBHOOK_SECRET
ngrok http 8080                             # (o con tu dominio: ngrok http --url=TU-DOMINIO.ngrok-free.app 8080)
```

El webhook va por `stripe listen` (la API es local), así que no hace falta registrar un endpoint en el Dashboard.
Si cambias `.env.staging`, reinicia la API.

## Datos de demo

`npm run staging:seed` (con la API arrancada; repetible): admin, 2 profesores, 2 alumnos, un tutor con un hijo menor,
3 disciplinas, 4 planes (crean Products y Prices en el sandbox), el seguro con sus precios, 5 clases (sus sesiones a un año)
y los 3 documentos legales publicados (PDFs de prueba). Imprime las cuentas; la contraseña es `SEED_PASSWORD`.
**El perfil del alumno sale incompleto a propósito** (ficha médica, acuerdos): es parte de lo que el cliente prueba.

`npm run staging:nightly` genera las sesiones que falten y la foto de ayer de los informes (en producción es un cron, ADR 0012).

## Qué necesita el cliente (y tú, antes)

| Para probar | Hace falta |
|---|---|
| Entrar, reservar, calendario, check-in con QR, progreso | nada más |
| Emails (avisos, recuperar contraseña) | `EMAIL_TRANSPORT=resend` + `RESEND_API_KEY`; sin él van a `storage-staging/emails.log` y nadie los ve |
| Push | `PUSH_TRANSPORT=webpush` + claves VAPID; solo con HTTPS (ngrok) y la app instalada (en iPhone, desde la pantalla de inicio) |
| Pagar | tarjeta de prueba de Stripe `4242 4242 4242 4242` (cualquier fecha futura y CVC); 3DS: `4000 0025 0000 3155` |
| Login con Google | cliente OAuth con el dominio de ngrok autorizado + `VITE_GOOGLE_CLIENT_ID` al compilar |
| Tablet | abrir `/tablet` en otro dispositivo con el código de Admin › Tablets |

## Cuidado

- La URL de ngrok es **pública**: cualquiera que la tenga ve la pantalla de entrada. Pasa solo las cuentas de demo y no metas
  datos reales de clientes de maat. El rate limiting aún no está (B20).
- ngrok gratis enseña una pantalla intermedia la primera vez y cambia la URL al reiniciar (rompe enlaces de emails ya enviados).
- Reiniciar de cero: `docker compose -f deploy/staging/docker-compose.staging.yaml --env-file .env.staging down -v`
  (borra la BD de staging) y repite «Una vez» 3 y el seed.
