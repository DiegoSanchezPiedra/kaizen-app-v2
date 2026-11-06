import { useMutation, useQuery } from '@tanstack/react-query'
import { BanIcon, UsersIcon } from 'lucide-react'
import { useState } from 'react'
import type React from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { attKey, AttendanceItem, CorrectDialog, useCloseList } from '@/components/attendance'
import { Back, Kv, Tag } from '@/components/billing-bits'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Page } from '@/components/page'
import { SessionRow, SessionRows } from '@/components/session-row'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/screen-state'
import { Button } from '@/components/ui/button'
import { Combobox, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList, ComboboxPopup } from '@/components/ui/combobox'
import { Textarea } from '@/components/ui/textarea'
import { WeekBoard } from '@/components/week-board'
import { useNow } from '@/hooks/use-now'
import { useWeek } from '@/hooks/use-week'
import { type Paged, type ProfileRow } from '@/lib/admin'
import { api, ApiError } from '@/lib/api'
import { formatDay, madridDay } from '@/lib/dates'
import { formatDeadline, formatTime } from '@/lib/format'
import { queryClient } from '@/lib/logout'
import { toastError, toastOk } from '@/lib/notify'
import { isClosed, plural, presentCount, unmarked, type Attendance, type AttendanceRow } from '@/lib/professor'
import {
  adjustedFields,
  canAdjust,
  canRestore,
  classValue,
  FIELD_LABEL,
  fieldValue,
  isRetroactive,
  looseErrors,
  madridToIso,
  weekRange,
  type AdminSession,
  type Field,
  type SessionBooking,
} from '@/lib/schedule'
import { groupByDay } from '@/lib/sessions'
import type { CalendarSession } from '@/lib/types'
import { path } from '@/lib/url'
import { cn } from '@/lib/utils'
import { Filter, useDebounced } from '@/pages/community'
import { FormSheet, SelectField, TextField, useAdminDisciplines, useTrainers } from '@/pages/admin/schedule-bits'
import { useConfirm } from '@/pages/admin/user-billing'

const name = (p: { display_name: string | null } | undefined) => p?.display_name ?? 'Sin nombre'
const userLink = 'font-medium text-link underline-offset-3 hover:underline'

const refreshSchedule = (id?: string) =>
  Promise.all([['calendar'], ['admin', 'session'], ...(id ? [attKey(id)] : [])].map((queryKey) => queryClient.invalidateQueries({ queryKey })))

// Programada, cancelada o celebrada. Los ajustes solo se ven en el detalle: el calendario no los da.
function StateTag({ s }: { s: Pick<CalendarSession, 'status' | 'held'> }) {
  return s.status === 'cancelled' ? <Tag variant="error">Cancelada</Tag> : s.held ? <Tag variant="success">Celebrada</Tag> : <Tag>Programada</Tag>
}

// ── Semana ───────────────────────────────────────────────────────────────────

