import { useCallback, useEffect, useRef, useState } from 'react'
import { backoffSeconds, createSseParser, DEFAULT_PERIOD, validUntil, viewOf, type Feed, type Received } from '@/lib/tablet'

// SSE de la tablet con fetch: EventSource no manda `Authorization: Device`. Reconecta con espera creciente.
// `onRevoked` salta con el evento `revoked` o con un 401: quien llama borra el token.
export function useTabletFeed(token: string, onRevoked: () => void) {
  const [received, setReceived] = useState<Received | null>(null)
  const [down, setDown] = useState(false)
  const [retry, setRetry] = useState<{ attempt: number; at: number } | null>(null)
  const [online, setOnline] = useState(navigator.onLine)
  const [now, setNow] = useState(() => Date.now())
  const wake = useRef<() => void>(() => {})
  const resetWait = useRef(false)
  const revoked = useRef(onRevoked)
  useEffect(() => {
    revoked.current = onRevoked
  })

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000)
    const on = () => {
      setOnline(true)
      wake.current() // al volver la red se reintenta al momento, sin esperar
    }
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      clearInterval(tick)
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  useEffect(() => {
    const stop = new AbortController()
    let last: Received | null = null

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const t = setTimeout(resolve, ms)
        wake.current = () => {
          clearTimeout(t)
          resolve()
        }
      })

    // Una conexión: lee hasta que se corta, la revocan o pasa más del tiempo de validez sin ningún `feed`.
    async function connect(): Promise<'dropped' | 'revoked'> {
      const link = new AbortController()
      const abort = () => link.abort()
      stop.signal.addEventListener('abort', abort)
      let watchdog: ReturnType<typeof setTimeout> | undefined
      try {
        const res = await fetch('/api/tablet/active-sessions', {
          headers: { Authorization: `Device ${token}`, Accept: 'text/event-stream' },
          signal: link.signal,
        })
        if (res.status === 401) return 'revoked'
        if (!res.ok || !res.body) return 'dropped'
        const parse = createSseParser()
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) return 'dropped'
          for (const ev of parse(value)) {
            if (ev.event === 'revoked') return 'revoked'
            if (ev.event !== 'feed') continue // `error`: el servidor cierra el stream a continuación y cuenta como caída
            const at = Date.now()
            const period = last ? Math.max(1, Math.round((at - last.at) / 1000)) : DEFAULT_PERIOD
            last = { feed: ev.data as Feed, at, period }
            setReceived(last)
            setDown(false)
            setRetry(null)
            clearTimeout(watchdog)
            watchdog = setTimeout(abort, Math.max(0, validUntil(last) - Date.now()))
          }
        }
      } catch {
        return 'dropped'
      } finally {
        clearTimeout(watchdog)
        stop.signal.removeEventListener('abort', abort)
        link.abort()
      }
    }

    void (async () => {
      let attempt = 0
      while (!stop.signal.aborted) {
        const before = last
        const result = await connect()
        if (stop.signal.aborted) return
        if (result === 'revoked') return revoked.current()
        attempt = last !== before ? 1 : attempt + 1 // si llegó algún `feed`, la racha de fallos empieza de nuevo
        if (resetWait.current) {
          resetWait.current = false
          attempt = 1
        }
        const wait = backoffSeconds(attempt)
        setDown(true)
        setRetry({ attempt, at: Date.now() + wait * 1000 })
        await sleep(wait * 1000)
      }
    })()

    return () => stop.abort()
  }, [token])

  // «Reintentar ahora»: salta la espera y la siguiente caída vuelve a esperar 1 s.
  const retryNow = useCallback(() => {
    resetWait.current = true
    wake.current()
  }, [])

  return {
    view: viewOf({ online, received, down, now }),
    feed: received?.feed ?? null,
    retry: retry ? { attempt: retry.attempt, seconds: Math.max(0, Math.ceil((retry.at - now) / 1000)) } : null,
    retryNow,
    now,
  }
}
