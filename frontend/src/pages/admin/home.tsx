import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { ArrowDownIcon, ArrowUpIcon, ChevronRightIcon, CircleCheckIcon, PlusIcon, SearchIcon } from 'lucide-react'
import type React from 'react'
import { Link, useNavigate } from 'react-router'
import { Page } from '@/components/page'
import { ErrorState, ListSkeleton } from '@/components/screen-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Meter, MeterIndicator, MeterTrack } from '@/components/ui/meter'
import { Skeleton } from '@/components/ui/skeleton'
import { useNow } from '@/hooks/use-now'
import {
  auditDetail,
  auditLabel,
  auditTarget,
  noticeLabel,
  nowFocus,
  trend,
  variation,
  type AcademyNotice,
  type AdminHome,
  type AuditRow,
  type DayStat,
  type HomeSession,
  type Paged,
  type SubscriptionReport,
} from '@/lib/admin'
import { api } from '@/lib/api'
import type { AdminEvent } from '@/lib/events'
import { addDays, madridDay } from '@/lib/dates'
import { formatDate, formatShortDate, formatTime } from '@/lib/format'
import { phaseOf, plural, type Phase } from '@/lib/professor'
import { path } from '@/lib/url'
import { cn } from '@/lib/utils'
import { MfaNotice } from '@/pages/admin/shell'

const nf = new Intl.NumberFormat('es-ES')
const dayFmt = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', weekday: 'short', day: 'numeric', month: 'short' })
const signed = new Intl.NumberFormat('es-ES', { signDisplay: 'exceptZero' })

// Con datos, sigue enseñándolos aunque un refresco falle (el indicador de la cabecera avisa); sin datos, esqueleto o error.
function View<T>({ q, skeleton, children }: { q: UseQueryResult<T>; skeleton: React.ReactNode; children: (data: T) => React.ReactNode }) {
  if (q.data !== undefined) return <>{children(q.data)}</>
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  return <>{skeleton}</>
}

// Línea de los 30 días; un día sin foto corta la línea (es un hueco, no un cero).
function Spark({ values }: { values: (number | null)[] }) {
  const nums = values.filter((v): v is number => v !== null)
  const max = Math.max(...nums, 1)
  const min = Math.min(...nums, 0)
  const y = (v: number) => 22 - ((v - min) / (max - min || 1)) * 20
  const d = values.reduce((acc, v, i) => (v === null ? acc : `${acc}${i && values[i - 1] !== null ? 'L' : 'M'}${i} ${y(v)}`), '')
  return (
    <svg viewBox={`0 0 ${Math.max(values.length - 1, 1)} 24`} preserveAspectRatio="none" aria-hidden="true" className="h-6 w-full text-link">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}

// ── Cabecera ─────────────────────────────────────────────────────────────────

function Live({ home }: { home: UseQueryResult<AdminHome> }) {
  if (home.data === undefined) return null
  const time = formatTime(new Date(home.dataUpdatedAt))
  // Punto fijo, sin latido; la caída se dice con texto y no solo con color.
  return home.isError ? (
    <Badge variant="warning">Sin conexión · {time}</Badge>
  ) : (
    <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground tabular-nums">
      <span className="size-2 rounded-full bg-success" aria-hidden="true" />
      En vivo · {time}
    </span>
  )
}

function Search() {
  const navigate = useNavigate()
  return (
    <form
      role="search"
      className="min-w-0 flex-1"
      onSubmit={(e) => {
        e.preventDefault()
        const q = String(new FormData(e.currentTarget).get('q') ?? '').trim()
        void navigate(path('/admin/users', { q: q || undefined }))
      }}
    >
      <InputGroup className="min-h-11">
        <InputGroupAddon aria-hidden="true">
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput type="search" name="q" aria-label="Buscar alumno" placeholder="Buscar alumno" enterKeyHint="search" />
      </InputGroup>
    </form>
  )
}

// «Sesión suelta» y «Evento» se crean desde su pantalla (la hoja de crear no tiene URL propia).
function Shortcuts({ className }: { className?: string }) {
  return (
    <div className={cn('grid grid-cols-2 gap-3', className)}>
      <Button variant="outline" size="xl" render={<Link to="/admin/sessions" />}>
        <PlusIcon />
        Sesión suelta
      </Button>
      <Button variant="outline" size="xl" render={<Link to="/admin/events" />}>
        <PlusIcon />
        Evento
      </Button>
    </div>
  )
}

// ── Ahora ────────────────────────────────────────────────────────────────────

function NowSession({ s, kind, now }: { s: HomeSession; kind: 'now' | 'upcoming' | 'next'; now: number }) {
  const started = Date.parse(s.starts_at) <= now
  const counts = [started && `${s.present} dentro`, plural(s.booked, 'reserva', 'reservas'), plural(s.capacity, 'plaza', 'plazas')].filter(Boolean).join(' · ')
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-heading text-xl leading-tight font-bold break-words">{s.discipline.name}</p>
          <p className="mt-1 text-[15px] font-medium tabular-nums">
            {kind === 'next' && <span className="first-letter:uppercase">{formatDate(s.starts_at)}, </span>}
            {formatTime(s.starts_at)}–{formatTime(s.ends_at)}
          </p>
          <p className="text-[13px] text-muted-foreground">{[s.trainer?.display_name ?? 'Sin profesor', s.location].filter(Boolean).join(' · ')}</p>
        </div>
        <Badge variant={kind === 'now' ? 'info' : 'outline'}>{kind === 'now' ? 'En curso' : 'Siguiente'}</Badge>
      </div>
      <Meter value={Math.min(s.booked, s.capacity)} max={Math.max(s.capacity, 1)} aria-label={`${s.booked} reservas de ${s.capacity} plazas`}>
        <MeterTrack className="rounded-full">
          <MeterIndicator className="transition-none" />
        </MeterTrack>
      </Meter>
      <p className="text-sm tabular-nums">{counts}</p>
      <Button variant={kind === 'now' ? 'default' : 'outline'} size="xl" render={<Link to={`/admin/sessions/${s.id}`} />}>
        {kind === 'now' ? 'Pasar lista' : 'Ver sesión'}
      </Button>
    </div>
  )
}

