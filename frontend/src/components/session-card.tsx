import { BanIcon, CalendarCheckIcon, CheckIcon, CircleDotIcon, ClockIcon, HourglassIcon, LockIcon, PlayIcon } from 'lucide-react'
import type React from 'react'
import { Badge } from '@/components/ui/badge'
import { formatTime } from '@/lib/format'
import type { SessionState } from '@/lib/sessions'
import { cn } from '@/lib/utils'

type BadgeProps = { variant: React.ComponentProps<typeof Badge>['variant']; Icon: typeof CheckIcon; text: string }

// Cada estado lleva icono y texto, nunca solo color.
export const STATE_BADGE: Record<SessionState, BadgeProps> = {
  available: { variant: 'outline', Icon: CircleDotIcon, text: 'Disponible' },
  booked: { variant: 'success', Icon: CheckIcon, text: 'Reservada' },
  waitlisted: { variant: 'warning', Icon: HourglassIcon, text: 'En espera' },
  uncovered: { variant: 'outline', Icon: LockIcon, text: 'No cubierta' },
  blocked: { variant: 'outline', Icon: ClockIcon, text: 'Aún no se puede reservar' },
  cancelled: { variant: 'error', Icon: BanIcon, text: 'Cancelada' },
  held: { variant: 'secondary', Icon: CalendarCheckIcon, text: 'Celebrada' },
  started: { variant: 'secondary', Icon: PlayIcon, text: 'En curso' },
}

export function StateBadge({ state, text }: { state: SessionState; text?: string }) {
  const { variant, Icon, text: label } = STATE_BADGE[state]
  return (
    <Badge variant={variant} size="lg">
      <Icon aria-hidden="true" />
      {text ?? label}
    </Badge>
  )
}

// Tarjeta de sesión del calendario, las reservas y el inicio: hora, título, detalle, estado y acción.
export function SessionCard({
  startsAt,
  endsAt,
  title,
  meta,
  note,
  state,
  badgeText,
  compact,
  children,
}: {
  startsAt: string
  endsAt: string
  title: string
  meta?: string
  note?: string
  state: SessionState
  badgeText?: string
  compact?: boolean
  children?: React.ReactNode
}) {
  const off = state === 'cancelled'
  return (
    <article
      className={cn(
        'grid gap-x-3 gap-y-0.5 rounded-xl border bg-card p-3 shadow-xs/5',
        compact ? 'grid-cols-1' : 'grid-cols-[52px_minmax(0,1fr)]',
        off && 'bg-transparent shadow-none',
        state === 'booked' && 'border-success/55 shadow-[inset_3px_0_0_var(--success)]',
        state === 'waitlisted' && 'border-warning/60',
      )}
    >
      <div className={cn('font-mono text-[15px] leading-tight tabular-nums', compact && 'flex gap-1.5')}>
        <div>{formatTime(startsAt)}</div>
        <div className="text-xs text-muted-foreground">{compact ? `– ${formatTime(endsAt)}` : formatTime(endsAt)}</div>
      </div>
      <div className={cn('min-w-0', compact && 'col-start-1')}>
        <h3 className={cn('text-base leading-snug font-semibold', off && 'text-muted-foreground line-through')}>{title}</h3>
        {meta && <p className="text-[13px] leading-snug text-muted-foreground">{meta}</p>}
        {note && <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{note}</p>}
      </div>
      <div className={cn('mt-2 flex flex-wrap items-center justify-between gap-2', !compact && 'col-start-2')}>
        <StateBadge state={state} text={badgeText} />
        {children}
      </div>
    </article>
  )
}
