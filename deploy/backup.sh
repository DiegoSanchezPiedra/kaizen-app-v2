#!/bin/sh
# Copia de la BD (pg_dump custom) y de storage/ (PDFs legales, fotos de perfil, logs) en BACKUP_DIR, con rotación.
# Lo lanza el cron del VPS (ver deploy/README.md). La copia FUERA del VPS no está resuelta: decisión pendiente.
set -eu
cd "$(dirname "$0")/.."
BACKUP_DIR=${BACKUP_DIR:-/var/backups/kaizen}
KEEP_DAYS=${KEEP_DAYS:-14}
C="docker compose -f docker-compose.prod.yaml"
set -a; . ./.env; set +a
mkdir -p "$BACKUP_DIR"
umask 077
D=$(date +%Y%m%d-%H%M%S)
# Se escribe a .part y se renombra: una copia a medias nunca pasa por válida.
$C exec -T db pg_dump -Fc -U "$POSTGRES_USER" "${DB_NAME:-kaizen}" > "$BACKUP_DIR/db-$D.dump.part"
$C exec -T api tar -C /app -czf - storage > "$BACKUP_DIR/storage-$D.tar.gz.part"
mv "$BACKUP_DIR/db-$D.dump.part" "$BACKUP_DIR/db-$D.dump"
mv "$BACKUP_DIR/storage-$D.tar.gz.part" "$BACKUP_DIR/storage-$D.tar.gz"
# Rotación por antigüedad: si el cron falla días, no se borra la última copia buena hasta pasados KEEP_DAYS.
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'db-*' -o -name 'storage-*' \) -mtime +"$KEEP_DAYS" -delete
echo "copia $D hecha en $BACKUP_DIR"
