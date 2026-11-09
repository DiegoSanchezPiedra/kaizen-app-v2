import { useEffect, useState } from 'react'
import { streakMedal, streakTier } from '@/lib/progress'
import { cn } from '@/lib/utils'

// ADR 0015: nada de la API se guarda en el dispositivo. La entrada (número y destello del aura) se juega una vez por
// sesión de la app (en memoria) y no compara con la última visita.
let played = false
// Opacidad (hex) del aura por nivel, del 1 al 5.
const AURA = ['33', '44', '55', '77', 'aa']

// Viñeta manga de la racha general con la temática de la disciplina con más horas (streakTheme; null = Kaizen). El aura
// sube con la racha actual (streakTier) y toma la paleta de la medalla de constancia de ese corte, sin nombrarla: esas
// medallas son de la mejor racha de cada disciplina, no de esta.
export function StreakPanel({ current, best, subject, theme = null, large }: { current: number; best: number; subject?: string; theme?: string | null; large?: boolean }) {
  const [first] = useState(!played)
  useEffect(() => {
    played = true
  }, [])
  const tier = streakTier(current)
  const m = streakMedal(theme, current)
  const color = tier ? m.palette.c1 : '#9AA0B8'
  return (
    <section aria-label="Racha" className="relative isolate overflow-hidden rounded-2xl border-3 border-black bg-brand-ink p-4 text-white shadow-[4px_4px_0_#000]">
      {tier > 0 && (
        <>
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10" style={{ background: `radial-gradient(circle at 18% 50%, ${color}${AURA[tier - 1]}, transparent ${40 + tier * 8}%)` }} />
          {tier >= 2 && <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(rgb(255_255_255/0.12)_1px,transparent_1.2px)] [background-size:6px_6px]" />}
          <div aria-hidden="true" className="pointer-events-none absolute top-1/2 left-[18%] -z-10 size-[260%] -translate-1/2 rounded-full" style={{ background: `repeating-conic-gradient(${color}${tier >= 3 ? '33' : '1a'} 0deg 5deg, transparent 5deg 16deg)` }} />
          {first && <div aria-hidden="true" className="pointer-events-none absolute inset-0 animate-medal-flash bg-white opacity-0" />}
        </>
      )}
      <span aria-hidden="true" className="absolute top-3 right-3 grid size-9 place-items-center rounded-md border-2 border-black text-lg font-black" style={{ background: tier ? m.palette.hanko : '#3A3F58' }}>
        {m.kanji}
      </span>
      <p className="text-sm font-semibold text-white/80">Racha{subject ? ` de ${subject}` : ''}</p>
      <p className="mt-1 flex items-center gap-3">
        <span
          className={cn('-rotate-3 border-3 border-black px-3 font-heading leading-none font-extrabold text-black italic shadow-[3px_3px_0_#000]', large ? 'py-1 text-7xl' : 'py-0.5 text-5xl', first && current > 0 && 'animate-power-up')}
          style={{ background: color }}
        >
          {current}
        </span>
        <span className="text-base font-semibold tracking-wide uppercase">{current === 1 ? 'semana seguida' : 'semanas seguidas'}</span>
      </p>
      <p className="mt-2 text-sm text-white/80">
        {subject ? 'Su' : 'Tu'} mejor racha: {best}
      </p>
    </section>
  )
}
