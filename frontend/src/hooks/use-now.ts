import { useEffect, useState } from 'react'

// «Ahora» para decidir si una sesión ya empezó; se refresca cada minuto sin esperar a otra petición.
export function useNow(everyMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(t)
  }, [everyMs])
  return now
}
