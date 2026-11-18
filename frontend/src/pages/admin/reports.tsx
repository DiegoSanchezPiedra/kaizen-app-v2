import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronRightIcon, CircleAlertIcon, TableIcon, UsersIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Page } from '@/components/page'
import { useReportFilters } from '@/components/report-filters'
import { EmptyState, ErrorState, InlineError } from '@/components/screen-state'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { hasData, latestStat, type DayStat, type MonthStat, type Paged, type SubscriptionReport } from '@/lib/admin'
import { api, ApiError } from '@/lib/api'
import { addDays, addMonths, formatDay, formatMonth, madridDay, madridMonth } from '@/lib/dates'
import { errorText } from '@/lib/errors'
import { niceMax, periodLabel, shortMonth, type ReportRow } from '@/lib/professor'
import { path } from '@/lib/url'
import { cn } from '@/lib/utils'
import { Filter } from '@/components/filter'
import { HATCH, Key, MonthBars, SERIES, SessionsReport, StatGrid } from '@/pages/professor-reports'
import { PAGE_SIZE, Pager } from '@/pages/admin/shell'

const nf = new Intl.NumberFormat('es-ES')
const dayFmt = new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' })
const shortDay = (d: string) => dayFmt.format(new Date(`${d}T12:00:00Z`)).replace('.', '')
const NO_DATA = 'Sin dato'
const badRange = (e: unknown) => e instanceof ApiError && e.code === 'invalid_range'

type Range = '30d' | '92d' | '12m' | '24m'
const RANGES: { value: Range; label: string }[] = [
  { value: '30d', label: 'Últimos 30 días' },
  { value: '92d', label: 'Últimos 92 días' },
  { value: '12m', label: 'Últimos 12 meses' },
  { value: '24m', label: 'Últimos 24 meses' },
]
// La foto es nocturna: por días, hasta ayer; por meses, hasta el en curso (como los rangos por defecto de la API).
function rangeParams(r: Range) {
  if (r.endsWith('d')) {
    const to = addDays(madridDay(), -1)
    return { group: 'day', from: addDays(to, r === '30d' ? -29 : -91), to }
  }
  const to = madridMonth()
  return { group: 'month', from: addMonths(to, r === '12m' ? -11 : -23), to }
}

type Stat = DayStat | MonthStat
const isMonth = (s: Stat): s is MonthStat => 'month' in s
// Un mes incompleto lo dice: «N de M días».
const coverage = (s: Stat) => (isMonth(s) && hasData(s) && s.days_with_data < s.days_in_month ? `${s.days_with_data} de ${s.days_in_month} días` : null)
const count = (v: number | null) => (v === null ? NO_DATA : nf.format(v))
const subs = (r: Stat) => (r.active ?? 0) + (r.past_due ?? 0) + (r.unpaid ?? 0)

function SubscriptionsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Cargando">
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-28 rounded-2xl" />
      </div>
      <Skeleton className="h-[30rem] rounded-2xl" />
    </div>
  )
}

