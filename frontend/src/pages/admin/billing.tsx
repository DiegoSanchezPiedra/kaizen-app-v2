import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarXIcon, CircleCheckIcon, ClockIcon, ExternalLinkIcon, HandCoinsIcon, RepeatIcon } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { Tag } from '@/components/billing-bits'
import { Page } from '@/components/page'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/screen-state'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import {
  canCancelPayerChange,
  PAYER_VIEWS,
  pageHref,
  pageOf,
  safeInvoiceUrl,
  type OverduePayer,
  type OverdueInvoice,
  type OverdueItem,
  type Paged,
  type PayerChange,
} from '@/lib/admin'
import { api } from '@/lib/api'
import { formatDeadline, formatEuros, formatShortDate } from '@/lib/format'
import { path } from '@/lib/url'
import { cn } from '@/lib/utils'
import { PAGE_SIZE, Pager } from '@/pages/admin/shell'
import { del, post, SubBadge, useConfirm } from '@/pages/admin/user-billing'

const name = (p: { display_name: string | null }) => p.display_name ?? 'Sin nombre'
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const TABS = [
  { value: 'delinquents', label: 'Morosos' },
  { value: 'grace', label: 'En gracia' },
  { value: 'payer-changes', label: 'Cambios de pagador' },
]
const LINK = 'text-link underline-offset-3 hover:underline'
// La lista anterior se queda atenuada mientras llega la página nueva (como en Usuarios).
const DIM = 'flex flex-col gap-4 transition-opacity duration-150 ease-out'

// docs/pantallas-b19.md § Cobros y b22.md § Cobros. Pestaña, vista y página en la URL.
export function AdminBillingPage() {
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((t) => t.value === params.get('tab')) ? params.get('tab')! : 'delinquents'
  return (
    <Page title="Cobros" wide>
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: String(v) }, { replace: true })} className="gap-5">
        <TabsList className="w-full sm:w-auto">
          {TABS.map((t) => (
            <TabsTab key={t.value} value={t.value} className="min-h-11 px-3 leading-tight last-of-type:shrink last-of-type:whitespace-normal sm:flex-1 sm:px-4">
              {t.label}
            </TabsTab>
          ))}
        </TabsList>
        <TabsPanel value="delinquents">
          <Overdue kind="delinquents" />
        </TabsPanel>
        <TabsPanel value="grace">
          <Overdue kind="grace" />
        </TabsPanel>
        <TabsPanel value="payer-changes">
          <PayerChanges />
        </TabsPanel>
      </Tabs>
    </Page>
  )
}

// ── Morosos y en gracia ──────────────────────────────────────────────────

type Kind = 'delinquents' | 'grace'

function Overdue({ kind }: { kind: Kind }) {
  const [params] = useSearchParams()
  const page = pageOf(params)
  const qc = useQueryClient()
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin', 'billing'] })
  const { ask, dialog } = useConfirm(refresh)
  const list = useQuery({
    queryKey: ['admin', 'billing', kind, page],
    queryFn: () => api<Paged<'payers', OverduePayer>>(path(`/admin/billing/${kind}`, { limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) })),
    placeholderData: keepPreviousData,
  })

  if (list.isPending) return <ListSkeleton rows={3} className="h-56 sm:h-44" />
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />
  if (list.data.total === 0)
    return <EmptyState icon={<HandCoinsIcon />} title={kind === 'grace' ? 'Nadie está en gracia' : 'Nadie debe nada'} />

  // Baja inmediata (la misma confirmación que la ficha), con a quién afecta y a quién se avisa. Solo en morosos.
  const cancel = (it: OverdueItem, p: OverduePayer) =>
    ask({
      title: 'Baja inmediata',
      description: `Termina ya la cuota de ${it.student_name ?? 'Sin nombre'} (${it.label}): anula sus recibos pendientes y cancela sus reservas futuras. Se avisa a ${name(p)}.`,
      label: 'Dar de baja ya',
      done: 'Cuota dada de baja',
      destructive: true,
      run: post(`/admin/subscriptions/${it.id}/cancel-now`),
    })

  const n = list.data.total
  return (
    <div className={cn(DIM, list.isPlaceholderData && 'opacity-60')} aria-busy={list.isPlaceholderData}>
      <p className="text-sm text-muted-foreground tabular-nums">
        {kind === 'grace' ? plural(n, 'pagador en gracia', 'pagadores en gracia') : plural(n, 'pagador debe', 'pagadores deben')}
      </p>
      {list.data.payers.map((p) => (
        <PayerBlock key={p.payer_id} p={p} kind={kind} onCancel={(it) => cancel(it, p)} />
      ))}
      <Pager total={n} page={page} href={(k) => pageHref(params, k)} />
      {dialog}
    </div>
  )
}

