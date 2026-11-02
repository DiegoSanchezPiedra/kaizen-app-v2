import { useQuery } from '@tanstack/react-query'
import { CalendarIcon, ChevronRightIcon, CircleCheckIcon } from 'lucide-react'
import type React from 'react'
import { Link } from 'react-router'
import { Page } from '@/components/page'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/screen-state'
import { Badge } from '@/components/ui/badge'
import { useNow } from '@/hooks/use-now'
import { latestStat, noticeLabel, type AcademyNotice, type DayStat, type SubscriptionReport } from '@/lib/admin'
import { api } from '@/lib/api'
import { addDays, formatDay, madridDay } from '@/lib/dates'
import { formatEuros, formatShortDate, formatTime } from '@/lib/format'
import { phaseOf, type Phase } from '@/lib/professor'
import { path } from '@/lib/url'
import type { CalendarSession } from '@/lib/types'
import { MfaNotice } from '@/pages/admin/shell'

const nf = new Intl.NumberFormat('es-ES')

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

const FIGURES: { key: 'active' | 'past_due' | 'unpaid' | 'mrr_cents'; label: string; to: string }[] = [
  { key: 'active', label: 'Suscripciones activas', to: '/admin/reports' },
  { key: 'past_due', label: 'En periodo de gracia', to: '/admin/billing?tab=grace' },
  { key: 'unpaid', label: 'Impagadas', to: '/admin/billing' },
  { key: 'mrr_cents', label: 'MRR', to: '/admin/reports' },
]

function Figures() {
  const stats = useQuery({
    queryKey: ['admin', 'stats-day', 'home'],
    queryFn: () => api<SubscriptionReport<DayStat>>('/admin/reports/subscriptions?group=day'),
  })
  if (stats.isPending) return <ListSkeleton rows={1} className="h-28" />
  if (stats.isError) return <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
  const last = latestStat(stats.data.rows)
  if (!last) return <EmptyState icon={<CalendarIcon />} title="Aún no hay fotos de la academia" text="Las cifras salen de la foto de cada noche; la primera llega mañana." />
  return (
    <section aria-label="Cifras" className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        {last.stale ? (
          <>
            <span className="font-semibold text-foreground">Sin dato de ayer.</span> Última foto: {formatDay(last.row.date)}.
          </>
        ) : (
          `Foto de ayer, ${formatDay(last.row.date)}.`
        )}
      </p>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {FIGURES.map((f) => {
          const v = last.row[f.key] ?? 0
          return (
            <Link
              key={f.key}
              to={f.to}
              className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-4 outline-none transition-colors hover:bg-accent/40 active:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="text-[13px] font-medium text-muted-foreground">{f.label}</span>
              <span className="font-heading text-3xl leading-none font-bold tabular-nums">{f.key === 'mrr_cents' ? formatEuros(v) : nf.format(v)}</span>
              <Spark values={stats.data.rows.map((r) => r[f.key])} />
            </Link>
          )
        })}
      </div>
    </section>
  )
}

const totalOf = (url: string) => api<{ total: number }>(url).then((r) => r.total)

function Attention() {
  const from = addDays(madridDay(), -30)
  const counts = useQuery({
    queryKey: ['admin', 'attention', from],
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
    queryFn: () => api<{ rows: AcademyNotice[] }>('/admin/notices?limit=3').then((r) => r.rows),
  })
  const items = counts.data && [
    { n: counts.data.delinquents, label: 'Morosos', hint: 'con algún recibo impagado', to: '/admin/billing' },
    { n: counts.data.grace, label: 'En periodo de gracia', hint: 'Stripe sigue reintentando el cobro', to: '/admin/billing?tab=grace' },
    { n: counts.data.payerChanges, label: 'Cambios de pagador caducados', hint: 'en los últimos 30 días', to: '/admin/billing?tab=payer-changes' },
    { n: counts.data.deliveries, label: 'Entregas fallidas', hint: 'en los últimos 30 días', to: '/admin/notices?tab=deliveries' },
  ]
  const pending = items?.filter((i) => i.n > 0) ?? []
  return (
    <section aria-label="Requiere atención" className="flex flex-col gap-3">
      <h2 className="font-semibold">Requiere atención</h2>
      {counts.isPending || notices.isPending ? (
        <ListSkeleton rows={2} className="h-14" />
      ) : counts.isError ? (
        <ErrorState error={counts.error} onRetry={() => void counts.refetch()} />
      ) : notices.isError ? (
        <ErrorState error={notices.error} onRetry={() => void notices.refetch()} />
      ) : pending.length === 0 && notices.data.length === 0 ? (
        <p className="flex items-center gap-2 rounded-xl border bg-card px-4 py-3.5 text-[15px] font-medium">
          <CircleCheckIcon className="size-5 text-success" aria-hidden="true" />
          Nada pendiente
        </p>
      ) : (
        <ul className="overflow-hidden rounded-xl border bg-card">
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

function Row({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <li className="border-b last:border-b-0">
      <Link to={to} className="flex min-h-14 items-center gap-3 px-4 py-2.5 outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
        {children}
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    </li>
  )
}

const PHASE: Record<Phase, { label: string; variant: 'outline' | 'info' | 'secondary' | 'error' }> = {
  upcoming: { label: 'Programada', variant: 'outline' },
  now: { label: 'En curso', variant: 'info' },
  ended: { label: 'Celebrada', variant: 'secondary' },
  cancelled: { label: 'Cancelada', variant: 'error' },
}

function Today() {
  const today = madridDay()
  const sessions = useQuery({
    queryKey: ['calendar', 'admin', today],
    queryFn: () => api<{ sessions: CalendarSession[] }>(path('/sessions/calendar', { from: today, to: today })).then((r) => r.sessions),
  })
  const now = useNow()
  return (
    <section aria-label="Hoy" className="flex flex-col gap-3">
      <h2 className="font-semibold">Hoy</h2>
      {sessions.isPending ? (
        <ListSkeleton rows={3} className="h-14" />
      ) : sessions.isError ? (
        <ErrorState error={sessions.error} onRetry={() => void sessions.refetch()} />
      ) : sessions.data.length === 0 ? (
        <p className="rounded-xl border bg-card px-4 py-3.5 text-[15px] text-muted-foreground">Hoy no hay sesiones.</p>
      ) : (
        <ul className="overflow-hidden rounded-xl border bg-card">
          {sessions.data.map((s) => {
            const phase = PHASE[phaseOf(s, now)]
            return (
              <Row key={s.id} to={`/admin/sessions/${s.id}`}>
                <span className="w-24 shrink-0 font-semibold tabular-nums">
                  {formatTime(s.starts_at)}–{formatTime(s.ends_at)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{s.discipline.name}</span>
                  <span className="block truncate text-[13px] text-muted-foreground">{s.trainer?.display_name ?? 'Sin profesor'}</span>
                </span>
                <Badge variant={phase.variant}>{phase.label}</Badge>
              </Row>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// docs/pantallas-b19.md § Inicio: un vistazo y lo que pide atención; todo enlaza a su pantalla.
export function AdminHomePage() {
  return (
    <Page title="Inicio" wide>
      <MfaNotice />
      <Figures />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Attention />
        <Today />
      </div>
    </Page>
  )
}
