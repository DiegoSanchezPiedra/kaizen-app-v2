# Producción es un solo VPS con Docker Compose y nginx, y se despliega con imágenes de un registro privado

La app es un proceso Node, una base de datos Postgres (con sus dos roles y la RLS), un frontend estático y ficheros en disco (`storage/`, los PDFs legales). Para una academia no hace falta repartirlo en varios nodos. Decisión del 2026-11-02, para ejecutarla en B20 y B10.7 cuando haya dominio y servidor; hoy no hay entorno de despliegue.

Se hace así:

- **Un VPS con Docker Compose**: `db` (Postgres 16, como el `docker-compose.yaml` de desarrollo) y `api` (Node). nginx sirve `frontend/dist` y hace de proxy de `/api/`, con la plantilla de `deploy/nginx.conf` y HTTPS con certbot. Los datos de Postgres y `storage/` van en volúmenes.
- **Cron del sistema** en el host para los procesos periódicos (ADR 0012).
- **Backups** de `pg_dump` y de `storage/` fuera del VPS, con una restauración probada (B20).
- **Los secretos** van en un `.env` solo del servidor, nunca en el repositorio ni en la imagen.
- **Se despliega con imágenes, no con el repo**: CI construye la imagen de la API y la sube con la etiqueta del commit a un **registro privado** (ghcr.io, que ya acompaña al repo de GitHub); el VPS hace `docker login` con un token de solo lectura, `docker compose pull` y `up -d`. Las migraciones se corren desde esa misma imagen. Se vuelve atrás cambiando la etiqueta. Estado: **por confirmar** al llegar a B20.

## Considered Options

- **Kubernetes**: réplicas, autoescalado y varios nodos que esta app no necesita; semanas de configuración y un coste mayor para el mismo resultado. Solo si algún día hay varias academias y mucho tráfico.
- **Instalar todo a mano en el VPS** (Node, Postgres y nginx con systemd): funciona, pero el entorno no se repite ni se mueve a otro servidor con facilidad.
- **Imágenes públicas en Docker Hub**: descartado. La imagen lleva el código de la API (lógica de cobros, migraciones, políticas RLS), y pública lo puede descargar cualquiera; además Docker Hub limita los pulls anónimos. Con un registro privado se mantienen las ventajas de desplegar por imagen.
- **`git pull` y construir en el VPS**: más simple, pero el servidor necesita el código fuente y las herramientas de compilación, y cada despliegue tarda lo que tarde el build.

## Consequences

- Hay que escribir un `Dockerfile` de la API, un `docker-compose.prod.yaml`, el flujo de CI que construye y publica la imagen y un script de despliegue; el VPS necesita solo el compose, el `.env` y la plantilla de nginx, no el repo.
- El frontend se construye en CI y se copia a `frontend/dist` del VPS (o se mete en una imagen de nginx); queda por decidir al llegar a B20.
- Un solo VPS es un punto único de fallo: se acepta, con snapshots del proveedor y un aviso externo simple.
- El webhook de Stripe necesita una URL pública con HTTPS, y pasar a la cuenta real de Stripe sigue siendo B10.7, no solo el despliegue.