function SubscriptionsTab() {
  const [params, setParams] = useSearchParams()
  const range = RANGES.find((r) => r.value === params.get('rango'))?.value ?? '30d'
  const setRange = (v: string) =>
    setParams((p) => {
      const n = new URLSearchParams(p)
      n.set('rango', v)
      return n
    }, { replace: true })
  const q = rangeParams(range)
  const [table, setTable] = useState(false)
  const report = useQuery({
    queryKey: ['admin', 'stats', q],
    queryFn: () => api<SubscriptionReport<Stat>>(path('/admin/reports/subscriptions', q)),
  })
  // Fechas con año cuando el rango abarca dos años (24 meses siempre; 92 días en invierno).
  const twoYears = q.from.slice(0, 4) !== q.to.slice(0, 4)
  const name = (s: Stat) => (isMonth(s) ? formatMonth(s.month) : `${formatDay(s.date)}${twoYears ? ` de ${s.date.slice(0, 4)}` : ''}`)
  const rows = report.data?.rows ?? []
  // El eje: por meses, el año en enero; 92 días, el mes en su día 1; 30 días, «17 nov» cada 7 desde el final, sin los extremos (se saldrían).
  const short = (s: Stat, i: number) =>
    isMonth(s)
      ? `${shortMonth(s.month)}${twoYears && s.month.endsWith('-01') ? ` ’${s.month.slice(2, 4)}` : ''}`
      : rows.length > 40
        ? s.date.endsWith('-01') && i >= 3 ? shortMonth(s.date.slice(0, 7)) : ''
        : (rows.length - 1 - i) % 7 === 0 && i >= 3 && i <= rows.length - 4
          ? shortDay(s.date).replace(/ \d{4}$/, '')
          : ''
  const last = rows.findLast(hasData)
  const sum = (k: 'new_subscriptions' | 'cancelled_subscriptions') => rows.reduce((n, r) => n + (r[k] ?? 0), 0)
  const stale = report.data?.group === 'day' && latestStat(rows as DayStat[])?.stale
  const maxSubs = niceMax(Math.max(...rows.map(subs)))
  const maxTrained = niceMax(Math.max(...rows.map((r) => r.trained)))
  const gaps = rows.some((r) => !hasData(r))
  const partial = rows.some((r) => coverage(r))
  const tip = (r: Stat, lines: string[]) => (hasData(r) ? [...lines, ...(coverage(r) ? [coverage(r)!] : [])] : [NO_DATA])

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Filter label="Periodo" value={range} onChange={setRange} items={RANGES} />
      </div>
      <p className="-mt-1 text-sm text-muted-foreground first-letter:uppercase">
        {q.group === 'day' ? `${shortDay(q.from)} – ${shortDay(q.to)}` : periodLabel(q.from, q.to)} · de la foto de cada noche
      </p>
      {report.isPending ? (
        <SubscriptionsSkeleton />
      ) : report.isError ? (
        badRange(report.error) ? (
          <InlineError>Revisa las fechas: como mucho 92 días o 24 meses.</InlineError>
        ) : (
          <ErrorState plainTitle error={report.error} onRetry={() => void report.refetch()} />
        )
      ) : !last ? (
        <EmptyState plainTitle icon={<TableIcon />} title="Sin fotos en este periodo" text="Las cifras salen de la foto de cada noche; prueba con otro periodo." />
      ) : (
        <div key={range} className="enter-soft flex flex-col gap-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <section aria-labelledby="foto" className="flex flex-col gap-2">
              <h2 id="foto" className="text-sm font-semibold">
                Última foto · <span className="first-letter:uppercase">{isMonth(last) ? formatMonth(last.month) : shortDay(last.date)}</span>
                {coverage(last) && <span className="font-normal text-muted-foreground"> · {coverage(last)}</span>}
              </h2>
              <StatGrid items={[['Activas', count(last.active)], ['En gracia', count(last.past_due)], ['Impagadas', count(last.unpaid)]]} />
              {stale && (
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <CircleAlertIcon className="size-4 shrink-0" aria-hidden="true" />
                  Sin dato de ayer: es la última foto que hay.
                </p>
              )}
            </section>
            <section aria-labelledby="periodo" className="flex flex-col gap-2">
              <h2 id="periodo" className="text-sm font-semibold">En el periodo</h2>
              <StatGrid items={[['Altas', nf.format(sum('new_subscriptions'))], ['Bajas', nf.format(sum('cancelled_subscriptions'))], ['Entrenaron', nf.format(report.data.trained)]]} />
            </section>
          </div>
          <section aria-label="Evolución" className={cn('flex flex-col gap-5 rounded-2xl border bg-card p-4', SERIES)}>
            <div className="flex flex-col gap-3">
              <h2 className="font-semibold">Suscripciones por estado</h2>
              <Key
                items={[
                  { label: 'Activas', cls: 'bg-(--s-pres)' },
                  { label: 'En gracia', cls: HATCH },
                  { label: 'Impagadas', cls: 'bg-(--s-abs)' },
                  ...(gaps ? [{ label: NO_DATA, cls: 'border border-dashed border-(--s-unr)' }] : []),
                  ...(partial ? [{ label: 'Mes incompleto', cls: 'mx-0.75 size-1.5 rounded-full bg-foreground/70' }] : []),
                ]}
              />
              <MonthBars
                months={rows}
                max={maxSubs}
                ticks={[0, maxSubs / 2, maxSubs]}
                unit={(n) => nf.format(n)}
                name={name}
                short={(r) => short(r, rows.indexOf(r))}
                gap={(r) => !hasData(r)}
                mark={(r) => coverage(r) !== null}
                stack={(r) => [
                  { cls: 'bg-(--s-pres)', v: r.active ?? 0 },
                  { cls: HATCH, v: r.past_due ?? 0 },
                  { cls: 'bg-(--s-abs)', v: r.unpaid ?? 0 },
                ]}
                tip={(r) => tip(r, [`Activas: ${count(r.active)}`, `En gracia: ${count(r.past_due)}`, `Impagadas: ${count(r.unpaid)}`])}
                labelLast={(r) => (hasData(r) ? nf.format(subs(r)) : NO_DATA)}
              />
            </div>
            <div className="flex flex-col gap-3">
              <h2 className="font-semibold">Alumnos que entrenaron</h2>
              <MonthBars
                months={rows}
                max={maxTrained}
                ticks={[0, maxTrained / 2, maxTrained]}
                unit={(n) => nf.format(n)}
                name={name}
                short={(r) => short(r, rows.indexOf(r))}
                stack={(r) => [{ cls: 'bg-(--s-occ)', v: r.trained }]}
                // En vivo, no de la foto: ni «Sin dato» ni la cobertura de fotos del mes.
                tip={(r) => [`Entrenaron: ${nf.format(r.trained)}`]}
                labelLast={(r) => nf.format(r.trained)}
              />
            </div>
            <Button variant="outline" size="xl" className="h-11 sm:h-11" aria-expanded={table} onClick={() => setTable((t) => !t)}>
              <TableIcon />
              {table ? 'Ocultar tabla' : 'Ver tabla'}
            </Button>
            {table && <StatsTable rows={rows} name={name} />}
          </section>
        </div>
      )}
    </div>
  )
}