// docs/pantallas-b19.md § Horario › Sesiones y docs/pantallas-b22.md § Calendario semanal: la semana, el día y la
// disciplina viven en la URL.
export function WeekView({ creating, onClose }: { creating: boolean; onClose: () => void }) {
  const [params, setParams] = useSearchParams()
  const w = useWeek()
  const discipline = params.get('disciplina') ?? 'all'
  const { from, to } = weekRange(w.week)
  const disciplines = useAdminDisciplines()

  const setDiscipline = (v: string) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        if (v !== 'all') n.set('disciplina', v)
        else n.delete('disciplina')
        return n
      },
      { replace: true },
    )
  const calendar = useQuery({
    queryKey: ['calendar', 'admin', from, discipline],
    queryFn: () =>
      api<{ sessions: CalendarSession[] }>(path('/sessions/calendar', { from, to, discipline_id: discipline === 'all' ? undefined : discipline })).then((r) => r.sessions),
  })
  const byDay = new Map(groupByDay(calendar.data ?? [], (s) => s.starts_at))

  return (
    <>
      <div className="sm:w-56">
        <Filter
          label="Disciplina"
          value={discipline}
          onChange={setDiscipline}
          items={[{ value: 'all', label: 'Todas las disciplinas' }, ...(disciplines.data ?? []).map((d) => ({ value: String(d.id), label: d.name }))]}
        />
      </div>
      <WeekBoard
        w={w}
        query={calendar}
        marked={new Set(byDay.keys())}
        top="top-14"
        renderDay={(day) => (
          <SessionRows>
            {(byDay.get(day) ?? []).map((s) => (
              <SessionRow
                key={s.id}
                to={`/admin/sessions/${s.id}`}
                start={s.starts_at}
                end={s.ends_at}
                title={s.discipline.name}
                meta={[s.trainer ? name(s.trainer) : 'Sin profesor', s.location].filter(Boolean).join(' · ')}
                off={s.status === 'cancelled'}
                aside={
                  <>
                    <StateTag s={s} />
                    <span className="text-sm text-muted-foreground tabular-nums">{plural(s.capacity, 'plaza', 'plazas')}</span>
                  </>
                }
              />
            ))}
          </SessionRows>
        )}
      />
      <LooseSession open={creating} onClose={onClose} defaultDay={w.day} onCreated={w.pick} />
    </>
  )
}

// ── Sesión suelta ────────────────────────────────────────────────────────────

const intOf = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v) : NaN)

// «Clase suelta» en la interfaz; en el código y en `CONTEXT.md`, sesión suelta. El día sale del elegido en la tira.
function LooseSession({ open, onClose, defaultDay, onCreated }: { open: boolean; onClose: () => void; defaultDay: string; onCreated: (day: string) => void }) {
  const now = useNow()
  const disciplines = useAdminDisciplines()
  const trainers = useTrainers()
  const blank = { discipline: 'none', trainer: 'none', day: null as string | null, time: '', duration: '60', capacity: '20', location: '' }
  const [draft, setF] = useState(blank)
  // Mientras no se toque el día, vale el de la tira (si no ha pasado).
  const f = { ...draft, day: draft.day ?? (defaultDay >= madridDay() ? defaultDay : '') }
  const [seen, setSeen] = useState<Set<string>>(new Set())
  const [tried, setTried] = useState(false)
  const [server, setServer] = useState<{ field: 'trainer' | 'time'; text: string } | null>(null)
  const set = (k: keyof typeof f) => (v: string) => {
    setF((x) => ({ ...x, [k]: v }))
    setServer(null)
  }
  const errors = looseErrors(f, now)
  const shown = (k: keyof typeof errors) => (tried || seen.has(k) ? errors[k] : undefined) ?? (server?.field === k ? server.text : undefined)
  const touch = (k: string) => () => setSeen((x) => new Set(x).add(k))
  const create = useMutation({
    mutationFn: () =>
      api<{ session: { id: string } }>('/admin/sessions', {
        method: 'POST',
        body: {
          discipline_id: f.discipline,
          trainer_id: f.trainer,
          starts_at: madridToIso(f.day, f.time),
          duration_min: intOf(f.duration),
          capacity: intOf(f.capacity),
          location: f.location.trim() || undefined,
        },
      }),
    onSuccess: () => {
      toastOk('Clase suelta creada', 'Ya se puede reservar.')
      setF(blank)
      setSeen(new Set())
      setTried(false)
      onCreated(f.day)
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'trainer_overlap') setServer({ field: 'trainer', text: 'Ese profesor ya imparte otra sesión a esa hora.' })
      else if (err instanceof ApiError && err.code === 'invalid_field' && err.field === 'starts_at') setServer({ field: 'time', text: 'Revisa la fecha y la hora.' })
      else toastError(err)
    },
    onSettled: () => void refreshSchedule(),
  })
  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title="Clase suelta"
      description="Una clase puntual: no se repite ni sale de una clase semanal."
      submitLabel="Crear la clase"
      loading={create.isPending}
      onSubmit={() => {
        if (Object.keys(errors).length) {
          setTried(true)
          return Promise.reject(new Error('invalid'))
        }
        return create.mutateAsync()
      }}
    >
      <SelectField label="Disciplina" error={shown('discipline')}>
        <Filter
          label="Disciplina"
          value={f.discipline}
          onChange={set('discipline')}
          items={[{ value: 'none', label: 'Elige una disciplina' }, ...(disciplines.data ?? []).filter((d) => d.is_active).map((d) => ({ value: String(d.id), label: d.name }))]}
        />
      </SelectField>
      <SelectField label="Profesor" error={shown('trainer')}>
        <Filter label="Profesor" value={f.trainer} onChange={set('trainer')} items={[{ value: 'none', label: 'Elige un profesor' }, ...(trainers.data ?? []).map((t) => ({ value: t.id, label: name(t) }))]} />
      </SelectField>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Día" type="date" value={f.day} onChange={set('day')} onBlur={touch('day')} error={shown('day')} />
        <TextField label="Hora" type="time" value={f.time} onChange={set('time')} onBlur={touch('time')} error={shown('time')} hint="Hora de Madrid" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Duración (min)" type="number" min={1} value={f.duration} onChange={set('duration')} onBlur={touch('duration')} error={shown('duration')} />
        <TextField label="Aforo" type="number" min={1} value={f.capacity} onChange={set('capacity')} onBlur={touch('capacity')} error={shown('capacity')} />
      </div>
      <TextField label="Lugar (opcional)" value={f.location} maxLength={100} onChange={set('location')} />
    </FormSheet>
  )
}

