import { useMutation, useQuery } from '@tanstack/react-query'
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Page } from '@/components/page'
import { useCancelBooking } from '@/components/cancel-booking'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/screen-state'
import { SessionCard } from '@/components/session-card'
import { SubjectGate } from '@/components/subject-gate'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useNow } from '@/hooks/use-now'
import { useSubject } from '@/hooks/use-subject'
import { api } from '@/lib/api'
import { addDays, dayOfMonth, formatDay, madridDay, mondayOf, shortWeekday } from '@/lib/dates'
import { toastManager } from '@/components/ui/toast'
import { errorCode, toastError, toastOk } from '@/lib/notify'
import { path, refreshBookings } from '@/lib/queries'
import { canCancel, groupByDay, sessionState } from '@/lib/sessions'
import type { Subject } from '@/lib/subject'
import type { Booking, CalendarSession, Discipline } from '@/lib/types'
import { cn } from '@/lib/utils'

const weekFmt = new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', day: 'numeric', month: 'short' })
const weekLabel = (start: string) => `${weekFmt.format(new Date(`${start}T12:00:00Z`))} – ${weekFmt.format(new Date(`${addDays(start, 6)}T12:00:00Z`))}`

function Calendar({ subject, profileId }: { subject: Subject | null; profileId?: string }) {
  const navigate = useNavigate()
  const { withSubject } = useSubject()
  const desktop = useMediaQuery('lg')
  const today = madridDay()
  const [week, setWeek] = useState(mondayOf(today))
  const [discipline, setDiscipline] = useState('all')
  // La API no da la ventana de reserva: se aprende del primer outside_booking_window (en memoria; vale para toda la academia).
  const [blockedFrom, setBlockedFrom] = useState<number>()
  const cancel = useCancelBooking()
  const now = useNow()

  const disciplines = useQuery({ queryKey: ['disciplines'], queryFn: () => api<{ disciplines: Discipline[] }>('/disciplines').then((r) => r.disciplines) })
  const calendar = useQuery({
    queryKey: ['calendar', profileId ?? 'self', week, discipline],
    queryFn: () =>
      api<{ sessions: CalendarSession[] }>(
        path('/sessions/calendar', { from: week, to: addDays(week, 6), discipline_id: discipline === 'all' ? undefined : discipline, profile_id: profileId }),
      ).then((r) => r.sessions),
  })

  const reserve = useMutation({
    mutationFn: (id: string) => api<{ booking: Booking }>('/bookings', { method: 'POST', body: { session_id: id, profile_id: profileId } }),
    onSuccess: ({ booking }) =>
      booking.status === 'waitlisted'
        ? toastManager.add({ type: 'info', title: 'La sesión está llena', description: 'Estás en la lista de espera.' })
        : toastOk('Sesión reservada'),
    onError: (err, id) => {
      const code = errorCode(err)
      const start = Date.parse(calendar.data?.find((s) => s.id === id)?.starts_at ?? '')
      if (code === 'outside_booking_window' && start) setBlockedFrom((b) => Math.min(b ?? start, start))
      const action =
        code === 'no_risk_cover'
          ? { label: 'Ver opciones', onClick: () => void navigate(withSubject('/agreements')) }
          : code === 'profile_incomplete'
            ? { label: 'Completar', onClick: () => void navigate(profileId ? withSubject('/account/health') : '/onboarding') }
            : undefined
      toastError(err, action)
    },
    onSettled: () => refreshBookings(),
  })

  const sessions = calendar.data ?? []
  const byDay = new Map(groupByDay(sessions, (s) => s.starts_at))
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i))
  const options = disciplines.data?.filter((d) => d.is_active) ?? []

  function actions(s: CalendarSession) {
    const state = sessionState(s, now, blockedFrom)
    if (state === 'available')
      return (
        <Button size="lg" loading={reserve.isPending && reserve.variables === s.id} onClick={() => reserve.mutate(s.id)}>
          Reservar
        </Button>
      )
    if ((state === 'booked' || state === 'waitlisted') && s.booking && canCancel(s, now))
      return (
        <Button size="lg" variant="outline" loading={cancel.pendingId === s.booking.id} onClick={() => cancel.ask(s.booking!.id, state === 'waitlisted')}>
          {state === 'waitlisted' ? 'Salir de la espera' : 'Cancelar'}
        </Button>
      )
    return null
  }

  const card = (s: CalendarSession) => {
    const state = sessionState(s, now, blockedFrom)
    return (
      <SessionCard
        key={s.id}
        compact={desktop}
        startsAt={s.starts_at}
        endsAt={s.ends_at}
        title={s.discipline.name}
        meta={[s.trainer?.display_name, s.location].filter(Boolean).join(' · ')}
        note={state === 'uncovered' ? 'Tu cuota no incluye esta disciplina.' : undefined}
        state={state}
      >
        {actions(s)}
      </SessionCard>
    )
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" size="icon-xl" aria-label="Semana anterior" onClick={() => setWeek(addDays(week, -7))}>
            <ChevronLeftIcon />
          </Button>
          <div className="flex flex-col items-center">
            <h2 className="text-base font-semibold" aria-live="polite">
              {weekLabel(week)}
            </h2>
            {week !== mondayOf(today) && (
              <Button variant="link" size="sm" onClick={() => setWeek(mondayOf(today))}>
                Ir a hoy
              </Button>
            )}
          </div>
          <Button variant="outline" size="icon-xl" aria-label="Semana siguiente" onClick={() => setWeek(addDays(week, 7))}>
            <ChevronRightIcon />
          </Button>
        </div>
        {options.length > 1 && (
          <ToggleGroup
            aria-label="Disciplina"
            value={[discipline]}
            onValueChange={(v) => setDiscipline(v[0] ?? 'all')}
            className="-mx-4 w-auto max-w-none gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:px-0"
          >
            {[{ id: 'all', name: 'Todas' }, ...options].map((d) => (
              <ToggleGroupItem
                key={d.id}
                value={String(d.id)}
                className="min-h-11 rounded-full px-4 data-pressed:border-foreground data-pressed:bg-foreground data-pressed:text-background"
                variant="outline"
              >
                {d.name}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </div>

      {calendar.isPending ? (
        <ListSkeleton rows={4} />
      ) : calendar.isError ? (
        <ErrorState error={calendar.error} onRetry={() => void calendar.refetch()} />
      ) : sessions.length === 0 ? (
        <EmptyState
          icon={<CalendarIcon />}
          title="No hay sesiones esta semana"
          text={discipline === 'all' ? 'Prueba con la semana siguiente.' : 'Prueba con otra disciplina o con otra semana.'}
          action={
            <Button size="xl" variant="outline" onClick={() => setWeek(addDays(week, 7))}>
              Semana siguiente
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-7 lg:items-start lg:gap-3" data-subject={subject?.id}>
          {days.map((day) => {
            const list = byDay.get(day) ?? []
            return (
              <section key={day} aria-label={formatDay(day)} className={cn('flex flex-col gap-2', list.length === 0 && 'max-lg:hidden')}>
                <h3 className={cn('px-0.5 text-[13px] font-bold tracking-wide text-muted-foreground uppercase', day === today && 'text-link')}>
                  <span className="lg:hidden">{formatDay(day)}</span>
                  <span className="hidden lg:inline">
                    {shortWeekday(day)} {dayOfMonth(day)}
                  </span>
                  {day === today && <span> · hoy</span>}
                </h3>
                {list.length === 0 ? <p className="text-sm text-muted-foreground">Sin sesiones</p> : list.map(card)}
              </section>
            )
          })}
        </div>
      )}
      <p className="text-center text-sm text-muted-foreground">
        ¿Qué has reservado?{' '}
        <Link to={withSubject('/bookings')} className="font-semibold text-link underline underline-offset-3">
          Ver mis reservas
        </Link>
      </p>
      {cancel.dialog}
    </>
  )
}

export function CalendarPage() {
  return (
    <Page title="Calendario" wide>
      <SubjectGate>{(s) => <Calendar {...s} />}</SubjectGate>
    </Page>
  )
}

