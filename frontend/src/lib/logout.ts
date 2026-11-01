import { QueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { clearToken } from '@/lib/session'

// ADR 0015: la caché de TanStack Query solo vive en memoria.
export const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } })

// ADR 0014, en este orden: (1) baja del push en el servidor, (2) en el navegador, (3) token, (4) caché, (5) /login.
// Con la sesión caducada no se puede llamar a (1); (2) deja el endpoint muerto y el worker lo borra al ver el 410.
// El paso (5) lo da el router al ver la sesión vacía (RequireSession), con el motivo que deja clearToken.
export async function logout({ expired = false } = {}): Promise<void> {
  const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined)
  const sub = await reg?.pushManager.getSubscription().catch(() => null)
  if (sub && !expired) {
    await api('/me/push-subscriptions', { method: 'DELETE', body: { endpoint: sub.endpoint } }).catch(() => {})
  }
  await sub?.unsubscribe().catch(() => {})
  clearToken(expired ? 'expired' : 'logout')
  queryClient.clear()
}
