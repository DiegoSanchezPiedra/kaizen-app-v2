# Producción es un solo VPS con Docker Compose y nginx; por ahora se despliega con `git pull`, y las imágenes de un registro privado quedan por valorar

La app es un proceso Node, una base de datos Postgres (con sus dos roles y la RLS), un frontend estático y ficheros en disco (`storage/`, los PDFs legales). Para una academia no hace falta repartirlo en varios nodos. Decisión del 2026-11-02, para ejecutarla en B20 y B10.7 cuando haya dominio y servidor; hoy no hay entorno de despliegue.

Se hace así:

- **Un VPS con Docker Compose**: `db` (Postgres 16, como el `docker-compose.yaml` de desarrollo) y `api` (Node). nginx sirve `frontend/dist` y hace de proxy de `/api/`, con la plantilla de `deploy/nginx.conf` y HTTPS con certbot. Los datos de Postgres y `storage/` van en volúmenes.
- **Cron del sistema** en el host para los procesos periódicos (ADR 0012).
- **Backups** de `pg_dump` y de `storage/` fuera del VPS, con una restauración probada (B20).
- **Los secretos** van en un `.env` solo del servidor, nunca en el repositorio.
- **Por ahora se despliega con el repo**: `git pull` en el VPS y `docker compose up -d --build`; las migraciones, desde el contenedor de la API.

## Considered Options

- **Kubernetes**: réplicas, autoescalado y varios nodos que esta app no necesita; semanas de configuración y un coste mayor para el mismo resultado. Solo si algún día hay varias academias y mucho tráfico.
- **Instalar todo a mano en el VPS** (Node, Postgres y nginx con systemd): funciona, pero el entorno no se repite ni se mueve a otro servidor con facilidad.
- **Imágenes de un registro privado (ghcr.io)**: **por valorar**, no descartada. CI construiría la imagen de la API con la etiqueta del commit, la subiría a ghcr.io (gratis y privado con el repo de GitHub) y el VPS haría `docker login` con un token de solo lectura, `docker compose pull` y `up -d`. Ventajas: el servidor no necesita el código ni las herramientas de compilación, el despliegue es rápido y se vuelve atrás cambiando la etiqueta. Coste: un `Dockerfile`, un flujo de CI y decidir cómo llega el frontend. Se retoma si el build en el VPS resulta lento o incómodo.
- **Imágenes públicas en Docker Hub**: descartado. La imagen lleva el código de la API (lógica de cobros, migraciones, políticas RLS) y pública lo puede descargar cualquiera; además Docker Hub limita los pulls anónimos.

## Consequences

- Hay que escribir un `Dockerfile` de la API, un `docker-compose.prod.yaml` y un script de despliegue; el VPS necesita el repo (o al menos `docker-compose.prod.yaml`, la API y `frontend/`) y construye allí.
- El frontend se construye (`npm run build`) y nginx sirve `frontend/dist`; si más adelante se pasa a imágenes, se decide si va dentro de una imagen de nginx.
- El código fuente vive en el servidor: la clave de despliegue del repo debe ser de solo lectura (*deploy key*) y el VPS bien cerrado.
- Un solo VPS es un punto único de fallo: se acepta, con snapshots del proveedor y un aviso externo simple.
- El webhook de Stripe necesita una URL pública con HTTPS, y pasar a la cuenta real de Stripe sigue siendo B10.7, no solo el despliegue.