// Un pagador: cuánto debe arriba a la derecha; cada cuota con sus recibos debajo.
function PayerBlock({ p, kind, onCancel }: { p: OverduePayer; kind: Kind; onCancel: (it: OverdueItem) => void }) {
  const due = p.invoices.reduce((s, v) => s + v.amount_due_cents, 0)
  const orphans = p.invoices.filter((v) => !p.items.some((it) => it.id === v.item_id))
  const id = `payer-${p.payer_id}`
  return (
    <section aria-labelledby={id} className="rounded-2xl border bg-card">
      <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <h2 id={id} className="min-w-0 font-heading text-lg leading-snug font-bold break-words">
          <Link to={`/admin/users/${p.payer_id}`} className={cn('inline-block', LINK)}>
            {name(p)}
          </Link>
        </h2>
        {p.invoices.length > 0 ? (
          <p className="flex shrink-0 flex-col items-end">
            <span className="font-heading text-xl leading-tight font-bold tabular-nums">{formatEuros(due)}</span>
            <span className="text-sm text-muted-foreground tabular-nums">{plural(p.invoices.length, 'recibo', 'recibos')}</span>
          </p>
        ) : (
          <p className="shrink-0 pt-0.5 text-sm text-muted-foreground">Sin recibos abiertos</p>
        )}
      </header>
      <ul className="divide-y">
        {p.items.map((it) => (
          <li key={`${it.kind}-${it.id}`} className="flex flex-col gap-2.5 px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Link to={`/admin/users/${it.student_id}`} className={cn('font-semibold', LINK)}>
                    {it.student_name ?? 'Sin nombre'}
                  </Link>
                  <SubBadge status={it.status} />
                </p>
                <p className="text-sm text-muted-foreground">
                  {it.label}
                  {it.current_period_end &&
                    (kind === 'grace'
                      ? ` · Stripe sigue reintentando el cobro hasta el ${formatShortDate(it.current_period_end)}`
                      : ` · fin de periodo ${formatShortDate(it.current_period_end)}`)}
                </p>
              </div>
              {kind === 'delinquents' && (
                <Button size="sm" variant="destructive-outline" onClick={() => onCancel(it)}>
                  Baja inmediata
                </Button>
              )}
            </div>
            <Invoices list={p.invoices.filter((v) => v.item_id === it.id)} />
          </li>
        ))}
        {orphans.length > 0 && (
          <li className="flex flex-col gap-2.5 px-4 py-3">
            <p className="text-sm font-medium text-muted-foreground">Otros recibos</p>
            <Invoices list={orphans} />
          </li>
        )}
      </ul>
    </section>
  )
}