function Now({ home, now, className }: { home: UseQueryResult<AdminHome>; now: number; className?: string }) {
  return (
    <section aria-label="Ahora" className={cn('flex flex-col gap-3', className)}>
      <h2 className="font-semibold">Ahora</h2>
      <View q={home} skeleton={<Skeleton className="h-52 w-full rounded-2xl" />}>
        {(d) => {
          const focus = nowFocus(d.sessions, d.next, now)
          return focus ? (
            <div className="divide-y overflow-hidden rounded-2xl border bg-card">
              {focus.sessions.map((s) => (
                <NowSession key={s.id} s={s} kind={focus.kind} now={now} />
              ))}
            </div>
          ) : (
            <p className="rounded-2xl border bg-card px-4 py-3.5 text-[15px] text-muted-foreground">No hay ninguna sesión programada.</p>
          )
        }}
      </View>
    </section>
  )
}

// ── Cifras ───────────────────────────────────────────────────────────────────

// La variación en % frente a `before`; sin base (before 0), la cifra de antes.
function Delta({ now, before, vs, was }: { now: number; before: number; vs: string; was: string }) {
  const pct = variation(now, before)
  if (pct === null) return <span className="text-[13px] text-muted-foreground tabular-nums">{was}: {nf.format(before)}</span>
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-muted-foreground tabular-nums">
      <span className={cn('flex items-center gap-0.5 font-semibold', pct > 0 ? 'text-success' : pct < 0 && 'text-destructive')}>
        {pct > 0 && <ArrowUpIcon className="size-3.5" aria-hidden="true" />}
        {pct < 0 && <ArrowDownIcon className="size-3.5" aria-hidden="true" />}
        {signed.format(pct)} %
      </span>
      {vs}
    </span>
  )
}

