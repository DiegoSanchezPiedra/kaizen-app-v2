import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ChartColumnIcon, TableIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { EmptyState, ErrorState, InlineError } from '@/components/screen-state'
import { Rise } from '@/components/rise'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Page } from '@/components/page'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { useReportFilters } from '@/components/report-filters'
import { api, ApiError } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { formatMonth } from '@/lib/dates'
import {
  classTitle,
  classTrainer,
  mobileLabels,
  monthlyTotals,
  niceMax,
  percent,
  periodLabel,
  shortMonth,
  sumFigures,
  type Figures,
  type Report,
  type ReportRow,
} from '@/lib/professor'
import { path } from '@/lib/url'
import { cn } from '@/lib/utils'

const PAGE = 25

const nf = new Intl.NumberFormat('es-ES')

// Colores pasados por el validador de dataviz en claro y oscuro (canvas B18.4); la falta no se distingue solo por el matiz.
// La trama de «sin registrar» va al 48 % de la tinta: al 34 % no llegaba a 3:1 sobre la tarjeta.
export const SERIES = 'text-foreground [--s-abs:#C8467E] [--s-occ:#0B47F0] [--s-pres:#0B47F0] [--s-unr:color-mix(in_srgb,var(--foreground)_48%,transparent)] dark:[--s-abs:#D55181] dark:[--s-occ:#2F62FF] dark:[--s-pres:#2F62FF]'
export const HATCH = 'bg-[repeating-linear-gradient(135deg,var(--s-unr)_0_2px,transparent_2px_5px)] shadow-[inset_0_0_0_1px_var(--s-unr)]'

