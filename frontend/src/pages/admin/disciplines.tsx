import { useMutation, useQuery } from '@tanstack/react-query'
import { BookOpenIcon, PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { Tag } from '@/components/billing-bits'
import { Medal } from '@/components/medal'
import { Page } from '@/components/page'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/screen-state'
import { Button } from '@/components/ui/button'
import { Radio, RadioGroup } from '@/components/ui/radio-group'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { toastManager } from '@/components/ui/toast'
import { api } from '@/lib/api'
import { toastOk } from '@/lib/notify'
import { plural } from '@/lib/professor'
import { medalOf } from '@/lib/progress'
import { THEMES, themeOf } from '@/lib/themes'
import type { Discipline } from '@/lib/types'
import { CardList, CardRow, Head, refreshCatalog } from '@/pages/admin/catalog-bits'
import { FormSheet, SwitchRow, TextField, useAdminDisciplines, useFieldError } from '@/pages/admin/schedule-bits'

// docs/pantallas-b22.md § Membresías y Disciplinas: una entrada propia del menú (antes, una pestaña de /admin/catalog).
export function AdminDisciplinesPage() {
  const list = useAdminDisciplines()
  const [editing, setEditing] = useState<Discipline | null | undefined>(undefined) // null = nueva
  return (
    <Page
      title="Disciplinas"
      wide
      actions={
        <Button size="lg" onClick={() => setEditing(null)}>
          <PlusIcon />
          Nueva disciplina
        </Button>
      }
    >
      {list.isPending ? (
        <ListSkeleton rows={5} className="h-14" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyState icon={<BookOpenIcon />} title="No hay disciplinas" text="Crea la primera con «Nueva disciplina»." />
      ) : (
        <>
          <CardList>
            {list.data.map((d) => (
              <CardRow
                key={d.id}
                name={d.name}
                active={d.is_active}
                activeLabel="Activa"
                inactiveLabel="Desactivada"
                lines={[`${d.minors_only ? 'Solo menores' : 'Todos'} · ${d.is_open ? 'abierta' : 'se elige en la cuota'}`, `Medallas: ${themeOf(d.medal_theme).series}`]}
                onOpen={() => setEditing(d)}
              />
            ))}
          </CardList>
          <div className="hidden overflow-x-auto rounded-2xl border bg-card sm:block">
            <Table>
              <Head cols={['Nombre', 'Quién', 'Reserva', 'Medallas', 'Estado', '']} />
              <TableBody>
                {list.data.map((d) => (
                  <TableRow key={d.id} className={d.is_active ? 'h-10' : 'h-10 text-muted-foreground'}>
                    <TableCell className="ps-4 font-medium">{d.name}</TableCell>
                    <TableCell>{d.minors_only ? <Tag variant="info">Solo menores</Tag> : 'Todos'}</TableCell>
                    <TableCell>{d.is_open ? <Tag variant="secondary">Abierta</Tag> : 'Se elige en la cuota'}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <Medal medal={medalOf(d.medal_theme ?? null, 'first_day')!} earned={d.is_active} className="size-7" />
                        {themeOf(d.medal_theme).series}
                      </span>
                    </TableCell>
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
        </>
      )}
      {editing !== undefined && <DisciplineSheet key={editing?.id ?? 'new'} d={editing} onClose={() => setEditing(undefined)} />}
    </Page>
  )
}

type DisciplineResult = { discipline: Discipline & { retired_classes?: number; cancelled_sessions?: number } }

function DisciplineSheet({ d, onClose }: { d: Discipline | null; onClose: () => void }) {
  const [f, setF] = useState({ name: d?.name ?? '', minors_only: d?.minors_only ?? false, is_open: d?.is_open ?? false, is_active: d?.is_active ?? true, medal_theme: d?.medal_theme ?? null })
  const fe = useFieldError()
  const body = { ...f, name: f.name.trim() }
  // PATCH: solo lo que cambia (sin nada, la API da empty_patch).
  const diff = d ? Object.fromEntries(Object.entries(body).filter(([k, v]) => v !== d[k as keyof Discipline])) : body
  const deactivating = !!d?.is_active && !f.is_active
  const save = useMutation({
    mutationFn: () => {
      fe.clear()
      return d ? api<DisciplineResult>(`/admin/disciplines/${d.id}`, { method: 'PATCH', body: diff }) : api<DisciplineResult>('/admin/disciplines', { method: 'POST', body: { name: body.name, minors_only: f.minors_only, is_open: f.is_open, medal_theme: f.medal_theme } })
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
      <ThemePicker id={d?.id} value={f.medal_theme} onChange={set('medal_theme')} />
    </FormSheet>
  )
}

type MedalTheme = { code: string; name: string; discipline_id: string | null }

// Temática de medallas (036): Kaizen, la suya y las libres (sin otra disciplina activa) que ya tienen arte. Cada
// opción enseña su primera medalla y su última de horas. Una temática solo está en una disciplina activa a la vez.
function ThemePicker({ id, value, onChange }: { id?: number | string; value: string | null; onChange: (v: string | null) => void }) {
  const themes = useQuery({ queryKey: ['admin', 'medal-themes'], queryFn: () => api<{ themes: MedalTheme[] }>('/admin/medal-themes').then((r) => r.themes) })
  const free = (themes.data ?? []).filter((t) => THEMES[t.code] && (t.discipline_id === null || String(t.discipline_id) === String(id) || t.code === value))
  const options = [{ code: '' }, ...free]
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-[15px] font-medium">Temática de medallas</legend>
      <p className="-mt-1 text-xs text-muted-foreground">Da nombre y arte a sus 11 medallas. Las que ya tiene otra disciplina activa no salen.</p>
      {themes.isPending ? (
        <ListSkeleton rows={3} className="h-16" />
      ) : (
        <RadioGroup value={value ?? ''} onValueChange={(v) => onChange((v as string) || null)} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {options.map((t) => {
            const first = medalOf(t.code || null, 'first_day')!
            const last = medalOf(t.code || null, 'hours_1000')!
            return (
              <label key={t.code} className="flex min-h-16 cursor-pointer items-center gap-3 rounded-xl border bg-card px-3 py-2 transition-colors has-data-checked:border-primary has-data-checked:bg-accent">
                <Radio value={t.code} />
                <Medal medal={first} earned className="size-11" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold">{t.code ? themeOf(t.code).series : 'Kaizen (sin temática)'}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {first.name} → {last.name}
                  </span>
                </span>
              </label>
            )
          })}
        </RadioGroup>
      )}
    </fieldset>
  )
}

