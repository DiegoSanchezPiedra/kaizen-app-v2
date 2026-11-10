# Despliegue en el VPS (ADR 0017)

Un VPS con Docker Compose: `db` (Postgres 16 con los roles de `deploy/staging/init-roles.sh`), `api` (Node, no root, lleva el
worker de avisos) y `web` (nginx con `deploy/nginx.conf` y el frontend compilado en la imagen). Datos en dos volúmenes:
`db` y `storage` (`/app/storage`: PDFs legales en `agreements/`, fotos en `avatars/`, logs). Los secretos, solo en el `.env` del servidor.

## Primer despliegue

1. En el VPS: Docker con el plugin Compose, `git`, y el repo clonado con una *deploy key* de solo lectura.
2. `cp deploy/.env.prod.example .env` y rellénalo (más lo que falta de la API en `.env.example`). Claves de Stripe: la cuenta
   real es la de maat; no pongas claves `live` hasta B10.7.
3. `deploy/deploy.sh`: `git pull`, build, arranca `db` (el primer arranque crea roles y base), migraciones y `up -d`.
   Producción no se abre sin TLS (decidido: certbot en el host). Sin TLS publica el `:80`. Con TLS (certbot en el host) pon `WEB_BIND=127.0.0.1:8080` y proxy desde el nginx del host.
   `GOOGLE_CLIENT_ID` y `VITE_STRIPE_PUBLISHABLE_KEY` se compilan en la imagen `web`: deben estar en el `.env` antes del primer `deploy/deploy.sh`; si faltan, el pago con tarjeta no carga y hay que recompilar `web`.
4. `deploy/check-gzip.sh https://<dominio>`: comprueba que el JS, el CSS y `sw.js` llegan con `content-encoding: gzip`. Si falla, el
   contenedor `web` comprime pero el nginx del host no lo deja pasar: que no quite `Accept-Encoding` y, si añade `Via`, `gzip_proxied any;`.
5. Cron del sistema (`crontab -e`; en Debian/Ubuntu la zona sale de `timedatectl`, ver `scripts/README.md`):

```cron
CRON_TZ=Europe/Madrid
0 3 * * * cd /ruta/al/repo && docker compose -f docker-compose.prod.yaml exec -T api node scripts/nightly.js >> /var/log/kaizen/nightly.log 2>&1
30 3 * * * /ruta/al/repo/deploy/backup.sh >> /var/log/kaizen/backup.log 2>&1
```

El worker de avisos va dentro de la API: no necesita cron. `npm run build:prod` solo construye las imágenes.

## Actualizar

`deploy/deploy.sh` (se para si `git pull --ff-only` no puede avanzar). Las migraciones corren antes de levantar la API nueva. Si cambias el nginx, repite `deploy/check-gzip.sh`.

## Backups

`deploy/backup.sh` deja en `BACKUP_DIR` (por defecto `/var/backups/kaizen`, modo 600) `db-FECHA.dump` (`pg_dump -Fc`) y
`storage-FECHA.tar.gz` (agreements, avatars y logs), y borra los de más de `KEEP_DAYS` (14). Un fallo deja el `.part` y sale con error.

**Copia fuera del VPS (decidido el 2026-11-10, sin montar):** almacenamiento de objetos compatible con S3 y copia cifrada (`restic`, o `age` antes de subir), más un aviso si el cron falla. Hasta montarla, estas copias comparten disco y servidor con los datos: no protegen de perder el VPS. Los snapshots del proveedor ayudan, no sustituyen.

## Restaurar

`D` = el dump elegido, `S` = el tar de storage.

```bash
C="docker compose -f docker-compose.prod.yaml"
$C stop api web
$C exec -T db pg_restore -U postgres --clean --if-exists --exit-on-error -d kaizen < D   # usuario y base del .env
$C up -d api web && $C exec -T api tar -xzf - -C /app < S                                  # añade ficheros; no borra los que sobran
```

En un VPS nuevo: primero el primer despliegue (crea roles y base vacía), luego lo anterior. Los dumps conservan los dueños,
que son los roles del `init-roles.sh`. Para ensayar sin riesgo, restaura en un `docker run postgres:16` aparte, o en una base nueva del mismo `db` sin tocar la real: `$C exec -T db createdb -U postgres kaizen_restore`, `$C exec -T db pg_restore -U postgres --exit-on-error -d kaizen_restore < D` (sin `--clean`), compara y bórrala con `$C exec -T db dropdb -U postgres kaizen_restore`.

## Variables

Las de `.env.example` más `deploy/.env.prod.example`: contraseñas de los tres roles y `POSTGRES_PASSWORD`, `DB_NAME`,
`DATABASE_URL*` (host `db`), `APP_URL` (https), `TRUST_PROXY=1`, `GOOGLE_CLIENT_ID` y `VITE_STRIPE_PUBLISHABLE_KEY` (entran
en el frontend al compilar), `WEB_BIND`. `PORT` y `AGREEMENTS_STORAGE_PATH` los fija el compose.

El `.env` no se ejecuta como shell (admite `MFA_TOTP_ISSUER=Kaizen App` o `EMAIL_FROM=Kaizen <...>` sin comillas). La API recibe
solo las variables que lista `docker-compose.prod.yaml` (sin `POSTGRES_*` ni la `DATABASE_URL` de migrator, que solo ve `migrate`):
si añades una variable nueva a la API, añádela también a esa lista.
