#!/bin/sh
# Certificado TLS (Let's Encrypt, webroot) para el nginx del contenedor web. Uso: sudo deploy/tls-init.sh <dominio> <email>
# Orden: 1) este script (deja un certificado provisional) 2) deploy/deploy.sh 3) este script otra vez (emite el real).
# Requisitos: certbot en el host y el DNS (registro A, sin AAAA) ya apuntando al VPS. Las renovaciones las hace el timer de
# certbot; el deploy-hook copia el certificado y recarga nginx.
set -eu
cd "$(dirname "$0")/.."
D=${1:?Uso: $0 <dominio> <email>}; E=${2:?Uso: $0 <dominio> <email>}
CERTS=/etc/kaizen/certs
COMPOSE="$(pwd)/docker-compose.prod.yaml"
mkdir -p "$CERTS" /var/www/certbot
# nginx no arranca sin certificado: uno provisional (30 días) que el real sustituye.
if [ ! -f "$CERTS/fullchain.pem" ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=$D" -keyout "$CERTS/privkey.pem" -out "$CERTS/fullchain.pem"
  chmod 600 "$CERTS/privkey.pem"
fi
if ! docker compose -f "$COMPOSE" ps --status running --services | grep -qx web; then
  echo "Certificado provisional listo. Ejecuta deploy/deploy.sh y repite este comando para emitir el real." >&2
  exit 0
fi
certbot certonly --webroot -w /var/www/certbot -d "$D" -m "$E" --agree-tos --non-interactive --cert-name kaizen \
  --deploy-hook "install -m 600 /etc/letsencrypt/live/kaizen/privkey.pem $CERTS/privkey.pem && install -m 644 /etc/letsencrypt/live/kaizen/fullchain.pem $CERTS/fullchain.pem && docker compose -f $COMPOSE exec -T web nginx -s reload"
echo "Certificado emitido. Comprueba: curl -sI https://$D/ | head -1"
