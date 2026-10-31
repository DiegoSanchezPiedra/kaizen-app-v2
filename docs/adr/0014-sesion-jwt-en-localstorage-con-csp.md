# La sesión es el JWT en `localStorage`, protegido con una CSP estricta, y cerrarla nunca se queda a medias

El backend solo acepta `Authorization: Bearer` (7 días, sin refresh ni logout de servidor). La PWA guarda el token en **`localStorage`**: sobrevive a cerrar la app, que en un móvil es lo normal. El riesgo es un XSS que lo lea (detrás hay fichas de salud de menores), y se frena con una **CSP estricta en Nginx** (`script-src 'self' https://accounts.google.com https://js.stripe.com`, `connect-src 'self'`, sin scripts inline) y con la regla de no usar `dangerouslySetInnerHTML`. El Service Worker no necesita el token.

**Cerrar sesión**, en este orden: (1) si hay suscripción de push, `DELETE /me/push-subscriptions`; (2) `PushSubscription.unsubscribe()` en el navegador; (3) borrar el token; (4) vaciar la caché de TanStack Query; (5) ir a `/login`. Si (1) falla sin red se sigue: (2) deja el endpoint muerto y el worker borra la fila al recibir el 410 (ADR 0011). Un `401 invalid_token|missing_token`, o un `exp` ya pasado al abrir, hace (2)–(5): con el token caducado no se puede llamar a (1), pero (2) no lo necesita. El evento `storage` cierra la sesión en todas las pestañas.

## Considered Options

- **Cookie `httpOnly`**: el JavaScript no la lee, pero exige cambiar el login (poner la cookie), `requireAuth` (leerla) y añadir protección CSRF en cada escritura, con tests en auth, MFA, Google y tablet. Con un XSS se puede seguir llamando a la API desde la página, solo que sin llevarse el token. Queda como mejora posible en B20.
- **Solo en memoria**: hay que iniciar sesión cada vez que se abre la PWA.

## Consequences

La seguridad de la sesión depende de la CSP: un script de un tercero que se añada después (analítica, chat) tiene que entrar en ella y revisarse. Pasar a la cookie más adelante es posible sin migrar datos, pero toca el backend entero de auth.