// ── Detalle ──────────────────────────────────────────────────────────────────

type Detail = { session: AdminSession; bookings: SessionBooking[] }

export function AdminSessionPage() {
  const { id = '' } = useParams()
  const query = useQuery({ queryKey: ['admin', 'session', id], queryFn: () => api<Detail>(`/admin/sessions/${id}`) })
  if (query.isPending) {
    return (
      <Page title="Sesión" wide>
        <ListSkeleton rows={3} />
      </Page>
    )
  }
  if (query.isError) {
    return (
      <Page title="Sesión" wide>
        <Back to="/admin/sessions">Horario</Back>
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Page>
    )
  }
  return <SessionDetail key={id} {...query.data} />
}

function SessionDetail({ session: s, bookings }: Detail) {
  const now = useNow()
  const trainers = useTrainers()
  const [adjusting, setAdjusting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const { ask, dialog } = useConfirm(() => void refreshSchedule(s.id))
  const day = madridDay(s.starts_at)
  const marked = adjustedFields(s)
  const started = isRetroactive(s, now)
  const trainerName = (tid: string) => trainers.data?.find((t) => t.id === tid)?.display_name ?? undefined
  const confirmed = bookings.filter((b) => b.status === 'confirmed')
  const waiting = bookings.filter((b) => b.status === 'waitlisted')

  const when = `${formatDay(day)} · ${formatTime(s.starts_at)}–${formatTime(s.ends_at)}`
  const rows: [string, React.ReactNode][] = [
    ['Disciplina', s.discipline.name],
    ...(['trainer_id', 'starts_at', 'duration_min', 'capacity', 'location'] as Field[]).map((f): [string, React.ReactNode] => {
      const isAdjusted = marked.includes(f)
      const shown = f === 'starts_at' ? when : fieldValue(s, f)
      const theirs = isAdjusted ? classValue(s, f, trainerName(s.class_values!.trainer_id)) : null
      return [
        FIELD_LABEL[f],
        <span key={f} className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
          <span className={f === 'starts_at' ? 'first-letter:uppercase' : undefined}>{shown}</span>
          {isAdjusted && (
            <>
              <Tag variant="info">Ajustado</Tag>
              <span className="text-xs font-normal text-muted-foreground">{theirs ? `La clase dice: ${theirs}` : 'La clase dice otro profesor'}</span>
              {canAdjust(s, now) && (
                <Button
                  size="xs"
                  variant="ghost"
                  aria-label={`Deshacer el ajuste: ${FIELD_LABEL[f]}`}
                  onClick={() =>
                    ask({
                      title: `¿Deshacer el ajuste de «${FIELD_LABEL[f].toLowerCase()}»?`,
                      description: `${FIELD_LABEL[f]} vuelve a lo que dice la clase${theirs ? ` (${theirs})` : ''}. Se avisa a quien tenga reserva.`,
                      label: 'Deshacer el ajuste',
                      done: (r: { notified: number; promoted: number }) => `Ajuste deshecho · ${plural(r.notified, 'aviso', 'avisos')}, ${plural(r.promoted, 'pasa', 'pasan')} de la espera`,
                      run: () => api(`/admin/sessions/${s.id}/reset`, { method: 'POST', body: { fields: [f] } }),
                    })
                  }
                >
                  Deshacer
                </Button>
              )}
            </>
          )}
        </span>,
      ]
    }),
  ]

  return (
    <Page title={s.discipline.name} wide actions={<StateTag s={s} />}>
      <Back to={`/admin/sessions?dia=${day}`}>Horario</Back>
      {s.status === 'cancelled' && (
        <p className="flex items-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm" role="status">
          <BanIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>Sesión cancelada{s.cancel_note ? `: «${s.cancel_note}»` : '.'}</span>
        </p>
      )}

      <section aria-label="Datos" className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
        {s.class_id === null && (
          <div>
            <Tag variant="secondary">Sesión suelta</Tag>
          </div>
        )}
        <Kv rows={rows} />
        <div className="flex flex-wrap gap-2 border-t pt-3">
          {canAdjust(s, now) && (
            <Button variant="outline" onClick={() => setAdjusting(true)}>
              Ajustar
            </Button>
          )}
          {s.status === 'scheduled' && (
            <Button variant="outline" onClick={() => setCancelling(true)}>
              Cancelar la sesión
            </Button>
          )}
          {canRestore(s, now) && (
            <Button
              variant="outline"
              onClick={() =>
                ask({
                  title: '¿Recuperar la sesión?',
                  description: 'Vuelve a estar programada. Las reservas canceladas no vuelven; se avisa a quien la tenía reservada.',
                  label: 'Recuperar la sesión',
                  done: (r: { notified: number }) => `Sesión recuperada · ${plural(r.notified, 'aviso', 'avisos')}`,
                  run: () => api(`/admin/sessions/${s.id}/restore`, { method: 'POST' }),
                })
              }
            >
              Recuperar la sesión
            </Button>
          )}
        </div>
      </section>

      {s.status === 'scheduled' && (
        <Bookings s={s} confirmed={confirmed} waiting={waiting} started={started} ask={ask} />
      )}
      {s.status === 'scheduled' && started && <AdminAttendance s={s} />}

      <AdjustSheet key={[s.trainer?.id, s.starts_at, s.duration_min, s.capacity, s.location].join('|')} s={s} open={adjusting} onClose={() => setAdjusting(false)} />
      <CancelDialog s={s} bookings={bookings.length} open={cancelling} onClose={() => setCancelling(false)} />
      {dialog}
    </Page>
  )
}

// Reservas y lista de espera (en orden de llegada) y «Reservar a un alumno».
function Bookings({ s, confirmed, waiting, started, ask }: { s: AdminSession; confirmed: SessionBooking[]; waiting: SessionBooking[]; started: boolean; ask: ReturnType<typeof useConfirm>['ask'] }) {
  const cancel = (b: SessionBooking) =>
    ask({
      title: b.status === 'waitlisted' ? '¿Sacarle de la lista de espera?' : '¿Cancelar la reserva?',
      description: `${name(b.student)}. Queda como «cancelada por la academia»; nunca cuenta como tardía.${b.status === 'confirmed' ? ' Si hay lista de espera, pasa la primera persona.' : ''}`,
      label: b.status === 'waitlisted' ? 'Sacarle de la espera' : 'Cancelar la reserva',
      done: 'Reserva cancelada',
      run: () => api(`/bookings/${b.id}/cancel`, { method: 'POST' }),
      destructive: true,
    })
  const list = (items: SessionBooking[], numbered: boolean) => (
    <ul className="divide-y overflow-hidden rounded-xl border">
      {items.map((b, i) => (
        <li key={b.id} className="flex min-h-12 items-center gap-3 px-4 py-1.5">
          {numbered && <span className="w-5 text-sm text-muted-foreground tabular-nums">{i + 1}.</span>}
          <Link to={`/admin/users/${b.student.id}`} className={cn(userLink, 'min-w-0 flex-1 truncate')}>
            {name(b.student)}
          </Link>
          <span className="hidden text-sm text-muted-foreground tabular-nums sm:inline">desde {formatDeadline(b.created_at)}</span>
          {!started && (
            <Button variant="ghost" size="sm" aria-label={`Cancelar la reserva de ${name(b.student)}`} onClick={() => cancel(b)}>
              Cancelar
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
  return (
    <section aria-label="Reservas" className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <h2 className="font-semibold">
        Reservas <span className="font-normal text-muted-foreground tabular-nums">{confirmed.length} de {plural(s.capacity, 'plaza', 'plazas')}</span>
      </h2>
      {confirmed.length === 0 ? <p className="text-sm text-muted-foreground">Nadie ha reservado todavía.</p> : list(confirmed, false)}
      {waiting.length > 0 && (
        <>
          <h3 className="text-sm font-semibold">Lista de espera</h3>
          {list(waiting, true)}
        </>
      )}
      {!started && <BookFor s={s} booked={[...confirmed, ...waiting].map((b) => b.student.id)} ask={ask} />}
    </section>
  )
}

// Reservar por un alumno: sin ventana de reserva para el admin. Si la sesión está llena, entra en la espera.
function BookFor({ s, booked, ask }: { s: AdminSession; booked: string[]; ask: ReturnType<typeof useConfirm>['ask'] }) {
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<ProfileRow | null>(null)
  const search = useDebounced(q.trim())
  const found = useQuery({
    queryKey: ['admin', 'profiles', 'students', search],
    enabled: search.length > 1,
    queryFn: () => api<Paged<'profiles', ProfileRow>>(path('/admin/profiles', { q: search, role: 'alumno', limit: '10' })),
  })
  const options = (found.data?.profiles ?? []).filter((x) => !booked.includes(x.id))
  return (
    <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center">
      <Combobox
        items={options}
        filter={null}
        value={picked}
        onValueChange={setPicked}
        onInputValueChange={setQ}
        itemToStringLabel={(x: ProfileRow) => name(x)}
        isItemEqualToValue={(a: ProfileRow, b: ProfileRow) => a.id === b.id}
      >
        <ComboboxInput aria-label="Reservar a un alumno" placeholder="Busca un alumno por nombre o email" className="sm:max-w-sm" size="lg" showTrigger={false} />
        <ComboboxPopup>
          <ComboboxEmpty>{search.length > 1 ? (found.isFetching ? 'Buscando…' : 'Nadie coincide') : 'Escribe para buscar'}</ComboboxEmpty>
          <ComboboxList>
            {(x: ProfileRow) => (
              <ComboboxItem key={x.id} value={x} className="min-h-11">
                {name(x)} {x.email && <span className="text-muted-foreground">· {x.email}</span>}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxPopup>
      </Combobox>
      <Button
        size="lg"
        disabled={!picked}
        onClick={() =>
          picked &&
          ask({
            title: `¿Reservar a ${name(picked)}?`,
            description: 'La ventana de reserva no cuenta para la academia. Si la sesión está llena, entra en la lista de espera.',
            label: 'Reservar',
            done: (r: { booking: { status: string } }) => (r.booking.status === 'waitlisted' ? 'La sesión está llena: entra en la lista de espera' : 'Reserva hecha'),
            run: async () => {
              const r = await api('/bookings', { method: 'POST', body: { session_id: s.id, profile_id: picked.id } })
              setPicked(null)
              setQ('')
              return r
            },
          })
        }
      >
        Reservar
      </Button>
    </div>
  )
}

// ── Lista de asistencia ──────────────────────────────────────────────────────

// La del profesor (B18.4), sin plazo para corregir. Aquí no hay fichas de salud: el panel nunca las ve.
function AdminAttendance({ s }: { s: AdminSession }) {
  const att = useQuery({ queryKey: attKey(s.id), queryFn: () => api<Attendance>(`/sessions/${s.id}/attendance`) })
  const [asking, setAsking] = useState(false)
  const [correcting, setCorrecting] = useState<AttendanceRow | null>(null)
  const close = useCloseList(s.id, () => setAsking(false))
  const rows = att.data?.students ?? []
  const closed = att.data ? isClosed(att.data) : false
  const present = presentCount(rows)
  const missing = unmarked(rows)
  return (
    <section aria-label="Lista de asistencia" className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">Lista de asistencia</h2>
        {att.data && !closed && rows.length > 0 && (
          <Button variant="outline" onClick={() => setAsking(true)}>
            Cerrar la lista
          </Button>
        )}
      </div>
      {att.isPending ? (
        <ListSkeleton rows={3} className="h-14" />
      ) : att.isError ? (
        <ErrorState error={att.error} onRetry={() => void att.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<UsersIcon />} title="No hay reservas" text="Nadie tenía esta sesión reservada." />
      ) : (
        <>
          <p className="text-sm font-semibold text-muted-foreground" aria-live="polite">
            {closed ? `Lista cerrada · ${plural(present, 'presente', 'presentes')} · ${plural(rows.length - present, 'falta', 'faltas')}` : `${present} de ${rows.length} presentes`}
          </p>
          <ul className="overflow-hidden rounded-xl border">
            {rows.map((r) => (
              <AttendanceItem key={r.booking_id} sessionId={s.id} row={r} mode={closed ? 'closed' : 'switch'} onCorrect={setCorrecting} />
            ))}
          </ul>
        </>
      )}
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title="¿Cerrar la lista?"
        description={missing.length ? 'Quien no esté marcado pasa a falta.' : 'Todos están presentes.'}
        confirmLabel="Cerrar la lista"
        variant="default"
        loading={close.isPending}
        onConfirm={() => close.mutate()}
      >
        {missing.length > 0 && (
          <ul className="list-disc pl-5">
            {missing.map((r) => (
              <li key={r.student_id}>{r.display_name}</li>
            ))}
          </ul>
        )}
      </ConfirmDialog>
      <CorrectDialog sessionId={s.id} row={correcting} onClose={() => setCorrecting(null)} />
    </section>
  )
}

// ── Ajustar ──────────────────────────────────────────────────────────────────

function AdjustSheet({ s, open, onClose }: { s: AdminSession; open: boolean; onClose: () => void }) {
  const now = useNow()
  const trainers = useTrainers()
  const initial = { trainer: s.trainer?.id ?? 'none', day: madridDay(s.starts_at), time: formatTime(s.starts_at), duration: String(s.duration_min), capacity: String(s.capacity), location: s.location ?? '' }
  const [f, setF] = useState(initial)
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }))
  // Solo se manda lo que cambia.
  const startsAt = madridToIso(f.day, f.time)
  const body = {
    ...(f.trainer !== initial.trainer && f.trainer !== 'none' && { trainer_id: f.trainer }),
    ...((f.day !== initial.day || f.time !== initial.time) && startsAt && { starts_at: startsAt }),
    ...(f.duration !== initial.duration && { duration_min: intOf(f.duration) }),
    ...(f.capacity !== initial.capacity && { capacity: intOf(f.capacity) }),
    ...(f.location.trim() !== initial.location && { location: f.location.trim() }),
  }
  const valid = !!startsAt && intOf(f.duration) >= 1 && intOf(f.capacity) >= 1 && (!('starts_at' in body) || Date.parse(startsAt) > now)
  const adjust = useMutation({
    mutationFn: () => api<{ notified: number; promoted: number }>(`/admin/sessions/${s.id}`, { method: 'PATCH', body }),
    onSuccess: (r) => toastOk('Sesión ajustada', `${plural(r.notified, 'aviso', 'avisos')} · ${plural(r.promoted, 'pasa', 'pasan')} de la espera`),
    onError: (err) => toastError(err),
    onSettled: () => void refreshSchedule(s.id),
  })
  return (
    <FormSheet
      open={open}
      onClose={() => {
        setF(initial)
        onClose()
      }}
      title="Ajustar la sesión"
      description="El cambio vale solo para esta sesión y queda marcado como ajustado; un cambio de la clase ya no lo pisa."
      submitLabel="Guardar el ajuste"
      disabled={Object.keys(body).length === 0 || !valid}
      loading={adjust.isPending}
      confirm={{
        title: '¿Guardar el ajuste?',
        description: 'Se avisa a quien tenga reserva de lo que cambie (profesor, hora, duración o lugar). Un aforo mayor pasa a quien esté en la espera.',
      }}
      onSubmit={() => adjust.mutateAsync()}
    >
      <SelectField label="Profesor">
        <Filter label="Profesor" value={f.trainer} onChange={set('trainer')} items={[{ value: 'none', label: 'Sin profesor' }, ...(trainers.data ?? []).map((t) => ({ value: t.id, label: name(t) }))]} />
      </SelectField>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Día" type="date" value={f.day} onChange={set('day')} />
        <TextField label="Hora" type="time" value={f.time} onChange={set('time')} hint="Hora de Madrid" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Duración (min)" type="number" min={1} value={f.duration} onChange={set('duration')} />
        <TextField label="Aforo" type="number" min={1} value={f.capacity} onChange={set('capacity')} />
      </div>
      <TextField label="Lugar" value={f.location} maxLength={100} onChange={set('location')} />
    </FormSheet>
  )
}

// ── Cancelar ─────────────────────────────────────────────────────────────────

const MAX_NOTE = 500

// Antes del inicio: avisa a quien tenía reserva. Desde el inicio es retroactiva: anula la lista, no avisa y pide motivo.
function CancelDialog({ s, bookings, open, onClose }: { s: AdminSession; bookings: number; open: boolean; onClose: () => void }) {
  const now = useNow()
  const retro = isRetroactive(s, now)
  const [note, setNote] = useState('')
  const cancel = useMutation({
    mutationFn: () => api<{ retroactive: boolean; cancelled_bookings: number; notified: number }>(`/admin/sessions/${s.id}/cancel`, { method: 'POST', body: { note: note.trim() || undefined } }),
    onSuccess: (r) =>
      toastOk(
        'Sesión cancelada',
        r.retroactive ? 'Cancelación retroactiva: la lista queda anulada y no se ha avisado a nadie.' : `${plural(r.cancelled_bookings, 'reserva cancelada', 'reservas canceladas')} · ${plural(r.notified, 'aviso', 'avisos')}`,
      ),
    onError: (err) => toastError(err),
    onSettled: () => {
      onClose()
      setNote('')
      void refreshSchedule(s.id)
    },
  })
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => !o && !cancel.isPending && onClose()}
      title={retro ? '¿Cancelar una sesión que ya empezó?' : '¿Cancelar la sesión?'}
      description={
        retro
          ? 'Cancelación retroactiva: anula la lista de asistencia y no avisa a nadie. El motivo es obligatorio y queda en la auditoría.'
          : `Se cancelan sus ${plural(bookings, 'reserva', 'reservas')} (con la lista de espera) y se avisa a quien las tenía. Puedes recuperarla antes de que empiece, pero las reservas no vuelven.`
      }
      confirmLabel="Cancelar la sesión"
      disabled={retro && !note.trim()}
      loading={cancel.isPending}
      onConfirm={() => cancel.mutate()}
    >
      <label htmlFor="cancel-note" className="font-medium">
        {retro ? 'Motivo (obligatorio)' : 'Motivo (opcional)'}
      </label>
      <Textarea id="cancel-note" value={note} maxLength={MAX_NOTE} onChange={(e) => setNote(e.target.value)} />
    </ConfirmDialog>
  )
}
