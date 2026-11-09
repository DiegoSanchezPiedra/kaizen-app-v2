import { useQuery } from '@tanstack/react-query'
import { TableIcon, UsersIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Page } from '@/components/page'
import { useReportFilters } from '@/components/report-filters'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/screen-state'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { hasData, latestStat, type DayStat, type MonthStat, type Paged, type SubscriptionReport } from '@/lib/admin'
import { api } from '@/lib/api'
import { addDays, addMonths, dayOfMonth, formatDay, formatMonth, madridDay, madridMonth } from '@/lib/dates'
import { niceMax, shortMonth, type ReportRow } from '@/lib/professor'
import { path } from '@/lib/url'
import { cn } from '@/lib/utils'
import { Filter } from '@/pages/community'
import { HATCH, Key, MonthBars, SERIES, SessionsReport, Tile } from '@/pages/professor-reports'
import { PAGE_SIZE, Pager } from '@/pages/admin/shell'

const nf = new Intl.NumberFormat('es-ES')
const NO_DATA = 'Sin dato'

type Range = 'd30' | 'd92' | 'm12' | 'm24'
const RANGES: { value: Range; label: string }[] = [
  { value: 'd30', label: 'Últimos 30 días' },
  { value: 'd92', label: 'Últimos 92 días' },
  { value: 'm12', label: 'Últimos 12 meses' },
  { value: 'm24', label: 'Últimos 24 meses' },
]
// La foto es nocturna: por días, hasta ayer; por meses, hasta el en curso (como los rangos por defecto de la API).
function rangeParams(r: Range) {
  if (r[0] === 'd') {
    const to = addDays(madridDay(), -1)
    return { group: 'day', from: addDays(to, r === 'd30' ? -29 : -91), to }
  }
  const to = madridMonth()
  return { group: 'month', from: addMonths(to, r === 'm12' ? -11 : -23), to }
}

type Stat = DayStat | MonthStat
const isMonth = (s: Stat): s is MonthStat => 'month' in s
const statName = (s: Stat) => (isMonth(s) ? formatMonth(s.month) : formatDay(s.date))
const statShort = (s: Stat, i: number) => (isMonth(s) ? shortMonth(s.month) : i % 7 === 0 ? String(dayOfMonth(s.date)) : '')
// Un mes incompleto lo dice: «N de M días».
const coverage = (s: Stat) => (isMonth(s) && s.days_with_data < s.days_in_month ? `${s.days_with_data} de ${s.days_in_month} días` : null)
const count = (v: number | null) => (v === null ? NO_DATA : nf.format(v))

