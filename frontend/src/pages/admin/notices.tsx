import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { BellIcon, BellOffIcon, InfoIcon, MailCheckIcon, MailIcon, SmartphoneIcon, TriangleAlertIcon } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { Tag } from '@/components/billing-bits'
import { Page } from '@/components/page'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/screen-state'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { CHANNEL_LABEL, deliveryError, deliveryLabel, noticeClock, noticeEvent, noticeLabel, noticeStudent, noticeUrgent, pageHref, pageOf, type AcademyNotice, type Delivery, type Paged } from '@/lib/admin'
import { api } from '@/lib/api'
import { addDays, madridDay } from '@/lib/dates'
import { formatLogDate } from '@/lib/format'
import { path } from '@/lib/url'
import { cn } from '@/lib/utils'
import { Communiques } from '@/pages/admin/communiques'
import { PAGE_SIZE, Pager } from '@/pages/admin/shell'

// `deliveries` es lo que enlaza el Inicio («Requiere atención»).
const TABS = [
  { value: 'academy', label: 'De la academia' },
  { value: 'deliveries', label: 'Entregas fallidas' },
  { value: 'communiques', label: 'Comunicados' },
]

// Al cambiar de página se queda la lista anterior atenuada, como en Cobros.
const DIM = 'flex flex-col gap-4 transition-opacity duration-150 ease-out'
const range = (page: number) => ({ limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) })
// Enlace suelto en una fila: 20 px de texto, 44 px de objetivo con el ::after.
const rowLink = 'relative font-medium text-link underline-offset-3 transition-colors duration-150 ease-out after:absolute after:-inset-x-1 after:-inset-y-4 hover:underline'

// docs/pantallas-b19.md § Avisos y docs/pantallas-b22.md § Avisos. Un registro: sin «leído».
export function AdminNoticesPage() {
  const [params, setParams] = useSearchParams()
  // `failed` era el nombre antiguo de la pestaña: los enlaces guardados siguen abriendo las fallidas.
  const asked = params.get('tab') === 'failed' ? 'deliveries' : params.get('tab')
  const tab = TABS.some((t) => t.value === asked) ? asked! : 'academy'
  // La misma cifra que el Inicio: entregas fallidas de los últimos 30 días.
  const from = addDays(madridDay(), -30)
  const recent = useQuery({
    queryKey: ['admin', 'notice-deliveries', 'recent', from],
    queryFn: () => api<Paged<'rows', Delivery>>(path('/admin/notice-deliveries', { from, limit: '1' })).then((r) => r.total),
  })
  return (
    <Page title="Avisos" wide>
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: String(v) }, { replace: true })} className="gap-5">
        <TabsList className="w-full sm:w-auto">
          {TABS.map((t) => (
            <TabsTab key={t.value} value={t.value} className="min-h-11 flex-1 gap-1.5 px-3 sm:gap-2 sm:px-4">
              {t.label}
              {t.value === 'deliveries' && !!recent.data && (
                <Badge variant="error" className="tabular-nums">
                  <span aria-hidden="true">{recent.data}</span>
                  <span className="sr-only">{recent.data} en los últimos 30 días</span>
                </Badge>
              )}
            </TabsTab>
          ))}
        </TabsList>
        <TabsPanel value="academy">
          <Academy />
        </TabsPanel>
        <TabsPanel value="deliveries">
          <Failed />
        </TabsPanel>
        <TabsPanel value="communiques">
          <Communiques />
        </TabsPanel>
      </Tabs>
    </Page>
  )
}

