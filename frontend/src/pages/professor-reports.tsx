import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ChartColumnIcon, TableIcon } from 'lucide-react'
import { useState } from 'react'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/screen-state'
import { Button } from '@/components/ui/button'
import { Page } from '@/components/page'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { Filter } from '@/pages/community'
import { api } from '@/lib/api'
import { addMonths, formatMonth, madridMonth } from '@/lib/dates'
import {
  classTitle,
  classTrainer,
  monthlyTotals,
  niceMax,
  percent,
  periodRange,
  plural,
  shortMonth,
  sumFigures,
  validRange,
  type Figures,
  type Period,
  type Report,
  type ReportRow,
} from '@/lib/professor'
import { useDisciplines } from '@/lib/queries'
import { path } from '@/lib/url'
import { cn } from '@/lib/utils'

const PAGE = 25
const PERIODS: { value: Period; label: string }[] = [
  { value: 'this', label: 'Este mes' },
  { value: 'last', label: 'Mes pasado' },
  { value: 'six', label: 'Últimos 6 meses' },
  { value: 'twelve', label: 'Últimos 12 meses' },
  { value: 'custom', label: 'Elegir meses…' },
]
const nf = new Intl.NumberFormat('es-ES')

// Colores pasados por el validador de dataviz en claro y oscuro (canvas B18.4); la falta no se distingue solo por el matiz.
const SERIES = 'text-foreground [--s-abs:#C8467E] [--s-occ:#0B47F0] [--s-pres:#0B47F0] [--s-unr:color-mix(in_srgb,var(--foreground)_34%,transparent)] dark:[--s-abs:#D55181] dark:[--s-occ:#2F62FF] dark:[--s-pres:#2F62FF]'
const HATCH = 'bg-[repeating-linear-gradient(135deg,var(--s-unr)_0_2px,transparent_2px_5px)] shadow-[inset_0_0_0_1px_var(--s-unr)]'

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border bg-card p-3">
      <span className="font-heading text-2xl leading-none font-bold tabular-nums sm:text-3xl">{value}</span>
      <span className="text-[13px] leading-snug font-medium text-muted-foreground">{label}</span>
    </div>
  )
}

function Key({ items }: { items: { label: string; cls: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-muted-foreground">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <i className={cn('inline-block size-3 rounded-[3px]', i.cls)} aria-hidden="true" />
          {i.label}
        </span>
      ))}
    </div>
  )
}

type Month = Figures & { month: string }

// Barras en HTML con altura en % del área (la columna mide el 100 %).
function Stack({ parts, max }: { parts: { cls: string; v: number }[]; max: number }) {
  return (
    <span className="flex h-full w-full max-w-7.5 flex-col-reverse justify-start gap-0.5">
      {parts.map((p, k) => (
        <span key={k} className={cn('block shrink-0', p.cls, k === parts.length - 1 && 'rounded-t')} style={{ height: `${(p.v / max) * 100}%` }} />
      ))}
    </span>
  )
}

