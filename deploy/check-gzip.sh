#!/bin/bash
# Comprueba que el JS, el CSS y sw.js llegan con gzip. Uso: deploy/check-gzip.sh https://<dominio>
set -euo pipefail
u=${1:?Uso: $0 <url>}; u=${u%/}
html=$(curl -fsS "$u/")
rutas=$(echo "$html" | grep -oE '/assets/index-[^"]+\.(js|css)' | sort -u || true)
[ "$(echo "$rutas" | wc -l)" -ge 2 ] || { echo "No encuentro el JS y el CSS principales en $u/" >&2; exit 1; }
fallo=0
for r in $rutas /sw.js; do
  h=$(curl -sI -H 'Accept-Encoding: gzip' "$u$r" | tr -d '\r')
  if echo "$h" | head -1 | grep -q ' 200' && echo "$h" | grep -qi '^content-encoding: gzip'; then
    echo "OK    $r"
  else
    echo "FALLO $r"; fallo=1
  fi
done
[ "$fallo" = 0 ] || echo "Pista: si el contenedor web comprime pero el host no lo deja pasar, revisa el nginx del host (que no quite Accept-Encoding y, si añade Via, gzip_proxied any; en deploy/nginx.conf)." >&2
exit "$fallo"
