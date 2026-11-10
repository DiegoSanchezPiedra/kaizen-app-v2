#!/bin/sh
# Despliegue en el VPS (ADR 0017): código nuevo, imágenes, migraciones y arranque. Desde cualquier directorio.
set -eu
cd "$(dirname "$0")/.."
C="docker compose -f docker-compose.prod.yaml"
[ -f .env ] || { echo "Falta .env (copia deploy/.env.prod.example)" >&2; exit 1; }
git pull --ff-only
$C build
$C up -d db
$C run --rm migrate
$C up -d --remove-orphans
$C ps
