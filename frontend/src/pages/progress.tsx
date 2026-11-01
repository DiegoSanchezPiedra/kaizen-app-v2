import { ChevronLeftIcon, ChevronRightIcon, ZapIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { BadgeHex } from '@/components/badge-hex'
import { Page } from '@/components/page'
import { EmptyState, ListSkeleton, QueryView } from '@/components/screen-state'
import { SectionTabs } from '@/components/section-tabs'
import { StreakPanel } from '@/components/streak-panel'
import { SubjectGate, subjectName } from '@/components/subject-gate'
import { Button } from '@/components/ui/button'
import { Meter, MeterIndicator, MeterTrack } from '@/components/ui/meter'
import { useSubject } from '@/hooks/use-subject'
import { addMonths, formatMonth, madridMonth } from '@/lib/dates'
import { formatDate } from '@/lib/format'
import { BADGES, formatHours } from '@/lib/progress'
import { useProgress } from '@/lib/queries'
import type { Subject } from '@/lib/subject'

function Progress({ subject, profileId }: { subject: Subject | null; profileId?: string }) {
  const { withSubject } = useSubject()
  const current = madridMonth()
  const [month, setMonth] = useState(current)
  const progress = useProgress(profileId, month)
  const name = subjectName(subject)
  return (
    <QueryView query={progress} skeleton={<ListSkeleton rows={3} className="h-32" />}>
      {(p) => {
        const earned = new Map(p.badges.map((b) => [b.code, b.earned_at]))
        const hours = p.hours.disciplines
        const max = Math.max(1, ...hours.map((d) => d.hours))
        const none = p.streak.best === 0 && p.badges.length === 0 && hours.length === 0
        return (
          <>
            <StreakPanel current={p.streak.current} best={p.streak.best} subject={name} large />
            {none && (
              <EmptyState
                icon={<ZapIcon />}
                title="Tu primera sesión empieza la racha"
                text="Cada semana con al menos una sesión suma a la racha."
                action={
                  <Button size="xl" render={<Link to={withSubject('/calendar')} />}>
                    Ver calendario
                  </Button>
                }
              />
            )}
            <section aria-labelledby="hours" className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <Button variant="ghost" size="icon-xl" aria-label="Mes anterior" onClick={() => setMonth(addMonths(month, -1))}>
                  <ChevronLeftIcon />
                </Button>
                <h2 id="hours" className="text-base font-semibold" aria-live="polite">
                  Horas · {formatMonth(month)}
                </h2>
                <Button variant="ghost" size="icon-xl" aria-label="Mes siguiente" disabled={month >= current} onClick={() => setMonth(addMonths(month, 1))}>
                  <ChevronRightIcon />
                </Button>
              </div>
              {hours.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin horas este mes.</p>
              ) : (
                hours.map((d) => (
                  <Meter key={d.id} value={d.hours} max={max} aria-label={`${d.name}: ${formatHours(d.hours)}`}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-medium">{d.name}</span>
                      <span className="font-mono tabular-nums">{formatHours(d.hours)}</span>
                    </div>
                    <MeterTrack className="h-2.5 rounded-full">
                      <MeterIndicator className="rounded-full" />
                    </MeterTrack>
                  </Meter>
                ))
              )}
            </section>
            <section aria-labelledby="badges" className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
              <h2 id="badges" className="text-base font-semibold">
                Logros
              </h2>
              <ul className="grid grid-cols-3 gap-x-2 gap-y-4 sm:grid-cols-5">
                {BADGES.map((b) => {
                  const at = earned.get(b.code)
                  return <BadgeHex key={b.code} badge={b} earnedAt={at ? formatDate(at).replace(/^\S+, /, '') : undefined} />
                })}
              </ul>
            </section>
          </>
        )
      }}
    </QueryView>
  )
}

export function ProgressPage() {
  return (
    <Page title="Progreso">
      <SectionTabs />
      <SubjectGate>{(s) => <Progress {...s} />}</SubjectGate>
    </Page>
  )
}
