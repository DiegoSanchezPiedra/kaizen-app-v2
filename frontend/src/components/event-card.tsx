import { BanIcon, CheckIcon, HourglassIcon, LockIcon } from 'lucide-react'
import { Link, type LinkProps } from 'react-router'
import { Seats } from '@/components/seats'
import { Badge } from '@/components/ui/badge'
import { dayOfMonth, madridDay, shortWeekday } from '@/lib/dates'
import { audienceTag, eventWhen, priceView, spotsLabel, type EventInfo } from '@/lib/events'
import { formatTime } from '@/lib/format'
import { cn } from '@/lib/utils'

// Estado de la inscripción del sujeto (o del evento) con icono y texto, nunca solo color.
export function EventBadge({ e }: { e: EventInfo }) {
  const r = e.registration
  if (e.status === 'cancelled')
    return (
      <Badge variant="error" size="lg">
        <BanIcon aria-hidden="true" />
        Cancelado
      </Badge>
    )
  if (r?.status === 'confirmed')
    return (
      <Badge variant="success" size="lg">
        <CheckIcon aria-hidden="true" />
        Inscrito
      </Badge>
    )
  if (r?.status === 'pending')
    return (
      <Badge variant="warning" size="lg">
        <HourglassIcon aria-hidden="true" />
        Pago pendiente
      </Badge>
    )
  if (spotsLabel(e) === 'Completo')
    return (
      <Badge variant="outline" size="lg">
        <LockIcon aria-hidden="true" />
        Completo
      </Badge>
    )
  return null
}

// Tarjeta de evento del Calendario, Reservas e Inicio: fecha, título, cuándo y dónde, precio y estado. Lleva al detalle.
export function EventCard({ e, to, member }: { e: EventInfo; to: LinkProps['to']; member?: boolean }) {
  const day = madridDay(e.starts_at)
  const price = priceView(e, member)
  const off = e.status === 'cancelled'
  const spots = spotsLabel(e)
  const tag = audienceTag(e.audience)
  return (
    <Link
      to={to}
      className={cn(
        'grid grid-cols-[52px_minmax(0,1fr)] gap-x-3 rounded-xl border bg-card p-3 shadow-xs/5 outline-none transition-transform duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] motion-reduce:active:scale-100',
        e.registration?.status === 'confirmed' && !off && 'border-success/55 shadow-[inset_3px_0_0_var(--success)]',
        e.registration?.status === 'pending' && !off && 'border-warning/60',
        off && 'bg-transparent shadow-none',
      )}
    >
      <div className="flex flex-col items-center font-mono leading-tight tabular-nums" aria-hidden="true">
        <span className="text-xs text-muted-foreground uppercase">{shortWeekday(day)}</span>
        <span className="text-[22px] font-bold">{dayOfMonth(day)}</span>
        <span className="text-xs text-muted-foreground">{formatTime(e.starts_at)}</span>
      </div>
      <div className="min-w-0">
        <h3 className={cn('text-base leading-snug font-semibold', off && 'text-muted-foreground line-through')}>{e.title}</h3>
        <p className="text-[13px] leading-snug text-muted-foreground first-letter:uppercase">{eventWhen(e)}</p>
        <p className="text-[13px] leading-snug text-muted-foreground">{[e.location, e.discipline?.name].filter(Boolean).join(' · ')}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <EventBadge e={e} />
          <span className="text-[15px] font-semibold tabular-nums">
            {price.main}
            {price.note && <span className="ml-1.5 text-xs font-medium text-muted-foreground">{price.note}</span>}
          </span>
          {tag && <Badge variant="secondary">{tag}</Badge>}
          {e.capacity !== null && spots !== 'Completo' && !e.registration?.status.match(/^(pending|confirmed)$/) && <Seats taken={e.taken} capacity={e.capacity} />}
        </div>
      </div>
    </Link>
  )
}
