import { ChevronLeftIcon, ChevronRightIcon, ZapIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Medal } from '@/components/medal'
import { MedalDialog, MedalReveal } from '@/components/medal-reveal'
import { Page } from '@/components/page'
import { EmptyState, ListSkeleton, QueryView } from '@/components/screen-state'
import { SectionTabs } from '@/components/section-tabs'
import { StreakPanel } from '@/components/streak-panel'
import { SubjectGate, subjectName } from '@/components/subject-gate'
import { Button } from '@/components/ui/button'
import { Meter, MeterIndicator, MeterTrack } from '@/components/ui/meter'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { useSubject } from '@/hooks/use-subject'
import { addMonths, formatMonth, madridMonth } from '@/lib/dates'
import { formatDate } from '@/lib/format'
import { type Medal as MedalInfo, type MedalKind, formatHours, glowOf, ladderOf, medalGoal, nextMedal } from '@/lib/progress'
import { KAIZEN, THEMES } from '@/lib/themes'
import { useProgress } from '@/lib/queries'
import type { DisciplineMedals } from '@/lib/types'
import type { Subject } from '@/lib/subject'

function Progress({ subject, profileId }: { subject: Subject | null; profileId?: string }) {
  const { withSubject } = useSubject()
  const current = madridMonth()
  const [month, setMonth] = useState(current)
  const progress = useProgress(profileId, month)
  const [chosen, setChosen] = useState<string>()
  const name = subjectName(subject)
  return (
    <QueryView query={progress} skeleton={<ListSkeleton rows={3} className="h-32" />}>
      {(p) => {
        const hours = p.hours.disciplines
        const max = Math.max(1, ...hours.map((d) => d.hours))
        const none = p.streak.best === 0 && p.disciplines.length === 0 && hours.length === 0
        // La elegida; si no, la de más horas.
        const d = p.disciplines.find((x) => x.id === chosen) ?? [...p.disciplines].sort((a, z) => z.hours - a.hours)[0]
        return (
          <>
            <MedalReveal progress={p} profileId={profileId} name={subject && !subject.self ? name : undefined} />
            <StreakPanel current={p.streak.current} best={p.streak.best} subject={name} large />
            {d && (
              <>
                {p.disciplines.length > 1 && <DisciplinePicker disciplines={p.disciplines} value={d.id} onChange={setChosen} />}
                <NextMedal key={d.id} d={d} />
              </>
            )}
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
            {d && (
              <section aria-labelledby="medals" className="flex flex-col gap-3">
                <h2 id="medals" className="sr-only">Medallas de {d.name}</h2>
                <MedalLadders key={d.id} d={d} name={subject && !subject.self ? name : undefined} />
              </section>
            )}
          </>
        )
      }}
    </QueryView>
  )
}

const shortDate = (iso: string) => formatDate(iso).replace(/^\S+, /, '')

// Una escalera por disciplina (037): se elige cuál ver. Botones en fila que se desliza en el móvil.
function DisciplinePicker({ disciplines, value, onChange }: { disciplines: DisciplineMedals[]; value: string; onChange: (id: string) => void }) {
  return (
    <div role="group" aria-label="Medallas de la disciplina" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
      {disciplines.map((x) => (
        <Button key={x.id} size="lg" variant={x.id === value ? 'default' : 'outline'} aria-pressed={x.id === value} onClick={() => onChange(x.id)} className="shrink-0">
          {x.name} · {x.badges.length}/11
        </Button>
      ))}
    </div>
  )
}

const seriesOf = (theme: string | null) => ((theme && THEMES[theme]) || KAIZEN).series

