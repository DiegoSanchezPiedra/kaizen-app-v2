# El frontend es una SPA de React + Vite + TypeScript en `frontend/`, y Nginx sirve la API bajo `/api/` sin tocar el backend

El primer frontend (B18) decide el stack que repiten todas las pantallas de B18 y B19. Es **React + Vite + TypeScript**, con React Router, TanStack Query para los datos del servidor (sin librería de estado global) y **Tailwind CSS v4 + coss ui** (componentes sobre Base UI que se copian al repo con el CLI de shadcn). La fase visual se hace en Claude Design, que exporta HTML/React, y coss ui solo existe para React, Tailwind v4 y `.tsx`; por eso el frontend va en TypeScript aunque el backend sea JS (los tipos de la API se escriben a mano desde `docs/api.md`). No hay SSR: es una PWA contra una API propia.

El backend construye enlaces a rutas del frontend (`/billing`, `/bookings`, `/agreements`, ver `docs/api.md`) que coinciden con rutas de la API montadas en la raíz. En un mismo dominio, **Nginx sirve la API bajo `/api/` quitando el prefijo** (`proxy_pass http://127.0.0.1:3000/;`) y el resto desde `frontend/dist` con `try_files $uri /index.html`; el proxy de Vite hace lo mismo en desarrollo. Mismo origen: sin CORS. El código vive en `frontend/` con su propio `package.json`, sin workspaces, y `npm run build:frontend` (`npm --prefix frontend ci && npm --prefix frontend run build`) es el build reproducible.

## Considered Options

- **TypeScript no / JavaScript como el backend**: cada componente de coss ui habría que convertirlo al copiarlo.
- **SvelteKit, Vue o sin framework**: lo que exporta Claude Design habría que traducirlo pantalla a pantalla, y sin framework el router, los formularios y la caché se escribirían a mano.
- **Next.js**: SSR y un servidor de Node más que no aportan nada a una PWA detrás de una API propia.
- **Subdominio `api.`**: CORS en el backend y un *preflight* por cada petición con `Authorization`.
- **Prefijo `/api` en Express**: toca `src/index.js` y todos los tests HTTP.

## Consequences

La URL del webhook de Stripe pasa a `/api/webhooks/stripe` (hoy solo en el sandbox; en producción, al configurarlo en B10.7). El SSE de la tablet necesita `proxy_buffering off` en `/api/tablet/`. Cambiar de framework después es reescribir todas las pantallas; sacar la API de `/api/` obliga a cambiar el cliente y la configuración de Nginx.