const STAT_COLS: [string, (r: Stat) => string][] = [
  ['Activas', (r) => count(r.active)],
  ['En gracia', (r) => count(r.past_due)],
  ['Impagadas', (r) => count(r.unpaid)],
  ['Altas', (r) => count(r.new_subscriptions)],
  ['Bajas', (r) => count(r.cancelled_subscriptions)],
  ['Entrenaron', (r) => nf.format(r.trained)],
]

// Como el resto del panel: una fila por día o mes hasta `xl` (cifras en 3×2) y la tabla solo desde `xl`.
function StatsTable({ rows, name }: { rows: Stat[]; name: (s: Stat) => string }) {
  return (
    <>
      <ul className="-mx-4 -mb-4 flex flex-col divide-y border-t xl:hidden">
        {rows.map((r) => (
          <li key={name(r)} className="flex flex-col gap-2 px-4 py-3">
            <p className="leading-snug">
              <span className="font-medium first-letter:uppercase">{name(r)}</span>
              {coverage(r) && <span className="text-sm text-muted-foreground"> · {coverage(r)}</span>}
            </p>
            <dl className="grid grid-cols-3 gap-x-3 gap-y-1.5">
              {STAT_COLS.map(([label, v]) => (
                <div key={label} className="flex flex-col-reverse">
                  <dt className="text-[13px] text-muted-foreground">{label}</dt>
                  <dd className={cn('font-semibold tabular-nums', v(r) === NO_DATA && 'font-normal text-muted-foreground')}>{v(r)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
      <Table className="tabular-nums max-xl:hidden">
        <caption className="sr-only">Cifras por {isMonth(rows[0]) ? 'mes' : 'día'}</caption>
        <TableHeader>
          <TableRow>
            {[isMonth(rows[0]) ? 'Mes' : 'Día', ...STAT_COLS.map(([h]) => h)].map((h, i) => (
              <TableHead key={h} className={i ? 'text-right' : undefined}>{h}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={name(r)}>
              <TableCell className="font-medium first-letter:uppercase">
                {name(r)}
                {coverage(r) && <span className="block pt-1 text-xs font-normal text-muted-foreground">{coverage(r)}</span>}
              </TableCell>
              {STAT_COLS.map(([h, v]) => (
                <TableCell key={h} className={cn('text-right', v(r) === NO_DATA && 'text-muted-foreground')}>{v(r)}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  )
}

type StudentRow = { id: string; name: string | null; bookings: number; present: number; absent: number; unrecorded: number; late: number }
const STUDENT_COLS: [string, (r: StudentRow) => number, string, string][] = [
  ['Reservas', (r) => r.bookings, 'reserva', 'reservas'],
  ['Presentes', (r) => r.present, 'presente', 'presentes'],
  ['Faltas', (r) => r.absent, 'falta', 'faltas'],
  ['Sin registrar', (r) => r.unrecorded, 'sin registrar', 'sin registrar'],
  ['Tardías', (r) => r.late, 'tardía', 'tardías'],
]

function StudentsTab() {
  const [params, setParams] = useSearchParams()
  const page = Math.max(1, Number(params.get('page')) || 1)
  const { ok, base, filters } = useReportFilters({ url: true })
  const report = useQuery({
    queryKey: ['admin', 'report-students', base, page],
    enabled: ok,
    placeholderData: keepPreviousData,
    queryFn: () => api<Paged<'rows', StudentRow>>(path('/admin/reports/students', { ...base, limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) })),
  })
  const href = (p: number) => {
    const n = new URLSearchParams(params)
    n.set('page', String(p))
    return `?${n}`
  }
  const noDiscipline = () =>
    setParams((p) => {
      const n = new URLSearchParams(p)
      n.delete('disciplina')
      return n
    }, { replace: true })
  const nameOf = (r: StudentRow) => r.name ?? <span className="text-muted-foreground">Sin nombre</span>
  return (
    <div className="flex flex-col gap-5">
      {filters}
      {ok && <p className="-mt-1 text-sm text-muted-foreground first-letter:uppercase">{periodLabel(base.from, base.to)} · sesiones ya celebradas, por nombre</p>}
      {!ok ? null : report.isPending ? (
        <Skeleton className="h-96 rounded-2xl" aria-busy="true" aria-label="Cargando" />
      ) : report.isError && !report.data ? (
        badRange(report.error) ? <InlineError>{errorText('invalid_range')}</InlineError> : <ErrorState plainTitle error={report.error} onRetry={() => void report.refetch()} />
      ) : report.data.total === 0 ? (
        <EmptyState
          plainTitle
          icon={<UsersIcon />}
          title="Nadie ha reservado en este periodo"
          text="Cuenta las reservas de sesiones ya celebradas; prueba con otro periodo."
          action={
            base.discipline_id !== undefined && (
              <Button variant="outline" className="h-11 sm:h-11" onClick={noDiscipline}>
                Quitar la disciplina
              </Button>
            )
          }
        />
      ) : (
        <div className={cn('flex flex-col gap-4 transition-opacity duration-150 ease-out', report.isPlaceholderData && 'opacity-60')} aria-busy={report.isPlaceholderData}>
          {/* Como Usuarios y Auditoría: una fila por alumno hasta `xl`; antes la tabla no cabe con la barra lateral. */}
          <ul className="flex flex-col divide-y overflow-hidden rounded-2xl border bg-card xl:hidden">
            {report.data.rows.map((r) => (
              <li key={r.id}>
                <Link
                  to={`/admin/users/${r.id}`}
                  className="flex min-h-11 items-center gap-3 py-3 ps-4 pe-3 transition-colors duration-150 hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none active:bg-accent"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="leading-snug font-semibold break-words">{nameOf(r)}</span>
                    <span className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-sm text-muted-foreground tabular-nums">
                      {STUDENT_COLS.map(([h, v, one, more]) => (
                        <span key={h}>
                          <b className="font-semibold text-foreground">{nf.format(v(r))}</b> {v(r) === 1 ? one : more}
                        </span>
                      ))}
                    </span>
                  </span>
                  <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden rounded-2xl border bg-card xl:block">
            <Table className="tabular-nums">
              <caption className="sr-only">Asistencia por alumno</caption>
              <TableHeader>
                <TableRow>
                  {['Alumno', ...STUDENT_COLS.map(([h]) => h)].map((h, i) => (
                    <TableHead key={h} className={i ? 'text-right last:pe-4' : 'ps-4'}>{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.data.rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="max-w-96 ps-4 leading-snug break-words whitespace-normal">
                      <Link to={`/admin/users/${r.id}`} className="inline-flex min-h-11 items-center font-medium text-link underline-offset-3 hover:underline">
                        {nameOf(r)}
                      </Link>
                    </TableCell>
                    {STUDENT_COLS.map(([h, v]) => (
                      <TableCell key={h} className="text-right last:pe-4">{nf.format(v(r))}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager total={report.data.total} page={page} href={href} />
        </div>
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

// docs/pantallas-b19.md § Informes y b22 § Informes: la pestaña y los filtros van en la URL; cambiar de pestaña los conserva.
export function AdminReportsPage() {
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((t) => t.value === params.get('tab')) ? params.get('tab')! : 'subscriptions'
  const toTab = (v: string) =>
    setParams((p) => {
      const n = new URLSearchParams(p)
      n.set('tab', v)
      n.delete('page')
      return n
    })
  return (
    <Page title="Informes" wide>
      <Tabs value={tab} onValueChange={(v) => toTab(String(v))} className="gap-5">
        <TabsList className="w-full sm:w-auto sm:self-start">
          {TABS.map((t) => (
            <TabsTab key={t.value} value={t.value} className="min-h-11 flex-1 px-3 sm:px-4">
              {t.label}
            </TabsTab>
          ))}
        </TabsList>
        <TabsPanel value="subscriptions">
          <SubscriptionsTab />
        </TabsPanel>
        <TabsPanel value="sessions" className="flex flex-col gap-5">
          <SessionsReport endpoint="/admin/reports/sessions" trainer={trainerOf} urlFilters />
        </TabsPanel>
        <TabsPanel value="students">
          <StudentsTab />
        </TabsPanel>
      </Tabs>
    </Page>
  )
}
