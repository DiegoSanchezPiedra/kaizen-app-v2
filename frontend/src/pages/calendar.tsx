import { useMutation, useQuery } from '@tanstack/react-query'
import { CalendarCheckIcon, ChevronDownIcon, InfoIcon } from 'lucide-react'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { Page } from '@/components/page'
import { useCancelBooking } from '@/components/cancel-booking'
import { StateBadge } from '@/components/session-card'
import { Seats } from '@/components/seats'
import { SessionRow, SessionRows } from '@/components/session-row'
import { SubjectGate } from '@/components/subject-gate'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTab } from '@/components/ui/tabs'
import { WeekBoard } from '@/components/week-board'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { EventList } from '@/pages/events'
import { NoticeCard } from '@/components/home-steps'
import { useNow } from '@/hooks/use-now'
import { useWeek } from '@/hooks/use-week'
import { useSubject } from '@/hooks/use-subject'
import { ApiError, api } from '@/lib/api'
import { addDays, madridDay } from '@/lib/dates'
import { toastManager } from '@/components/ui/toast'
import { errorCode, toastError, toastOk } from '@/lib/notify'
import { errorText } from '@/lib/errors'
import { bookBlock, tutorHint } from '@/lib/minor'
import { NO_SUBSCRIPTION } from '@/lib/notices'
import { onboardingFrom } from '@/lib/paths'
import { incompletePath } from '@/lib/profile'
import { path, refreshBookings, useMinor, useSubscription } from '@/lib/queries'
import { canCancel, groupByDay, seatsOf, sessionState, type SessionState } from '@/lib/sessions'
import type { Subject } from '@/lib/subject'
import type { Booking, CalendarSession, Discipline } from '@/lib/types'
import { cn } from '@/lib/utils'

// ADR 0015: nada de la API se guarda en el dispositivo. La entrada escalonada se juega una vez por sesión de la app
// (en memoria), igual que la del Inicio: volver al Calendario no la repite.
let played = false

// Cuando una fila cambia de estado (reservar, cancelar) lo nuevo entra con un fundido de 200 ms. La primera vez que se
// pinta no anima: la lista ya trae su propia entrada.
function Swap({ k, className, children }: { k: string; className: string; children: ReactNode }) {
  // Derivado durante el render (patrón de React): el primer valor no anima; desde el primer cambio, cada uno sí.
  const [seen, setSeen] = useState(k)
  const [fade, setFade] = useState(false)
  if (seen !== k) {
    setSeen(k)
    setFade(true)
  }
  return (
    <div key={k} className={cn(className, fade && 'enter-soft')}>
      {children}
    </div>
  )
}

// Las sesiones ya celebradas de un día que aún tiene otras se pliegan en una fila: lo reservable queda arriba.
// El plegado baja la altura de 1fr a 0fr y se funde, 200 ms ease-out, como en HomeSteps.
function HeldFold({ n, children }: { n: number; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 w-full cursor-pointer items-center gap-2 px-3 text-left text-sm text-muted-foreground outline-none transition-colors duration-150 ease-(--ease-out) hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-accent/60 lg:px-2"
      >
        <CalendarCheckIcon aria-hidden="true" className="size-4 shrink-0 lg:hidden" />
        {/* En las 7 columnas de lg el texto largo no cabe. */}
        <span className="flex-1">
          <span className="lg:hidden">{n === 1 ? '1 sesión celebrada' : `${n} sesiones celebradas`}</span>
          <span className="hidden lg:inline">{n === 1 ? '1 celebrada' : `${n} celebradas`}</span>
        </span>
        <ChevronDownIcon aria-hidden="true" className={cn('size-4 shrink-0 transition-transform duration-200 ease-(--ease-out)', open && 'rotate-180')} />
      </button>
      <div
        id={id}
        inert={!open}
        data-open={open ? '' : undefined}
        className="grid grid-rows-[0fr] opacity-0 transition-[grid-template-rows,opacity] duration-200 ease-(--ease-out) data-open:grid-rows-[1fr] data-open:opacity-100"
      >
        <div className="min-h-0 overflow-hidden">
          <ul className="divide-y border-t">{children}</ul>
        </div>
      </div>
    </li>
  )
}

