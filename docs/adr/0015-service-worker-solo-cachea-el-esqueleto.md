# El Service Worker solo cachea el esqueleto de la app; los datos de la API no se guardan nunca en el dispositivo

Un móvil puede ser de varias personas (un tutor y su hijo, una familia) y la API devuelve fichas de salud, reservas y pagos. Por eso **el Service Worker solo precachea el esqueleto** (HTML, JS, CSS, fuentes, iconos y logo), que no lleva datos de nadie, y **no intercepta `/api/*`**. Nginx añade `Cache-Control: no-store` a todas las respuestas de `/api/` (el backend hoy no lo pone), para que tampoco las guarde la caché HTTP del navegador, y la caché de TanStack Query vive solo en memoria, sin persistirse. Lo único que queda en el dispositivo es el token (ADR 0014), que se borra al cerrar sesión.

**Offline**, la app abre y cada pantalla con datos muestra «sin conexión» con reintentar; no hay escrituras en cola (ni reservas, ni cancelaciones, ni check-in). El Service Worker se genera con `vite-plugin-pwa` en modo `injectManifest`, con un `sw.ts` propio para el push, y una versión nueva se ofrece con un aviso en vez de activarse sola, para no recargar a nadie a mitad de un pago o de pasar lista.

## Considered Options

- **Cachear lecturas de la API** (el calendario, las reservas) para verlas sin red: en un móvil compartido el siguiente usuario vería las del anterior, y habría que borrar esas cachés por usuario sin poder fiarse de que se cierre sesión.
- **Cola de escrituras offline** (Background Sync): una reserva o un check-in que se envía horas después ya no tiene sentido (ventana de reserva, QR caducado), y los errores llegarían cuando nadie mira.
- **Activar la versión nueva sola** (`skipWaiting`): puede recargar a mitad del Checkout o de cerrar una lista.

## Consequences

Sin red, la app no enseña nada propio, ni siquiera la próxima reserva. Cachear datos más adelante obliga a decidir antes cómo se borran por usuario y a sacar de ahí todo lo de salud.
