import { QueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { clearToken, getSession, type EndReason } from '@/lib/session'

// ADR 0015: la caché de TanStack Query solo vive en memoria.
export const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } })

// ADR 0014, en este orden: (1) baja del push en el servidor, (2) en el navegador, (3) token, (4) caché, (5) /login.
// Con la sesión caducada no se puede llamar a (1); (2) deja el endpoint muerto y el worker lo borra al ver el 410.
// El paso (5) lo da el router al ver la sesión vacía (RequireSession), con el motivo que deja clearToken.
export async function logout({ expired = false, reason }: { expired?: boolean; reason?: EndReason } = {}): Promise<void> {
  const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined)
  const sub = await reg?.pushManager.getSubscription().catch(() => null)
  if (sub && !expired) {
    await api('/me/push-subscriptions', { method: 'DELETE', body: { endpoint: sub.endpoint } }).catch(() => {})
  }
  await sub?.unsubscribe().catch(() => {})
  clearToken(reason ?? (expired ? 'expired' : 'logout'))
  queryClient.clear()
}

// B19: la API usa el rol de la base, no el del token. Al abrir y tras un 403 insufficient_role, si GET /me da otro
// rol, se cierra la sesión (el token vale, así que con el paso 1) y /login dice «tu acceso ha cambiado».
export async function checkRole(): Promise<void> {
  const session = getSession()
  if (!session) return
  const me = await queryClient
    .fetchQuery({ queryKey: ['me'], queryFn: () => api<{ role: string }>('/me'), staleTime: 0 })
    .catch(() => null)
  if (me && getSession()?.token === session.token && me.role !== session.role) await logout({ reason: 'role_changed' })
}
