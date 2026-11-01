/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare let self: ServiceWorkerGlobalScope

// ADR 0015: solo el esqueleto (HTML, JS, CSS, fuentes, iconos). Nada de /api/*: ni se precachea ni se intercepta.
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
// Abrir cualquier ruta sin red sirve el index.html de la precaché; cada pantalla enseña «Sin conexión».
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }))

// Versión nueva: espera al «Actualizar» del aviso (updateSW manda SKIP_WAITING); nunca se activa sola.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting()
})

// ADR 0011: title y body del backend, sin añadir nada; el tag (id del aviso) evita verlo dos veces.
self.addEventListener('push', (event) => {
  const { title, body, tag, url } = event.data?.json() ?? {}
  if (!title) return
  event.waitUntil(
    self.registration.showNotification(title, { body, tag, icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', data: { url } }),
  )
})

// Enfoca una ventana abierta de la app y la lleva a su url; si no hay, abre una.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url ?? '/', self.location.origin).href
  event.waitUntil(
    (async () => {
      const [client] = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      if (!client) return void (await self.clients.openWindow(url))
      await client.focus()
      await client.navigate(url).catch(() => self.clients.openWindow(url))
    })(),
  )
})

// pushsubscriptionchange: nada (el SW no tiene el token); la app resincroniza al abrir.
