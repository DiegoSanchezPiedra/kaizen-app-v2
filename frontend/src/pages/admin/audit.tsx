import { useQuery } from '@tanstack/react-query'
import { FunnelIcon, HistoryIcon, XIcon } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { Page } from '@/components/page'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/screen-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AUDIT_CATEGORIES, auditDetail, auditLabel, auditTarget, categoryPrefixes, pageHref, pageOf, type AuditRow, type Paged } from '@/lib/admin'
import { api } from '@/lib/api'
import { formatDeadline } from '@/lib/format'
import { path } from '@/lib/url'
import { Filter } from '@/pages/community'
import { PAGE_SIZE, Pager } from '@/pages/admin/shell'

const ALL = 'all'
const CATEGORIES = [{ value: ALL, label: 'Todas las categorías' }, ...AUDIT_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))]

// docs/pantallas-b19.md § Auditoría. Filtros en la URL: ?category&actor&resource_type&resource_id&from&to&page.
// Los avisos (notice.*) no salen: la API nunca los devuelve.
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
  const set = (k: string, v: string) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        if (v && v !== ALL) n.set(k, v)
        else n.delete(k)
        n.delete('page')
        return n
      },
      { replace: true },
    )
  const list = useQuery({
    queryKey: ['admin', 'audit', q, page],
    queryFn: () => api<Paged<'rows', AuditRow>>(path('/admin/audit', { ...q, limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) })),
  })
  const scoped = q.resource_id ? `${q.resource_type ?? 'recurso'} ${q.resource_id}` : null

  return (
    <Page title="Auditoría" wide>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="sm:w-56">
          <Filter label="Categoría" value={category} onChange={(v) => set('category', v)} items={CATEGORIES} />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Desde
          <Input type="date" className="min-h-11 w-40" value={params.get('from') ?? ''} max={params.get('to') ?? undefined} onChange={(e) => set('from', e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Hasta
          <Input type="date" className="min-h-11 w-40" value={params.get('to') ?? ''} min={params.get('from') ?? undefined} onChange={(e) => set('to', e.target.value)} />
        </label>
        {(q.actor_id || scoped) && (
          <Button variant="outline" size="sm" onClick={() =>
              setParams(
                (p) => {
                  const n = new URLSearchParams(p)
                  for (const k of ['actor', 'resource_type', 'resource_id', 'page']) n.delete(k)
                  return n
                },
                { replace: true },
              )
            }>
            <XIcon />
            {q.actor_id ? 'Quitar el filtro de persona' : `Quitar el filtro de ${scoped}`}
          </Button>
        )}
      </div>
      {list.isPending ? (
        <ListSkeleton rows={6} className="h-10" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.total === 0 ? (
        <EmptyState icon={<HistoryIcon />} title="Nada registrado con estos filtros" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border bg-card">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  {['Fecha', 'Quién', 'Qué', 'Sobre qué', 'Detalle'].map((h, i) => (
                    <TableHead key={h} className={i ? undefined : 'ps-4'}>
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.rows.map((a) => {
                  const target = auditTarget(a)
                  return (
                    <TableRow key={a.id} className="h-10">
                      <TableCell className="ps-4 tabular-nums">{formatDeadline(a.created_at)}</TableCell>
                      <TableCell>
                        {a.actor.id ? (
                          <span className="flex items-center gap-1.5">
                            <Link to={`/admin/users/${a.actor.id}`} className="font-medium text-link underline-offset-3 hover:underline">
                              {a.actor.display_name ?? 'Sin nombre'}
                            </Link>
                            <Link
                              to={pageHref(new URLSearchParams({ ...Object.fromEntries(params), actor: a.actor.id }), 1)}
                              aria-label={`Ver solo lo de ${a.actor.display_name ?? 'esta persona'}`}
                              className="relative grid size-6 place-items-center rounded text-muted-foreground after:absolute after:-inset-x-1 after:-inset-y-2.5 hover:text-foreground"
                            >
                              <FunnelIcon className="size-3.5" />
                            </Link>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Sistema</span>
                        )}
                      </TableCell>
                      <TableCell>{auditLabel(a.action)}</TableCell>
                      <TableCell>
                        {target.to ? (
                          <Link to={target.to} className="text-link underline-offset-3 hover:underline">
                            {target.label}
                          </Link>
                        ) : (
                          target.label
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{auditDetail(a) || '—'}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          <Pager total={list.data.total} page={page} href={(n) => pageHref(params, n)} />
        </>
      )}
    </Page>
  )
}
