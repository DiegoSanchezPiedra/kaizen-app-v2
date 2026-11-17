import { useInfiniteQuery } from '@tanstack/react-query'
import { CalendarIcon, InfoIcon, QrCodeIcon } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { BookingRow } from '@/components/booking-row'
import { useCancelBooking } from '@/components/cancel-booking'
import { EventCard } from '@/components/event-card'
import { NextUp } from '@/components/next-up'
import { Page } from '@/components/page'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/screen-state'
import { SubjectGate } from '@/components/subject-gate'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { useNow } from '@/hooks/use-now'
import { useSubject } from '@/hooks/use-subject'
import { addDays, formatDay, formatMonth, madridDay, madridMonth } from '@/lib/dates'
import { entryStart, isUpcomingRegistration, mergeByStart } from '@/lib/events'
import { formatTime } from '@/lib/format'
import { bookBlock } from '@/lib/minor'
import { bookingsOf, useBookingRules, useBookings, useCheckinWindow, useEvents, useMinor } from '@/lib/queries'
import { PAST_CHUNK_DAYS, checkinPhase, groupBy, splitBookings, type SessionState } from '@/lib/sessions'
import type { Booking } from '@/lib/types'
import { cn } from '@/lib/utils'

// El panel de pestañas es una parada de Tab (WAI-ARIA) y el componente compartido le quita el contorno: se le da un anillo.
const PANEL = 'enter-soft flex flex-col gap-5 rounded-2xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background'

const MAX_PAST_CHUNKS = 8 // unos dos años hacia atrás

// ADR 0015: nada de la API se guarda en el dispositivo. La entrada escalonada se juega una vez por sesión de la app
// (en memoria): volver a Reservas no la repite.
let played = false

function stateOf(b: Booking, past: boolean): SessionState {
  if (b.status === 'cancelled') return 'cancelled'
  if (past) return 'held'
  return b.status === 'waitlisted' ? 'waitlisted' : 'booked'
}

const dayLabel = (day: string, today: string) => (day === today ? 'Hoy' : day === addDays(today, 1) ? 'Mañana' : formatDay(day))

// TanStack pausa las consultas sin red: la pantalla se quedaría en el esqueleto (el Calendario lo trata igual).
const offline = (q: { isPending: boolean; fetchStatus: string }) => q.isPending && q.fetchStatus === 'paused'

// Un bloque de la pantalla con su turno de entrada (60 ms por bloque). Sin `on` no anima nada.
function Rise({ on, i, children }: { on: boolean; i: number; children: ReactNode }) {
  return (
    <div className={on ? 'animate-rise' : undefined} style={on ? { animationDelay: `${Math.min(i, 4) * 60}ms` } : undefined}>
      {children}
    </div>
  )
}

