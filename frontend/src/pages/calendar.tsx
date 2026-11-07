import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Page } from '@/components/page'
import { useCancelBooking } from '@/components/cancel-booking'
import { StateBadge } from '@/components/session-card'
import { Seats } from '@/components/seats'
import { SessionRow, SessionRows } from '@/components/session-row'
import { SubjectGate } from '@/components/subject-gate'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTab } from '@/components/ui/tabs'
import { WeekBoard } from '@/components/week-board'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { EventList } from '@/pages/events'
import { NoticeCard } from '@/pages/home'
import { useNow } from '@/hooks/use-now'
import { useWeek } from '@/hooks/use-week'
import { useSubject } from '@/hooks/use-subject'
import { api } from '@/lib/api'
import { addDays } from '@/lib/dates'
import { toastManager } from '@/components/ui/toast'
import { errorCode, toastError, toastOk } from '@/lib/notify'
import { NO_SUBSCRIPTION } from '@/lib/notices'
import { path, refreshBookings, useSubscription } from '@/lib/queries'
import { canCancel, groupByDay, seatsOf, sessionState, type SessionState } from '@/lib/sessions'
import type { Subject } from '@/lib/subject'
import type { Booking, CalendarSession, Discipline } from '@/lib/types'

function Calendar({ subject, profileId }: { subject: Subject | null; profileId?: string }) {
  const navigate = useNavigate()
  const { withSubject } = useSubject()
  const w = useWeek()
  const [discipline, setDiscipline] = useState('all')
  // La API no da la ventana de reserva: se aprende del primer outside_booking_window (en memoria; vale para toda la academia).
  const [blockedFrom, setBlockedFrom] = useState<number>()
  const cancel = useCancelBooking()
  const now = useNow()
  const noSub = useSubscription(profileId).data === null

  const disciplines = useQuery({ queryKey: ['disciplines'], queryFn: () => api<{ disciplines: Discipline[] }>('/disciplines').then((r) => r.disciplines) })
  const calendar = useQuery({
    queryKey: ['calendar', profileId ?? 'self', w.week, discipline],
    queryFn: () =>
      api<{ sessions: CalendarSession[] }>(
        path('/sessions/calendar', { from: w.week, to: addDays(w.week, 6), discipline_id: discipline === 'all' ? undefined : discipline, profile_id: profileId }),
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
          : code === 'not_covered'
            ? { label: 'Ver cuota', onClick: () => void navigate(withSubject('/billing')) }
            : code === 'profile_incomplete'
              ? { label: 'Completar', onClick: () => void navigate(profileId ? withSubject('/account/health') : '/onboarding') }
              : undefined
      toastError(err, action)
    },
    onSettled: () => refreshBookings(),
  })

  const byDay = new Map(groupByDay(calendar.data ?? [], (s) => s.starts_at))
  const options = disciplines.data?.filter((d) => d.is_active) ?? []

  function actions(s: CalendarSession, state: SessionState) {
    if (state === 'available')
      return (
        <Button size="lg" loading={reserve.isPending && reserve.variables === s.id} onClick={() => reserve.mutate(s.id)}>
          {seatsOf(s.taken, s.capacity).full ? 'Lista de espera' : 'Reservar'}
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

  // A la derecha, la acción; si no hay, el estado. Con acción, el estado (Reservada, En espera) pasa bajo el nombre.
  const row = (s: CalendarSession) => {
    const state = sessionState(s, now, blockedFrom)
    const action = actions(s, state)
    const tag = state === 'available' ? null : <StateBadge state={state} />
    // Aforo solo mientras se puede reservar o ya se tiene plaza; en una pasada o cancelada no aporta.
    const seats = !['cancelled', 'held', 'started'].includes(state) && <Seats taken={s.taken} capacity={s.capacity} />
    return (
      <SessionRow
        key={s.id}
        start={s.starts_at}
        end={s.ends_at}
        title={s.discipline.name}
        meta={[s.trainer?.display_name, s.location].filter(Boolean).join(' · ')}
        off={state === 'cancelled'}
        accent={state === 'booked' ? 'success' : state === 'waitlisted' ? 'warning' : undefined}
        below={action ? <>{tag}{seats}</> : seats || undefined}
        aside={action ?? tag}
      />
    )
  }

  const day = (d: string) => {
    const list = byDay.get(d) ?? []
    // El motivo de «No cubierta» se dice una vez por día, no en cada sesión.
    // Sin cuota ya lo dice el aviso de arriba.
    const uncovered = !noSub && list.some((s) => sessionState(s, now, blockedFrom) === 'uncovered')
    return (
      <>
        {uncovered && <p className="px-0.5 text-[13px] text-muted-foreground">«No cubierta»: tu cuota no incluye esa disciplina.</p>}
        <SessionRows>{list.map(row)}</SessionRows>
      </>
    )
  }

  return (
    <>
      {noSub && <NoticeCard n={NO_SUBSCRIPTION} />}
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
      <div data-subject={subject?.id}>
        <WeekBoard w={w} query={calendar} marked={new Set(byDay.keys())} top={subject ? 'top-[61px]' : 'top-0'} renderDay={day} />
      </div>
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
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'events' ? 'events' : 'sessions'
  // El sujeto (?para=) se conserva al cambiar de pestaña.
  const pick = (v: string) =>
    setParams((p) => {
      if (v === 'events') p.set('tab', 'events')
      else p.delete('tab')
      return p
    })
  return (
    <Page title="Calendario" wide>
      <Tabs value={tab} onValueChange={(v) => pick(String(v))}>
        <TabsList className="w-full">
          <TabsTab value="sessions" className="min-h-11 flex-1">
            Sesiones
          </TabsTab>
          <TabsTab value="events" className="min-h-11 flex-1">
            Eventos
          </TabsTab>
        </TabsList>
      </Tabs>
      <SubjectGate>{(s) => (tab === 'events' ? <EventList {...s} /> : <Calendar {...s} />)}</SubjectGate>
    </Page>
  )
}