function Figures({ home, className }: { home: UseQueryResult<AdminHome>; className?: string }) {
  // La línea de 30 días sale de la foto nocturna; si no está o falla, la tarjeta se ve igual sin línea.
  const rows = useQuery({
    queryKey: ['admin', 'stats-day', 'home'],
    queryFn: () => api<SubscriptionReport<DayStat>>('/admin/reports/subscriptions?group=day'),
  }).data?.rows
  return (
    <section aria-label="Cifras" className={className}>
      <View q={home} skeleton={<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>}>
        {(d) => {
          const activeTrend = rows && trend(rows, 'active')
          const cards: { label: string; value: string; to: string; extra?: React.ReactNode; spark?: (number | null)[]; alert?: boolean }[] = [
            {
              label: 'Alumnos activos',
              value: nf.format(d.students.activos),
              to: '/admin/users?estado=activo',
              spark: rows?.map((r) => r.active),
              extra: typeof activeTrend === 'number' && <span className="text-[13px] text-muted-foreground tabular-nums">{signed.format(activeTrend)} en 30 días</span>,
            },
            { label: 'Impago', value: nf.format(d.students.impago), to: '/admin/billing', alert: d.students.impago > 0 },
            {
              label: 'Entrenaron (30 días)',
              value: nf.format(d.trained.last_30),
              to: '/admin/reports',
              spark: d.trained.series,
              extra: <Delta now={d.trained.last_30} before={d.trained.previous_30} vs="vs. 30 días anteriores" was="30 días antes" />,
            },
            {
              label: 'Asistencias hoy',
              value: nf.format(d.attendance.today),
              to: '/admin/reports?tab=students',
              extra: <Delta now={d.attendance.today} before={d.attendance.last_week} vs="vs. hace 7 días" was="Hace 7 días" />,
            },
          ]
          return (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {cards.map((c) => (
                <Link
                  key={c.label}
                  to={c.to}
                  className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-4 outline-none transition-colors hover:bg-accent/40 active:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="text-[13px] font-medium text-muted-foreground">{c.label}</span>
                  <span className={cn('font-heading text-3xl leading-none font-bold tabular-nums lg:text-2xl xl:text-3xl', c.alert && 'text-destructive')}>{c.value}</span>
                  {c.extra}
                  {c.spark?.some((v) => v !== null) && <Spark values={c.spark} />}
                </Link>
              ))}
            </div>
          )
        }}
      </View>
    </section>
  )
}

// ── Filas ────────────────────────────────────────────────────────────────────

// Fila de lista de B22: enlace con feedback al pulsar; sin `to`, una fila informativa.
function Row({ to, children }: { to?: string; children: React.ReactNode }) {
  const cls = 'flex min-h-14 items-center gap-3 px-4 py-2.5'
  return (
    <li className="border-b last:border-b-0">
      {to ? (
        <Link to={to} className={cn(cls, 'outline-none hover:bg-accent/40 active:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset')}>
          {children}
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Link>
      ) : (
        <div className={cls}>{children}</div>
      )}
    </li>
  )
}

const Heading = ({ title, to, link }: { title: string; to?: string; link?: string }) => (
  <div className="flex min-h-6 items-center justify-between gap-3">
    <h2 className="font-semibold">{title}</h2>
    {to && (
      <Link to={to} className="-my-2.5 flex min-h-11 items-center gap-0.5 text-sm text-link outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {link}
        <ChevronRightIcon className="size-4" aria-hidden="true" />
      </Link>
    )}
  </div>
)

// ── Requiere atención ────────────────────────────────────────────────────────

const totalOf = (url: string) => api<{ total: number }>(url).then((r) => r.total)

