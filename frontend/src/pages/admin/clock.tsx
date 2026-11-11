import { useMutation } from '@tanstack/react-query'
import { DownloadIcon, UsersIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Back, Tag } from '@/components/billing-bits'
import { ClockLog, MonthNav } from '@/components/clock-log'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Page } from '@/components/page'
import { EmptyState, ErrorState, ListSkeleton, QueryView } from '@/components/screen-state'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { EMPLOYMENT_LABEL, type Employment } from '@/lib/clock'
import { madridMonth } from '@/lib/dates'
import { queryClient } from '@/lib/logout'
import { toastError, toastOk } from '@/lib/notify'
import { useAdminClock } from '@/lib/queries'
import { path } from '@/lib/url'
import { Filter } from '@/pages/community'
import { useTrainers } from '@/pages/admin/schedule-bits'

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const refresh = () => void queryClient.invalidateQueries({ queryKey: ['admin', 'clock'] })

// El CSV va con Bearer: se baja y se guarda desde una URL temporal (como el PDF de un documento).
async function downloadCsv(profileId: string, month: string) {
  try {
    const url = URL.createObjectURL(await api<Blob>(path('/admin/clock/export', { profile_id: profileId, month, format: 'csv' }), { blob: true }))
    const a = document.createElement('a')
    a.href = url
    a.download = `jornada-${month}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  } catch (err) {
    toastError(err)
  }
}

// docs/api.md § Registro de jornada. Sin `profile_id`, los profesores (la API no lista solo a los empleados: el tipo de
// relación sale al abrir cada uno); con él, su mes.
export function AdminClockPage() {
  const [params, setParams] = useSearchParams()
  const profileId = params.get('profile_id')
  return (
    <Page title="Jornada" wide>
      {profileId ? <Professor id={profileId} month={MONTH.test(params.get('month') ?? '') ? params.get('month')! : madridMonth()} setMonth={(m) => setParams({ profile_id: profileId, month: m }, { replace: true })} /> : <Professors />}
    </Page>
  )
}

function Professors() {
  const list = useTrainers()
  if (list.isPending) return <ListSkeleton rows={4} className="h-14" />
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />
  if (list.data.length === 0) return <EmptyState icon={<UsersIcon />} title="No hay profesores" />
  return (
    <ul className="overflow-hidden rounded-2xl border bg-card">
      {list.data.map((p) => (
        <li key={p.id} className="border-b last:border-b-0">
          <Link to={`/admin/clock?profile_id=${p.id}`} className="flex min-h-14 items-center px-4 py-2.5 font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
            {p.display_name ?? 'Sin nombre'}
          </Link>
        </li>
      ))}
    </ul>
  )
}

function Professor({ id, month, setMonth }: { id: string; month: string; setMonth: (m: string) => void }) {
  const query = useAdminClock(id, month)
  return (
    <>
      <Back to="/admin/clock">Profesores</Back>
      <MonthNav month={month} onChange={setMonth} />
      <QueryView query={query}>
        {(data) => (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{data.profile.display_name ?? 'Sin nombre'}</span>
              <Tag variant={data.profile.employment === 'employee' ? 'info' : 'outline'}>{EMPLOYMENT_LABEL[data.profile.employment]}</Tag>
              <Button variant="outline" size="lg" className="ms-auto" onClick={() => void downloadCsv(id, month)}>
                <DownloadIcon />
                Descargar CSV
              </Button>
            </div>
            <ClockLog data={data} admin printTo={`/admin/clock/print?${new URLSearchParams({ profile_id: id, month })}`} onChanged={refresh} />
          </>
        )}
      </QueryView>
    </>
  )
}

// En la ficha del profesor (Usuarios): empleado o autónomo (PUT /admin/profiles/:id/employment).
export function EmploymentChange({ id }: { id: string }) {
  const query = useAdminClock(id, madridMonth())
  const [next, setNext] = useState<Employment | null>(null)
  const change = useMutation({
    mutationFn: (employment: Employment) => api(`/admin/profiles/${id}/employment`, { method: 'PUT', body: { employment } }),
    onSuccess: (_, e) => toastOk(`Ahora es ${EMPLOYMENT_LABEL[e].toLowerCase()}`),
    onError: (err) => toastError(err),
    onSettled: () => {
      setNext(null)
      void queryClient.invalidateQueries({ queryKey: ['admin'] })
      void queryClient.invalidateQueries({ queryKey: ['clock'] })
    },
  })
  const items = (Object.keys(EMPLOYMENT_LABEL) as Employment[]).map((value) => ({ value, label: EMPLOYMENT_LABEL[value] }))
  return (
    <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center">
      <span className="text-sm text-muted-foreground sm:w-40">Tipo de relación</span>
      <div className="sm:w-52">
        {query.data ? (
          <Filter label="Tipo de relación" value={query.data.profile.employment} onChange={(v) => v !== query.data.profile.employment && setNext(v as Employment)} items={items} />
        ) : (
          <p className="text-sm text-muted-foreground">{query.isError ? 'No se ha podido leer.' : 'Cargando…'}</p>
        )}
      </div>
      <ConfirmDialog
        open={next !== null}
        onOpenChange={(o) => !o && !change.isPending && setNext(null)}
        title={next ? `¿Pasar a ${EMPLOYMENT_LABEL[next].toLowerCase()}?` : ''}
        description={
          next === 'self_employed'
            ? 'Deja de fichar y de pedir correcciones. Lo que ya fichó se conserva y se puede consultar.'
            : 'Empieza a fichar su jornada y a poder pedir correcciones.'
        }
        confirmLabel="Cambiar"
        variant="default"
        loading={change.isPending}
        onConfirm={() => next && change.mutate(next)}
      />
    </div>
  )
}