// La próxima medalla de horas de la disciplina, protagonista con su anillo; debajo, la de constancia en pequeño.
function NextMedal({ d }: { d: DisciplineMedals }) {
  const codes = new Set(d.badges.map((b) => b.code))
  const hours = nextMedal(d.theme, 'hours', codes)
  const streak = nextMedal(d.theme, 'streak', codes)
  const ring = glowOf(ladderOf(d.theme)[0])
  const pct = hours && hours.at > 0 ? Math.min(1, d.hours / hours.at) : 0
  const R = 72
  const C = 2 * Math.PI * R
  return (
    <section aria-labelledby="next-medal" className="flex flex-col items-center gap-2.5 rounded-2xl border-3 border-black bg-brand-ink bg-[repeating-conic-gradient(from_0deg_at_50%_40%,rgb(255_255_255/0.07)_0deg_3deg,transparent_3deg_12deg)] p-4 pt-5 text-center text-white shadow-[4px_4px_0_#000]">
      <p className="text-sm font-bold tracking-wider text-white/80 uppercase">
        {d.name} · {seriesOf(d.theme)}
      </p>
      <p className="-mt-1.5 text-xs text-white/70">{hours ? 'Tu próxima medalla' : 'Medallas de horas'}</p>
      {hours ? (
        <>
          <div className="relative grid size-40 place-items-center">
            <svg viewBox="0 0 156 156" className="absolute inset-0 -rotate-90" aria-hidden="true">
              <circle cx="78" cy="78" r={R} fill="none" stroke="rgb(255 255 255 / 0.14)" strokeWidth="8" />
              <circle cx="78" cy="78" r={R} fill="none" stroke={ring} strokeWidth="8" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} className="transition-[stroke-dashoffset] duration-700 ease-out" />
            </svg>
            <Medal medal={hours} earned={false} className="size-28" />
          </div>
          <h3 id="next-medal" style={{ color: ring }} className="font-heading text-4xl leading-none font-extrabold uppercase italic [text-shadow:3px_3px_0_var(--power)]">
            {hours.name}
          </h3>
          {hours.at === 0 ? (
            <p className="text-[15px]">Se consigue con tu primera sesión</p>
          ) : (
            <Meter value={d.hours} max={hours.at} aria-label={`Horas hacia ${hours.name}`} className="w-full max-w-64 gap-1">
              <p className="text-[15px]">
                <span className="font-mono tabular-nums">
                  {formatHours(d.hours).replace(' h', '')} / {formatHours(hours.at)}
                </span>{' '}
                · te faltan {formatHours(Math.max(0, hours.at - d.hours))}
              </p>
            </Meter>
          )}
        </>
      ) : (
        <h3 id="next-medal" style={{ color: ring }} className="font-heading text-4xl font-extrabold uppercase italic">Todas conseguidas</h3>
      )}
      <div className="mt-1 w-full border-t border-white/15 pt-3">
        {streak ? (
          <Meter value={d.streak.best} max={streak.at} aria-label={`Semanas hacia ${streak.name}`} className="gap-1.5">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-semibold">{streak.name}</span>
              <span className="font-mono tabular-nums">
                {d.streak.best} / {streak.at} semanas
              </span>
            </div>
            <MeterTrack className="h-2 rounded-full bg-white/15">
              <MeterIndicator className="rounded-full bg-ki" />
            </MeterTrack>
            <p className="text-left text-xs text-white/75">Según tu mejor racha en {d.name}</p>
          </Meter>
        ) : (
          <p className="text-sm font-semibold">Medallas de constancia: todas conseguidas</p>
        )}
      </div>
    </section>
  )
}

const LADDERS: { kind: MedalKind; label: string }[] = [
  { kind: 'hours', label: 'Horas' },
  { kind: 'streak', label: 'Constancia' },
]

// Escaleras por pestaña: conseguidas con su fecha (al tocarlas se vuelve a ver su animación), la próxima con lo que
// falta y las bloqueadas con su meta.
function MedalLadders({ d, name }: { d: DisciplineMedals; name?: string }) {
  const earned = new Map(d.badges.map((b) => [b.code, b.earned_at]))
  const codes = new Set(earned.keys())
  const ladder = ladderOf(d.theme)
  const [replay, setReplay] = useState<MedalInfo | null>(null)
  return (
    <Tabs defaultValue="hours" className="gap-3">
      {replay && <MedalDialog medal={replay} name={name} label={`Medalla conseguida · ${d.name}`} onClose={() => setReplay(null)} />}
      <TabsList className="w-full">
        {LADDERS.map((l) => {
          const all = ladder.filter((x) => x.kind === l.kind)
          return (
            <TabsTab key={l.kind} value={l.kind} className="min-h-11 flex-1">
              {l.label} · {all.filter((x) => codes.has(x.code)).length}/{all.length}
            </TabsTab>
          )
        })}
      </TabsList>
      {LADDERS.map((l) => {
        const next = nextMedal(d.theme, l.kind, codes)
        const value = l.kind === 'hours' ? d.hours : d.streak.best
        return (
          <TabsPanel key={l.kind} value={l.kind}>
            <ol className="flex flex-col rounded-2xl border-3 border-black bg-card py-1.5 shadow-[4px_4px_0_#000]">
              {ladder.filter((x) => x.kind === l.kind).map((x) => {
                const at = earned.get(x.code)
                const left = x.kind === 'hours' ? formatHours(Math.max(0, x.at - value)) : `${Math.max(0, x.at - value)} semanas`
                const body = (
                  <>
                    <Medal medal={x} earned={!!at} className="size-14" />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="font-heading text-xl leading-tight font-extrabold uppercase italic">{x.name}</span>
                      <span className="text-[13px] text-muted-foreground">
                        {at ? `${medalGoal(x)} · ${shortDate(at)}` : x === next && x.at > 0 ? `${medalGoal(x)} · te faltan ${left}` : `Bloqueada · ${medalGoal(x)}`}
                      </span>
                    </span>
                  </>
                )
                return (
                  <li key={x.code}>
                    {at ? (
                      <button type="button" onClick={() => setReplay(x)} className="flex min-h-11 w-full items-center gap-3 px-3.5 py-2 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none active:scale-[0.99]">
                        {body}
                        <span className="sr-only">. Ver su animación</span>
                      </button>
                    ) : (
                      <div className="flex items-center gap-3 px-3.5 py-2">{body}</div>
                    )}
                  </li>
                )
              })}
            </ol>
          </TabsPanel>
        )
      })}
    </Tabs>
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
