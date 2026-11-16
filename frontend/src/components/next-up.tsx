import { ChevronRightIcon, HourglassIcon } from 'lucide-react'
import { Link, type To } from 'react-router'
import { addDays, formatDay, madridDay } from '@/lib/dates'
import { formatTime } from '@/lib/format'

// «Hoy», «Mañana» o la fecha; y, si falta poco para empezar, cuánto.
function when(startsAt: string, now: number) {
  const day = madridDay(startsAt)
  const today = madridDay(now)
  const label = day === today ? 'Hoy' : day === addDays(today, 1) ? 'Mañana' : formatDay(day)
  const min = Math.ceil((Date.parse(startsAt) - now) / 60_000)
  const rel = min <= 0 || min >= 180 ? null : min < 60 ? `en ${min} min` : `en ${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`
  return { label, rel }
}

// La próxima sesión del alumno, el elemento dominante del Inicio. Lleva a Reservas, donde está el check-in.
export function NextUp({
  startsAt,
  endsAt,
  title,
  location,
  pending,
  to,
  now,
}: {
  startsAt: string
  endsAt: string
  title: string
  location?: string | null
  // «En espera» o «Pago pendiente»: lo que aún no es una plaza firme.
  pending?: string
  to: To
  now: number
}) {
  const { label, rel } = when(startsAt, now)
  return (
    <Link
      to={to}
      className="block rounded-2xl bg-primary p-4 text-primary-foreground shadow-[0_1px_2px_rgb(0_0_0/0.12),0_10px_20px_-10px_color-mix(in_oklab,var(--primary)_75%,transparent)] transition-[scale,filter] duration-150 ease-(--ease-out) outline-offset-2 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-ring active:scale-[0.98]"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="font-heading text-4xl leading-none font-bold tabular-nums text-balance">
          {label} · {formatTime(startsAt)}
        </p>
        <ChevronRightIcon aria-hidden="true" className="size-5 shrink-0 opacity-80" />
      </div>
      <p className="mt-3 text-lg leading-snug font-semibold">{title}</p>
      <p className="mt-0.5 text-sm leading-snug tabular-nums">
        Hasta las {formatTime(endsAt)}
        {location ? ` · ${location}` : ''}
        {rel ? ` · ${rel}` : ''}
      </p>
      {pending && (
        <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-sm font-medium">
          <HourglassIcon aria-hidden="true" className="size-4" />
          {pending}
        </span>
      )}
    </Link>
  )
}
