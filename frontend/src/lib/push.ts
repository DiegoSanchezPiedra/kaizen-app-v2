import { api, ApiError } from '@/lib/api'

// ADR 0011 y el traspaso de B18.6 en el canvas. La tarjeta es del dispositivo, no del sujeto.
export type PushState = 'ofrecer' | 'pidiendo' | 'activado' | 'denegado' | 'ios' | 'sin_soporte' | 'error'
export type Support = 'ok' | 'ios' | 'sin_soporte'

export function pushSupport(nav: Navigator = navigator, win: typeof globalThis = globalThis): Support {
  if ('serviceWorker' in nav && 'PushManager' in win && 'Notification' in win) return 'ok'
  // iPadOS se presenta como Mac; sin standalone no hay push hasta instalar la app.
  const ios = /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)
  const standalone = win.matchMedia?.('(display-mode: standalone)').matches
  return ios && !standalone ? 'ios' : 'sin_soporte'
}

export function cardState(o: {
  support: Support
  permission: NotificationPermission
  subscribed: boolean
  busy: boolean
  failed: boolean
}): PushState {
  if (o.support !== 'ok') return o.support
  if (o.busy) return 'pidiendo'
  if (o.permission === 'denied') return 'denegado'
  // Con permiso pero sin suscripción (p. ej. tras cerrar sesión) no se suscribe solo: vuelve la tarjeta.
  if (o.permission === 'granted' && o.subscribed) return 'activado'
  return o.failed ? 'error' : 'ofrecer'
}

// Inicio: nunca sin soporte ni tras «Ahora no»; activado o denegado solo si se acaba de decidir en esta visita.
export function showOnHome(state: PushState, o: { dismissed: boolean; decidedNow: boolean }): boolean {
  if (state === 'sin_soporte' || o.dismissed) return false
  if (state === 'activado' || state === 'denegado') return o.decidedNow
  return true
}

export function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const b64 = key.replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0))
}

export function sameKey(current: ArrayBuffer | null, key: string): boolean {
  if (!current) return false
  const a = new Uint8Array(current)
  const b = keyBytes(key)
  return a.length === b.length && a.every((x, i) => x === b[i])
}

const post = (sub: PushSubscription) => {
  const { endpoint, keys } = sub.toJSON()
  return api('/me/push-subscriptions', { method: 'POST', body: { endpoint, keys } })
}
const subscribe = (pm: PushManager, key: string) => pm.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) })

// Al abrir con permiso: si hay suscripción, se cambia si la clave VAPID no es la de la API y se reafirma con POST
// (upsert que la pasa al usuario actual). Sin suscripción no hace nada. Devuelve si queda suscrito.
export async function syncPush(pm: PushManager, key: string): Promise<boolean> {
  let sub = await pm.getSubscription()
  if (!sub) return false
  if (!sameKey(sub.options.applicationServerKey, key)) {
    await sub.unsubscribe()
    sub = await subscribe(pm, key)
  }
  await post(sub)
  return true
}

// Al tocar «Activar avisos». Lanza si fallan subscribe() o el POST.
export async function enablePush(key: string): Promise<NotificationPermission> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission
  const reg = await navigator.serviceWorker.ready
  await post(await subscribe(reg.pushManager, key))
  return permission
}

// GET /push/vapid-public-key y, con permiso, la resincronización. null = 503 push_disabled (no se pinta nada).
export async function loadPush(): Promise<{ key: string; subscribed: boolean } | null> {
  let key: string
  try {
    key = (await api<{ key: string }>('/push/vapid-public-key')).key
  } catch (err) {
    if (err instanceof ApiError && err.code === 'push_disabled') return null
    throw err
  }
  if (pushSupport() !== 'ok' || Notification.permission !== 'granted') return { key, subscribed: false }
  const reg = await navigator.serviceWorker.getRegistration()
  const subscribed = reg ? await syncPush(reg.pushManager, key).catch(() => false) : false
  return { key, subscribed }
}