function SubscriptionsTab() {
  const [range, setRange] = useState<Range>('d30')
  const params = rangeParams(range)
  const [table, setTable] = useState(false)
  const report = useQuery({
    queryKey: ['admin', 'stats', params],
    queryFn: () => api<SubscriptionReport<Stat>>(path('/admin/reports/subscriptions', params)),
  })
  const rows = report.data?.rows ?? []
  const last = rows.findLast(hasData)
  const sum = (k: 'new_subscriptions' | 'cancelled_subscriptions') => rows.reduce((n, r) => n + (r[k] ?? 0), 0)
  const stale = report.data?.group === 'day' && latestStat(rows as DayStat[])?.stale
  const maxSubs = niceMax(Math.max(...rows.map((r) => (r.active ?? 0) + (r.past_due ?? 0) + (r.unpaid ?? 0))))
  const maxTrained = niceMax(Math.max(...rows.map((r) => r.trained)))
  const tip = (r: Stat, lines: string[]) => (hasData(r) ? [...lines, ...(coverage(r) ? [coverage(r)!] : [])] : [NO_DATA])

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-2 sm:max-w-xs">
        <Filter label="Periodo" value={range} onChange={(v) => setRange(v as Range)} items={RANGES} />
      </div>
      {report.isPending ? (
        <ListSkeleton rows={2} className="h-40" />
      ) : report.isError ? (
        <ErrorState error={report.error} onRetry={() => void report.refetch()} />
      ) : !last ? (
        <EmptyState icon={<TableIcon />} title="Sin fotos en este periodo" text="Las cifras salen de la foto de cada noche." />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              {stale && <span className="font-semibold text-foreground">Sin dato de ayer. </span>}
              Estados de la última foto: {statName(last)}.
            </p>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
              <Tile label="Activas" value={count(last.active)} />
              <Tile label="En gracia" value={count(last.past_due)} />
              <Tile label="Impagadas" value={count(last.unpaid)} />
              <Tile label="Altas en el periodo" value={nf.format(sum('new_subscriptions'))} />
              <Tile label="Bajas en el periodo" value={nf.format(sum('cancelled_subscriptions'))} />
              <Tile label="Entrenaron en el periodo" value={nf.format(report.data!.trained)} />
            </div>
          </div>
          <section aria-label="Evolución" className={cn('flex flex-col gap-5 rounded-2xl border bg-card p-4', SERIES)}>
            <div className="flex flex-col gap-3">
              <h2 className="font-semibold">Suscripciones por estado</h2>
              <Key items={[{ label: 'Activas', cls: 'bg-(--s-pres)' }, { label: 'En gracia', cls: HATCH }, { label: 'Impagadas', cls: 'bg-(--s-abs)' }]} />
              <MonthBars
                months={rows}
                max={maxSubs}
                ticks={[0, maxSubs / 2, maxSubs]}
                unit={(n) => nf.format(n)}
                name={statName}
                short={(r) => statShort(r, rows.indexOf(r))}
                stack={(r) => [
                  { cls: 'bg-(--s-pres)', v: r.active ?? 0 },
                  { cls: HATCH, v: r.past_due ?? 0 },
                  { cls: 'bg-(--s-abs)', v: r.unpaid ?? 0 },
                ]}
                tip={(r) => tip(r, [`Activas: ${count(r.active)}`, `En gracia: ${count(r.past_due)}`, `Impagadas: ${count(r.unpaid)}`])}
                labelLast={(r) => (hasData(r) ? nf.format((r.active ?? 0) + (r.past_due ?? 0) + (r.unpaid ?? 0)) : NO_DATA)}
              />
            </div>
            <div className="flex flex-col gap-3">
              <h2 className="font-semibold">Alumnos que entrenaron</h2>
              <MonthBars
                months={rows}
                max={maxTrained}
                ticks={[0, maxTrained / 2, maxTrained]}
                unit={(n) => nf.format(n)}
                name={statName}
                short={(r) => statShort(r, rows.indexOf(r))}
                stack={(r) => [{ cls: 'bg-(--s-occ)', v: r.trained }]}
                tip={(r) => [`Entrenaron: ${nf.format(r.trained)}`, ...(coverage(r) ? [coverage(r)!] : [])]}
                labelLast={(r) => nf.format(r.trained)}
              />
            </div>
            <Button variant="outline" size="xl" aria-expanded={table} onClick={() => setTable((t) => !t)}>
              <TableIcon />
              {table ? 'Ocultar tabla' : 'Ver tabla'}
            </Button>
            {table && (
              <Table className="tabular-nums">
                <TableHeader>
                  <TableRow>
                    {[isMonth(last) ? 'Mes' : 'Día', 'Activas', 'En gracia', 'Impagadas', 'Altas', 'Bajas', 'Entrenaron'].map((h, i) => (
                      <TableHead key={h} className={i ? 'text-right' : undefined}>{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={statName(r)}>
                      <TableCell className="font-medium first-letter:uppercase">
                        {statName(r)}
                        {coverage(r) && <span className="block text-xs text-muted-foreground">{coverage(r)}</span>}
                      </TableCell>
                      {[count(r.active), count(r.past_due), count(r.unpaid), count(r.new_subscriptions), count(r.cancelled_subscriptions), nf.format(r.trained)].map((v, i) => (
                        <TableCell key={i} className={cn('text-right', v === NO_DATA && 'text-muted-foreground')}>{v}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        </>
      )}
    </div>
  )
}

type StudentRow = { id: string; name: string | null; bookings: number; present: number; absent: number; unrecorded: number; late: number }

function StudentsTab() {
  const [params] = useSearchParams()
  const page = Math.max(1, Number(params.get('page')) || 1)
  const { ok, base, filters } = useReportFilters()
  const report = useQuery({
    queryKey: ['admin', 'report-students', base, page],
    enabled: ok,
    queryFn: () => api<Paged<'rows', StudentRow>>(path('/admin/reports/students', { ...base, limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) })),
  })
  const href = (p: number) => `?${new URLSearchParams({ tab: 'students', page: String(p) })}`
  return (
    <div className="flex flex-col gap-4">
      {filters}
      {!ok ? null : report.isPending ? (
        <ListSkeleton rows={4} className="h-10" />
      ) : report.isError ? (
        <ErrorState error={report.error} onRetry={() => void report.refetch()} />
      ) : report.data.total === 0 ? (
        <EmptyState icon={<UsersIcon />} title="Nadie ha reservado en este periodo" />
      ) : (
        <>
          <div className="rounded-2xl border bg-card">
            <Table className="tabular-nums">
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  {['Alumno', 'Reservas', 'Presentes', 'Faltas', 'Sin registrar', 'Tardías'].map((h, i) => (
                    <TableHead key={h} className={i ? 'text-right' : 'ps-4'}>{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.data.rows.map((r) => (
                  <TableRow key={r.id} className="h-10">
                    <TableCell className="ps-4">
                      <Link to={`/admin/users/${r.id}`} className="font-medium text-link underline-offset-3 hover:underline">
                        {r.name ?? 'Sin nombre'}
                      </Link>
                    </TableCell>
                    {[r.bookings, r.present, r.absent, r.unrecorded, r.late].map((v, i) => (
                      <TableCell key={i} className="text-right">{nf.format(v)}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager total={report.data.total} page={page} href={href} />
        </>
      )}
    </div>
  )
}

// El admin ve el nombre del profesor de cada clase; una sesión suelta no tiene habitual.
const trainerOf = (r: ReportRow) => (!r.class_id ? null : r.trainer?.name ? `Clase de ${r.trainer.name}` : 'Sin profesor habitual')

const TABS = [
  { value: 'subscriptions', label: 'Suscripciones' },
  { value: 'sessions', label: 'Sesiones' },
  { value: 'students', label: 'Alumnos' },
]

// docs/pantallas-b19.md § Informes: las métricas de B17 con los gráficos de B18.4. La pestaña va en la URL.
export function AdminReportsPage() {
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((t) => t.value === params.get('tab')) ? params.get('tab')! : 'subscriptions'
  return (
    <Page title="Informes" wide>
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: String(v) })} className="gap-5">
        <TabsList className="w-full sm:w-auto">
          {TABS.map((t) => (
            <TabsTab key={t.value} value={t.value} className="min-h-11 flex-1 px-4">
              {t.label}
            </TabsTab>
          ))}
        </TabsList>
        <TabsPanel value="subscriptions">
          <SubscriptionsTab />
        </TabsPanel>
        <TabsPanel value="sessions" className="flex flex-col gap-5">
          <SessionsReport endpoint="/admin/reports/sessions" trainer={trainerOf} />
        </TabsPanel>
        <TabsPanel value="students">
          <StudentsTab />
        </TabsPanel>
      </Tabs>
    </Page>
  )
}