function Invoices({ list }: { list: OverdueInvoice[] }) {
  if (!list.length) return null
  return (
    <ul className="flex flex-col gap-2.5 border-s-2 ps-3" aria-label="Recibos pendientes">
      {list.map((v) => {
        const url = safeInvoiceUrl(v.hosted_invoice_url)
        return (
          <li key={v.id} className="flex flex-col items-start gap-x-3 gap-y-1.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              <p className="font-semibold tabular-nums">{formatEuros(v.amount_due_cents)}</p>
              <p className="text-sm text-muted-foreground tabular-nums">
                {plural(v.attempt_count, 'intento', 'intentos')}
                {v.next_payment_attempt && ` · siguiente ${formatDeadline(v.next_payment_attempt)}`}
              </p>
              {v.last_payment_error && <p className="text-sm break-words text-muted-foreground">Último error: {v.last_payment_error}</p>}
            </div>
            {url && (
              <Button variant="outline" size="sm" render={<a href={url} target="_blank" rel="noreferrer" />}>
                Abrir el recibo
                <span className="sr-only">(se abre en otra pestaña)</span>
                <ExternalLinkIcon aria-hidden="true" />
              </Button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

// ── Cambios de pagador ───────────────────────────────────────────────────

const VIEWS = [
  ['live', 'En curso'],
  ['expired', 'Caducados'],
] as const
// Los chips de Usuarios (EstadoChips): una vista activa a la vez.
const CHIP =
  'inline-flex min-h-11 items-center gap-2 rounded-full border bg-card px-4 text-sm font-medium whitespace-nowrap outline-none transition-[background-color,border-color,scale] duration-150 ease-out hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background motion-safe:active:scale-[0.97] sm:min-h-9'

// Estado con icono y texto (DESIGN.md: nunca solo color).
const CHANGE_TAG = {
  requested: ['Pendiente de pago', 'info', ClockIcon],
  paid: ['Pagado', 'success', CircleCheckIcon],
  expired: ['Caducado', 'warning', CalendarXIcon],
} as const
function ChangeStatus({ status }: { status: string }) {
  const [label, variant, Icon] = CHANGE_TAG[status as keyof typeof CHANGE_TAG] ?? CHANGE_TAG.requested
  return (
    <Tag variant={variant}>
      <Icon aria-hidden="true" />
      {label}
    </Tag>
  )
}

function Payers({ c }: { c: PayerChange }) {
  return (
    <>
      {name(c.old_payer)} <span aria-hidden="true">→</span>
      <span className="sr-only">pasa a</span> {name(c.new_payer)}
    </>
  )
}

function PayerChanges() {
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'expired' ? 'expired' : 'live'
  const page = pageOf(params)
  const qc = useQueryClient()
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin', 'payer-changes'] })
  const { ask, dialog } = useConfirm(refresh)
  const list = useQuery({
    queryKey: ['admin', 'payer-changes', view, page],
    queryFn: () =>
      api<Paged<'rows', PayerChange>>(path('/admin/payer-changes', { status: PAYER_VIEWS[view], limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) })),
    placeholderData: keepPreviousData,
  })

  const annul = (c: PayerChange) =>
    ask({
      title: 'Anular el cambio de pagador',
      description: `${name(c.new_payer)} deja de poder pagarlo y ${name(c.old_payer)} sigue pagando la cuota de ${name(c.student)}. Se avisa a los dos.`,
      label: 'Anular el cambio',
      done: 'Cambio de pagador anulado',
      destructive: true,
      run: del(`/admin/subscriptions/${c.subscription_id}/payer-change`),
    })
  const action = (c: PayerChange) =>
    canCancelPayerChange(c) ? (
      <Button size="sm" variant="outline" onClick={() => annul(c)}>
        Anular
      </Button>
    ) : c.status === 'expired' ? (
      <Button size="sm" variant="outline" render={<Link to={`/admin/users/${c.student.id}?tab=billing`} />}>
        Volver a pedirlo
      </Button>
    ) : null
  const note = (c: PayerChange) => c.status === 'expired' && `No pagó a tiempo; sigue pagando ${name(c.old_payer)}.`

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2" role="group" aria-label="Vista">
        {VIEWS.map(([v, label]) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setParams({ tab: 'payer-changes', view: v }, { replace: true })}
            className={cn(CHIP, view === v && 'border-primary bg-primary/12 hover:bg-primary/12')}
          >
            {label}
          </button>
        ))}
      </div>
      {list.isPending ? (
        <ListSkeleton rows={3} className="h-32 xl:h-11" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.total === 0 ? (
        <EmptyState icon={<RepeatIcon />} title={view === 'live' ? 'No hay cambios en curso' : 'Ninguno ha caducado'} />
      ) : (
        <div className={cn(DIM, list.isPlaceholderData && 'opacity-60')} aria-busy={list.isPlaceholderData}>
          {/* Hasta xl, una fila por cambio (con la barra lateral la tabla no cabe antes). */}
          <ul className="flex flex-col divide-y rounded-2xl border bg-card xl:hidden">
            {list.data.rows.map((c) => (
              <li key={c.id} className="flex flex-col gap-1 px-4 py-3">
                <p className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <Link to={`/admin/users/${c.student.id}`} className={cn('font-semibold', LINK)}>
                    {name(c.student)}
                  </Link>
                  <ChangeStatus status={c.status} />
                </p>
                <p className="text-sm">
                  <span className="sr-only">Pagador: </span>
                  <Payers c={c} />
                </p>
                <p className="text-sm text-muted-foreground tabular-nums">
                  {c.plan.name} · desde {formatShortDate(c.starts_at)} · límite {formatDeadline(c.deadline)}
                </p>
                {note(c) && <p className="text-sm text-muted-foreground">{note(c)}</p>}
                {action(c) && <div className="mt-1.5">{action(c)}</div>}
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto rounded-2xl border bg-card xl:block">
            <Table>
              <TableHeader>
                <TableRow>
                  {['Alumno', 'Pagador', 'Plan', 'Desde', 'Fecha límite', 'Estado'].map((h, i) => (
                    <TableHead key={h} className={i ? undefined : 'ps-4'}>
                      {h}
                    </TableHead>
                  ))}
                  <TableHead className="pe-4">
                    <span className="sr-only">Acción</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.rows.map((c) => (
                  <TableRow key={c.id} className="h-12">
                    <TableCell className="ps-4">
                      <Link to={`/admin/users/${c.student.id}`} className={cn('font-medium', LINK)}>
                        {name(c.student)}
                      </Link>
                    </TableCell>
                    <TableCell className="leading-snug whitespace-normal">
                      <Payers c={c} />
                    </TableCell>
                    <TableCell className="leading-snug whitespace-normal">{c.plan.name}</TableCell>
                    <TableCell className="tabular-nums">{formatShortDate(c.starts_at)}</TableCell>
                    <TableCell className="tabular-nums">{formatDeadline(c.deadline)}</TableCell>
                    <TableCell>
                      <span className="flex flex-col items-start gap-1">
                        <ChangeStatus status={c.status} />
                        {note(c) && <span className="max-w-56 text-sm leading-snug whitespace-normal text-muted-foreground">{note(c)}</span>}
                      </span>
                    </TableCell>
                    <TableCell className="pe-4 text-end">{action(c)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager total={list.data.total} page={page} href={(n) => pageHref(params, n)} />
        </div>
      )}
      {dialog}
    </div>
  )
}
