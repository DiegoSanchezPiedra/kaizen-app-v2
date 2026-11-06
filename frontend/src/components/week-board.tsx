import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef } from 'react'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/screen-state'
import { Button } from '@/components/ui/button'
import type { Week } from '@/hooks/use-week'
import { addDays, formatDay, longWeekday, shortWeekday } from '@/lib/dates'
import { nextMarked, stripDays } from '@/lib/week'
import { cn } from '@/lib/utils'

const weekFmt = new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', day: 'numeric', month: 'short' })
const weekLabel = (start: string) => `${weekFmt.format(new Date(`${start}T12:00:00Z`))} – ${weekFmt.format(new Date(`${addDays(start, 6)}T12:00:00Z`))}`

// Tira de lunes a domingo (docs/auditoria-b22.md § 4): en móvil va fija arriba y se desliza para cambiar de semana.
function Strip({ w, marked, top }: { w: Week; marked: ReadonlySet<string>; top: string }) {
  const touch = useRef<{ x: number; y: number }>(null)
  return (
    <div data-week-strip className={cn('sticky z-10 -mx-4 flex flex-col gap-2 border-b bg-background px-4 pt-2 pb-2 lg:static lg:mx-0 lg:border-b-0 lg:bg-transparent lg:p-0', top)}>
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
        <Button variant="outline" size="icon-xl" aria-label="Semana anterior" onClick={() => w.shift(-1)}>
          <ChevronLeftIcon />
        </Button>
        <div className="flex items-center justify-center gap-3">
          <h2 className="text-base font-semibold tabular-nums" aria-live="polite">
            {weekLabel(w.week)}
          </h2>
          {!w.isCurrent && (
            <Button variant="link" size="sm" onClick={w.reset}>
              Hoy
            </Button>
          )}
        </div>
        <Button variant="outline" size="icon-xl" aria-label="Semana siguiente" onClick={() => w.shift(1)}>
          <ChevronRightIcon />
        </Button>
      </div>
      <div
        role="group"
        aria-label="Días de la semana"
        className="grid touch-pan-y grid-cols-7 gap-1"
        onTouchStart={(e) => {
          touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
        }}
        onTouchEnd={(e) => {
          const t = touch.current
          touch.current = null
          if (!t) return
          const dx = e.changedTouches[0].clientX - t.x
          const dy = e.changedTouches[0].clientY - t.y
          if (Math.abs(dx) > 50 && Math.abs(dx) > 1.5 * Math.abs(dy)) w.shift(dx < 0 ? 1 : -1)
        }}
      >
        {stripDays(w, w.today, marked).map((d) => (
          <button
            key={d.day}
            type="button"
            aria-pressed={d.selected}
            aria-current={d.today ? 'date' : undefined}
            aria-label={`${formatDay(d.day)}${d.today ? ', hoy' : ''}${d.marked ? ', con clases' : ''}`}
            onClick={() => w.pick(d.day)}
            className={cn(
              'relative flex min-h-13 cursor-pointer flex-col items-center justify-center rounded-lg pb-1 text-muted-foreground outline-none transition-[transform,background-color,color] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96] motion-reduce:active:scale-100',
              d.today && !d.selected && 'ring-[1.5px] ring-primary ring-inset',
              d.selected ? 'bg-primary text-primary-foreground' : 'hover:bg-accent/60',
            )}
          >
            <span className={cn('text-xs font-semibold', d.selected && 'text-primary-foreground/85')}>{d.letter}</span>
            <span className={cn('font-heading text-xl leading-none font-bold tabular-nums', !d.selected && !d.past && 'text-foreground')}>{d.number}</span>
            <span aria-hidden="true" className={cn('absolute bottom-1.5 size-1 rounded-full', d.marked ? (d.selected ? 'bg-primary-foreground' : 'bg-muted-foreground') : 'invisible')} />
          </button>
        ))}
      </div>
    </div>
  )
}

type Query = { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }

// El calendario semanal de los tres roles: la tira y, debajo, el día elegido (móvil) o los 7 días en columnas (`lg`).
// Cada pantalla pone los datos (`marked`: días con clases) y las filas de un día (`renderDay`).
export function WeekBoard({
  w,
  query,
  marked,
  renderDay,
  noun = 'clases',
  top = 'top-0',
}: {
  w: Week
  query: Query
  marked: ReadonlySet<string>
  renderDay: (day: string) => React.ReactNode
  noun?: string
  // Dónde se queda la tira en móvil: bajo lo que ya sea fijo arriba (la cabecera del admin, el selector de sujeto).
  top?: 'top-0' | 'top-14' | 'top-[61px]'
}) {
  // Al elegir un día: en escritorio, su columna a la vista; en móvil, si se quedó bajo la tira, su cabecera justo debajo.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const el = document.getElementById(`dia-${w.day}`)
    if (!el) return
    if (matchMedia('(min-width: 1024px)').matches) el.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    else {
      const below = (document.querySelector('[data-week-strip]')?.getBoundingClientRect().bottom ?? 0) + 8
      if (el.getBoundingClientRect().top < below) {
        el.style.scrollMarginTop = `${below}px`
        el.scrollIntoView({ block: 'start' })
      }
    }
  }, [w.day])

  const next = nextMarked(w, marked)
  return (
    <div className="flex flex-col gap-4">
      <Strip w={w} marked={query.isPending || query.isError ? new Set() : marked} top={top} />
      {query.isPending ? (
        <ListSkeleton rows={3} className="h-16" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : marked.size === 0 ? (
        <EmptyState
          icon={<CalendarIcon />}
          title={`No hay ${noun} esta semana`}
          text="Prueba con la semana siguiente."
          action={
            <Button size="xl" variant="outline" onClick={() => w.shift(1)}>
              Semana siguiente
            </Button>
          }
        />
      ) : (
        <div key={w.week} className="flex flex-col lg:grid lg:animate-day-in lg:grid-cols-[repeat(7,minmax(0,1fr))] lg:items-start lg:gap-1 motion-reduce:animate-none" style={{ '--day-dx': `${w.dir * 10}px` } as React.CSSProperties}>
          {w.days.map((day) => {
            const has = marked.has(day)
            const selected = day === w.day
            return (
              <section
                key={day}
                id={`dia-${day}`}
                aria-label={formatDay(day)}
                className={cn(
                  'flex flex-col gap-2 lg:scroll-mt-4 lg:rounded-3xl lg:p-1.5',
                  selected ? 'max-lg:animate-day-in max-lg:motion-reduce:animate-none lg:bg-accent lg:ring-2 lg:ring-primary/40' : 'max-lg:hidden',
                )}
              >
                <h3 className={cn('px-0.5 text-[13px] font-bold tracking-wide text-muted-foreground uppercase', day === w.today && 'text-link')}>
                  <span className="first-letter:uppercase lg:hidden">{formatDay(day)}</span>
                  <span className="hidden lg:inline">
                    {shortWeekday(day)} {Number(day.slice(8))}
                  </span>
                  {day === w.today && <span> · hoy</span>}
                </h3>
                {has ? (
                  renderDay(day)
                ) : (
                  <>
                    <p className="px-0.5 text-sm text-muted-foreground max-lg:hidden">Sin {noun}</p>
                    <div className="lg:hidden">
                      <EmptyState
                        icon={<CalendarIcon />}
                        title={`No hay ${noun} el ${longWeekday(day)}`}
                        action={
                          <Button size="xl" variant="outline" onClick={() => (next ? w.pick(next) : w.shift(1))}>
                            {next ? 'Ver el día siguiente con clases' : 'Semana siguiente'}
                          </Button>
                        }
                      />
                    </div>
                  </>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
