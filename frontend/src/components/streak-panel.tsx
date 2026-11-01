import { FlameIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

// ADR 0015: nada de la API se guarda en el dispositivo. La animación del «nivel de poder» se juega una vez por
// sesión de la app (en memoria) y no compara con la última visita.
let played = false

export function StreakPanel({ current, best, subject, large }: { current: number; best: number; subject?: string; large?: boolean }) {
  const [first] = useState(!played)
  useEffect(() => {
    played = true
  }, [])
  const label = current === 1 ? 'semana seguida' : 'semanas seguidas'
  return (
    <section aria-label="Racha" className="relative isolate overflow-hidden rounded-2xl bg-brand-ink p-4 text-white brand-glow brand-glow-corner">
      <div className="flex items-center gap-4">
        <span className={cn('grid shrink-0 place-items-center rounded-full bg-power/20 text-power', large ? 'size-20' : 'size-14')}>
          <FlameIcon className={large ? 'size-10' : 'size-7'} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white/80">Racha{subject ? ` de ${subject}` : ''}</p>
          <p className="flex items-baseline gap-2">
            <span className={cn('font-heading font-extrabold text-power italic', large ? 'text-7xl' : 'text-5xl', first && current > 0 && 'animate-power-up')}>
              {current}
            </span>
            <span className="text-base font-semibold">{label}</span>
          </p>
          <p className="text-sm text-white/80">Tu mejor racha: {best}</p>
        </div>
      </div>
    </section>
  )
}
