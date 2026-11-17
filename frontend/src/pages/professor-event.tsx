import { useQuery } from '@tanstack/react-query'
import { BanIcon, CalendarDaysIcon, CheckIcon, ChevronRightIcon, HeartPulseIcon, UsersIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { EventStudentItem, evKey } from '@/components/attendance'
import { CARD } from '@/components/child-access'
import { NextUp } from '@/components/next-up'
import { Page } from '@/components/page'
import { Rise } from '@/components/rise'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/screen-state'
import { StatusAlert } from '@/components/status-alert'
import { Badge } from '@/components/ui/badge'
import { useNow } from '@/hooks/use-now'
import { api } from '@/lib/api'
import { madridDay } from '@/lib/dates'
import { attendanceOpen, eventDayOf, eventHealthDay, eventWhen, type EventInfo, type EventStudent } from '@/lib/events'
import { formatDeadline, formatTime } from '@/lib/format'
import { phaseOf, plural } from '@/lib/professor'
import { cn } from '@/lib/utils'
import { BackLink, HealthView, useHealthView } from '@/pages/professor'

type Detail = { event: EventInfo; students: EventStudent[] }

// La entrada escalonada del detalle, solo la primera vez de la sesión de la app.
let eventPlayed = false

const EVENT_BADGE = (
  <Badge variant="outline" size="lg">
    <CalendarDaysIcon aria-hidden="true" />
    Evento
  </Badge>
)

// La descripción puede ser larga: en el tatami lo primero es la lista, así que se corta a 4 líneas.
// shortcut: «larga» por caracteres y saltos de línea, sin medir el desbordamiento; medirlo si se queda corto.
function Description({ text }: { text: string }) {
  const [more, setMore] = useState(false)
  const long = text.length > 180 || text.split('\n').length > 4
  return (
    <div className="flex flex-col">
      <p className={cn('text-[15px] leading-snug whitespace-pre-line', long && !more && 'line-clamp-4')}>{text}</p>
      {long && (
        <button type="button" aria-expanded={more} onClick={() => setMore(!more)} className="-mb-2 inline-flex min-h-11 items-center self-start font-semibold text-link">
          {more ? 'Ver menos' : 'Ver más'}
        </button>
      )}
    </div>
  )
}

function EventDetail({ data }: { data: Detail }) {
  const { event: e, students } = data
  const now = useNow()
  const health = useHealthView()
  const phase = phaseOf(e, now)
  const cancelled = phase === 'cancelled'
  const open = attendanceOpen(e, now)
  const present = students.filter((s) => s.attended === true).length
  const day = eventDayOf(e, now)
  const [first, setFirst] = useState(!eventPlayed)
  const [liveAtStart] = useState(phase === 'now')
  useEffect(() => {
    eventPlayed = true
  }, [])

  if (health.show) {
    return (
      <Page title="Fichas de salud">
        <BackLink onClick={health.close}>{e.title}</BackLink>
        <HealthView sessionId={e.id} kind="events" />
      </Page>
    )
  }

  const enrolled = plural(students.length, 'inscrito', 'inscritos')
  const counting = open && students.length > 0
  const sameDay = madridDay(e.starts_at) === madridDay(now)

  return (
    <Page title={e.title} wide>
      <BackLink to={`/professor?dia=${madridDay(phase === 'now' ? now : e.starts_at)}`}>Sesiones</BackLink>
      <div className={cn('grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:items-start lg:gap-x-7 lg:gap-y-3', counting && 'pb-24 lg:pb-0')}>
        <div className="flex flex-col gap-3">
          <Rise on={first} i={0} className="flex flex-col gap-3">
            {/* En curso, el hueco azul es lo dominante (el título ya es el del evento); el resto, debajo. */}
            {phase === 'now' ? (
              <>
                {/* key: sin ella React reutiliza el div de la tarjeta (mismo sitio) y @starting-style no se dispara. */}
                <div key="live" className={liveAtStart ? undefined : 'enter-soft'}>
                  <NextUp
                    startsAt={e.starts_at}
                    endsAt={e.ends_at}
                    title={enrolled}
                    location={e.location}
                    live
                    now={now}
                    headline={day ? `Día ${day.n} de ${day.of}` : undefined}
                    until={day ? `Hasta el ${formatDeadline(e.ends_at)}` : undefined}
                  />
                </div>
                <div className={cn(CARD, 'gap-2')}>
                  <div className="flex flex-wrap items-center gap-2">
                    {EVENT_BADGE}
                    {e.discipline && <span className="text-sm text-muted-foreground">{e.discipline.name}</span>}
                  </div>
                  {e.description && <Description text={e.description} />}
                </div>
              </>
            ) : (
              <div className={cn(CARD, 'gap-1')}>
                <div className="mb-1.5 flex flex-wrap gap-2">
                  {EVENT_BADGE}
                  {cancelled && (
                    <Badge variant="error" size="lg">
                      <BanIcon aria-hidden="true" />
                      Cancelado
                    </Badge>
                  )}
                  {phase === 'ended' && (
                    <Badge variant="secondary" size="lg">
                      <CheckIcon aria-hidden="true" />
                      Terminado
                    </Badge>
                  )}
                </div>
                <p className="font-semibold tabular-nums first-letter:uppercase">{eventWhen(e)}</p>
                <p className="text-sm text-muted-foreground">{[e.location, e.discipline?.name, !cancelled && enrolled].filter(Boolean).join(' · ')}</p>
                {phase === 'ended' && students.length > 0 && <p className="text-[13px] text-muted-foreground">Puedes seguir marcando la asistencia.</p>}
                {e.description && (
                  <div className="mt-1.5">
                    <Description text={e.description} />
                  </div>
                )}
              </div>
            )}
          </Rise>
          {!cancelled && (
            <Rise on={first} i={1}>
              {eventHealthDay(e, now) ? (
                <button
                  type="button"
                  onClick={() => {
                    setFirst(false)
                    health.open()
                  }}
                  className="flex min-h-14 w-full items-center gap-3 rounded-2xl border bg-card px-4 py-2.5 text-left outline-none transition-[scale] duration-150 ease-(--ease-out) focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]"
                >
                  <HeartPulseIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">Ver fichas de salud</span>
                    <span className="block text-[13px] text-muted-foreground">Solo los días del evento. Esta consulta queda registrada.</span>
                  </span>
                  <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>
              ) : (
                <p className="flex items-center gap-2 px-0.5 text-[13px] text-muted-foreground">
                  <HeartPulseIcon className="size-4 shrink-0" aria-hidden="true" />
                  Las fichas de salud se pueden ver los días del evento.
                </p>
              )}
            </Rise>
          )}
        </div>

        <Rise on={first} i={2} className="flex flex-col gap-3 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          {cancelled ? (
            <EmptyState icon={<BanIcon />} title="Evento cancelado" text="No tiene lista." />
          ) : students.length === 0 ? (
            <EmptyState icon={<UsersIcon />} title="Aún no hay inscritos" text="Cuando alguien se inscriba aparecerá aquí." />
          ) : (
            <>
              {/* Antes de empezar, lo primero es saber cuándo se abre. */}
              {!open && (
                <StatusAlert
                  notice={{ kind: 'info', icon: 'clock', title: `La lista se abre ${sameDay ? `a las ${formatTime(e.starts_at)}` : `el ${formatDeadline(e.starts_at)}`}` }}
                />
              )}
              <h2 className="px-0.5 text-sm font-semibold text-muted-foreground tabular-nums">{open ? `Inscritos · ${students.length}` : enrolled}</h2>
              <ul className="overflow-hidden rounded-2xl border bg-card">
                {students.map((s) => (
                  <EventStudentItem key={s.profile_id} eventId={e.id} student={s} open={open} touch />
                ))}
              </ul>
            </>
          )}
        </Rise>
        {/* Después de la lista (en el móvil, fija abajo; en lg, debajo de la columna izquierda por la rejilla). Fuera de Rise:
            un transform en el padre rompería el `fixed`. El único contador y el único aria-live. Sin botón: la lista de un
            evento no se cierra. */}
        {counting && (
          <div className="fixed inset-x-3 bottom-[calc(70px+env(safe-area-inset-bottom))] z-10 rounded-2xl border bg-card px-4 py-3 shadow-lg lg:static lg:col-start-1 lg:row-start-2 lg:p-4 lg:shadow-xs/5">
            <p className="flex items-baseline justify-between gap-3" aria-live="polite">
              <span className="text-sm font-semibold">
                <span className="font-heading text-3xl leading-none font-bold tabular-nums">{present}</span>
                <span className="tabular-nums"> de {students.length}</span> {present === 1 ? 'presente' : 'presentes'}
              </span>
              <span className="text-[13px] text-muted-foreground tabular-nums">
                {present === students.length ? 'Todos presentes' : `${students.length - present} sin marcar`}
              </span>
            </p>
          </div>
        )}
      </div>
    </Page>
  )
}

export function ProfessorEventPage() {
  const { id = '' } = useParams()
  const query = useQuery({ queryKey: evKey(id), queryFn: () => api<Detail>(`/professor/events/${id}`) })
  if (query.isPending) {
    return (
      <Page title="Evento">
        <ListSkeleton rows={4} className="h-18" />
      </Page>
    )
  }
  if (query.isError) {
    return (
      <Page title="Evento">
        <BackLink to="/professor">Sesiones</BackLink>
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Page>
    )
  }
  return <EventDetail key={id} data={query.data} />
}
