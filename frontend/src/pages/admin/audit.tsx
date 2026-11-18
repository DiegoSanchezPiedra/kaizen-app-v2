import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { CogIcon, FunnelIcon, HistoryIcon, XIcon } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { Page } from '@/components/page'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/screen-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AUDIT_CATEGORIES, auditDetail, auditLabel, auditScopeLabel, auditTarget, categoryPrefixes, pageHref, pageOf, type AuditRow, type Paged } from '@/lib/admin'
import { api } from '@/lib/api'
import { formatLogDate } from '@/lib/format'
import { path } from '@/lib/url'
import { cn } from '@/lib/utils'
import { Filter } from '@/components/filter'
import { PAGE_SIZE, Pager } from '@/pages/admin/shell'

const ALL = 'all'
const CATEGORIES = [{ value: ALL, label: 'Todas las categorías' }, ...AUDIT_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))]
const FILTERS = ['category', 'actor', 'resource_type', 'resource_id', 'from', 'to']
const link = 'relative text-link underline-offset-3 transition-colors duration-150 ease-out after:absolute after:-inset-x-1 after:-inset-y-4 hover:underline'

// docs/pantallas-b19.md § Auditoría y docs/pantallas-b22.md § Auditoría. Filtros en la URL: ?category&actor&resource_type&resource_id&from&to&page.
// Los avisos (notice.*) no salen: la API nunca los devuelve. `health.view` dice la acción, nunca el dato.
export function AdminAuditPage() {
  const [params, setParams] = useSearchParams()
  const page = pageOf(params)
  const category = params.get('category') ?? ALL
  const q = {
    action: categoryPrefixes(params.get('category')),
    actor_id: params.get('actor') ?? undefined,
    resource_type: params.get('resource_type') ?? undefined,
    resource_id: params.get('resource_id') ?? undefined,
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
  }
  const edit = (f: (n: URLSearchParams) => void) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        f(n)
        n.delete('page')
        return n
      },
      { replace: true },
    )
  const set = (k: string, v: string) => edit((n) => (v && v !== ALL ? n.set(k, v) : n.delete(k)))
  const drop = (...ks: string[]) => edit((n) => ks.forEach((k) => n.delete(k)))
  const list = useQuery({
    queryKey: ['admin', 'audit', q, page],
    queryFn: () => api<Paged<'rows', AuditRow>>(path('/admin/audit', { ...q, limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) })),
    placeholderData: keepPreviousData,
  })
  // Todas las filas son de esa persona: su nombre sale de la primera.
  const actorName = (!list.isPlaceholderData && list.data?.rows[0]?.actor.display_name) || 'esta persona'
  const filtered = FILTERS.some((k) => params.has(k))

  return (
    <Page title="Auditoría" wide>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="sm:w-56">
            <Filter label="Categoría" value={category} onChange={(v) => set('category', v)} items={CATEGORIES} />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:flex">
            <label className="flex flex-col gap-1 text-sm text-muted-foreground">
              Desde
              <Input type="date" className="min-h-11 sm:w-40" value={params.get('from') ?? ''} max={params.get('to') ?? undefined} onChange={(e) => set('from', e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm text-muted-foreground">
              Hasta
              <Input type="date" className="min-h-11 sm:w-40" value={params.get('to') ?? ''} min={params.get('from') ?? undefined} onChange={(e) => set('to', e.target.value)} />
            </label>
          </div>
        </div>
        {(q.actor_id || q.resource_id) && (
          <div className="flex flex-wrap gap-2">
            {q.actor_id && (
              <Button variant="outline" className="h-11 max-w-full sm:h-11" aria-label={`Quitar el filtro: solo lo de ${actorName}`} onClick={() => drop('actor')}>
                <span className="truncate">Solo lo de {actorName}</span>
                <XIcon />
              </Button>
            )}
            {q.resource_id && (
              <Button variant="outline" className="h-11 max-w-full sm:h-11" aria-label={`Quitar el filtro: solo ${auditScopeLabel(q.resource_type ?? null)}`} onClick={() => drop('resource_type', 'resource_id')}>
                <span className="truncate">Solo {auditScopeLabel(q.resource_type ?? null)}</span>
                <XIcon />
              </Button>
            )}
          </div>
        )}
      </div>
      {list.isPending ? (
        <ListSkeleton rows={6} className="h-20" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.total === 0 ? (
        filtered ? (
          <EmptyState
            icon={<HistoryIcon />}
            title="Nada registrado con estos filtros"
            action={
              <Button variant="outline" className="h-11 sm:h-11" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                Quitar los filtros
              </Button>
            }
          />
        ) : (
          <EmptyState icon={<HistoryIcon />} title="Aún no hay nada registrado" />
        )
      ) : (
        <div className={cn('flex flex-col gap-4 transition-opacity duration-150 ease-out', list.isPlaceholderData && 'opacity-60')} aria-busy={list.isPlaceholderData}>
          {/* Como Usuarios y Cobros: una fila por línea hasta `xl`; antes la tabla no cabe con la barra lateral. */}
          <ul className="flex flex-col divide-y rounded-2xl border bg-card xl:hidden">
            {list.data.rows.map((a) => {
              const detail = auditDetail(a)
              return (
                <li key={a.id} className="flex flex-col gap-1 px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 font-medium">{auditLabel(a.action)}</span>
                    <time dateTime={a.created_at} className="shrink-0 text-sm text-muted-foreground tabular-nums">
                      {formatLogDate(a.created_at)}
                    </time>
                  </div>
                  <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
                    <Actor a={a} params={params} />
                    <span className="text-muted-foreground" aria-hidden="true">
                      ·
                    </span>
                    <Target a={a} />
                  </p>
                  {detail && <p className="text-sm break-words text-muted-foreground">{detail}</p>}
                </li>
              )
            })}
          </ul>
          <div className="hidden overflow-x-auto rounded-2xl border bg-card xl:block">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  {['Fecha', 'Quién', 'Qué', 'Sobre qué', 'Detalle'].map((h, i) => (
                    <TableHead key={h} className={cn(!i && 'ps-4')}>
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.rows.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="ps-4 tabular-nums">{formatLogDate(a.created_at)}</TableCell>
                    <TableCell>
                      <Actor a={a} params={params} />
                    </TableCell>
                    <TableCell>{auditLabel(a.action)}</TableCell>
                    <TableCell>
                      <Target a={a} />
                    </TableCell>
                    <TableCell className="max-w-96 min-w-48 leading-snug break-words whitespace-normal text-muted-foreground">{auditDetail(a) || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager total={list.data.total} page={page} href={(n) => pageHref(params, n)} />
        </div>
      )}
    </Page>
  )
}

function Actor({ a, params }: { a: AuditRow; params: URLSearchParams }) {
  if (!a.actor.id)
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <CogIcon aria-hidden="true" className="size-3.5" />
        Sistema
      </span>
    )
  const name = a.actor.display_name
  return (
    <span className="inline-flex items-center gap-1.5">
      <Link to={`/admin/users/${a.actor.id}`} className={cn(link, 'font-medium')}>
        {name ?? <span className="italic">Sin nombre</span>}
      </Link>
      {params.get('actor') !== a.actor.id && (
        <Link
          to={pageHref(new URLSearchParams({ ...Object.fromEntries(params), actor: a.actor.id }), 1)}
          aria-label={`Ver solo lo de ${name ?? 'esta persona'}`}
          className="relative grid size-6 place-items-center rounded text-muted-foreground transition-colors duration-150 ease-out after:absolute after:-inset-2.5 hover:bg-accent hover:text-foreground"
        >
          <FunnelIcon className="size-3.5" aria-hidden="true" />
        </Link>
      )}
    </span>
  )
}

function Target({ a }: { a: AuditRow }) {
  const t = auditTarget(a)
  return t.to ? (
    <Link to={t.to} className={cn(link, 'after:-inset-x-2.5')}>
      {t.label}
    </Link>
  ) : (
    <span className="text-muted-foreground">{t.label}</span>
  )
}