function Attention({ home, className }: { home: UseQueryResult<AdminHome>; className?: string }) {
  const from = addDays(madridDay(), -30)
  const counts = useQuery({
    queryKey: ['admin', 'attention', from],
    refetchInterval: 120_000,
    queryFn: async () => {
      const [delinquents, grace, payerChanges, deliveries] = await Promise.all([
        totalOf('/admin/billing/delinquents?limit=1'),
        totalOf('/admin/billing/grace?limit=1'),
        totalOf(path('/admin/payer-changes', { status: 'expired', from, limit: '1' })),
        totalOf(path('/admin/notice-deliveries', { from, limit: '1' })),
      ])
      return { delinquents, grace, payerChanges, deliveries }
    },
  })
  const notices = useQuery({
    queryKey: ['admin', 'notices', 'home'],
    refetchInterval: 120_000,
    queryFn: () => api<{ rows: AcademyNotice[] }>('/admin/notices?limit=3').then((r) => r.rows),
  })
  const failed = [counts, notices].find((q) => q.isError && q.data === undefined)
  const loading = counts.data === undefined || notices.data === undefined || home.isPending
  const items = counts.data && [
    { n: counts.data.delinquents, label: 'Morosos', hint: 'con algún recibo impagado', to: '/admin/billing' },
    { n: counts.data.grace, label: 'En periodo de gracia', hint: 'Stripe sigue reintentando el cobro', to: '/admin/billing?tab=grace' },
    { n: counts.data.payerChanges, label: 'Cambios de pagador caducados', hint: 'en los últimos 30 días', to: '/admin/billing?tab=payer-changes' },
    { n: counts.data.deliveries, label: 'Entregas fallidas', hint: 'en los últimos 30 días', to: '/admin/notices?tab=deliveries' },
    { n: home.data?.students.inactivos ?? 0, label: 'Sin venir hace 14 días', hint: 'alumnos activos sin asistencia', to: '/admin/users?estado=inactivo' },
  ]
  const pending = items?.filter((i) => i.n > 0) ?? []
  return (
    <section aria-label="Requiere atención" className={cn('flex flex-col gap-3', className)}>
      <Heading title="Requiere atención" />
      {failed ? (
        <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />
      ) : loading ? (
        <ListSkeleton rows={2} className="h-14" />
      ) : pending.length === 0 && notices.data.length === 0 ? (
        <p className="flex items-center gap-2 rounded-2xl border bg-card px-4 py-3.5 text-[15px] font-medium">
          <CircleCheckIcon className="size-5 text-success" aria-hidden="true" />
          Nada pendiente
        </p>
      ) : (
        <ul className="overflow-hidden rounded-2xl border bg-card">
          {pending.map((i) => (
            <Row key={i.label} to={i.to}>
              <span className="grid h-7 min-w-7 place-items-center rounded-full bg-warning/16 px-2 text-sm font-bold tabular-nums">{nf.format(i.n)}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{i.label}</span>
                <span className="block text-[13px] text-muted-foreground">{i.hint}</span>
              </span>
            </Row>
          ))}
          {notices.data.map((n) => (
            <Row key={n.id} to="/admin/notices">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{noticeLabel(n.action)}</span>
                <span className="block text-[13px] text-muted-foreground">Aviso de la academia · {formatShortDate(n.created_at)}</span>
              </span>
            </Row>
          ))}
        </ul>
      )}
    </section>
  )
}

// ── Hoy ──────────────────────────────────────────────────────────────────────

const PHASE: Record<Phase, { label: string; variant: 'outline' | 'info' | 'secondary' | 'error' }> = {
  upcoming: { label: 'Programada', variant: 'outline' },
  now: { label: 'En curso', variant: 'info' },
  ended: { label: 'Celebrada', variant: 'secondary' },
  cancelled: { label: 'Cancelada', variant: 'error' },
}

function Today({ home, now, className }: { home: UseQueryResult<AdminHome>; now: number; className?: string }) {
  return (
    <section aria-label="Hoy" className={cn('flex flex-col gap-3', className)}>
      <Heading title="Hoy" to="/admin/sessions" link="Horario" />
      <View q={home} skeleton={<ListSkeleton rows={3} className="h-14" />}>
        {(d) =>
          d.sessions.length === 0 ? (
            <p className="rounded-2xl border bg-card px-4 py-3.5 text-[15px] text-muted-foreground">Hoy no hay sesiones.</p>
          ) : (
            <ul className="overflow-hidden rounded-2xl border bg-card">
              {d.sessions.map((s) => {
                const phase = PHASE[phaseOf(s, now)]
                const off = s.status === 'cancelled'
                const started = Date.parse(s.starts_at) <= now
                return (
                  <Row key={s.id} to={`/admin/sessions/${s.id}`}>
                    <span className="w-13 shrink-0 font-mono text-[15px] leading-tight tabular-nums">
                      <span className={cn('block font-semibold', off && 'text-muted-foreground line-through')}>{formatTime(s.starts_at)}</span>
                      <span className="block text-xs text-muted-foreground">{formatTime(s.ends_at)}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn('block leading-snug font-semibold break-words', off && 'text-muted-foreground line-through')}>{s.discipline.name}</span>
                      <span className="block truncate text-[13px] text-muted-foreground">{s.trainer?.display_name ?? 'Sin profesor'}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <Badge variant={phase.variant}>{phase.label}</Badge>
                      <span className={cn('text-[13px] text-muted-foreground tabular-nums', off && 'line-through')}>
                        {s.booked}/{s.capacity} reservas{started && !off ? ` · ${s.present} dentro` : ''}
                      </span>
                    </span>
                  </Row>
                )
              })}
            </ul>
          )
        }
      </View>
    </section>
  )
}

// ── Próximos eventos y lo de hoy en la academia: solo salen si hay algo ──────

