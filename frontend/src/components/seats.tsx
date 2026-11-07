import { seatsOf } from '@/lib/sessions'
import { cn } from '@/lib/utils'

// «10/13 plazas» y una barra fina; llena, «13/13 · Completa». El texto dice todo: la barra es solo apoyo visual.
export function Seats({ taken, capacity, fullText = 'Completa' }: { taken: number; capacity: number; fullText?: string }) {
  const { label, full, ratio } = seatsOf(taken, capacity)
  return (
    <span className={cn('inline-flex items-center gap-2 text-xs tabular-nums', full ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
      <span aria-hidden="true" className="h-1 w-10 overflow-hidden rounded-full bg-muted">
        <span className={cn('block h-full rounded-full', full ? 'bg-foreground' : 'bg-primary')} style={{ width: `${ratio * 100}%` }} />
      </span>
      {full ? `${label} · ${fullText}` : `${label} plazas`}
    </span>
  )
}
