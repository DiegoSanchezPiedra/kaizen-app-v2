import { CalendarIcon, CircleAlertIcon, InfoIcon, TriangleAlertIcon } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ErrorState, QueryView } from '@/components/screen-state'
import { Page } from '@/components/page'
import { EventCard } from '@/components/event-card'
import { HomeSteps } from '@/components/home-steps'
import { NextUp } from '@/components/next-up'
import { PushCard } from '@/components/push-card'
import { SessionCard } from '@/components/session-card'
import { MedalReveal } from '@/components/medal-reveal'
import { streakTheme } from '@/lib/progress'
import { StreakPanel } from '@/components/streak-panel'
import { SubjectGate, subjectName } from '@/components/subject-gate'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useNow } from '@/hooks/use-now'
import { useStepRows } from '@/hooks/use-step-rows'
import { useSubject } from '@/hooks/use-subject'
import { addDays, formatDay, madridDay } from '@/lib/dates'
import { isUpcomingRegistration, mergeByStart } from '@/lib/events'
import { MINOR_INCOMPLETE, minorView } from '@/lib/minor'
import { homeNotices, type HomeNotice } from '@/lib/notices'
import { useBookings, useEvents, useMinor, useProfileStatus, useProgress, useSubscription } from '@/lib/queries'
import type { Subject } from '@/lib/subject'
import { cn } from '@/lib/utils'

const ICON = { warning: TriangleAlertIcon, error: CircleAlertIcon, info: InfoIcon }

// Alerta suelta con su botón; el Inicio ya no la usa (agrupa los avisos en HomeSteps), el Calendario sí.
export function NoticeCard({ n }: { n: HomeNotice }) {
  const { withSubject } = useSubject()
  const Icon = ICON[n.kind]
  return (
    <Alert variant={n.kind} role="status">
      <Icon />
      <AlertTitle>{n.title}</AlertTitle>
      <AlertDescription>{n.text}</AlertDescription>
      <AlertAction>
        <Button size="lg" variant="outline" render={<Link to={withSubject(n.to)} />}>
          {n.cta}
        </Button>
      </AlertAction>
    </Alert>
  )
}

// ADR 0015: nada de la API se guarda en el dispositivo. La entrada escalonada se juega una vez por sesión de la app
// (en memoria), igual que la de la racha: volver al Inicio no la repite.
let played = false

// Un bloque del Inicio con su turno de entrada (60 ms por bloque). Sin `on` no anima nada.
function Rise({ on, i, className, children }: { on: boolean; i: number; className?: string; children: ReactNode }) {
  return (
    <div className={cn(on && 'animate-rise', className)} style={on ? { animationDelay: `${i * 60}ms` } : undefined}>
      {children}
    </div>
  )
}

