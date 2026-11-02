import { useMutation, useQuery } from '@tanstack/react-query'
import { BookOpenIcon, PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { Tag } from '@/components/billing-bits'
import { Page } from '@/components/page'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/screen-state'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { toastManager } from '@/components/ui/toast'
import { api } from '@/lib/api'
import { centsToEuros, eurosToCents, maxDisciplinesLabel } from '@/lib/catalog'
import { formatEuros } from '@/lib/format'
import { queryClient } from '@/lib/logout'
import { toastError, toastOk } from '@/lib/notify'
import { plural } from '@/lib/professor'
import type { Discipline, Plan } from '@/lib/types'
import { FormSheet, SelectField, SwitchRow, TextField, useAdminDisciplines, useFieldError } from '@/pages/admin/schedule-bits'
import { Filter } from '@/pages/community'

const TABS = [
  { value: 'disciplines', label: 'Disciplinas' },
  { value: 'plans', label: 'Planes' },
]

// Lo que cambia el catálogo lo ven también el alumno (planes, disciplinas), el calendario y las reservas.
const refreshCatalog = () => Promise.all(['admin', 'plans', 'disciplines', 'calendar', 'bookings'].map((k) => queryClient.invalidateQueries({ queryKey: [k] })))

const useAdminPlans = () => useQuery({ queryKey: ['admin', 'plans'], queryFn: () => api<{ plans: Plan[] }>('/admin/plans').then((r) => r.plans) })

// docs/pantallas-b19.md § Catálogo.
export function AdminCatalogPage() {
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((t) => t.value === params.get('tab')) ? params.get('tab')! : 'disciplines'
  return (
    <Page title="Catálogo" wide>
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: String(v) }, { replace: true })} className="gap-5">
        <TabsList className="w-full sm:w-auto">
          {TABS.map((t) => (
            <TabsTab key={t.value} value={t.value} className="min-h-11 flex-1 px-4">
              {t.label}
            </TabsTab>
          ))}
        </TabsList>
        <TabsPanel value="disciplines">
          <Disciplines />
        </TabsPanel>
        <TabsPanel value="plans">
          <Plans />
        </TabsPanel>
      </Tabs>
    </Page>
  )
}

const Head = ({ cols }: { cols: string[] }) => (
  <TableHeader className="sticky top-0 bg-card">
    <TableRow>
      {cols.map((h, i) => (
        <TableHead key={h || 'acciones'} className={i ? undefined : 'ps-4'}>
          {h || <span className="sr-only">Acciones</span>}
        </TableHead>
      ))}
    </TableRow>
  </TableHeader>
)

// ── Disciplinas ──────────────────────────────────────────────────────────────

