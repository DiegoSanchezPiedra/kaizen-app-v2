import { useQuery } from '@tanstack/react-query'
import { BellOffIcon, MailCheckIcon } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { Page } from '@/components/page'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/screen-state'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { CHANNEL_LABEL, deliveryLabel, noticeEvent, noticeLabel, noticeStudent, pageHref, pageOf, type AcademyNotice, type Delivery, type Paged } from '@/lib/admin'
import { api } from '@/lib/api'
import { formatDeadline } from '@/lib/format'
import { path } from '@/lib/url'
import { PAGE_SIZE, Pager } from '@/pages/admin/shell'

const TABS = [
  { value: 'academy', label: 'De la academia' },
  { value: 'failed', label: 'Entregas fallidas' },
]

const range = (page: number) => ({ limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) })

// docs/pantallas-b19.md § Avisos. Un registro: sin «leído».
export function AdminNoticesPage() {
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((t) => t.value === params.get('tab')) ? params.get('tab')! : 'academy'
  return (
    <Page title="Avisos" wide>
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: String(v) }, { replace: true })} className="gap-5">
        <TabsList className="w-full sm:w-auto">
          {TABS.map((t) => (
            <TabsTab key={t.value} value={t.value} className="min-h-11 flex-1 px-4">
              {t.label}
            </TabsTab>
          ))}
        </TabsList>
        <TabsPanel value="academy">
          <Academy />
        </TabsPanel>
        <TabsPanel value="failed">
          <Failed />
        </TabsPanel>
      </Tabs>
    </Page>
  )
}

function Academy() {
  const [params] = useSearchParams()
  const page = pageOf(params)
  const list = useQuery({ queryKey: ['admin', 'notices', page], queryFn: () => api<Paged<'rows', AcademyNotice>>(path('/admin/notices', range(page))) })
  if (list.isPending) return <ListSkeleton rows={4} className="h-14" />
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />
  if (list.data.total === 0) return <EmptyState icon={<BellOffIcon />} title="La academia no tiene avisos" />
  return (
    <div className="flex flex-col gap-4">
      <ul className="divide-y rounded-2xl border bg-card">
        {list.data.rows.map((n) => {
          const student = noticeStudent(n)
          const event = noticeEvent(n)
          return (
            <li key={n.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
              <time dateTime={n.created_at} className="w-36 shrink-0 text-sm text-muted-foreground tabular-nums">
                {formatDeadline(n.created_at)}
              </time>
              <span className="min-w-0 flex-1">{noticeLabel(n.action)}</span>
              {event && (
                <Link to={`/admin/events/${event}`} className="text-sm font-medium text-link underline-offset-3 hover:underline">
                  Ver el evento
                </Link>
              )}
              {student && (
                <Link to={`/admin/users/${student}`} className="text-sm font-medium text-link underline-offset-3 hover:underline">
                  Ver la ficha
                </Link>
              )}
            </li>
          )
        })}
      </ul>
      <Pager total={list.data.total} page={page} href={(n) => pageHref(params, n)} />
    </div>
  )
}

function Failed() {
  const [params] = useSearchParams()
  const page = pageOf(params)
  const list = useQuery({ queryKey: ['admin', 'notice-deliveries', page], queryFn: () => api<Paged<'rows', Delivery>>(path('/admin/notice-deliveries', range(page))) })
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        No se reintentan: un aviso caduca a las 24 h; si importa, avisa a la persona por otro medio.
      </p>
      {list.isPending ? (
        <ListSkeleton rows={4} className="h-10" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.total === 0 ? (
        <EmptyState icon={<MailCheckIcon />} title="Todo se ha entregado" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border bg-card">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  {['Fecha', 'Aviso', 'Canal', 'Destinatario', 'Intentos', 'Último error'].map((h, i) => (
                    <TableHead key={h} className={i ? undefined : 'ps-4'}>
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.rows.map((d) => (
                  <TableRow key={d.id} className="h-10">
                    <TableCell className="ps-4 tabular-nums">{formatDeadline(d.created_at)}</TableCell>
                    <TableCell>{deliveryLabel(d.action)}</TableCell>
                    <TableCell>{CHANNEL_LABEL[d.channel] ?? d.channel}</TableCell>
                    <TableCell>
                      <Link to={`/admin/users/${d.recipient.id}`} className="font-medium text-link underline-offset-3 hover:underline">
                        {d.recipient.display_name ?? 'Sin nombre'}
                      </Link>
                    </TableCell>
                    <TableCell className="tabular-nums">{d.attempts}</TableCell>
                    <TableCell className="max-w-64 text-xs text-muted-foreground">{d.last_error ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager total={list.data.total} page={page} href={(n) => pageHref(params, n)} />
        </>
      )}
    </div>
  )
}
