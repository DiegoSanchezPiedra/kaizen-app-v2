import { useMutation, useQuery } from '@tanstack/react-query'
import { EllipsisIcon, LayersIcon } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { Tag } from '@/components/billing-bits'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/screen-state'
import { Button } from '@/components/ui/button'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '@/components/ui/menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useMediaQuery } from '@/hooks/use-media-query'
import { api } from '@/lib/api'
import { madridDay } from '@/lib/dates'
import { formatShortDate } from '@/lib/format'
import { queryClient } from '@/lib/logout'
import { toastError, toastOk } from '@/lib/notify'
import { plural } from '@/lib/professor'
import { classState, groupByWeekday, WEEKDAYS, type AdminClass } from '@/lib/schedule'
import { path } from '@/lib/url'
import { cn } from '@/lib/utils'
import { Filter } from '@/pages/community'
import { FormSheet, SelectField, TextField, useAdminDisciplines, useTrainers } from '@/pages/admin/schedule-bits'

const cap = (w: string) => w[0].toUpperCase() + w.slice(1)
const refreshClasses = () => Promise.all(['classes', 'calendar'].map((k) => queryClient.invalidateQueries({ queryKey: k === 'classes' ? ['admin', 'classes'] : [k] })))
const intOf = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v) : NaN)
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