// Cifras en una sola tarjeta: rejilla de 3 columnas (el informe de sesiones pasa a una fila de 6 desde lg).
export function StatGrid({ items, className }: { items: [string, string][]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-3 gap-px overflow-hidden rounded-2xl border bg-border', className)}>
      {items.map(([label, value]) => (
        <div key={label} className="flex flex-col-reverse justify-end gap-1 bg-card px-3 py-3.5 sm:px-4">
          <dt className="text-[13px] leading-snug font-medium text-muted-foreground">{label}</dt>
          <dd className="font-heading text-[1.75rem] leading-none font-bold tabular-nums sm:text-3xl">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Key({ items }: { items: { label: string; cls: string }[] }) {
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
    <span className="flex h-full w-full max-w-6 flex-col-reverse justify-start gap-0.5">
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
        {months.every((m) => m.occupancy === null) ? (
          <p className="text-sm text-muted-foreground">Sin plazas en el periodo: no hay ocupación que mostrar.</p>
        ) : (
          <MonthBars months={months} max={1} ticks={[0, 0.5, 1]} unit={(n) => `${n * 100} %`} stack={(m) => [{ cls: 'bg-(--s-occ)', v: occ(m) }]} tip={(m) => [`Ocupación: ${percent(m.occupancy)}`, `${nf.format(m.booked)} reservas de ${nf.format(m.capacity)} plazas`]} labelLast={(m) => percent(m.occupancy)} />
        )}
      </div>
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="font-semibold">Asistencia por mes</h2>
          <p className="text-[13px] text-muted-foreground">Reservas de cada mes: presentes, faltas y sin registrar.</p>
        </div>
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

// Una columna-botón por mes (o día: `name` y `short` dicen cómo se llama), la última etiquetada y el resto por tooltip.
// `gap`: sin dato (contorno punteado, nunca una barra de 0); `mark`: un punto bajo la etiqueta (mes incompleto).
export function MonthBars<T>({ months, max, ticks, unit, stack, tip, labelLast, gap: isGap, mark, name = (m) => formatMonth((m as Month).month), short = (m) => shortMonth((m as Month).month) }: {
  months: T[]
  max: number
  ticks: number[]
  unit: (n: number) => string
  stack: (m: T) => { cls: string; v: number }[]
  tip: (m: T) => string[]
  labelLast: (m: T) => string
  name?: (m: T) => string
  short?: (m: T) => string
  gap?: (m: T) => boolean
  mark?: (m: T) => boolean
}) {
  const [hover, setHover] = useState<number | null>(null)
  const last = months.length - 1
  // Una sola parada de Tab por gráfica (la del último mes); las flechas, Inicio y Fin recorren los meses.
  const [cur, setCur] = useState(last)
  const move = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    const to = ({ ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: last } as Record<string, number>)[e.key]
    if (to === undefined || to < 0 || to > last) return
    e.preventDefault()
    setCur(to)
    ;(e.currentTarget.parentElement!.children[ticks.length + to] as HTMLElement).focus()
  }
  const gap = months.length > 40 ? 'gap-px' : months.length > 16 ? 'gap-0.5' : 'gap-2.5'
  // Ratón, lápiz o dedo en horizontal: la columna bajo el puntero, aunque sea de 2 px (92 días en el móvil).
  const scrub = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    setHover(Math.min(last, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * months.length))))
  }
  const fits = mobileLabels(months.map(short)) // en el móvil no caben 12 meses: se ocultan sin mover la rejilla
  return (
    <div>
      <div onPointerMove={scrub} onPointerLeave={() => setHover(null)} className={cn('relative ml-10 grid h-42 touch-pan-y grid-flow-col auto-cols-fr border-b border-foreground/30', gap)}>
        {ticks.map((t) => (
          <div key={t} className="pointer-events-none absolute right-0 -left-10 border-t" style={{ bottom: `${(t / max) * 100}%` }}>
            <span className="absolute -top-2 left-0 w-8.5 text-right text-[11px] text-muted-foreground tabular-nums">{unit(t)}</span>
          </div>
        ))}
        {months.map((m, i) => (
          <button
            key={name(m)}
            type="button"
            aria-label={`${name(m)}: ${tip(m).join(', ')}`}
            tabIndex={i === Math.min(cur, last) ? 0 : -1}
            onKeyDown={(e) => move(e, i)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            className="relative flex h-full items-end justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {/* Con columnas de 2 px, dos bordes discontinuos se ven casi macizos: una sola línea de puntos. */}
            {isGap?.(m) ? (
              <span className={cn('h-full w-full max-w-6', months.length > 40 ? 'mx-auto max-w-px bg-[repeating-linear-gradient(to_top,var(--s-unr)_0_2px,transparent_2px_6px)]' : 'rounded-sm border border-dashed border-(--s-unr)')} />
            ) : (
              <Stack parts={stack(m)} max={max} />
            )}
            {i === last && (
              <span className="pointer-events-none absolute right-0 text-right text-xs font-semibold whitespace-nowrap tabular-nums" style={{ bottom: `calc(${(stack(m).reduce((s, p) => s + p.v, 0) / max) * 100}% + 4px)` }}>
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
                <span className="block font-semibold first-letter:uppercase">{name(m)}</span>
                {tip(m).map((t) => (
                  <span key={t} className="block">{t}</span>
                ))}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className={cn('mt-1.5 ml-10 grid grid-flow-col auto-cols-fr text-center text-xs text-muted-foreground', gap, mark && months.some(mark) && 'pb-2')}>
        {months.map((m, i) => (
          <span key={name(m)} className={cn('relative whitespace-nowrap', !fits[i] && 'max-sm:invisible')}>
            {short(m)}
            {mark?.(m) && <i aria-hidden="true" className="visible absolute -bottom-2 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-foreground/70" />}
          </span>
        ))}
      </div>
    </div>
  )
}

type Row = { key: string; title: string; subtitle?: string | null; f: Figures }

const COLS: [string, (f: Figures) => string][] = [
  ['Sesiones', (f) => nf.format(f.sessions)],
  ['Ocupación', (f) => percent(f.occupancy)],
  ['Presentes', (f) => nf.format(f.present)],
  ['Faltas', (f) => nf.format(f.absent)],
  ['Sin registrar', (f) => nf.format(f.unrecorded)],
  ['Tardías', (f) => nf.format(f.late)],
]

// Barra segmentada fina (dataviz): partes proporcionales, 2 px de hueco, extremos redondeados; las cifras van al lado.
function Bar({ f }: { f: Figures }) {
  const parts = [
    { cls: 'bg-(--s-pres)', v: f.present },
    { cls: 'bg-(--s-abs)', v: f.absent },
    { cls: HATCH, v: f.unrecorded },
  ].filter((p) => p.v > 0)
  if (!parts.length) return <div className="h-2 rounded-full bg-muted" aria-hidden="true" />
  return (
    <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
      {parts.map((p) => (
        <span key={p.cls} className={cn('basis-0', p.cls)} style={{ flexGrow: p.v }} />
      ))}
    </div>
  )
}

// Móvil: una tarjeta por fila con las cifras en rejilla 3×2. Desde md: una tabla para comparar filas (columnas alineadas).
function Rows({ rows, name }: { rows: Row[]; name: string }) {
  return (
    <>
      <ul className={cn('flex flex-col gap-3 md:hidden', SERIES)}>
        {rows.map((r) => (
          <li key={r.key} className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
            <div>
              <h3 className="font-semibold text-pretty">{r.title}</h3>
              {r.subtitle && <p className="text-[13px] text-muted-foreground">{r.subtitle}</p>}
            </div>
            <Bar f={r.f} />
            <dl className="grid grid-cols-3 gap-x-3 gap-y-2.5">
              {COLS.map(([label, v]) => (
                <div key={label} className="flex flex-col-reverse">
                  <dt className="text-[13px] text-muted-foreground">{label}</dt>
                  <dd className="text-lg leading-tight font-semibold tabular-nums">{v(r.f)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
      <div className={cn('rounded-2xl border bg-card max-md:hidden', SERIES)}>
        <Table className="tabular-nums">
          <caption className="sr-only">{`Por ${name.toLowerCase()}`}</caption>
          <TableHeader>
            <TableRow>
              <TableHead className="ps-4">{name}</TableHead>
              <TableHead className="w-[18%]">Asistencia</TableHead>
              {COLS.map(([label]) => (
                <TableHead key={label} className="text-right last:pe-4">{label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell className="py-3 ps-4 whitespace-normal">
                  <span className="block font-medium">{r.title}</span>
                  {r.subtitle && <span className="block text-[13px] text-muted-foreground">{r.subtitle}</span>}
                </TableCell>
                <TableCell>
                  <Bar f={r.f} />
                </TableCell>
                {COLS.map(([label, v]) => (
                  <TableCell key={label} className="text-right last:pe-4">{v(r.f)}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  )
}

// Las seis cifras del periodo en una sola tarjeta: rejilla 3×2 en el móvil, una fila desde lg.
function Summary({ f }: { f: Figures }) {
  const items: [string, string][] = [
    ['Sesiones', nf.format(f.sessions)],
    [f.occupancy === null ? 'Ocupación · sin plazas' : 'Ocupación', percent(f.occupancy)],
    ['Presentes', nf.format(f.present)],
    ['Faltas', nf.format(f.absent)],
    ['Sin registrar', nf.format(f.unrecorded)],
    ['Cancelaciones tardías', nf.format(f.late)],
  ]
  return <StatGrid items={items} className="lg:grid-cols-6" />
}

function ReportSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Cargando">
      <Skeleton className="h-36 rounded-2xl lg:h-20" />
      <Skeleton className="h-72 rounded-2xl" />
      <Skeleton className="h-28 rounded-2xl" />
    </div>
  )
}

const badRange = (e: unknown) => e instanceof ApiError && e.code === 'invalid_range'

function Failure({ error, retry }: { error: unknown; retry: () => void }) {
  return badRange(error) ? <InlineError>{errorText('invalid_range')}</InlineError> : <ErrorState plainTitle error={error} onRetry={retry} />
}

export function ProfessorReportsPage() {
  return (
    <Page title="Informes" wide>
      <SessionsReport endpoint="/professor/reports/sessions" />
    </Page>
  )
}

// La entrada escalonada solo en la primera visita de la sesión de la app.
let played = false

// El del profesor (solo sus sesiones) y el del admin (toda la academia): la misma pantalla con otro endpoint.
export function SessionsReport({ endpoint, trainer = classTrainer, urlFilters }: { endpoint: string; trainer?: (r: ReportRow) => string | null; urlFilters?: boolean }) {
  const [tab, setTab] = useState('discipline')
  const { ok, base, filters } = useReportFilters({ url: urlFilters })
  const filtered = base.discipline_id !== undefined
  const showClass = filtered || tab === 'class'
  const byDiscipline = useQuery({
    queryKey: ['report', endpoint, 'discipline', base],
    enabled: ok,
    queryFn: () => api<Report>(path(endpoint, { by: 'discipline', ...base })),
  })
  const byClass = useInfiniteQuery({
    queryKey: ['report', endpoint, 'class', base],
    enabled: ok && showClass,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api<Report>(path(endpoint, { by: 'class', ...base, limit: String(PAGE), offset: String(pageParam) })),
    getNextPageParam: (last) => ((last.offset ?? 0) + PAGE < (last.total ?? 0) ? (last.offset ?? 0) + PAGE : undefined),
  })

  // Al cambiar de filtro el bloque de resultados es otro nodo (key) y entra con enter-soft; la primera vez, escalonado.
  const key = JSON.stringify(base)
  const [riseKey, setRiseKey] = useState(played ? null : key)
  if (riseKey !== null && riseKey !== key) setRiseKey(null)
  const rise = riseKey === key
  useEffect(() => {
    played = true
  }, [])

  const data = byDiscipline.data
  const months = data ? monthlyTotals(data.rows) : []
  const total = data ? sumFigures(data.rows.map((r) => r.total)) : null
  const classRows: Row[] = (byClass.data?.pages.flatMap((p) => p.rows) ?? []).map((r) => ({ key: `${r.discipline.id}-${r.class_id ?? 'loose'}`, title: classTitle(r), subtitle: trainer(r), f: r.total }))
  const left = (byClass.data?.pages.at(-1)?.total ?? 0) - classRows.length

  const classes = byClass.isPending ? (
    <Skeleton className="h-40 rounded-2xl" aria-busy="true" aria-label="Cargando" />
  ) : !byClass.data ? (
    <Failure error={byClass.error} retry={() => void byClass.refetch()} />
  ) : (
    <>
      <Rows rows={classRows} name="Clase" />
      {byClass.isFetchNextPageError && <InlineError>No se pudieron cargar más clases. Vuelve a intentarlo.</InlineError>}
      {byClass.hasNextPage && (
        <Button size="xl" variant="outline" loading={byClass.isFetchingNextPage} onClick={() => void byClass.fetchNextPage()}>
          {byClass.isFetchNextPageError ? 'Reintentar' : `Cargar más clases (quedan ${nf.format(left)})`}
        </Button>
      )}
    </>
  )

  return (
    <>
      {filters}
      {ok && (
        <p className="-mt-1 text-sm text-muted-foreground first-letter:uppercase">
          {periodLabel(base.from, base.to)} · sesiones ya celebradas
        </p>
      )}
      {ok && byDiscipline.isPending && <ReportSkeleton />}
      {ok && !data && byDiscipline.isError && <Failure error={byDiscipline.error} retry={() => void byDiscipline.refetch()} />}
      {ok && data && total && (
        <div key={key} className={cn('flex flex-col gap-4', !rise && 'enter-soft')}>
          {total.sessions === 0 && total.booked === 0 ? (
            <EmptyState plainTitle icon={<ChartColumnIcon />} title="Sin sesiones en este periodo" text="Cuenta lo que ya se ha celebrado; prueba con otro periodo." />
          ) : (
            <>
              <Rise on={rise} i={0}>
                <Summary f={total} />
              </Rise>
              {months.length >= 2 && (
                <Rise on={rise} i={1}>
                  <Charts months={months} />
                </Rise>
              )}
              <Rise on={rise} i={2} className="flex flex-col gap-3">
                {filtered ? (
                  <>
                    <h2 className="mt-1 font-semibold">Por clase</h2>
                    {classes}
                  </>
                ) : (
                  <Tabs value={tab} onValueChange={(v) => setTab(String(v))} className="gap-4">
                    <TabsList className="w-full sm:w-auto sm:self-start">
                      <TabsTab value="discipline" className="min-h-11 flex-1 px-5">Por disciplina</TabsTab>
                      <TabsTab value="class" className="min-h-11 flex-1 px-5">Por clase</TabsTab>
                    </TabsList>
                    <TabsPanel value="discipline">
                      <Rows rows={data.rows.map((r) => ({ key: String(r.discipline.id), title: r.discipline.name, f: r.total }))} name="Disciplina" />
                    </TabsPanel>
                    <TabsPanel value="class" className="flex flex-col gap-3">
                      {classes}
                    </TabsPanel>
                  </Tabs>
                )}
              </Rise>
            </>
          )}
        </div>
      )}
    </>
  )
}