function Academy() {
  const [params] = useSearchParams()
  const page = pageOf(params)
  const list = useQuery({ queryKey: ['admin', 'notices', page], queryFn: () => api<Paged<'rows', AcademyNotice>>(path('/admin/notices', range(page))), placeholderData: keepPreviousData })
  if (list.isPending) return <ListSkeleton rows={4} className="h-16" />
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />
  if (list.data.total === 0) return <EmptyState icon={<BellOffIcon />} title="La academia no tiene avisos" />
  return (
    <div className={cn(DIM, list.isPlaceholderData && 'opacity-60')} aria-busy={list.isPlaceholderData}>
      <ul className="divide-y rounded-2xl border bg-card">
        {list.data.rows.map((n) => {
          const urgent = noticeUrgent(n.action)
          const event = noticeEvent(n)
          const clock = noticeClock(n)
          const student = noticeStudent(n)
          const links = [
            event && { to: `/admin/events/${event}`, label: 'Ver el evento' },
            clock && { to: `/admin/clock?profile_id=${clock}`, label: 'Ver la jornada' },
            student && { to: `/admin/users/${student}`, label: 'Ver la ficha' },
          ].filter((l) => !!l)
          const Icon = urgent ? TriangleAlertIcon : BellIcon
          return (
            <li key={n.id} className="flex gap-3 px-4 py-3">
              <Icon aria-hidden="true" className={cn('mt-1 size-4 shrink-0', urgent ? 'text-destructive-foreground' : 'text-muted-foreground')} />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="text-pretty">
                  {urgent && <Tag variant="error">Revisar</Tag>} {noticeLabel(n.action)}
                </p>
                <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <time dateTime={n.created_at} className="text-muted-foreground tabular-nums">
                    {formatLogDate(n.created_at)}
                  </time>
                  {links.map((l) => (
                    <Link key={l.to} to={l.to} className={rowLink}>
                      {l.label}
                    </Link>
                  ))}
                </p>
              </div>
            </li>
          )
        })}
      </ul>
      <Pager total={list.data.total} page={page} href={(n) => pageHref(params, n)} />
    </div>
  )
}

function ChannelTag({ channel }: { channel: string }) {
  const Icon = channel === 'push' ? SmartphoneIcon : MailIcon
  return (
    <Tag>
      <Icon aria-hidden="true" />
      {CHANNEL_LABEL[channel] ?? channel}
    </Tag>
  )
}

const Recipient = ({ d, className }: { d: Delivery; className?: string }) => (
  <Link to={`/admin/users/${d.recipient.id}`} className={cn(rowLink, 'break-words', className)}>
    {d.recipient.display_name ?? <span className="italic">Sin nombre</span>}
  </Link>
)

const attempts = (n: number) => `${n} ${n === 1 ? 'intento' : 'intentos'}`

function Failed() {
  const [params] = useSearchParams()
  const page = pageOf(params)
  const list = useQuery({ queryKey: ['admin', 'notice-deliveries', page], queryFn: () => api<Paged<'rows', Delivery>>(path('/admin/notice-deliveries', range(page))), placeholderData: keepPreviousData })
  return (
    <div className="flex flex-col gap-4">
      <p className="flex gap-2 text-sm text-muted-foreground">
        <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        No se reintentan: un aviso caduca a las 24 h; si importa, avisa a la persona por otro medio.
      </p>
      {list.isPending ? (
        <ListSkeleton rows={4} className="h-20" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.total === 0 ? (
        <EmptyState icon={<MailCheckIcon />} title="Todo se ha entregado" />
      ) : (
        <div className={cn(DIM, list.isPlaceholderData && 'opacity-60')} aria-busy={list.isPlaceholderData}>
          {/* Como Usuarios y Cobros: una fila por entrega hasta `xl`; antes la tabla no cabe con la barra lateral. */}
          <ul className="flex flex-col divide-y rounded-2xl border bg-card xl:hidden">
            {list.data.rows.map((d) => (
              <li key={d.id} className="flex flex-col gap-1 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <Recipient d={d} className="min-w-0" />
                  <ChannelTag channel={d.channel} />
                </div>
                <p className="text-sm">
                  {deliveryLabel(d.action)}
                  <span className="text-muted-foreground">
                    {' · '}
                    <time dateTime={d.created_at} className="tabular-nums">
                      {formatLogDate(d.created_at)}
                    </time>
                  </span>
                </p>
                <p className="text-sm break-words text-muted-foreground">
                  <span className="tabular-nums">{attempts(d.attempts)}</span>
                  {d.last_error && ` · ${deliveryError(d.last_error)}`}
                </p>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto rounded-2xl border bg-card xl:block">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  {['Fecha', 'Aviso', 'Canal', 'Destinatario', 'Intentos', 'Último error'].map((h, i) => (
                    <TableHead key={h} className={cn(!i && 'ps-4', h === 'Intentos' && 'text-right')}>
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.rows.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="ps-4 tabular-nums">{formatLogDate(d.created_at)}</TableCell>
                    <TableCell>{deliveryLabel(d.action)}</TableCell>
                    <TableCell>
                      <ChannelTag channel={d.channel} />
                    </TableCell>
                    <TableCell>
                      <Recipient d={d} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{d.attempts}</TableCell>
                    <TableCell className="max-w-80 min-w-56 text-xs leading-snug break-words whitespace-normal text-muted-foreground">{deliveryError(d.last_error)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager total={list.data.total} page={page} href={(n) => pageHref(params, n)} />
        </div>
      )}
    </div>
  )
}