function Charts({ months }: { months: Month[] }) {
  const [table, setTable] = useState(false)
  const maxBooked = niceMax(Math.max(...months.map((m) => m.present + m.absent + m.unrecorded)))
  const occ = (m: Month) => m.occupancy ?? 0
  return (
    <section aria-label="Por mes" className={cn('flex flex-col gap-5 rounded-2xl border bg-card p-4', SERIES)}>
      <div className="flex flex-col gap-3">
        <h2 className="font-semibold">Ocupación por mes</h2>
        <MonthBars months={months} max={1} ticks={[0, 0.5, 1]} unit={(n) => `${n * 100} %`} stack={(m) => [{ cls: 'bg-(--s-occ)', v: occ(m) }]} tip={(m) => [`Ocupación: ${percent(m.occupancy)}`, `${nf.format(m.booked)} reservas de ${nf.format(m.capacity)} plazas`]} labelLast={(m) => percent(m.occupancy)} />
      </div>
      <div className="flex flex-col gap-3">
        <h2 className="font-semibold">Asistencia por mes</h2>
        <Key items={[{ label: 'Presentes', cls: 'bg-(--s-pres)' }, { label: 'Faltas', cls: 'bg-(--s-abs)' }, { label: 'Sin registrar', cls: HATCH }]} />
        <MonthBars
          months={months}
          max={maxBooked}
          ticks={[0, maxBooked / 2, maxBooked]}
          unit={(n) => nf.format(n)}
          stack={(m) => [
            { cls: 'bg-(--s-pres)', v: m.present },
            { cls: 'bg-(--s-abs)', v: m.absent },
            { cls: HATCH, v: m.unrecorded },
          ]}
          tip={(m) => [`Presentes: ${m.present}`, `Faltas: ${m.absent}`, `Sin registrar: ${m.unrecorded}`]}
          labelLast={(m) => nf.format(m.present + m.absent + m.unrecorded)}
        />
      </div>
      <Button variant="outline" size="xl" aria-expanded={table} onClick={() => setTable((t) => !t)}>
        <TableIcon />
        {table ? 'Ocultar tabla' : 'Ver tabla'}
      </Button>
      {table && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm tabular-nums">
            <caption className="sr-only">Cifras por mes</caption>
            <thead>
              <tr className="text-xs tracking-wide text-muted-foreground uppercase">
                {['Mes', 'Sesiones', 'Ocupación', 'Presentes', 'Faltas', 'Sin registrar'].map((h, i) => (
                  <th key={h} scope="col" className={cn('px-3 py-2.5 font-semibold', i === 0 ? 'text-left' : 'text-right')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month} className="border-t">
                  <th scope="row" className="px-3 py-2.5 text-left font-medium whitespace-nowrap first-letter:uppercase">{formatMonth(m.month)}</th>
                  {[m.sessions, percent(m.occupancy), m.present, m.absent, m.unrecorded].map((v, i) => (
                    <td key={i} className="px-3 py-2.5 text-right whitespace-nowrap">{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// Una columna-botón por mes (foco y tooltip), el último mes etiquetado y el resto por tooltip.
function MonthBars({ months, max, ticks, unit, stack, tip, labelLast }: {
  months: Month[]
  max: number
  ticks: number[]
  unit: (n: number) => string
  stack: (m: Month) => { cls: string; v: number }[]
  tip: (m: Month) => string[]
  labelLast: (m: Month) => string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const last = months.length - 1
  return (
    <div>
      <div className="relative ml-10 grid h-42 grid-flow-col auto-cols-fr gap-2.5 border-b border-foreground/30">
        {ticks.map((t) => (
          <div key={t} className="pointer-events-none absolute right-0 -left-10 border-t" style={{ bottom: `${(t / max) * 100}%` }}>
            <span className="absolute -top-2 left-0 w-8.5 text-right text-[11px] text-muted-foreground tabular-nums">{unit(t)}</span>
          </div>
        ))}
        {months.map((m, i) => (
          <button
            key={m.month}
            type="button"
            aria-label={`${formatMonth(m.month)}: ${tip(m).join(', ')}`}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            className="relative flex h-full items-end justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Stack parts={stack(m)} max={max} />
            {i === last && (
              <span className="pointer-events-none absolute -right-2 -left-2 text-center text-xs font-semibold whitespace-nowrap tabular-nums" style={{ bottom: `calc(${(stack(m).reduce((s, p) => s + p.v, 0) / max) * 100}% + 4px)` }}>
                {labelLast(m)}
              </span>
            )}
            {hover === i && (
              <span
                aria-hidden="true"
                className={cn(
                  'pointer-events-none absolute -top-1 z-10 -translate-y-full rounded-lg border bg-popover px-2.5 py-2 text-left text-[13px] leading-snug whitespace-nowrap text-popover-foreground shadow-lg',
                  i < 2 ? 'left-0' : i > last - 2 ? 'right-0' : 'left-1/2 -translate-x-1/2',
                )}
              >
                <span className="block font-semibold first-letter:uppercase">{formatMonth(m.month)}</span>
                {tip(m).map((t) => (
                  <span key={t} className="block">{t}</span>
                ))}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="mt-1.5 ml-10 grid grid-flow-col auto-cols-fr gap-2.5 text-center text-xs text-muted-foreground">
        {months.map((m) => (
          <span key={m.month}>{shortMonth(m.month)}</span>
        ))}
      </div>
    </div>
  )
}

function Group({ title, subtitle, f }: { title: string; subtitle?: string | null; f: Figures }) {
  const booked = f.present + f.absent + f.unrecorded
  const pct = (n: number) => `${booked ? (n / booked) * 100 : 0}%`
  return (
    <article className={cn('flex flex-col gap-2.5 rounded-xl border bg-card p-3.5', SERIES)}>
      <div>
        <h3 className="font-semibold">{title}</h3>
        {subtitle && <p className="text-[13px] text-muted-foreground">{subtitle}</p>}
      </div>
      {booked > 0 && (
        <div className="flex h-3 gap-0.5" aria-hidden="true">
          <span className="rounded-l bg-(--s-pres)" style={{ width: pct(f.present) }} />
          <span className="bg-(--s-abs)" style={{ width: pct(f.absent) }} />
          <span className={cn('rounded-r', HATCH)} style={{ width: pct(f.unrecorded) }} />
        </div>
      )}
      <p className="text-[13px] leading-snug text-muted-foreground tabular-nums">
        {plural(f.sessions, 'sesión', 'sesiones')} · {percent(f.occupancy)} de ocupación · {plural(f.present, 'presente', 'presentes')} · {plural(f.absent, 'falta', 'faltas')} · {f.unrecorded} sin registrar · {plural(f.late, 'cancelación tardía', 'cancelaciones tardías')}
      </p>
    </article>
  )
}

const monthOptions = (cur: string) => Array.from({ length: 36 }, (_, i) => addMonths(cur, -i)).map((m) => ({ value: m, label: formatMonth(m) }))

export function ProfessorReportsPage() {
  const cur = madridMonth()
  const [tab, setTab] = useState('discipline')
  const [period, setPeriod] = useState<Period>('this')
  const [cFrom, setCFrom] = useState(addMonths(cur, -2))
  const [cTo, setCTo] = useState(cur)
  const [discipline, setDiscipline] = useState('all')
  const disciplines = useDisciplines()

  const { from, to } = period === 'custom' ? { from: cFrom, to: cTo } : periodRange(period)
  const ok = validRange(from, to)
  const base = { from, to, discipline_id: discipline === 'all' ? undefined : discipline }
  const byDiscipline = useQuery({
    queryKey: ['prof-report', 'discipline', base],
    enabled: ok,
    queryFn: () => api<Report>(path('/professor/reports/sessions', { by: 'discipline', ...base })),
  })
  const byClass = useInfiniteQuery({
    queryKey: ['prof-report', 'class', base],
    enabled: ok && tab === 'class',
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api<Report>(path('/professor/reports/sessions', { by: 'class', ...base, limit: String(PAGE), offset: String(pageParam) })),
    getNextPageParam: (last) => ((last.offset ?? 0) + PAGE < (last.total ?? 0) ? (last.offset ?? 0) + PAGE : undefined),
  })

  const months = byDiscipline.data ? monthlyTotals(byDiscipline.data.rows) : []
  const total = byDiscipline.data ? sumFigures(byDiscipline.data.rows.map((r) => r.total)) : null
  const classRows: ReportRow[] = byClass.data?.pages.flatMap((p) => p.rows) ?? []

  return (
    <Page title="Informes" wide>
      <div className="grid gap-2 sm:grid-cols-2">
        <Filter label="Periodo" value={period} onChange={(v) => setPeriod(v as Period)} items={PERIODS} />
        <Filter
          label="Disciplina"
          value={discipline}
          onChange={setDiscipline}
          items={[{ value: 'all', label: 'Todas las disciplinas' }, ...(disciplines.data ?? []).map((d) => ({ value: String(d.id), label: d.name }))]}
        />
        {period === 'custom' && (
          <>
            <Filter label="Desde" value={cFrom} onChange={setCFrom} items={monthOptions(cur)} />
            <Filter label="Hasta" value={cTo} onChange={setCTo} items={monthOptions(cur)} />
          </>
        )}
      </div>
      {!ok && <p role="alert" className="rounded-xl border bg-card p-3.5 text-sm font-semibold">Revisa las fechas: «Hasta» no puede ser anterior a «Desde» y como mucho son 12 meses.</p>}
      {ok && byDiscipline.isPending && <ListSkeleton rows={3} className="h-28" />}
      {ok && byDiscipline.isError && <ErrorState error={byDiscipline.error} onRetry={() => void byDiscipline.refetch()} />}
      {ok && total && (total.sessions === 0 && total.booked === 0 ? (
        <EmptyState icon={<ChartColumnIcon />} title="Sin sesiones en este periodo" text="Cuenta lo que ya se ha celebrado; prueba con otro periodo." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            <Tile label="Sesiones" value={nf.format(total.sessions)} />
            <Tile label="Ocupación" value={percent(total.occupancy)} />
            <Tile label="Presentes" value={nf.format(total.present)} />
            <Tile label="Faltas" value={nf.format(total.absent)} />
            <Tile label="Sin registrar" value={nf.format(total.unrecorded)} />
            <Tile label="Cancelaciones tardías" value={nf.format(total.late)} />
          </div>
          {months.length >= 2 && <Charts months={months} />}
          <Tabs value={tab} onValueChange={(v) => setTab(String(v))} className="gap-4">
            <TabsList className="w-full">
              <TabsTab value="discipline" className="min-h-11 flex-1">Por disciplina</TabsTab>
              <TabsTab value="class" className="min-h-11 flex-1">Por clase</TabsTab>
            </TabsList>
            <TabsPanel value="discipline" className="grid gap-3 lg:grid-cols-2">
              {byDiscipline.data!.rows.map((r) => (
                <Group key={String(r.discipline.id)} title={r.discipline.name} f={r.total} />
              ))}
            </TabsPanel>
            <TabsPanel value="class" className="flex flex-col gap-3">
              {byClass.isPending ? (
                <ListSkeleton rows={3} className="h-24" />
              ) : byClass.isError ? (
                <ErrorState error={byClass.error} onRetry={() => void byClass.refetch()} />
              ) : (
                <>
                  <div className="grid gap-3 lg:grid-cols-2">
                    {classRows.map((r) => (
                      <Group key={`${r.discipline.id}-${r.class_id ?? 'loose'}`} title={classTitle(r)} subtitle={classTrainer(r)} f={r.total} />
                    ))}
                  </div>
                  {byClass.hasNextPage && (
                    <Button size="xl" variant="outline" loading={byClass.isFetchingNextPage} onClick={() => void byClass.fetchNextPage()}>
                      Cargar más clases
                    </Button>
                  )}
                </>
              )}
            </TabsPanel>
          </Tabs>
        </>
      ))}
    </Page>
  )
}