// docs/pantallas-b19.md § Horario › Clases: la tabla por día de la semana y hora, con la disciplina en la URL.
export function ClassesView({ creating, onClose }: { creating: boolean; onClose: () => void }) {
  const [params, setParams] = useSearchParams()
  const discipline = params.get('disciplina') ?? 'all'
  const disciplines = useAdminDisciplines()
  const [changing, setChanging] = useState<AdminClass | null>(null)
  const [retiring, setRetiring] = useState<AdminClass | null>(null)
  const today = madridDay()
  const wide = useMediaQuery('sm')
  const list = useQuery({
    queryKey: ['admin', 'classes', discipline],
    queryFn: () => api<{ classes: AdminClass[] }>(path('/admin/classes', { discipline_id: discipline === 'all' ? undefined : discipline })).then((r) => r.classes),
  })

  return (
    <>
      <div className="sm:w-64">
        <Filter
          label="Disciplina"
          value={discipline}
          onChange={(v) =>
            setParams(
              (p) => {
                const n = new URLSearchParams(p)
                if (v === 'all') n.delete('disciplina')
                else n.set('disciplina', v)
                return n
              },
              { replace: true },
            )
          }
          items={[{ value: 'all', label: 'Todas las disciplinas' }, ...(disciplines.data ?? []).map((d) => ({ value: String(d.id), label: d.name }))]}
        />
      </div>
      {list.isPending ? (
        <ListSkeleton rows={5} className="h-10" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyState icon={<LayersIcon />} title="No hay clases" text={discipline === 'all' ? 'Crea la primera con «Nueva clase».' : 'Esta disciplina no tiene clases.'} />
      ) : !wide ? (
        <div className="flex flex-col gap-5">
          {groupByWeekday(list.data).map(([weekday, classes]) => (
            <section key={weekday} aria-label={cap(WEEKDAYS[weekday - 1])} className="flex flex-col gap-2">
              <h3 className="px-0.5 text-[13px] font-bold tracking-wide text-muted-foreground uppercase">{WEEKDAYS[weekday - 1]}</h3>
              <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
                {classes.map((c) => {
                  const state = classState(c, today)
                  const what = `la clase de ${WEEKDAYS[c.weekday - 1]} a las ${c.start_time}`
                  return (
                    <li key={c.id} className={cn('flex min-h-14 items-start gap-x-4 py-2 ps-4 pe-4', state === 'retired' && 'text-muted-foreground')}>
                      <span className="w-14 shrink-0 tabular-nums">
                        <span className="block font-semibold">{c.start_time}</span>
                        <span className="block text-sm text-muted-foreground">{c.duration_min} min</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-x-3">
                          <span className="min-w-0 flex-1 font-semibold">{c.discipline_name}</span>
                          <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{plural(c.capacity, 'plaza', 'plazas')}</span>
                        </span>
                        <span className="block text-sm text-muted-foreground">{[c.trainer_name ?? 'Sin nombre', c.location].filter(Boolean).join(' · ')}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground tabular-nums">
                          {c.ends_on ? `${formatShortDate(c.starts_on)} – ${formatShortDate(c.ends_on)}` : `Desde ${formatShortDate(c.starts_on)}`}
                          {state === 'retired' && <Tag variant="secondary">Retirada</Tag>}
                          {state === 'ending' && <Tag variant="warning">Se retira</Tag>}
                        </span>
                      </span>
                      {state !== 'retired' && (
                        <Menu>
                          <MenuTrigger render={<Button variant="ghost" size="icon-xl" className="-my-1 -me-3" aria-label={`Acciones de ${what}`} />}>
                            <EllipsisIcon />
                          </MenuTrigger>
                          <MenuPopup align="end">
                            <MenuItem aria-label={`Cambiar ${what}`} onClick={() => setChanging(c)}>
                              Cambiar
                            </MenuItem>
                            {state === 'active' && (
                              <MenuItem aria-label={`Retirar ${what}`} onClick={() => setRetiring(c)}>
                                Retirar
                              </MenuItem>
                            )}
                          </MenuPopup>
                        </Menu>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <Table>
            <TableHeader className="sticky top-0 bg-card">
              <TableRow>
                {['Día', 'Hora', 'Disciplina', 'Profesor', 'Aforo', 'Lugar', 'Desde', 'Hasta', ''].map((h, i) => (
                  <TableHead key={h || 'acciones'} className={i ? undefined : 'ps-4'}>
                    {h || <span className="sr-only">Acciones</span>}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.map((c) => {
                const state = classState(c, today)
                return (
                  <TableRow key={c.id} className={state === 'retired' ? 'h-10 text-muted-foreground' : 'h-10'}>
                    <TableCell className="ps-4 first-letter:uppercase">{WEEKDAYS[c.weekday - 1]}</TableCell>
                    <TableCell className="tabular-nums whitespace-nowrap">
                      <span className="font-medium">{c.start_time}</span> <span className="text-muted-foreground">· {c.duration_min} min</span>
                    </TableCell>
                    <TableCell className="max-w-36 truncate font-medium" title={c.discipline_name}>
                      {c.discipline_name}
                    </TableCell>
                    <TableCell className="max-w-36 truncate" title={c.trainer_name ?? undefined}>
                      {c.trainer_name ?? 'Sin nombre'}
                    </TableCell>
                    <TableCell className="tabular-nums">{c.capacity}</TableCell>
                    <TableCell>{c.location ?? '—'}</TableCell>
                    <TableCell className="tabular-nums">{formatShortDate(c.starts_on)}</TableCell>
                    <TableCell className="tabular-nums">
                      {c.ends_on ? formatShortDate(c.ends_on) : '—'} {state === 'retired' && <Tag variant="secondary">Retirada</Tag>}
                      {state === 'ending' && <Tag variant="warning">Se retira</Tag>}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {state !== 'retired' && (
                        <>
                          <Button variant="ghost" size="sm" aria-label={`Cambiar la clase de ${WEEKDAYS[c.weekday - 1]} a las ${c.start_time}`} onClick={() => setChanging(c)}>
                            Cambiar
                          </Button>
                          {state === 'active' && (
                            <Button variant="ghost" size="sm" aria-label={`Retirar la clase de ${WEEKDAYS[c.weekday - 1]} a las ${c.start_time}`} onClick={() => setRetiring(c)}>
                              Retirar
                            </Button>
                          )}
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <CreateClass open={creating} onClose={onClose} />
      {changing && <ChangeClass key={changing.id} c={changing} onClose={() => setChanging(null)} />}
      {retiring && <RetireClass key={retiring.id} c={retiring} onClose={() => setRetiring(null)} />}
    </>
  )
}

// ── Crear ────────────────────────────────────────────────────────────────────

function CreateClass({ open, onClose }: { open: boolean; onClose: () => void }) {
  const disciplines = useAdminDisciplines()
  const trainers = useTrainers()
  const blank = { discipline: 'none', trainer: 'none', weekday: '1', time: '', duration: '60', capacity: '20', location: '', starts_on: '', ends_on: '' }
  const [f, setF] = useState(blank)
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }))
  const dates = (!f.starts_on || DAY_RE.test(f.starts_on)) && (!f.ends_on || (DAY_RE.test(f.ends_on) && f.ends_on >= (f.starts_on || f.ends_on)))
  const ready = f.discipline !== 'none' && f.trainer !== 'none' && TIME_RE.test(f.time) && intOf(f.duration) >= 1 && intOf(f.capacity) >= 1 && dates
  const create = useMutation({
    mutationFn: () =>
      api<{ class: { sessions_created: number } }>('/admin/classes', {
        method: 'POST',
        body: {
          discipline_id: f.discipline,
          trainer_id: f.trainer,
          weekday: intOf(f.weekday),
          start_time: f.time,
          duration_min: intOf(f.duration),
          capacity: intOf(f.capacity),
          location: f.location.trim() || undefined,
          starts_on: f.starts_on || undefined,
          ends_on: f.ends_on || undefined,
        },
      }),
    onSuccess: (r) => {
      toastOk('Clase creada', `${plural(r.class.sessions_created, 'sesión generada', 'sesiones generadas')}`)
      setF(blank)
    },
    onError: (err) => toastError(err),
    onSettled: () => void refreshClasses(),
  })
  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title="Nueva clase"
      description="Una clase se repite cada semana: genera sus sesiones para el próximo año."
      submitLabel="Crear la clase"
      disabled={!ready}
      loading={create.isPending}
      onSubmit={() => create.mutateAsync()}
    >
      <SelectField label="Disciplina">
        <Filter
          label="Disciplina"
          value={f.discipline}
          onChange={set('discipline')}
          items={[{ value: 'none', label: 'Elige una disciplina' }, ...(disciplines.data ?? []).filter((d) => d.is_active).map((d) => ({ value: String(d.id), label: d.name }))]}
        />
      </SelectField>
      <SelectField label="Profesor">
        <Filter label="Profesor" value={f.trainer} onChange={set('trainer')} items={[{ value: 'none', label: 'Elige un profesor' }, ...(trainers.data ?? []).map((t) => ({ value: t.id, label: t.display_name ?? 'Sin nombre' }))]} />
      </SelectField>
      <div className="grid grid-cols-2 gap-3">
        <SelectField label="Día de la semana">
          <Filter label="Día de la semana" value={f.weekday} onChange={set('weekday')} items={WEEKDAYS.map((d, i) => ({ value: String(i + 1), label: d[0].toUpperCase() + d.slice(1) }))} />
        </SelectField>
        <TextField label="Hora" type="time" value={f.time} onChange={set('time')} hint="Hora de Madrid" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Duración (min)" type="number" min={1} value={f.duration} onChange={set('duration')} />
        <TextField label="Aforo" type="number" min={1} value={f.capacity} onChange={set('capacity')} />
      </div>
      <TextField label="Lugar (opcional)" value={f.location} maxLength={100} onChange={set('location')} />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Desde (opcional)" type="date" value={f.starts_on} onChange={set('starts_on')} hint="Por defecto, hoy" />
        <TextField label="Hasta (opcional)" type="date" value={f.ends_on} onChange={set('ends_on')} hint="Por defecto, sin fin" />
      </div>
    </FormSheet>
  )
}

// ── Cambiar ──────────────────────────────────────────────────────────────────

function ChangeClass({ c, onClose }: { c: AdminClass; onClose: () => void }) {
  const trainers = useTrainers()
  const today = madridDay()
  const initial = { trainer: c.trainer_id, time: c.start_time, duration: String(c.duration_min), capacity: String(c.capacity), location: c.location ?? '' }
  const [f, setF] = useState({ ...initial, from: today })
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }))
  const patch = {
    ...(f.trainer !== initial.trainer && { trainer_id: f.trainer }),
    ...(f.time !== initial.time && { start_time: f.time }),
    ...(f.duration !== initial.duration && { duration_min: intOf(f.duration) }),
    ...(f.capacity !== initial.capacity && { capacity: intOf(f.capacity) }),
    ...(f.location.trim() !== initial.location && { location: f.location.trim() }),
  }
  const valid = DAY_RE.test(f.from) && f.from >= today && TIME_RE.test(f.time) && intOf(f.duration) >= 1 && intOf(f.capacity) >= 1
  const change = useMutation({
    mutationFn: () => api<{ sessions_changed: number; notified: number; promoted: number }>(`/admin/classes/${c.id}`, { method: 'PATCH', body: { from: f.from, ...patch } }),
    onSuccess: (r) =>
      toastOk('Clase cambiada', `${plural(r.sessions_changed, 'sesión cambiada', 'sesiones cambiadas')} · ${plural(r.notified, 'aviso', 'avisos')} · ${plural(r.promoted, 'pasa', 'pasan')} de la espera`),
    onError: (err) => toastError(err),
    onSettled: () => void refreshClasses(),
  })
  return (
    <FormSheet
      open
      onClose={onClose}
      title="Cambiar la clase"
      description={`${cap(WEEKDAYS[c.weekday - 1])} a las ${c.start_time} · ${c.discipline_name}. Cambia las sesiones desde la fecha que elijas; no cambia el pasado ni los campos ajustados de cada sesión.`}
      submitLabel="Guardar el cambio"
      disabled={Object.keys(patch).length === 0 || !valid}
      loading={change.isPending}
      confirm={{
        title: '¿Guardar el cambio?',
        description: `Cambia las sesiones desde el ${valid ? formatShortDate(`${f.from}T12:00:00Z`) : 'día elegido'} y se avisa a quien tenga reserva. Un aforo mayor pasa a quien esté en la espera.`,
      }}
      onSubmit={() => change.mutateAsync()}
    >
      <TextField label="Desde qué fecha" type="date" value={f.from} min={today} onChange={set('from')} />
      <SelectField label="Profesor">
        <Filter label="Profesor" value={f.trainer} onChange={set('trainer')} items={(trainers.data ?? [{ id: c.trainer_id, display_name: c.trainer_name }]).map((t) => ({ value: t.id, label: t.display_name ?? 'Sin nombre' }))} />
      </SelectField>
      <TextField label="Hora" type="time" value={f.time} onChange={set('time')} hint="Hora de Madrid" />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Duración (min)" type="number" min={1} value={f.duration} onChange={set('duration')} />
        <TextField label="Aforo" type="number" min={1} value={f.capacity} onChange={set('capacity')} />
      </div>
      <TextField label="Lugar" value={f.location} maxLength={100} onChange={set('location')} />
    </FormSheet>
  )
}

// ── Retirar ──────────────────────────────────────────────────────────────────

function RetireClass({ c, onClose }: { c: AdminClass; onClose: () => void }) {
  const today = madridDay()
  const [date, setDate] = useState(today)
  const retire = useMutation({
    mutationFn: () => api<{ class: { cancelled_sessions: number } }>(`/admin/classes/${c.id}/retire`, { method: 'POST', body: { date } }),
    onSuccess: (r) => toastOk('Clase retirada', plural(r.class.cancelled_sessions, 'sesión cancelada', 'sesiones canceladas')),
    onError: (err) => toastError(err),
    onSettled: () => {
      onClose()
      void refreshClasses()
    },
  })
  const valid = DAY_RE.test(date) && date >= today
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && !retire.isPending && onClose()}
      title="¿Retirar la clase?"
      description={`${cap(WEEKDAYS[c.weekday - 1])} a las ${c.start_time} · ${c.discipline_name}. Cancela sus sesiones desde esa fecha y avisa a quien tenía reserva. Las anteriores se quedan como están.`}
      confirmLabel="Retirar la clase"
      disabled={!valid}
      loading={retire.isPending}
      onConfirm={() => retire.mutate()}
    >
      <TextField label="Retirar desde" type="date" value={date} min={today} onChange={setDate} />
    </ConfirmDialog>
  )
}