function Bookings({ profileId }: { profileId?: string }) {
  const { withSubject } = useSubject()
  // El plazo de cancelación de la academia: el diálogo avisa de antemano de si puede contar como tardía.
  const cancel = useCancelBooking(useBookingRules().data?.cancellation_notice_minutes)
  // B32: un menor sin permiso de reservar tampoco cancela (la API lo cierra): en lugar de los botones, un aviso.
  const blocked = bookBlock(useMinor())
  const today = madridDay()
  const upcoming = useBookings(profileId, today, addDays(today, PAST_CHUNK_DAYS - 1))
  // Pasadas por tramos de 92 días hacia atrás (la API no deja más por petición).
  const past = useInfiniteQuery({
    queryKey: ['bookings', profileId ?? 'self', 'past'],
    initialPageParam: today,
    queryFn: ({ pageParam: end }) =>
      bookingsOf(profileId, addDays(end, -(PAST_CHUNK_DAYS - 1)), end),
    getNextPageParam: (_last, pages) => (pages.length < MAX_PAST_CHUNKS ? addDays(today, -PAST_CHUNK_DAYS * pages.length) : undefined),
  })

  const now = useNow()
  // La ventana exacta de la academia; mientras llega (o si falla) checkinPhase usa la holgada.
  const win = useCheckinWindow().data
  // Sus inscripciones a eventos van mezcladas con las sesiones, por fecha.
  const events = useEvents(profileId, true)
  const loading = upcoming.isPending || events.isPending
  const mine = upcoming.data ?? []
  // «En curso»: la reserva que empezó hace poco sigue arriba (el check-in aún puede estar abierto), no salta a Pasadas.
  const live = mine.filter((b) => b.status === 'confirmed' && checkinPhase(b.starts_at, now, win) === 'live')
  const next = mergeByStart(
    [...splitBookings(mine, now).upcoming, ...live],
    (events.data ?? []).filter((e) => isUpcomingRegistration(e, now)),
  )
  // El hueco principal es lo siguiente que ocurre y sigue en pie; las canceladas se quedan en su día, tachadas.
  const heroAt = next.findIndex((it) => it.kind === 'event' || it.s.status !== 'cancelled')
  const hero = next[heroAt]
  const days = groupBy(
    next.filter((_, i) => i !== heroAt),
    (it) => madridDay(entryStart(it)),
  )
  const liveIds = new Set(live.map((b) => b.id))
  const old = splitBookings(past.data?.pages.flat() ?? [], now).past.filter((b) => !liveIds.has(b.id))
  const months = groupBy(old, (b) => madridMonth(b.starts_at))
  const lastEmpty = past.data && past.data.pages.at(-1)?.length === 0

  // Entrada escalonada solo en la primera visita; luego, lo que cambie (otra reserva sube al hueco) entra con un fundido.
  const [first, setFirst] = useState(!played)
  useEffect(() => {
    played = true
  }, [])
  useEffect(() => {
    if (loading) return
    const t = setTimeout(() => setFirst(false), 900)
    return () => clearTimeout(t)
  }, [loading])

  const cancelButton = (b: Booking, className?: string) => {
    const waiting = b.status === 'waitlisted'
    const label = waiting ? 'Salir de la espera' : 'Cancelar'
    return (
      <Button
        size="lg"
        variant="ghost"
        className={className}
        loading={cancel.pendingId === b.id}
        aria-label={`${label}: ${b.discipline_name}, ${formatDay(madridDay(b.starts_at))} a las ${formatTime(b.starts_at)}`}
        onClick={() => cancel.ask(b.id, waiting, b.starts_at)}
      >
        {label}
      </Button>
    )
  }

  const heroNode =
    hero?.kind === 'event' ? (
      <NextUp
        startsAt={hero.e.starts_at}
        endsAt={hero.e.ends_at}
        title={hero.e.title}
        location={hero.e.location}
        pending={hero.e.registration?.status === 'pending' ? 'Pago pendiente' : undefined}
        to={withSubject(`/events/${hero.e.id}`)}
        now={now}
      />
    ) : hero ? (
      <NextUp
        startsAt={hero.s.starts_at}
        endsAt={hero.s.ends_at}
        title={hero.s.discipline_name}
        location={hero.s.location}
        pending={hero.s.status === 'waitlisted' ? 'En espera' : undefined}
        live={checkinPhase(hero.s.starts_at, now, win) === 'live'}
        now={now}
        action={
          <>
            {hero.s.status === 'confirmed' && checkinPhase(hero.s.starts_at, now, win) && (
              <Button
                size="xl"
                variant="outline"
                render={<Link to="/checkin" />}
                className="min-w-40 flex-1 border-transparent bg-white text-primary hover:bg-white/90 focus-visible:ring-white focus-visible:ring-offset-0 dark:bg-white dark:hover:bg-white/90"
              >
                <QrCodeIcon />
                Hacer check-in
              </Button>
            )}
            {/* Solo, alinea su texto con el de la tarjeta (el botón fantasma lleva su propio relleno). */}
            {!blocked &&
              Date.parse(hero.s.starts_at) > now &&
              cancelButton(
                hero.s,
                cn('text-primary-foreground hover:bg-white/15 active:bg-white/20 focus-visible:ring-white focus-visible:ring-offset-0', !(hero.s.status === 'confirmed' && checkinPhase(hero.s.starts_at, now, win)) && '-ms-3'),
              )}
          </>
        }
      />
    ) : null

  const sessionAction = (b: Booking) => (!blocked && b.status !== 'cancelled' ? cancelButton(b) : undefined)

  const nextPanel = offline(upcoming) || offline(events) ? (
    <ErrorState plainTitle error={null} onRetry={() => void Promise.all([upcoming.refetch(), events.refetch()])} />
  ) : loading ? (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Cargando">
      <Skeleton className="h-36 w-full rounded-2xl" />
      <ListSkeleton rows={3} className="h-16" />
    </div>
  ) : upcoming.isError || (events.isError && next.length === 0) ? (
    <ErrorState plainTitle error={upcoming.error ?? events.error} onRetry={() => void Promise.all([upcoming.refetch(), events.refetch()])} />
  ) : (
    <>
      {blocked && (
        <Alert variant="info" role="status">
          <InfoIcon />
          <AlertTitle>{blocked}</AlertTitle>
          <AlertDescription>Para cancelar una reserva o salir de la espera, habla con tu tutor.</AlertDescription>
        </Alert>
      )}
      {events.isError && (
        <Alert variant="warning" role="status">
          <InfoIcon />
          <AlertTitle>No hemos podido cargar tus eventos</AlertTitle>
          <AlertDescription>Aquí solo ves tus sesiones.</AlertDescription>
          <AlertAction>
            <Button size="sm" variant="outline" onClick={() => void events.refetch()}>
              Reintentar
            </Button>
          </AlertAction>
        </Alert>
      )}
      {!hero && days.length === 0 ? (
        <EmptyState plainTitle
          icon={<CalendarIcon />}
          title="Aún no tienes reservas"
          text="Cuando reserves una sesión o te inscribas a un evento aparecerá aquí."
          action={
            <Button size="xl" render={<Link to={withSubject('/calendar')} />}>
              Ver calendario
            </Button>
          }
        />
      ) : (
        <>
          {heroNode && (
            <Rise on={first} i={0}>
              {/* Con otra reserva en el hueco (p. ej. tras cancelar la anterior) el bloque entra con un fundido. */}
              <section key={hero.kind === 'event' ? hero.e.id : hero.s.id} aria-label="Lo siguiente" className={first ? undefined : 'enter-soft'}>
                {heroNode}
              </section>
            </Rise>
          )}
          {days.map(([day, list], i) => (
            <Rise key={day} on={first} i={i + 1}>
              <section aria-labelledby={`day-${day}`} className="flex flex-col gap-2">
                <h2 id={`day-${day}`} className="px-0.5 text-base font-semibold first-letter:uppercase">
                  {dayLabel(day, today)}
                </h2>
                <ul className="flex flex-col gap-3">
                  {list.map((it) =>
                    it.kind === 'event' ? (
                      <li key={it.e.id}>
                        <EventCard flat e={it.e} to={withSubject(`/events/${it.e.id}`)} />
                      </li>
                    ) : (
                      <BookingRow key={it.s.id} b={it.s} state={stateOf(it.s, false)} action={sessionAction(it.s)} />
                    ),
                  )}
                </ul>
              </section>
            </Rise>
          ))}
        </>
      )}
    </>
  )

  const pastPanel = offline(past) ? (
    <ErrorState plainTitle error={null} onRetry={() => void past.refetch()} />
  ) : past.isPending ? (
    <ListSkeleton rows={3} className="h-16" />
  ) : past.isError ? (
    <ErrorState plainTitle error={past.error} onRetry={() => void past.refetch()} />
  ) : (
    <>
      {old.length === 0 && <EmptyState plainTitle icon={<CalendarIcon />} title="Aún no tienes reservas pasadas" text="Tu historial de sesiones aparecerá aquí." />}
      {months.map(([month, list]) => (
        <section key={month} aria-labelledby={`month-${month}`} className="flex flex-col">
          {/* Pegajoso: con muchos meses se sabe en cuál se está. El fondo tapa lo que pasa por debajo. */}
          <h2 id={`month-${month}`} className="sticky top-0 z-10 -mx-4 bg-background px-4.5 py-2 text-base font-semibold first-letter:uppercase">
            {formatMonth(month)}
          </h2>
          <ul className="flex flex-col gap-3">
            {list.map((b) => (
              <BookingRow key={b.id} b={b} state={stateOf(b, true)} withDay />
            ))}
          </ul>
        </section>
      ))}
      {past.hasNextPage && (
        <Button size="xl" variant="outline" loading={past.isFetchingNextPage} onClick={() => void past.fetchNextPage()}>
          Cargar meses anteriores
        </Button>
      )}
      {lastEmpty && <p className="text-center text-sm text-muted-foreground">No hay reservas en ese tramo.</p>}
    </>
  )

  return (
    <>
      <Tabs defaultValue="next" className="gap-4">
        <TabsList className="w-full">
          <TabsTab value="next" className="min-h-11 flex-1">
            Próximas
          </TabsTab>
          <TabsTab value="past" className="min-h-11 flex-1">
            Pasadas
          </TabsTab>
        </TabsList>
        {/* Al cambiar de pestaña el panel entra con un fundido corto (200 ms, ease-out). */}
        <TabsPanel value="next" className={PANEL}>
          {nextPanel}
        </TabsPanel>
        <TabsPanel value="past" className={PANEL}>
          {pastPanel}
        </TabsPanel>
      </Tabs>
      {cancel.dialog}
    </>
  )
}

export function BookingsPage() {
  return (
    // El check-in vive en la cabecera, siempre a mano; cuando toca (empieza pronto), además es la acción de la reserva.
    <Page
      title="Reservas"
      actions={
        <Button variant="ghost" size="lg" render={<Link to="/checkin" />}>
          <QrCodeIcon />
          Check-in
        </Button>
      }
    >
      <SubjectGate>{(s) => <Bookings profileId={s.profileId} />}</SubjectGate>
    </Page>
  )
}