function Calendar({ subject, profileId }: { subject: Subject | null; profileId?: string }) {
  const [first] = useState(!played)
  useEffect(() => {
    played = true
  }, [])
  // 60 ms entre bloques; sin `first` no anima nada.
  const rise = (i: number) => (first ? { className: 'animate-rise', style: { animationDelay: `${i * 60}ms` } } : {})
  const navigate = useNavigate()
  const location = useLocation()
  const { withSubject } = useSubject()
  const w = useWeek()
  const [discipline, setDiscipline] = useState('all')
  // La API no da la ventana de reserva: se aprende del primer outside_booking_window (en memoria; vale para toda la academia).
  const [blockedFrom, setBlockedFrom] = useState<number>()
  const cancel = useCancelBooking()
  const now = useNow()
  const noSub = useSubscription(profileId).data === null
  // B32: un menor sin permiso de reservar ve el motivo, no el botón (ni el de cancelar: la API también lo cierra).
  const minor = useMinor()
  const blocked = bookBlock(minor)

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
      // Un menor no puede arreglar la cuota ni el perfil: «Habla con tu tutor».
      const hint = tutorHint(minor, code)
      if (hint) {
        toastManager.add({ type: 'error', title: errorText(code), description: hint, timeout: 5000 })
        return
      }
      const action =
        code === 'not_covered'
          ? { label: 'Ver cuota', onClick: () => void navigate(withSubject('/billing')) }
          : code === 'profile_incomplete'
            ? {
                label: 'Completar',
                onClick: () => {
                  const details = err instanceof ApiError ? err.details : {}
                  const to = profileId ? incompletePath(Array.isArray(details.missing) ? (details.missing as string[]) : [], details.whose) : '/onboarding'
                  void navigate(to === '/onboarding' ? onboardingFrom(location.pathname + location.search) : withSubject(to))
                },
              }
            : undefined
      toastError(err, action)
    },
    onSettled: () => refreshBookings(),
  })

  const byDay = new Map(groupByDay(calendar.data ?? [], (s) => s.starts_at))
  // Sin red la consulta se pausa y se quedaría en esqueleto: se dice «Sin conexión» (ErrorState lo detecta con error null).
  // Al volver la red se reanuda sola y la lista aparece.
  const offline = calendar.isPending && calendar.fetchStatus === 'paused'
  // Días en que el sujeto ya tiene una reserva firme: la tira los marca.
  const booked = new Set((calendar.data ?? []).filter((s) => s.booking?.status === 'confirmed' && s.status !== 'cancelled').map((s) => madridDay(s.starts_at)))
  const options = disciplines.data?.filter((d) => d.is_active) ?? []

  function actions(s: CalendarSession, state: SessionState) {
    if (blocked) return state === 'available' ? <span className="text-[13px] font-semibold text-muted-foreground">Sin permiso</span> : null
    if (state === 'available')
      return (
        // En las 7 columnas de lg «Lista de espera» no cabe en una línea: se parte en dos.
        <Button size="lg" className="h-auto min-h-10 whitespace-normal py-1.5 leading-tight sm:h-auto sm:min-h-9" loading={reserve.isPending && reserve.variables === s.id} onClick={() => reserve.mutate(s.id)}>
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
    const below = action ? <>{tag}{seats}</> : seats || undefined
    const aside = action ?? tag
    return (
      <SessionRow
        key={s.id}
        start={s.starts_at}
        end={s.ends_at}
        title={s.discipline.name}
        meta={[s.trainer?.display_name, s.location].filter(Boolean).join(' · ')}
        off={state === 'cancelled'}
        tone={state === 'booked' ? 'success' : state === 'waitlisted' ? 'warning' : 'none'}
        below={below ? <Swap k={state} className="flex flex-wrap gap-1.5">{below}</Swap> : undefined}
        aside={aside ? <Swap k={state} className="flex flex-col items-end gap-1 lg:items-start">{aside}</Swap> : undefined}
      />
    )
  }

  const day = (d: string) => {
    const list = byDay.get(d) ?? []
    // El motivo de «No cubierta» se dice una vez por día, no en cada sesión.
    // Sin cuota ya lo dice el aviso de arriba.
    const uncovered = !noSub && list.some((s) => sessionState(s, now, blockedFrom) === 'uncovered')
    // Las celebradas se pliegan solo si el día aún tiene otras; un día entero pasado se ve completo.
    const held = list.filter((s) => sessionState(s, now, blockedFrom) === 'held')
    const fold = held.length > 0 && held.length < list.length
    return (
      <>
        {uncovered && <p className="px-0.5 text-[13px] text-muted-foreground">«No cubierta»: tu cuota no la cubre ese día (otra disciplina, la edad o una pausa).</p>}
        <SessionRows>
          {fold && <HeldFold n={held.length}>{held.map(row)}</HeldFold>}
          {(fold ? list.filter((s) => !held.includes(s)) : list).map(row)}
        </SessionRows>
      </>
    )
  }

  return (
    <>
      {blocked && (
        <Alert variant="info" role="status">
          <InfoIcon />
          <AlertTitle>{blocked}</AlertTitle>
          <AlertDescription>Habla con tu tutor si quieres reservar.</AlertDescription>
        </Alert>
      )}
      {noSub && <NoticeCard n={NO_SUBSCRIPTION} />}
      {options.length > 1 && (
        <ToggleGroup
          aria-label="Disciplina"
          value={[discipline]}
          onValueChange={(v) => setDiscipline(v[0] ?? 'all')}
          className={cn('-mx-4 w-auto max-w-none gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:px-0', rise(1).className)}
          style={rise(1).style}
        >
          {[{ id: 'all', name: 'Todas' }, ...options].map((d) => (
            <ToggleGroupItem
              key={d.id}
              value={String(d.id)}
              className="min-h-11 rounded-full px-4 data-pressed:border-primary/40 data-pressed:bg-primary/12 data-pressed:text-link dark:data-pressed:bg-primary/12"
              variant="outline"
            >
              {d.name}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
      <div data-subject={subject?.id} className={rise(2).className} style={rise(2).style}>
        <WeekBoard w={w} query={offline ? { isPending: false, isError: true, error: null, refetch: calendar.refetch } : calendar} marked={new Set(byDay.keys())} booked={booked} tint top={subject ? 'top-[61px]' : 'top-0'} renderDay={day} />
      </div>
      <p className={cn('text-center text-sm text-muted-foreground', rise(3).className)} style={rise(3).style}>
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
