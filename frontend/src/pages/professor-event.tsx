import { useQuery } from '@tanstack/react-query'
import { BanIcon, CalendarDaysIcon, CheckIcon, ChevronRightIcon, HeartPulseIcon, PlayIcon, UsersIcon } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router'
import { EventStudentItem, evKey } from '@/components/attendance'
import { Page } from '@/components/page'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/screen-state'
import { StatusAlert } from '@/components/status-alert'
import { Badge } from '@/components/ui/badge'
import { useNow } from '@/hooks/use-now'
import { api } from '@/lib/api'
import { attendanceOpen, eventHealthDay, eventWhen, type EventInfo, type EventStudent } from '@/lib/events'
import { formatTime } from '@/lib/format'
import { phaseOf, plural } from '@/lib/professor'
import { BackLink, HealthView } from '@/pages/professor'

type Detail = { event: EventInfo; students: EventStudent[] }

function EventDetail({ data }: { data: Detail }) {
  const { event: e, students } = data
  const now = useNow()
  const [showHealth, setShowHealth] = useState(false)
  const phase = phaseOf(e, now)
  const cancelled = phase === 'cancelled'
  const open = attendanceOpen(e, now)
  const present = students.filter((s) => s.attended === true).length

  if (showHealth) {
    return (
      <Page title="Fichas de salud">
        <BackLink onClick={() => setShowHealth(false)}>{e.title} · {formatTime(e.starts_at)}</BackLink>
        <HealthView sessionId={e.id} kind="events" />
      </Page>
    )
  }

  return (
    <Page title={e.title} wide>
      <BackLink to="/professor">Sesiones</BackLink>
      <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start lg:gap-7">
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border bg-card p-3.5">
            <Badge variant="outline" size="lg" className="mb-2">
              <CalendarDaysIcon aria-hidden="true" />
              Evento
            </Badge>
            <p className="font-semibold first-letter:uppercase">{eventWhen(e)}</p>
            <p className="text-sm text-muted-foreground">{[e.location, e.discipline?.name].filter(Boolean).join(' · ')}</p>
            {e.description && <p className="mt-2 text-[15px] leading-snug whitespace-pre-line">{e.description}</p>}
            {(cancelled || phase === 'now' || phase === 'ended') && (
              <Badge variant={cancelled ? 'error' : phase === 'now' ? 'info' : 'secondary'} size="lg" className="mt-2">
                {cancelled ? <BanIcon aria-hidden="true" /> : phase === 'now' ? <PlayIcon aria-hidden="true" /> : <CheckIcon aria-hidden="true" />}
                {cancelled ? 'Cancelado' : phase === 'now' ? 'En curso · pasa lista' : 'Terminado'}
              </Badge>
            )}
          </div>
          {eventHealthDay(e, now) && (
            <button
              type="button"
              onClick={() => setShowHealth(true)}
              className="flex min-h-14 items-center gap-3 rounded-xl border bg-card px-4 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <HeartPulseIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">Ver fichas de salud</span>
                <span className="block text-[13px] text-muted-foreground">Solo los días del evento. Esta consulta queda registrada.</span>
              </span>
              <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          {cancelled ? (
            <EmptyState icon={<BanIcon />} title="Evento cancelado" text="No tiene lista." />
          ) : students.length === 0 ? (
            <EmptyState icon={<UsersIcon />} title="Aún no hay inscritos" text="Cuando alguien se inscriba aparecerá aquí." />
          ) : (
            <>
              <p className="px-0.5 text-sm font-semibold text-muted-foreground" aria-live="polite">
                {open ? `${present} de ${students.length} presentes` : plural(students.length, 'inscrito', 'inscritos')}
              </p>
              {!open && <StatusAlert notice={{ kind: 'info', icon: 'clock', title: `La lista se abre a las ${formatTime(e.starts_at)}` }} />}
              <ul className="overflow-hidden rounded-xl border bg-card">
                {students.map((s) => (
                  <EventStudentItem key={s.profile_id} eventId={e.id} student={s} open={open} />
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </Page>
  )
}

export function ProfessorEventPage() {
  const { id = '' } = useParams()
  const query = useQuery({ queryKey: evKey(id), queryFn: () => api<Detail>(`/professor/events/${id}`) })
  if (query.isPending) return <Page title="Evento"><ListSkeleton rows={3} /></Page>
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
