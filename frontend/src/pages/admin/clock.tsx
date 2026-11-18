import { useMutation } from '@tanstack/react-query'
import { ChevronRightIcon, Clock3Icon, TimerIcon, TriangleAlertIcon, UsersIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Back, Tag } from '@/components/billing-bits'
import { ClockLog, MonthNav } from '@/components/clock-log'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Page } from '@/components/page'
import { EmptyState, ErrorState, ListSkeleton, QueryView } from '@/components/screen-state'
import { api } from '@/lib/api'
import { EMPLOYMENT_LABEL, monthParam, type Employment } from '@/lib/clock'
import { madridMonth } from '@/lib/dates'
import { queryClient } from '@/lib/logout'
import { formatDeadline, formatTime } from '@/lib/format'
import { toastError, toastOk } from '@/lib/notify'
import { plural } from '@/lib/professor'
import { useAdminClock, useEmployees } from '@/lib/queries'
import { path } from '@/lib/url'
import { Filter } from '@/components/filter'

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

// docs/api.md § Registro de jornada. Sin `profile_id`, los profesores empleados; con él, su mes.
export function AdminClockPage() {
  const [params, setParams] = useSearchParams()
  const profileId = params.get('profile_id')
  return (
    <Page title="Jornada" wide>
      {profileId ? <Professor id={profileId} month={monthParam(params)} setMonth={(m) => setParams({ profile_id: profileId, month: m }, { replace: true })} /> : <Professors />}
    </Page>
  )
}

// El admin viene a revisar: arriba los que tienen correcciones pendientes o una salida olvidada (`open_late`, el umbral
// del aviso «Lo grave» del Inicio, lo pone la API); luego, por nombre.
function Professors() {
  const list = useEmployees()
  if (list.isPending) return <ListSkeleton rows={4} className="h-14" />
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />
  if (list.data.employees.length === 0) return <EmptyState icon={<UsersIcon />} title="No hay profesores empleados" text="Marca a un profesor como empleado en su ficha de Usuarios." />
  const rows = [...list.data.employees]
  const urgent = (p: (typeof rows)[number]) => (p.pending > 0 || p.open_late ? 0 : 1)
  rows.sort((a, b) => urgent(a) - urgent(b)) // estable: dentro de cada grupo sigue el orden por nombre del servidor
  return (
    <div className="flex max-w-2xl flex-col gap-2">
      <p className="px-1 text-sm text-muted-foreground tabular-nums">{plural(rows.length, 'profesor empleado', 'profesores empleados')}</p>
      <ul className="overflow-hidden rounded-2xl border bg-card">
        {rows.map((p) => (
          <li key={p.id} className="border-b last:border-b-0">
            <Link
              to={`/admin/clock?profile_id=${p.id}`}
              className="flex min-h-16 items-center gap-3 py-2.5 ps-4 pe-3 transition-colors duration-150 ease-out outline-none hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-accent"
            >
              <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
                <span className="font-semibold break-words">{p.display_name ?? 'Sin nombre'}</span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                  {p.pending > 0 && (
                    <Tag variant="warning">
                      <Clock3Icon aria-hidden />
                      {plural(p.pending, 'corrección pendiente', 'correcciones pendientes')}
                    </Tag>
                  )}
                  {p.open_late && (
                    <span className="flex items-center gap-1.5 font-semibold text-warning-foreground">
                      <TriangleAlertIcon className="size-3.5 shrink-0" aria-hidden />
                      Jornada abierta desde el {formatDeadline(p.open_since!)}
                    </span>
                  )}
                  {p.open_since && !p.open_late && (
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <TimerIcon className="size-3.5 shrink-0" aria-hidden />
                      En jornada desde las <span className="font-mono tabular-nums">{formatTime(p.open_since)}</span>
                    </span>
                  )}
                  {p.pending === 0 && !p.open_since && <span className="text-muted-foreground">Al día</span>}
                </span>
              </span>
              <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

// De quién (encabezado) antes que cuándo (MonthNav). El CSV va con Imprimir en las acciones del mes.
function Professor({ id, month, setMonth }: { id: string; month: string; setMonth: (m: string) => void }) {
  const query = useAdminClock(id, month)
  const profile = query.data?.profile
  return (
    <>
      <Back to="/admin/clock">Profesores</Back>
      {profile && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          <h2 className="font-heading text-lg leading-snug font-bold text-balance">{profile.display_name ?? 'Sin nombre'}</h2>
          <Tag variant={profile.employment === 'employee' ? 'info' : 'outline'}>{EMPLOYMENT_LABEL[profile.employment]}</Tag>
        </div>
      )}
      <MonthNav month={month} onChange={setMonth} />
      <QueryView query={query}>
        {(data) => (
          <ClockLog
            data={data}
            admin
            printTo={`/admin/clock/print?${new URLSearchParams({ profile_id: id, month })}`}
            onCsv={() => void downloadCsv(id, month)}
            onChanged={refresh}
          />
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
