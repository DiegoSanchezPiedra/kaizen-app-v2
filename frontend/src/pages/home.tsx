import { CalendarIcon, CircleAlertIcon, InfoIcon, TriangleAlertIcon } from 'lucide-react'
import { Link } from 'react-router'
import { EmptyState, ListSkeleton, QueryView } from '@/components/screen-state'
import { Page } from '@/components/page'
import { PushCard } from '@/components/push-card'
import { SessionCard } from '@/components/session-card'
import { StreakPanel } from '@/components/streak-panel'
import { SubjectGate, subjectName } from '@/components/subject-gate'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useNow } from '@/hooks/use-now'
import { useSubject } from '@/hooks/use-subject'
import { addDays, formatDay, madridDay } from '@/lib/dates'
import { homeNotices, type HomeNotice } from '@/lib/notices'
import { useBookings, useProfileStatus, useProgress, useSubscription } from '@/lib/queries'
import type { Subject } from '@/lib/subject'

const ICON = { warning: TriangleAlertIcon, error: CircleAlertIcon, info: InfoIcon }

function NoticeCard({ n }: { n: HomeNotice }) {
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

function Home({ subject, profileId }: { subject: Subject | null; profileId?: string }) {
  const { withSubject } = useSubject()
  const status = useProfileStatus(profileId)
  const subscription = useSubscription(profileId)
  // Con un hijo, además el estado del propio tutor (su protección de datos).
  const selfStatus = useProfileStatus(undefined)
  const progress = useProgress(profileId)
  const now = useNow()
  const today = madridDay()
  const bookings = useBookings(profileId, today, addDays(today, 30))
  const name = subjectName(subject)
  const notices = homeNotices({
    status: status.data,
    subscription: subscription.data,
    subject: subject && !subject.self ? subject : null,
    self: profileId ? selfStatus.data : undefined,
  })
  const next = (bookings.data ?? [])
    .filter((b) => b.status !== 'cancelled' && Date.parse(b.starts_at) > now)
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
    .slice(0, 3)

  return (
    <>
      {(status.isPending || subscription.isPending) && <Skeleton className="h-20 w-full rounded-xl" />}
      {notices.length > 0 && (
        <div className="flex flex-col gap-3" aria-label="Avisos">
          {notices.map((n) => (
            <NoticeCard key={n.id} n={n} />
          ))}
        </div>
      )}
      <QueryView query={progress} skeleton={<Skeleton className="h-28 w-full rounded-2xl" />}>
        {(p) => <StreakPanel current={p.streak.current} best={p.streak.best} subject={name} />}
      </QueryView>
      <section aria-labelledby="next" className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 id="next" className="text-lg font-semibold">
            Próximas reservas
          </h2>
          <Link to={withSubject('/bookings')} className="inline-flex min-h-11 items-center font-semibold whitespace-nowrap text-link underline underline-offset-3">
            Ver todas
          </Link>
        </div>
        <QueryView query={bookings} skeleton={<ListSkeleton rows={2} />}>
          {() =>
            next.length === 0 ? (
              <EmptyState
                icon={<CalendarIcon />}
                title={name ? `${name} aún no tiene reservas` : 'Aún no tienes reservas'}
                text="Mira qué sesiones hay y reserva la que encaje."
                action={
                  <Button size="xl" render={<Link to={withSubject('/calendar')} />}>
                    Ver calendario
                  </Button>
                }
              />
            ) : (
              <ul className="flex flex-col gap-3">
                {next.map((b) => (
                  <li key={b.id}>
                    <SessionCard
                      startsAt={b.starts_at}
                      endsAt={b.ends_at}
                      title={b.discipline_name}
                      meta={`${formatDay(madridDay(b.starts_at))}${b.location ? ` · ${b.location}` : ''}`}
                      state={b.status === 'waitlisted' ? 'waitlisted' : 'booked'}
                    />
                  </li>
                ))}
              </ul>
            )
          }
        </QueryView>
      </section>
      <PushCard place="inicio" />
    </>
  )
}

export function HomePage() {
  return (
    <Page title="Inicio">
      <SubjectGate>{(s) => <Home {...s} />}</SubjectGate>
    </Page>
  )
}
