import { useMutation } from '@tanstack/react-query'
import { BookOpenIcon, PlusIcon, StarIcon } from 'lucide-react'
import { useState } from 'react'
import { Tag } from '@/components/billing-bits'
import { Page } from '@/components/page'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/screen-state'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { api, ApiError } from '@/lib/api'
import { ageOf, ageRangeLabel, centsToEuros, eligibleLabel, eurosToCents, maxDisciplinesLabel } from '@/lib/catalog'
import { formatEuros } from '@/lib/format'
import { toastError, toastOk } from '@/lib/notify'
import { plural } from '@/lib/professor'
import type { Discipline, Plan } from '@/lib/types'
import { CatalogRow, CatalogRows, CatalogTable, Head, refreshCatalog, StateTag } from '@/pages/admin/catalog-bits'
import { useAdminPlans } from '@/lib/queries'
import { FormSheet, SelectField, SwitchRow, TextField, useAdminDisciplines, useFieldError } from '@/pages/admin/schedule-bits'
import { Filter } from '@/components/filter'

const Featured = () => (
  <Tag variant="info">
    <StarIcon aria-hidden="true" />
    Recomendada
  </Tag>
)
const includes = (p: Plan) => (p.max_disciplines === null ? 'Todas las disciplinas' : plural(p.max_disciplines, 'disciplina', 'disciplinas'))