function Home({ subject, profileId }: { subject: Subject | null; profileId?: string }) {
  const { withSubject } = useSubject()
  const [first] = useState(!played)
  useEffect(() => {
    played = true
  }, [])
  const status = useProfileStatus(profileId)
  const subscription = useSubscription(profileId)
  // Con un hijo, además el estado del propio tutor (su protección de datos).
  const selfStatus = useProfileStatus(undefined)
  const progress = useProgress(profileId)
  const now = useNow()
  const today = madridDay()
  const bookings = useBookings(profileId, today, addDays(today, 30))
  const name = subjectName(subject)
  // B32: un menor con acceso propio no ve cuota ni pasos de perfil (los lleva su tutor).
  const minor = minorView(useMinor()).isMinor
  const notices = minor ? [] : homeNotices({
    status: status.data,
    subscription: subscription.data,
    subject: subject && !subject.self ? subject : null,
    self: profileId ? selfStatus.data : undefined,
  })
  const stepRows = useStepRows(notices)
  const events = useEvents(profileId, true)
  const next = mergeByStart(
    (bookings.data ?? []).filter((b) => b.status !== 'cancelled' && Date.parse(b.starts_at) > now),
    (events.data ?? []).filter((e) => isUpcomingRegistration(e, now)),
  ).slice(0, 3)
  // El hueco principal es lo siguiente que ocurre, sea sesión o evento; el resto va a la lista.
  const [head, ...rest] = next
  // Sin cuota o con impago no se puede reservar: no se invita a hacerlo.
  const canBook = !notices.some((n) => n.id === 'nosub' || n.id === 'unpaid')
  const loading = bookings.isPending || events.isPending
  const failed = bookings.isError || events.isError
  // Esqueleto → contenido: un fundido corto, solo en la primera visita (como la entrada escalonada).
  const soft = first ? 'enter-soft' : undefined

  const heroSlot = loading ? (
    <Skeleton className="h-36 w-full rounded-2xl" />
  ) : failed ? (
    <ErrorState error={bookings.error ?? events.error} onRetry={() => void Promise.all([bookings.refetch(), events.refetch()])} />
  ) : head ? (
    <div className={soft}>
      {head.kind === 'event' ? (
        <NextUp
          startsAt={head.e.starts_at}
          endsAt={head.e.ends_at}
          title={head.e.title}
          location={head.e.location}
          pending={head.e.registration?.status === 'pending' ? 'Pago pendiente' : undefined}
          to={withSubject(`/events/${head.e.id}`)}
          now={now}
        />
      ) : (
        <NextUp
          startsAt={head.s.starts_at}
          endsAt={head.s.ends_at}
          title={head.s.discipline_name}
          location={head.s.location}
          pending={head.s.status === 'waitlisted' ? 'En espera' : undefined}
          to={withSubject('/bookings')}
          now={now}
        />
      )}
    </div>
  ) : null

  const listSlot =
    loading || failed || (head && rest.length === 0) ? null : (
      <section aria-labelledby="next" className={cn('flex flex-col gap-3', soft)}>
        <div className="flex items-center justify-between">
          <h2 id="next" className="text-lg font-semibold">
            Próximas reservas
          </h2>
          <Link to={withSubject('/bookings')} className="inline-flex min-h-11 items-center font-semibold whitespace-nowrap text-link underline underline-offset-3">
            Ver todas
          </Link>
        </div>
        {rest.length === 0 ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-dashed p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <CalendarIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              <div>
                <p className="font-semibold">{name ? `${name} aún no tiene reservas` : 'Aún no tienes reservas'}</p>
                {canBook && <p className="text-sm text-muted-foreground">Mira qué sesiones hay y reserva la que encaje.</p>}
              </div>
            </div>
            {canBook && (
              <Button size="lg" variant="outline" render={<Link to={withSubject('/calendar')} />}>
                Ver calendario
              </Button>
            )}
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {rest.map((it) =>
              it.kind === 'event' ? (
                <li key={it.e.id}>
                  <EventCard e={it.e} to={withSubject(`/events/${it.e.id}`)} />
                </li>
              ) : (
                <li key={it.s.id}>
                  <SessionCard
                    startsAt={it.s.starts_at}
                    endsAt={it.s.ends_at}
                    title={it.s.discipline_name}
                    meta={`${formatDay(madridDay(it.s.starts_at))}${it.s.location ? ` · ${it.s.location}` : ''}`}
                    state={it.s.status === 'waitlisted' ? 'waitlisted' : 'booked'}
                    hideBadge={it.s.status !== 'waitlisted'}
                  />
                </li>
              ),
            )}
          </ul>
        )}
      </section>
    )

  const stepsSlot =
    status.isPending || (!minor && subscription.isPending) ? (
      <Skeleton className="h-24 w-full rounded-2xl" />
    ) : stepRows.length > 0 ? (
      <div className={soft}>
        <HomeSteps rows={stepRows} />
      </div>
    ) : null

  // El HTML va en el orden visual del móvil (sesión, pendientes, racha, lista) para que el Tab lo siga. Desde lg, dos
  // columnas: sesión y lista | pendientes y racha, que ocupa las dos filas (la 2ª es la elástica: absorbe la altura).
  return (
    <>
      {minor && !!status.data?.missing?.length && (
        <Alert variant="info" role="status">
          <InfoIcon />
          <AlertDescription>{MINOR_INCOMPLETE}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:grid-rows-[auto_1fr] lg:items-start lg:gap-x-8">
        {heroSlot && (
          <Rise on={first} i={0}>
            {heroSlot}
          </Rise>
        )}
        <div className="flex flex-col gap-4 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          {stepsSlot && (
            <Rise on={first} i={1}>
              {stepsSlot}
            </Rise>
          )}
          <Rise on={first} i={2}>
            <QueryView query={progress} skeleton={<Skeleton className="h-20 w-full rounded-2xl" />}>
              {(p) => (
                <>
                  <MedalReveal progress={p} profileId={profileId} name={subject && !subject.self ? name : undefined} />
                  <div className={soft}>
                    <StreakPanel current={p.streak.current} best={p.streak.best} subject={name} theme={streakTheme(p.disciplines)} compact hint={canBook && next.some((it) => it.kind !== 'event') ? 'Se empieza asistiendo a una clase.' : undefined} />
                  </div>
                </>
              )}
            </QueryView>
          </Rise>
        </div>
        {listSlot && (
          <Rise on={first} i={3}>
            {listSlot}
          </Rise>
        )}
      </div>
      <Rise on={first} i={4}>
        <PushCard place="inicio" />
      </Rise>
    </>
  )
}

export function HomePage() {
  return (
    <Page title="Inicio" lgWide>
      <SubjectGate>{(s) => <Home {...s} />}</SubjectGate>
    </Page>
  )
}
