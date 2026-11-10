import { useMutation, useQuery } from '@tanstack/react-query'
import { BookOpenIcon, PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { Tag } from '@/components/billing-bits'
import { Page } from '@/components/page'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/screen-state'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api'
import { ageRangeLabel, centsToEuros, eurosToCents, maxDisciplinesLabel } from '@/lib/catalog'
import { formatEuros } from '@/lib/format'
import { toastError, toastOk } from '@/lib/notify'
import { plural } from '@/lib/professor'
import type { Discipline, Plan } from '@/lib/types'
import { CardList, CardRow, Head, refreshCatalog } from '@/pages/admin/catalog-bits'
import { FormSheet, SelectField, SwitchRow, TextField, useAdminDisciplines, useFieldError } from '@/pages/admin/schedule-bits'
import { Filter } from '@/pages/community'

const useAdminPlans = () => useQuery({ queryKey: ['admin', 'plans'], queryFn: () => api<{ plans: Plan[] }>('/admin/plans').then((r) => r.plans) })

// Un «plan» de la API es una «membresía» en el panel; el alumno sigue viendo «plan» y «cuota». docs/pantallas-b22.md § Membresías y Disciplinas.
export function AdminMembershipsPage() {
  const list = useAdminPlans()
  const disciplines = useAdminDisciplines()
  const [editing, setEditing] = useState<Plan | null | undefined>(undefined)
  const [choosing, setChoosing] = useState<Plan | null>(null)
  const eligible = (p: Plan) => (p.eligible_discipline_ids.length ? plural(p.eligible_discipline_ids.length, 'disciplina', 'disciplinas') : 'Todas las activas')
  return (
    <Page
      title="Membresías"
      wide
      actions={
        <Button size="lg" onClick={() => setEditing(null)}>
          <PlusIcon />
          Nueva membresía
        </Button>
      }
    >
      <p className="-mt-2 text-sm text-muted-foreground">Precios al mes, impuestos incluidos.</p>
      {list.isPending ? (
        <ListSkeleton rows={4} className="h-14" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyState icon={<BookOpenIcon />} title="No hay membresías" text="Crea la primera con «Nueva membresía»." />
      ) : (
        <>
          <CardList>
            {list.data.map((p) => (
              <CardRow
                key={p.id}
                name={p.name}
                active={p.is_active}
                activeLabel="Activa"
                inactiveLabel="Retirada"
                lines={[
                  [
                    formatEuros(p.price_cents),
                    p.max_disciplines === null ? 'todas las disciplinas' : plural(p.max_disciplines, 'disciplina', 'disciplinas'),
                    p.eligible_discipline_ids.length > 0 && `elige entre ${p.eligible_discipline_ids.length}`,
                    p.minors_only && 'solo menores',
                  ]
                    .filter(Boolean)
                    .join(' · '),
                ]}
                onOpen={() => setEditing(p)}
              />
            ))}
          </CardList>
          <div className="hidden overflow-x-auto rounded-2xl border bg-card sm:block">
            <Table>
              <Head cols={['Membresía', 'Precio', 'Disciplinas', 'Quién', 'Elegibles', 'Estado', '']} />
              <TableBody>
                {list.data.map((p) => (
                  <TableRow key={p.id} className={p.is_active ? 'h-10' : 'h-10 text-muted-foreground'}>
                    <TableCell className="ps-4 font-medium">{p.name}</TableCell>
                    <TableCell className="tabular-nums whitespace-nowrap">{formatEuros(p.price_cents)}</TableCell>
                    <TableCell>{maxDisciplinesLabel(p.max_disciplines)}</TableCell>
                    <TableCell>{p.minors_only ? <Tag variant="info">Solo menores</Tag> : 'Todos'}</TableCell>
                    <TableCell>{eligible(p)}</TableCell>
                    <TableCell>{p.is_active ? <Tag variant="success">Activa</Tag> : <Tag variant="secondary">Retirada</Tag>}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button variant="ghost" size="sm" aria-label={`Editar la membresía ${p.name}`} onClick={() => setEditing(p)}>
                        Editar
                      </Button>
                      <Button variant="ghost" size="sm" aria-label={`Disciplinas de la membresía ${p.name}`} onClick={() => setChoosing(p)}>
                        Disciplinas
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
      {editing !== undefined && (
        <PlanSheet
          key={editing?.id ?? 'new'}
          p={editing}
          onClose={() => setEditing(undefined)}
          onChoose={(plan) => {
            setChoosing(plan)
            setEditing(undefined)
          }}
        />
      )}
      {choosing && <EligibleSheet key={choosing.id} p={choosing} all={disciplines.data ?? []} onClose={() => setChoosing(null)} />}
    </Page>
  )
}

const MAX_OPTIONS = ['1', '2', '3', '4']

function PlanSheet({ p, onClose, onChoose }: { p: Plan | null; onClose: () => void; onChoose: (p: Plan) => void }) {
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
    onSuccess: () => toastOk(p ? 'Membresía guardada' : 'Membresía creada'),
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
      title={p ? `Editar ${p.name}` : 'Nueva membresía'}
      description="El precio es el que paga el alumno cada mes, impuestos incluidos."
      submitLabel={priceChanged ? 'Cambiar el precio' : retiring ? 'Retirar' : p ? 'Guardar' : 'Crear la membresía'}
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
        hint="Impuestos incluidos. Con 0 € la membresía no se contrata por la pasarela."
        error={f.price && cents === null ? 'Escribe un importe como 30 o 29,90.' : fe.error('price_cents')}
      />
      <SelectField label="Cuántas disciplinas incluye">
        <Filter
          label="Cuántas disciplinas incluye"
          value={f.max}
          onChange={(v) => setF((x) => ({ ...x, max: v }))}
          items={[...new Set([...MAX_OPTIONS, f.max].filter((v) => v !== 'all'))].map((v) => ({ value: v, label: v })).concat({ value: 'all', label: 'Todas' })}
        />
        {p && <p className="text-xs text-muted-foreground">Con suscriptores, ni esto ni «solo menores» se pueden cambiar: crea otra membresía.</p>}
      </SelectField>
      <SwitchRow label="Solo menores" checked={f.minors_only} onChange={(v) => setF((x) => ({ ...x, minors_only: v }))} />
      {p && <SwitchRow label="Activa" hint="Una membresía retirada ya no se contrata." checked={f.is_active} onChange={(v) => setF((x) => ({ ...x, is_active: v }))} />}
      {p && (
        // Por debajo de `sm` la tarjeta solo abre esta hoja; la lista de elegibles se abre desde aquí. Cambiar de hoja descarta lo escrito.
        <div className="flex flex-col gap-1">
          <Button type="button" variant="outline" size="lg" disabled={Object.keys(diff).length > 0} onClick={() => onChoose(p)}>
            Elegir disciplinas
          </Button>
          {Object.keys(diff).length > 0 && <p className="text-xs text-muted-foreground">Guarda antes los cambios.</p>}
        </div>
      )}
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
          {p.max_disciplines !== null && ` · la membresía incluye ${p.max_disciplines}`}
        </legend>
        {shown.map((d) => (
          <label key={d.id} className="flex min-h-11 items-center gap-3 rounded-lg border px-3">
            <Checkbox
              checked={picked.includes(String(d.id))}
              onCheckedChange={(c) => setPicked((xs) => (c ? [...xs, String(d.id)] : xs.filter((x) => x !== String(d.id))))}
            />
            <span className="flex-1">{d.name}</span>
            {!d.is_active && <Tag variant="secondary">Desactivada</Tag>}
            {ageRangeLabel(d.min_age, d.max_age) && <Tag variant="info">{ageRangeLabel(d.min_age, d.max_age)}</Tag>}
          </label>
        ))}
      </fieldset>
    </FormSheet>
  )
}
