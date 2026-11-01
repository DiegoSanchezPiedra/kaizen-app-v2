import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { cardState, enablePush, loadPush, pushSupport } from '@/lib/push'
import { useSession } from '@/lib/session'

// Una vez por apertura (y tras cada login, porque cerrar sesión vacía la caché): clave VAPID y resincronizar.
export function usePushQuery() {
  const role = useSession()?.role
  return useQuery({
    queryKey: ['push'],
    queryFn: loadPush,
    enabled: role === 'alumno' || role === 'tutor',
    staleTime: Infinity,
    retry: false,
  })
}

export function usePush() {
  const query = usePushQuery()
  const qc = useQueryClient()
  const [permission, setPermission] = useState<NotificationPermission>(() => ('Notification' in window ? Notification.permission : 'default'))
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [decidedNow, setDecidedNow] = useState(false)
  const data = query.data

  async function enable() {
    if (!data) return
    setBusy(true)
    setFailed(false)
    try {
      const p = await enablePush(data.key)
      setPermission(p)
      if (p === 'granted') qc.setQueryData(['push'], { ...data, subscribed: true })
      if (p !== 'default') setDecidedNow(true)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return {
    // Sin datos (cargando, sin red o 503 push_disabled) no hay tarjeta.
    ready: !!data,
    state: cardState({ support: pushSupport(), permission, subscribed: !!data?.subscribed, busy, failed }),
    decidedNow,
    enable,
  }
}