function Disciplines() {
  const list = useAdminDisciplines()
  const [editing, setEditing] = useState<Discipline | null | undefined>(undefined) // null = nueva
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button size="lg" onClick={() => setEditing(null)}>
          <PlusIcon />
          Nueva disciplina
        </Button>
      </div>
      {list.isPending ? (
        <ListSkeleton rows={5} className="h-10" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyState icon={<BookOpenIcon />} title="No hay disciplinas" text="Crea la primera con «Nueva disciplina»." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <Table>
            <Head cols={['Nombre', 'Quién', 'Reserva', 'Estado', '']} />
            <TableBody>
              {list.data.map((d) => (
                <TableRow key={d.id} className={d.is_active ? 'h-10' : 'h-10 text-muted-foreground'}>
                  <TableCell className="ps-4 font-medium">{d.name}</TableCell>
                  <TableCell>{d.minors_only ? <Tag variant="info">Solo menores</Tag> : 'Todos'}</TableCell>
                  <TableCell>{d.is_open ? <Tag variant="secondary">Abierta</Tag> : 'Se elige en la cuota'}</TableCell>
                  <TableCell>{d.is_active ? <Tag variant="success">Activa</Tag> : <Tag variant="secondary">Desactivada</Tag>}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" aria-label={`Editar ${d.name}`} onClick={() => setEditing(d)}>
                      Editar
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {editing !== undefined && <DisciplineSheet key={editing?.id ?? 'new'} d={editing} onClose={() => setEditing(undefined)} />}
    </div>
  )
}

type DisciplineResult = { discipline: Discipline & { retired_classes?: number; cancelled_sessions?: number } }

function DisciplineSheet({ d, onClose }: { d: Discipline | null; onClose: () => void }) {
  const [f, setF] = useState({ name: d?.name ?? '', minors_only: d?.minors_only ?? false, is_open: d?.is_open ?? false, is_active: d?.is_active ?? true })
  const fe = useFieldError()
  const body = { ...f, name: f.name.trim() }
  // PATCH: solo lo que cambia (sin nada, la API da empty_patch).
  const diff = d ? Object.fromEntries(Object.entries(body).filter(([k, v]) => v !== d[k as keyof Discipline])) : body
  const deactivating = !!d?.is_active && !f.is_active
  const save = useMutation({
    mutationFn: () => {
      fe.clear()
      return d ? api<DisciplineResult>(`/admin/disciplines/${d.id}`, { method: 'PATCH', body: diff }) : api<DisciplineResult>('/admin/disciplines', { method: 'POST', body: { name: body.name, minors_only: f.minors_only, is_open: f.is_open } })
    },
    onSuccess: ({ discipline: r }) =>
      deactivating
        ? toastManager.add({
            type: 'success',
            title: `${r.name} desactivada`,
            description: `${plural(r.retired_classes ?? 0, 'clase retirada', 'clases retiradas')} y ${plural(r.cancelled_sessions ?? 0, 'sesión cancelada', 'sesiones canceladas')}.`,
            timeout: 10000,
          })
        : toastOk(d ? 'Disciplina guardada' : 'Disciplina creada'),
    onError: fe.fail,
    onSettled: () => void refreshCatalog(),
  })
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))
  return (
    <FormSheet
      open
      onClose={onClose}
      title={d ? `Editar ${d.name}` : 'Nueva disciplina'}
      description="Las disciplinas son las que se eligen en la cuota y se reservan en el calendario."
      submitLabel={deactivating ? 'Desactivar' : d ? 'Guardar' : 'Crear la disciplina'}
      disabled={!body.name || body.name.length > 100 || (!!d && Object.keys(diff).length === 0)}
      loading={save.isPending}
      confirm={
        deactivating
          ? {
              title: `¿Desactivar ${d.name}?`,
              description:
                'Retira todas sus clases, cancela sus sesiones futuras y avisa a quienes tenían reserva. Quien la tenía elegida en su cuota puede cambiarla gratis.',
              destructive: true,
            }
          : undefined
      }
      onSubmit={() => save.mutateAsync()}
    >
      <TextField label="Nombre" value={f.name} onChange={set('name')} maxLength={100} error={fe.error('name')} />
      <SwitchRow label="Solo menores" hint="Un adulto no la puede hacer." checked={f.minors_only} onChange={set('minors_only')} />
      <SwitchRow label="Abierta" hint="La cubre cualquier cuota, sin elegirla ni ocupar hueco del plan." checked={f.is_open} onChange={set('is_open')} />
      {d && <SwitchRow label="Activa" hint="Si la desactivas, se retiran sus clases y se cancelan sus sesiones futuras." checked={f.is_active} onChange={set('is_active')} />}
    </FormSheet>
  )
}

// ── Planes ───────────────────────────────────────────────────────────────────

function Plans() {
  const list = useAdminPlans()
  const disciplines = useAdminDisciplines()
  const [editing, setEditing] = useState<Plan | null | undefined>(undefined)
  const [choosing, setChoosing] = useState<Plan | null>(null)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Precios al mes, impuestos incluidos.</p>
        <Button size="lg" onClick={() => setEditing(null)}>
          <PlusIcon />
          Nuevo plan
        </Button>
      </div>
      {list.isPending ? (
        <ListSkeleton rows={4} className="h-10" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyState icon={<BookOpenIcon />} title="No hay planes" text="Crea el primero con «Nuevo plan»." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <Table>
            <Head cols={['Plan', 'Precio', 'Disciplinas', 'Quién', 'Elegibles', 'Estado', '']} />
            <TableBody>
              {list.data.map((p) => (
                <TableRow key={p.id} className={p.is_active ? 'h-10' : 'h-10 text-muted-foreground'}>
                  <TableCell className="ps-4 font-medium">{p.name}</TableCell>
                  <TableCell className="tabular-nums whitespace-nowrap">{formatEuros(p.price_cents)}</TableCell>
                  <TableCell>{maxDisciplinesLabel(p.max_disciplines)}</TableCell>
                  <TableCell>{p.minors_only ? <Tag variant="info">Solo menores</Tag> : 'Todos'}</TableCell>
                  <TableCell>{p.eligible_discipline_ids.length ? plural(p.eligible_discipline_ids.length, 'disciplina', 'disciplinas') : 'Todas las activas'}</TableCell>
                  <TableCell>{p.is_active ? <Tag variant="success">Activo</Tag> : <Tag variant="secondary">Retirado</Tag>}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button variant="ghost" size="sm" aria-label={`Editar el plan ${p.name}`} onClick={() => setEditing(p)}>
                      Editar
                    </Button>
                    <Button variant="ghost" size="sm" aria-label={`Disciplinas del plan ${p.name}`} onClick={() => setChoosing(p)}>
                      Disciplinas
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {editing !== undefined && <PlanSheet key={editing?.id ?? 'new'} p={editing} onClose={() => setEditing(undefined)} />}
      {choosing && <EligibleSheet key={choosing.id} p={choosing} all={disciplines.data ?? []} onClose={() => setChoosing(null)} />}
    </div>
  )
}

const MAX_OPTIONS = ['1', '2', '3', '4']

function PlanSheet({ p, onClose }: { p: Plan | null; onClose: () => void }) {
  const [f, setF] = useState({
    name: p?.name ?? '',
    price: p ? centsToEuros(p.price_cents) : '',
    max: p ? String(p.max_disciplines ?? 'all') : '1',
    minors_only: p?.minors_only ?? false,
    is_active: p?.is_active ?? true,
  })
  const fe = useFieldError()
  const cents = eurosToCents(f.price)
  const max = f.max === 'all' ? null : Number(f.max)
  const priceChanged = !!p && cents !== null && cents !== p.price_cents
  const retiring = !!p?.is_active && !f.is_active
  const body = { name: f.name.trim(), price_cents: cents, max_disciplines: max, minors_only: f.minors_only, is_active: f.is_active }
  const diff = p ? Object.fromEntries(Object.entries(body).filter(([k, v]) => v !== p[k as keyof Plan])) : body
  const save = useMutation({
    mutationFn: () => {
      fe.clear()
      return p ? api(`/admin/plans/${p.id}`, { method: 'PATCH', body: diff }) : api('/admin/plans', { method: 'POST', body })
    },
    onSuccess: () => toastOk(p ? 'Plan guardado' : 'Plan creado'),
    onError: fe.fail,
    onSettled: () => void refreshCatalog(),
  })
  // Lo que pasa a quien ya tiene el plan, una frase por cambio (docs/pantallas-b19.md § Catálogo).
  const effects = [
    priceChanged && 'El nuevo precio se aplica a todos sus suscriptores desde su siguiente cobro, sin cobrar la diferencia.',
    retiring && 'Ya no se contrata; las suscripciones siguen igual.',
  ].filter((e): e is string => !!e)
  return (
    <FormSheet
      open
      onClose={onClose}
      title={p ? `Editar ${p.name}` : 'Nuevo plan'}
      description="El precio es el que paga el alumno cada mes, impuestos incluidos."
      submitLabel={priceChanged ? 'Cambiar el precio' : retiring ? 'Retirar' : p ? 'Guardar' : 'Crear el plan'}
      disabled={!body.name || body.name.length > 100 || cents === null || (!!p && Object.keys(diff).length === 0)}
      loading={save.isPending}
      confirm={effects.length ? { title: priceChanged ? `¿Cambiar el precio de ${p!.name}?` : `¿Retirar ${p!.name}?`, description: effects.join(' ') } : undefined}
      onSubmit={() => save.mutateAsync()}
    >
      <TextField label="Nombre" value={f.name} onChange={(v) => setF((x) => ({ ...x, name: v }))} maxLength={100} error={fe.error('name')} />
      <TextField
        label="Precio al mes (€)"
        value={f.price}
        onChange={(v) => setF((x) => ({ ...x, price: v }))}
        inputMode="decimal"
        hint="Impuestos incluidos. Con 0 € el plan no se contrata por la pasarela."
        error={f.price && cents === null ? 'Escribe un importe como 30 o 29,90.' : fe.error('price_cents')}
      />
      <SelectField label="Cuántas disciplinas incluye">
        <Filter
          label="Cuántas disciplinas incluye"
          value={f.max}
          onChange={(v) => setF((x) => ({ ...x, max: v }))}
          items={[...new Set([...MAX_OPTIONS, f.max].filter((v) => v !== 'all'))].map((v) => ({ value: v, label: v })).concat({ value: 'all', label: 'Todas' })}
        />
        {p && <p className="text-xs text-muted-foreground">Con suscriptores, ni esto ni «solo menores» se pueden cambiar: crea otro plan.</p>}
      </SelectField>
      <SwitchRow label="Solo menores" checked={f.minors_only} onChange={(v) => setF((x) => ({ ...x, minors_only: v }))} />
      {p && <SwitchRow label="Activo" hint="Un plan retirado ya no se contrata." checked={f.is_active} onChange={(v) => setF((x) => ({ ...x, is_active: v }))} />}
    </FormSheet>
  )
}

function EligibleSheet({ p, all, onClose }: { p: Plan; all: Discipline[]; onClose: () => void }) {
  const [picked, setPicked] = useState(() => p.eligible_discipline_ids.map(String))
  const shown = all.filter((d) => d.is_active || picked.includes(String(d.id)))
  const same = picked.length === p.eligible_discipline_ids.length && picked.every((id) => p.eligible_discipline_ids.map(String).includes(id))
  const save = useMutation({
    mutationFn: () => api(`/admin/plans/${p.id}/disciplines`, { method: 'PUT', body: { discipline_ids: picked } }),
    onSuccess: () => toastOk('Disciplinas guardadas'),
    onError: (err) => toastError(err),
    onSettled: () => void refreshCatalog(),
  })
  return (
    <FormSheet
      open
      onClose={onClose}
      title={`Disciplinas de ${p.name}`}
      description="Entre cuáles elige el alumno. Sin ninguna marcada, vale cualquiera de las activas que su edad permita."
      submitLabel="Guardar"
      disabled={same}
      loading={save.isPending}
      onSubmit={() => save.mutateAsync()}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">
          {picked.length ? plural(picked.length, 'disciplina elegible', 'disciplinas elegibles') : 'Todas las activas que permita la edad'}
          {p.max_disciplines !== null && ` · el plan incluye ${p.max_disciplines}`}
        </legend>
        {shown.map((d) => (
          <label key={d.id} className="flex min-h-11 items-center gap-3 rounded-lg border px-3">
            <Checkbox
              checked={picked.includes(String(d.id))}
              onCheckedChange={(c) => setPicked((xs) => (c ? [...xs, String(d.id)] : xs.filter((x) => x !== String(d.id))))}
            />
            <span className="flex-1">{d.name}</span>
            {!d.is_active && <Tag variant="secondary">Desactivada</Tag>}
            {d.minors_only && <Tag variant="info">Solo menores</Tag>}
          </label>
        ))}
      </fieldset>
    </FormSheet>
  )
}
