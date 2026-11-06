# Las fotos de perfil se guardan en disco y se sirven con una URL secreta del mismo origen

Cada perfil puede tener una foto (B24). Decisión del 2026-11-06, en el diseño de B24.

Se hace así:

- **En disco**, en `storage/avatars/` (como los acuerdos, ADR 0017: un VPS con copias de seguridad), con un nombre de 32 bytes
  aleatorios. `profiles.avatar` guarda ese nombre.
- **Se sirven en `GET /api/avatars/<nombre>`, sin token.** El JWT vive en `localStorage` (ADR 0014) y un `<img>` no puede
  mandarlo. La URL es la credencial: la API solo la entrega en respuestas que quien mira ya puede ver (su propia cuenta, el
  tutor de un menor, el admin, el profesor de las sesiones del alumno y, si el dueño lo elige, su perfil público). Cambiar o
  quitar la foto borra el fichero y el nombre viejo deja de existir.
- **Recorte y reducción en el navegador** (`canvas`, cuadrado de 512 px, JPEG): quita el EXIF, también la ubicación GPS. El
  servidor no reprocesa la imagen. Acepta JPEG, PNG o WebP de hasta 1 MB, y comprueba los primeros bytes del fichero. La
  sirve con su tipo fijo, `nosniff` y una CSP que no deja ejecutar nada.
- **Quién la toca**: cada uno la suya; el tutor, la de sus hijos menores; el admin solo la quita (por inadecuada), y el dueño
  (o el tutor) recibe un aviso sin el motivo. Todo queda en la auditoría.

## Considered Options

- **Pedir cada foto con el token (`fetch` → `blob:`)**: obliga a comprobar en cada petición quién puede ver la foto de quién,
  a añadir `blob:` a la CSP y a escribir más código. La caché del navegador sirve de menos.
- **Almacenamiento externo (S3 o similar)**: un servicio y unas credenciales más para unas pocas fotos de 50 KB.
- **Reprocesar en el servidor con `sharp`**: una dependencia nativa. Limpia mejor una imagen hecha a mano, pero el riesgo
  que cubre (que el propio dueño suba su EXIF) ya lo cubre el recorte del navegador en la app.

## Consequences

- Quien tenga la URL ve la foto, también tras perder el acceso, hasta que el dueño la cambie o la quite. Es lo mismo que pasa
  en Slack o Google. Para un menor, la URL solo llega a su tutor, al admin y al profesor de sus sesiones.
- `deploy/nginx.conf` no cambia: la foto llega por `/api/` y `img-src 'self'` ya la permite.
- Las fotos entran en la copia de seguridad del disco del VPS, junto a los acuerdos.
