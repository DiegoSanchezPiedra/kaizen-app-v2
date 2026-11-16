import type { ReactNode } from 'react'
import { STATE_BADGE } from '@/components/session-card'
import { dayOfMonth, madridDay, shortWeekday } from '@/lib/dates'
import { formatTime } from '@/lib/format'
import { CANCEL_REASON, type SessionState } from '@/lib/sessions'
import type { Booking } from '@/lib/types'
import { cn } from '@/lib/utils'

const TONE: Partial<Record<SessionState, string>> = {
  waitlisted: 'text-warning-foreground',
  cancelled: 'text-destructive-foreground',
  held: 'text-muted-foreground',
}

// Una reserva en una sola fila (Reservas): hora, disciplina, dónde y, solo si no es la normal («Reservada»), su estado con
// icono y texto. La acción va en la misma línea; si no cabe (p. ej. «Salir de la espera» con un título largo) baja a la derecha.
// `withDay`: en la lista de pasadas, que no va agrupada por día, la fecha corta forma parte de la fila.
export function BookingRow({ b, state, withDay, action }: { b: Booking; state: SessionState; withDay?: boolean; action?: ReactNode }) {
  const off = state === 'cancelled'
  const day = madridDay(b.starts_at)
  const badge = state === 'booked' ? null : STATE_BADGE[state]
  const text = off && b.cancel_reason ? CANCEL_REASON[b.cancel_reason] : badge?.text
  const meta = [withDay && `${shortWeekday(day)} ${dayOfMonth(day)}`, b.location].filter(Boolean).join(' · ')
  return (
    <li
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border bg-card px-3 py-2.5 shadow-xs/5 transition-[background-color,border-color,opacity] duration-200 ease-(--ease-out)',
        state === 'waitlisted' && 'border-warning/60',
        off && 'bg-transparent shadow-none',
      )}
    >
      <div className="w-[52px] shrink-0 font-mono text-[15px] leading-tight tabular-nums">
        <div>
          <span className="sr-only">De </span>
          {formatTime(b.starts_at)}
        </div>
        <div className="text-xs text-muted-foreground">
          <span className="sr-only">a </span>
          {formatTime(b.ends_at)}
        </div>
      </div>
      <div className="min-w-0 flex-1 basis-32">
        <h3 className={cn('text-base leading-snug font-semibold', off && 'text-muted-foreground line-through')}>{b.discipline_name}</h3>
        {(meta || badge) && (
          <p className="flex flex-wrap items-center gap-x-2 text-[13px] leading-snug text-muted-foreground">
            {meta && <span>{meta}</span>}
            {badge && (
              <span className={cn('inline-flex items-center gap-1 font-medium', TONE[state])}>
                <badge.Icon aria-hidden="true" className="size-3.5" />
                {text}
              </span>
            )}
          </p>
        )}
      </div>
      {action && <div className="ml-auto shrink-0">{action}</div>}
    </li>
  )
}
