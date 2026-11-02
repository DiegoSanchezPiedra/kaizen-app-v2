import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLinkIcon, HandCoinsIcon, RepeatIcon } from 'lucide-react'
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
  type OverdueItem,
  type Paged,
  type PayerChange,
} from '@/lib/admin'
import { api } from '@/lib/api'
import { formatDeadline, formatEuros, formatShortDate } from '@/lib/format'
import { path } from '@/lib/url'
import { PAGE_SIZE, Pager } from '@/pages/admin/shell'
import { cancelInsurance, del, post, SubBadge, useConfirm } from '@/pages/admin/user-billing'

const name = (p: { display_name: string | null }) => p.display_name ?? 'Sin nombre'
const TABS = [
  { value: 'delinquents', label: 'Morosos' },
  { value: 'grace', label: 'En gracia' },
  { value: 'payer-changes', label: 'Cambios de pagador' },
]

// docs/pantallas-b19.md § Cobros. Pestaña y página en la URL.
export function AdminBillingPage() {
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((t) => t.value === params.get('tab')) ? params.get('tab')! : 'delinquents'
  return (
    <Page title="Cobros" wide>
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: String(v) }, { replace: true })} className="gap-5">
        <TabsList className="w-full sm:w-auto">
          {TABS.map((t) => (
            <TabsTab key={t.value} value={t.value} className="min-h-11 flex-1 px-4">
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

function Overdue({ kind }: { kind: 'delinquents' | 'grace' }) {
  const [params] = useSearchParams()
  const page = pageOf(params)
  const qc = useQueryClient()
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin', 'billing'] })
  const { ask, dialog } = useConfirm(refresh)
  const list = useQuery({
    queryKey: ['admin', 'billing', kind, page],
    queryFn: () => api<Paged<'payers', OverduePayer>>(path(`/admin/billing/${kind}`, { limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) })),
  })

  if (list.isPending) return <ListSkeleton rows={3} className="h-40" />
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />
  if (list.data.total === 0)
    return <EmptyState icon={<HandCoinsIcon />} title={kind === 'grace' ? 'Nadie está en gracia' : 'Nadie debe nada'} />

  // Baja inmediata (la misma confirmación que la ficha). Solo en morosos: en gracia aún no es moroso.
  const cancel = (it: OverdueItem) =>
    ask(
      it.kind === 'insurance'
        ? {
            title: 'Baja inmediata del seguro',
            description: `Termina ya y anula sus recibos pendientes. Sin reembolso; se avisa a quien lo paga. Si no ha firmado la exención, no podrá reservar hasta firmarla o contratar otro seguro.`,
            label: 'Dar de baja ya',
            done: 'Seguro dado de baja',
            destructive: true,
            run: () => cancelInsurance(it.id, true),
          }
        : {
            title: 'Baja inmediata',
            description: `Termina ya: anula los recibos pendientes y cancela sus reservas futuras. Se avisa al pagador.`,
            label: 'Dar de baja ya',
            done: 'Cuota dada de baja',
            destructive: true,
            run: post(`/admin/subscriptions/${it.id}/cancel-now`),
          },
    )

  return (
    <>
      <div className="flex flex-col gap-4">
        {list.data.payers.map((p) => (
          <section key={p.payer_id} aria-label={name(p)} className="rounded-2xl border bg-card p-4">
            <h2 className="font-heading text-lg font-bold">
              <Link to={`/admin/users/${p.payer_id}`} className="text-link underline-offset-3 hover:underline">
                {name(p)}
              </Link>
            </h2>
            <ul className="mt-3 divide-y">
              {p.items.map((it) => (
                <li key={`${it.kind}-${it.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <Link to={`/admin/users/${it.student_id}`} className="font-medium text-link underline-offset-3 hover:underline">
                        {it.student_name ?? 'Sin nombre'}
                      </Link>
                      <span className="text-muted-foreground">{it.kind === 'insurance' ? `Seguro · ${it.label}` : it.label}</span>
                      <SubBadge status={it.status} />
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {kind === 'grace' && it.current_period_end
                        ? `Stripe sigue reintentando el cobro hasta el ${formatShortDate(it.current_period_end)}.`
                        : it.current_period_end
                          ? `Fin de periodo: ${formatShortDate(it.current_period_end)}`
                          : null}
                    </p>
                  </div>
                  {kind === 'delinquents' && (
                    <Button variant="destructive-outline" onClick={() => cancel(it)}>
                      Baja inmediata
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {p.invoices.length > 0 && (
              <>
                <h3 className="mt-3 text-sm font-medium text-muted-foreground">Recibos pendientes</h3>
                <ul className="mt-1 divide-y">
                  {p.invoices.map((v) => {
                    const item = p.items.find((i) => i.id === v.item_id)
                    const url = safeInvoiceUrl(v.hosted_invoice_url)
                    return (
                      <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p>
                            <span className="font-medium tabular-nums">{formatEuros(v.amount_due_cents)}</span>
                            {item && <span className="text-muted-foreground"> · {item.student_name ?? 'Sin nombre'}</span>}
                            <span className="text-muted-foreground tabular-nums">
                              {' '}
                              · {v.attempt_count} {v.attempt_count === 1 ? 'intento' : 'intentos'}
                              {v.next_payment_attempt && ` · siguiente ${formatDeadline(v.next_payment_attempt)}`}
                            </span>
                          </p>
                          {v.last_payment_error && <p className="text-xs text-muted-foreground">{v.last_payment_error}</p>}
                        </div>
                        {url && (
                          <Button variant="outline" size="sm" render={<a href={url} target="_blank" rel="noreferrer" />}>
                            Abrir el recibo
                            <ExternalLinkIcon />
                          </Button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </section>
        ))}
      </div>
      <Pager total={list.data.total} page={page} href={(n) => pageHref(params, n)} />
      {dialog}
    </>
  )
}

// ── Cambios de pagador ───────────────────────────────────────────────────

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
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2" role="group" aria-label="Vista">
        {(['live', 'expired'] as const).map((v) => (
          <Button
            key={v}
            size="sm"
            variant={view === v ? 'default' : 'outline'}
            aria-pressed={view === v}
            onClick={() => setParams({ tab: 'payer-changes', view: v }, { replace: true })}
          >
            {v === 'live' ? 'En curso' : 'Caducados'}
          </Button>
        ))}
      </div>
      {list.isPending ? (
        <ListSkeleton rows={4} className="h-10" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.total === 0 ? (
        <EmptyState icon={<RepeatIcon />} title={view === 'live' ? 'No hay cambios en curso' : 'Ninguno ha caducado'} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border bg-card">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  {['Alumno', 'Pagador', 'Plan', 'Desde', 'Fecha límite', 'Estado', ''].map((h, i) => (
                    <TableHead key={h || 'actions'} className={i ? undefined : 'ps-4'}>
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.rows.map((c) => (
                  <TableRow key={c.id} className="h-10">
                    <TableCell className="ps-4">
                      <Link to={`/admin/users/${c.student.id}`} className="font-medium text-link underline-offset-3 hover:underline">
                        {name(c.student)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {name(c.old_payer)} → {name(c.new_payer)}
                    </TableCell>
                    <TableCell>{c.plan.name}</TableCell>
                    <TableCell className="tabular-nums">{formatShortDate(c.starts_at)}</TableCell>
                    <TableCell className="tabular-nums">{formatDeadline(c.deadline)}</TableCell>
                    <TableCell>
                      {c.status === 'expired' ? <Tag variant="warning">Caducado</Tag> : <Tag variant={c.status === 'paid' ? 'success' : 'info'}>{c.status === 'paid' ? 'Pagado' : 'Pendiente de pago'}</Tag>}
                    </TableCell>
                    <TableCell className="text-end">
                      {canCancelPayerChange(c) && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            ask({
                              title: 'Anular el cambio de pagador',
                              description: `${name(c.new_payer)} deja de poder pagarlo y ${name(c.old_payer)} sigue pagando la cuota de ${name(c.student)}. Se avisa a los dos.`,
                              label: 'Anular el cambio',
                              done: 'Cambio de pagador anulado',
                              destructive: true,
                              run: del(`/admin/subscriptions/${c.subscription_id}/payer-change`),
                            })
                          }
                        >
                          Anular
                        </Button>
                      )}
                      {c.status === 'expired' && (
                        <span className="flex flex-col items-end gap-1 text-sm text-muted-foreground">
                          No pagó a tiempo; sigue pagando {name(c.old_payer)}
                          <Button size="sm" variant="outline" render={<Link to={`/admin/users/${c.student.id}?tab=billing`} />}>
                            Volver a pedirlo
                          </Button>
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager total={list.data.total} page={page} href={(n) => pageHref(params, n)} />
        </>
      )}
      {dialog}
    </div>
  )
}