function Events({ today, className }: { today: string; className?: string }) {
  const events = useQuery({
    queryKey: ['admin', 'events', 'home', today],
    refetchInterval: 120_000,
    queryFn: () => api<Paged<'events', AdminEvent>>(path('/admin/events', { from: today, to: addDays(today, 7), status: 'scheduled', limit: '5' })).then((r) => r.events),
  })
  if (events.data?.length === 0) return null
  return (
    <section aria-label="Próximos eventos" className={cn('flex flex-col gap-3', className)}>
      <Heading title="Próximos eventos" to="/admin/events" link="Eventos" />
      <View q={events} skeleton={<ListSkeleton rows={2} className="h-14" />}>
        {(rows) => (
          <ul className="overflow-hidden rounded-2xl border bg-card">
            {rows.map((e) => (
              <Row key={e.id} to={`/admin/events/${e.id}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{e.title}</span>
                  <span className="block text-[13px] text-muted-foreground first-letter:uppercase">
                    {dayFmt.format(new Date(e.starts_at))} · {formatTime(e.starts_at)}
                  </span>
                </span>
                <span className="text-[13px] text-muted-foreground tabular-nums">{e.capacity === null ? plural(e.taken, 'inscrito', 'inscritos') : `${e.taken}/${e.capacity}`}</span>
              </Row>
            ))}
          </ul>
        )}
      </View>
    </section>
  )
}

// Solo lo que el audit_log guarda de verdad: bajas y subidas de plan, y sesiones y eventos cancelados (las altas y los
// cobros fallidos no pasan por la auditoría: los fallidos son avisos, que la API de auditoría nunca devuelve).
const TODAY_ACTIONS = 'subscription.create,subscription.cancel,subscription.upgrade,session.cancel,event.cancel'

function Activity({ today, className }: { today: string; className?: string }) {
  const rows = useQuery({
    queryKey: ['admin', 'audit', 'home', today],
    refetchInterval: 120_000,
    queryFn: () => api<Paged<'rows', AuditRow>>(path('/admin/audit', { from: today, to: today, action: TODAY_ACTIONS, limit: '5' })).then((r) => r.rows),
  })
  if (rows.data?.length === 0) return null
  return (
    <section aria-label="Hoy en la academia" className={cn('flex flex-col gap-3', className)}>
      <Heading title="Hoy en la academia" />
      <View q={rows} skeleton={<ListSkeleton rows={2} className="h-14" />}>
        {(list) => (
          <ul className="overflow-hidden rounded-2xl border bg-card">
            {list.map((a) => (
              <Row key={a.id} to={auditTarget(a).to ?? undefined}>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{auditLabel(a.action)}</span>
                  <span className="block text-[13px] text-muted-foreground">{[a.actor.display_name ?? 'Sistema', auditDetail(a)].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="text-[13px] text-muted-foreground tabular-nums">{formatTime(a.created_at)}</span>
              </Row>
            ))}
          </ul>
        )}
      </View>
    </section>
  )
}

// docs/propuesta-inicio-admin.md: qué pasa ahora, qué pide atención y cómo va la academia; todo enlaza a su pantalla.
// En móvil el orden es el del DOM por `order-*`; en `lg` las dos columnas (8 + 4) se montan con `contents` → `flex`.
export function AdminHomePage() {
  const now = useNow()
  const today = madridDay(now)
  const home = useQuery({ queryKey: ['admin', 'home'], queryFn: () => api<AdminHome>('/admin/home'), refetchInterval: 30_000 })
  return (
    <Page title="Inicio" wide actions={<Live home={home} />}>
      <p className="-mt-3 text-sm text-muted-foreground first-letter:uppercase">{formatDate(new Date(now))}</p>
      <MfaNotice />
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <Search />
        <Shortcuts className="hidden lg:grid lg:w-96" />
      </div>
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-12 lg:items-start">
        <Figures home={home} className="order-2 lg:order-first lg:col-span-12" />
        <div className="contents lg:col-span-8 lg:flex lg:flex-col lg:gap-6">
          <Now home={home} now={now} className="order-1" />
          <Today home={home} now={now} className="order-4" />
        </div>
        <div className="contents lg:col-span-4 lg:flex lg:flex-col lg:gap-6">
          <Attention home={home} className="order-3" />
          <Events today={today} className="order-5" />
          <Activity today={today} className="order-6" />
        </div>
        <Shortcuts className="order-7 lg:hidden" />
      </div>
    </Page>
  )
}