// Un «plan» de la API es una «membresía» en el panel; el alumno sigue viendo «plan» y «cuota». docs/pantallas-b22.md § Membresías y Disciplinas.
export function AdminMembershipsPage() {
  const list = useAdminPlans()
  const disciplines = useAdminDisciplines()
  const [editing, setEditing] = useState<Plan | null | undefined>(undefined)
  const [choosing, setChoosing] = useState<Plan | null>(null)
  const eligible = (p: Plan) => eligibleLabel(p.eligible_discipline_ids, disciplines.data ?? [], p.max_disciplines)
  return (
    <Page
      title="Membresías"
      wide
      actions={
        <Button size="lg" onClick={() => setEditing(null)}>
          <PlusIcon />
          {/* A 375 «Nueva membresía» desborda la cabecera 4 px: «Nueva» a la vista, el nombre entero para el lector. */}
          Nueva<span className="max-sm:sr-only"> membresía</span>
        </Button>
      }
    >
      <p className="-mt-2 text-sm text-muted-foreground">Precios al mes, impuestos incluidos.</p>
      {list.isPending ? (
        <ListSkeleton rows={4} className="h-16 xl:h-11" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyState icon={<BookOpenIcon />} title="No hay membresías" text="Crea la primera con «Nueva membresía»." />
      ) : (
        <>
          <CatalogRows>
            {list.data.map((p) => (
              <CatalogRow
                key={p.id}
                name={p.name}
                active={p.is_active}
                off="Retirada"
                marks={p.is_featured && <Featured />}
                lines={[
                  <span key="precio">
                    <span className="font-medium text-foreground tabular-nums">{formatEuros(p.price_cents)}</span>
                    {[includes(p), ageRangeLabel(p.min_age, p.max_age)?.toLowerCase()].filter(Boolean).map((t) => ` · ${t}`).join('')}
                  </span>,
                  // «Todas las disciplinas» sin elegibles ya lo dice todo: sin segunda línea.
                  ...(p.max_disciplines === null && !p.eligible_discipline_ids.length ? [] : [eligible(p)]),
                ]}
                onOpen={() => setEditing(p)}
              />
            ))}
          </CatalogRows>
          <CatalogTable>
            <Table>
              <Head cols={['Membresía', 'Precio', 'Incluye', 'Elegibles', 'Edad', 'Estado', '']} end={[1]} />
              <TableBody>
                {list.data.map((p) => (
                  <TableRow key={p.id} className={p.is_active ? undefined : 'text-muted-foreground'}>
                    <TableCell className="ps-4 font-medium whitespace-normal">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {p.name}
                        {p.is_featured && <Featured />}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatEuros(p.price_cents)}</TableCell>
                    <TableCell>{maxDisciplinesLabel(p.max_disciplines)}</TableCell>
                    <TableCell className="min-w-40 whitespace-normal">
                      {eligible(p)}
                    </TableCell>
                    <TableCell>{ageRangeLabel(p.min_age, p.max_age) ?? 'Todas'}</TableCell>
                    <TableCell>
                      <StateTag active={p.is_active} off="Retirada" />
                    </TableCell>
                    <TableCell className="pe-2 text-right">
                      <Button variant="ghost" size="sm" className="h-11 sm:h-11" aria-label={`Editar la membresía ${p.name}`} onClick={() => setEditing(p)}>
                        Editar
                      </Button>
                      <Button variant="ghost" size="sm" className="h-11 sm:h-11" aria-label={`Disciplinas de la membresía ${p.name}`} onClick={() => setChoosing(p)}>
                        Disciplinas
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CatalogTable>
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
const LOCKED = 'Con suscriptores no se cambia.'

function PlanSheet({ p, onClose, onChoose }: { p: Plan | null; onClose: () => void; onChoose: (p: Plan) => void }) {
  const [f, setF] = useState({
    name: p?.name ?? '',
    price: p ? centsToEuros(p.price_cents) : '',
    max: p ? String(p.max_disciplines ?? 'all') : '1',
    min_age: p?.min_age == null ? '' : String(p.min_age),
    max_age: p?.max_age == null ? '' : String(p.max_age),
    is_active: p?.is_active ?? true,
    is_featured: p?.is_featured ?? false,
  })
  // 409 plan_has_subscriptions: los campos que la API no deja cambiar (`fields`); sin ellos, es la bajada a 0 €.
  const [locked, setLocked] = useState<string[]>([])
  const fe = useFieldError()
  const cents = eurosToCents(f.price)
  const max = f.max === 'all' ? null : Number(f.max)
  const minAge = ageOf(f.min_age)
  const maxAge = ageOf(f.max_age)
  const crossed = minAge != null && maxAge != null && minAge > maxAge
  const priceChanged = !!p && cents !== null && cents !== p.price_cents
  const retiring = !!p?.is_active && !f.is_active
  const body = { name: f.name.trim(), price_cents: cents, max_disciplines: max, min_age: minAge ?? null, max_age: maxAge ?? null, is_active: f.is_active, is_featured: f.is_featured }
  const diff = p ? Object.fromEntries(Object.entries(body).filter(([k, v]) => v !== p[k as keyof Plan])) : body
  const save = useMutation({
    mutationFn: () => {
      fe.clear()
      setLocked([])
      return p ? api(`/admin/plans/${p.id}`, { method: 'PATCH', body: diff }) : api('/admin/plans', { method: 'POST', body })
    },
    onSuccess: () => toastOk(p ? 'Membresía guardada' : 'Membresía creada'),
    onError: (err) => {
      if (!(err instanceof ApiError && err.code === 'plan_has_subscriptions')) return fe.fail(err)
      const fields = err.details.fields
      setLocked(Array.isArray(fields) && fields.length ? fields.map(String) : ['price_cents'])
    },
    onSettled: () => void refreshCatalog(),
  })
  const lockedError = (k: string) => (locked.includes(k) ? (k === 'price_cents' ? 'Tiene suscriptores: no puede bajar a 0 €.' : LOCKED) : undefined)
  // Lo que pasa a quien ya tiene el plan y a quién se avisa (docs/pantallas-b19.md § Catálogo). La API no manda avisos aquí.
  const effects = [
    priceChanged && 'El nuevo precio se aplica a todos sus suscriptores desde su siguiente cobro, sin cobrar la diferencia.',
    retiring && 'Ya no se contrata; las suscripciones siguen igual.',
    'La app no avisa a los suscriptores.',
  ].filter((e): e is string => !!e)
  return (
    <FormSheet
      open
      onClose={onClose}
      title={p ? `Editar ${p.name}` : 'Nueva membresía'}
      description="El precio es el que paga el alumno cada mes, impuestos incluidos."
      submitLabel={priceChanged ? 'Cambiar el precio' : retiring ? 'Retirar' : p ? 'Guardar' : 'Crear la membresía'}
      disabled={!body.name || body.name.length > 100 || cents === null || minAge === undefined || maxAge === undefined || crossed || (!!p && Object.keys(diff).length === 0)}
      loading={save.isPending}
      confirm={priceChanged || retiring ? { title: priceChanged ? `¿Cambiar el precio de ${p!.name}?` : `¿Retirar ${p!.name}?`, description: effects.join(' ') } : undefined}
      onSubmit={() => save.mutateAsync()}
    >
      <TextField label="Nombre" value={f.name} onChange={(v) => setF((x) => ({ ...x, name: v }))} maxLength={100} error={fe.error('name')} />
      <TextField
        label="Precio al mes (€)"
        value={f.price}
        onChange={(v) => setF((x) => ({ ...x, price: v }))}
        inputMode="decimal"
        hint="Impuestos incluidos. Con 0 € la membresía no se contrata por la pasarela."
        error={f.price && cents === null ? 'Escribe un importe como 30 o 29,90.' : (lockedError('price_cents') ?? fe.error('price_cents'))}
      />
      <SelectField label="Cuántas disciplinas incluye">
        <Filter
          label="Cuántas disciplinas incluye"
          value={f.max}
          onChange={(v) => setF((x) => ({ ...x, max: v }))}
          items={[...new Set([...MAX_OPTIONS, f.max].filter((v) => v !== 'all'))].map((v) => ({ value: v, label: v })).concat({ value: 'all', label: 'Todas' })}
        />
        {lockedError('max_disciplines') ? (
          <p role="alert" className="text-xs text-destructive-foreground">
            {LOCKED}
          </p>
        ) : (
          p && <p className="text-xs text-muted-foreground">Con suscriptores, ni esto ni la edad se pueden cambiar: crea otra membresía.</p>
        )}
      </SelectField>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Edad mínima" inputMode="numeric" value={f.min_age} onChange={(v) => setF((x) => ({ ...x, min_age: v }))} error={minAge === undefined ? 'Escribe un entero de 0 a 99.' : (lockedError('min_age') ?? fe.error('min_age'))} />
        <TextField
          label="Edad máxima"
          inputMode="numeric"
          value={f.max_age}
          onChange={(v) => setF((x) => ({ ...x, max_age: v }))}
          error={maxAge === undefined ? 'Escribe un entero de 0 a 99.' : crossed ? 'No puede ser menor que la mínima.' : (lockedError('max_age') ?? fe.error('max_age'))}
        />
      </div>
      <p className="-mt-1 text-xs text-muted-foreground">Vacío: sin límite. Al contratar cuentan la mínima y la máxima; quien después supera la máxima deja de estar cubierto.</p>
      {p && <SwitchRow label="Activa" hint="Una membresía retirada ya no se contrata." checked={f.is_active} onChange={(v) => setF((x) => ({ ...x, is_active: v }))} />}
      <SwitchRow
        label="Recomendada"
        hint="Sale destacada al contratar. Solo hay una: marcar esta quita la marca de la otra."
        checked={f.is_featured}
        onChange={(v) => setF((x) => ({ ...x, is_featured: v }))}
      />
      {p && (
        // Por debajo de `xl` la fila solo abre esta hoja; la lista de elegibles se abre desde aquí. Cambiar de hoja descarta lo escrito.
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
          {picked.length ? `${p.max_disciplines === null ? 'Incluye' : `Elige ${p.max_disciplines} entre`} ${plural(picked.length, 'marcada', 'marcadas')}` : 'Todas las activas que permita la edad'}
        </legend>
        {shown.map((d) => (
          <label key={d.id} className="flex min-h-11 items-center gap-3 rounded-lg border px-3">
            <Checkbox
              checked={picked.includes(String(d.id))}
              onCheckedChange={(c) => setPicked((xs) => (c ? [...xs, String(d.id)] : xs.filter((x) => x !== String(d.id))))}
            />
            <span className="flex-1">{d.name}</span>
            {!d.is_active && <StateTag active={false} off="Desactivada" />}
            {ageRangeLabel(d.min_age, d.max_age) && <Tag variant="info">{ageRangeLabel(d.min_age, d.max_age)}</Tag>}
          </label>
        ))}
      </fieldset>
    </FormSheet>
  )
}
