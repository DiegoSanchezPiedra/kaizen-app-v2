import { useInfiniteQuery } from '@tanstack/react-query'
import { CalendarIcon, QrCodeIcon } from 'lucide-react'
import { Link } from 'react-router'
import { useCancelBooking } from '@/components/cancel-booking'
import { Page } from '@/components/page'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/screen-state'
import { EventCard } from '@/components/event-card'
import { SessionCard } from '@/components/session-card'
import { SubjectGate } from '@/components/subject-gate'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { useNow } from '@/hooks/use-now'
import { useSubject } from '@/hooks/use-subject'
import { addDays, formatDay, madridDay, madridMonth, formatMonth } from '@/lib/dates'
import { isUpcomingRegistration, mergeByStart } from '@/lib/events'
import { bookBlock } from '@/lib/minor'
import { bookingsOf, useBookings, useEvents, useMinor } from '@/lib/queries'
import { CANCEL_REASON, PAST_CHUNK_DAYS, groupBy, splitBookings, type SessionState } from '@/lib/sessions'
import type { Booking } from '@/lib/types'

const MAX_PAST_CHUNKS = 8 // unos dos años hacia atrás

function stateOf(b: Booking, past: boolean): SessionState {
  if (b.status === 'cancelled') return 'cancelled'
  if (past) return 'held'
  return b.status === 'waitlisted' ? 'waitlisted' : 'booked'
}

function Bookings({ profileId }: { profileId?: string }) {
  const { withSubject } = useSubject()
  const cancel = useCancelBooking()
  // B32: un menor sin permiso de reservar tampoco cancela (la API lo cierra): en lugar del botón, el motivo.
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
  // Sus inscripciones a eventos van mezcladas con las sesiones, por fecha.
  const events = useEvents(profileId, true)
  const next = mergeByStart(
    splitBookings(upcoming.data ?? [], now).upcoming,
    (events.data ?? []).filter((e) => isUpcomingRegistration(e, now)),
  )
  const old = splitBookings(past.data?.pages.flat() ?? [], now).past
  const months = groupBy(old, (b) => madridMonth(b.starts_at))
  const lastEmpty = past.data && past.data.pages.at(-1)?.length === 0

  return (
    <>
      <Button size="xl" variant="outline" render={<Link to="/checkin" />}>
        <QrCodeIcon />
        Hacer check-in
      </Button>
      <Tabs defaultValue="next" className="gap-4">
        <TabsList className="w-full">
          <TabsTab value="next" className="min-h-11 flex-1">
            Próximas
          </TabsTab>
          <TabsTab value="past" className="min-h-11 flex-1">
            Pasadas
          </TabsTab>
        </TabsList>

        <TabsPanel value="next" className="flex flex-col gap-3">
          {upcoming.isPending || events.isPending ? (
            <ListSkeleton rows={3} />
          ) : upcoming.isError || events.isError ? (
            <ErrorState error={upcoming.error ?? events.error} onRetry={() => void Promise.all([upcoming.refetch(), events.refetch()])} />
          ) : next.length === 0 ? (
            <EmptyState
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
            next.map((it) => {
              if (it.kind === 'event') return <EventCard key={it.e.id} e={it.e} to={withSubject(`/events/${it.e.id}`)} />
              const b = it.s
              const state = stateOf(b, false)
              return (
                <SessionCard
                  key={b.id}
                  startsAt={b.starts_at}
                  endsAt={b.ends_at}
                  title={b.discipline_name}
                  meta={`${formatDay(madridDay(b.starts_at))}${b.location ? ` · ${b.location}` : ''}`}
                  note={b.cancel_reason ? CANCEL_REASON[b.cancel_reason] : undefined}
                  state={state}
                >
                  {(state === 'booked' || state === 'waitlisted') &&
                    (blocked ? (
                      <p className="text-[13px] text-muted-foreground">{blocked}</p>
                    ) : (
                      <Button size="lg" variant="outline" loading={cancel.pendingId === b.id} onClick={() => cancel.ask(b.id, state === 'waitlisted')}>
                        {state === 'waitlisted' ? 'Salir de la espera' : 'Cancelar'}
                      </Button>
                    ))}
                </SessionCard>
              )
            })
          )}
        </TabsPanel>

        <TabsPanel value="past" className="flex flex-col gap-3">
          {past.isPending ? (
            <ListSkeleton rows={3} />
          ) : past.isError ? (
            <ErrorState error={past.error} onRetry={() => void past.refetch()} />
          ) : (
            <>
              {old.length === 0 && (
                <EmptyState icon={<CalendarIcon />} title="Aún no tienes reservas pasadas" text="Tu historial de sesiones aparecerá aquí." />
              )}
              {months.map(([month, list]) => (
                <section key={month} aria-label={formatMonth(month)} className="flex flex-col gap-3">
                  <h2 className="px-0.5 text-[13px] font-bold tracking-wide text-muted-foreground uppercase">{formatMonth(month)}</h2>
                  {list.map((b) => (
                    <SessionCard
                      key={b.id}
                      startsAt={b.starts_at}
                      endsAt={b.ends_at}
                      title={b.discipline_name}
                      meta={`${formatDay(madridDay(b.starts_at))}${b.location ? ` · ${b.location}` : ''}`}
                      note={b.cancel_reason ? CANCEL_REASON[b.cancel_reason] : undefined}
                      state={stateOf(b, true)}
                    />
                  ))}
                </section>
              ))}
              {past.hasNextPage && (
                <Button size="xl" variant="outline" loading={past.isFetchingNextPage} onClick={() => void past.fetchNextPage()}>
                  Cargar meses anteriores
                </Button>
              )}
              {lastEmpty && <p className="text-center text-sm text-muted-foreground">No hay reservas en ese tramo.</p>}
            </>
          )}
        </TabsPanel>
      </Tabs>
      {cancel.dialog}
    </>
  )
}

export function BookingsPage() {
  return (
    <Page title="Reservas">
      <SubjectGate>{(s) => <Bookings profileId={s.profileId} />}</SubjectGate>
    </Page>
  )
}
