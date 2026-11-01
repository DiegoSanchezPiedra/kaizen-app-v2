import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNow } from '@/hooks/use-now'
import { POLL_EVERY_MS, pollPhase, type PollPhase } from '@/lib/billing'

// Repite `fn` cada 2 s hasta que `done` o hasta los 2 min (pollPhase). Un fallo suelto no para: se reintenta igual.
export function usePoll<T>(key: unknown[], fn: () => Promise<T>, done: (v: T | undefined) => boolean, enabled = true) {
  const [start, setStart] = useState(() => Date.now())
  const now = useNow(1000)
  const q = useQuery({
    queryKey: [...key, 'poll', start],
    queryFn: fn,
    enabled,
    retry: false,
    gcTime: 0,
    refetchInterval: (query) => (done(query.state.data) || pollPhase(Date.now() - start) === 'stopped' ? false : POLL_EVERY_MS),
  })
  const ok = done(q.data)
  const phase: PollPhase | 'done' = ok ? 'done' : pollPhase(now - start)
  return { phase, data: q.data, restart: () => setStart(Date.now()) }
}
