import { useMutation, useQuery } from '@tanstack/react-query'
import { BanIcon, UsersIcon } from 'lucide-react'
import { useState } from 'react'
import type React from 'react'
import { Link, useParams } from 'react-router'
import { Back, Kv, Tag } from '@/components/billing-bits'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Page } from '@/components/page'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/screen-state'
import { Button } from '@/components/ui/button'
import { Combobox, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList, ComboboxPopup } from '@/components/ui/combobox'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { toastManager } from '@/components/ui/toast'
import { useNow } from '@/hooks/use-now'
import { type Paged, type ProfileRow } from '@/lib/admin'
import { api } from '@/lib/api'
import { madridDay } from '@/lib/dates'
import {
  attendanceOpen, AUDIENCE_LABEL, cancelResult, cancelSummary, CANCEL_REASON_LABEL, canRefund, canRetryRefund, draftOf, emptyDraft, eventBody, eventErrors, eventSeats,
  eventPatch, isLive, memberPriceLabel, notifiesOnPatch, payLabel, priceLabel, refundLabel,
  type AdminEvent, type Audience, type EventDraft, type EventRegistration,
} from '@/lib/events'
import { formatDate, formatDeadline, formatEuros, formatShortDate, formatTime } from '@/lib/format'
import { queryClient } from '@/lib/logout'
import { toastError, toastOk } from '@/lib/notify'
import { plural } from '@/lib/professor'
import { path } from '@/lib/url'
import { cn } from '@/lib/utils'
import { Filter, useDebounced } from '@/pages/community'
import { FormSheet, SelectField, SwitchRow, TextField, useAdminDisciplines, useFieldError, useTrainers } from '@/pages/admin/schedule-bits'
import { useConfirm } from '@/pages/admin/user-billing'

const name = (p: { display_name: string | null } | undefined) => p?.display_name ?? 'Sin nombre'
const userLink = 'font-medium text-link underline-offset-3 hover:underline'
const refresh = () => Promise.all([['admin', 'events'], ['admin', 'event']].map((queryKey) => queryClient.invalidateQueries({ queryKey })))

// «sábado, 12 de diciembre · 10:00–14:00»; si dura varios días, «12 dic, 10:00 → 13 dic, 14:00».
function when(e: Pick<AdminEvent, 'starts_at' | 'ends_at'>): string {
  if (madridDay(e.starts_at) === madridDay(e.ends_at)) return `${formatDate(e.starts_at)} · ${formatTime(e.starts_at)}–${formatTime(e.ends_at)}`
  return `${formatShortDate(e.starts_at)}, ${formatTime(e.starts_at)} → ${formatShortDate(e.ends_at)}, ${formatTime(e.ends_at)}`
}

export function StateTag({ e }: { e: Pick<AdminEvent, 'status' | 'taken' | 'capacity'> }) {
  return e.status === 'cancelled' ? <Tag variant="error">Cancelado</Tag> : e.capacity !== null && e.taken >= e.capacity ? <Tag variant="warning">Completo</Tag> : <Tag>Programado</Tag>
}

// ── Crear y editar ───────────────────────────────────────────────────────────

// Sin `event` crea; con `event` solo manda lo que cambia. Inicio, fin o lugar avisan a los inscritos: lo dice antes de guardar.
export function EventSheet({ event, open, onClose, defaultDay = '', onCreated }: { event?: AdminEvent; open: boolean; onClose: () => void; defaultDay?: string; onCreated?: (day: string) => void }) {
  const now = useNow()
  const disciplines = useAdminDisciplines()
  const trainers = useTrainers()
  const field = useFieldError()
  const initial = event ? draftOf(event) : emptyDraft()
  const [draft, setD] = useState<EventDraft>(initial)
  // Al crear, el día de inicio y de fin son el elegido en el calendario (si no ha pasado) hasta que se toquen.
  // shortcut: vaciar un día a mano lo vuelve a rellenar; si molesta, guardar si se tocó.
  const dd = defaultDay >= madridDay() ? defaultDay : ''
  const d = event ? draft : { ...draft, day: draft.day || dd, endDay: draft.endDay || dd }
  const [seen, setSeen] = useState<Set<string>>(new Set())
  const [tried, setTried] = useState(false)
  const errors = event ? {} : eventErrors(d, now)
  const shown = (k: keyof typeof errors) => (tried || seen.has(k) ? errors[k] : undefined)
  const touch = (k: string) => () => setSeen((x) => new Set(x).add(k))
  const set = <K extends keyof EventDraft>(k: K) => (v: EventDraft[K]) => {
    field.clear()
    setD((x) => ({ ...x, [k]: v }))
  }
  const full = eventBody(d, now, !event)
  const patch = full && event ? eventPatch(event, full) : null
  // Al editar, el inicio solo tiene que ser futuro si se mueve.
  const movedToPast = !!patch && 'starts_at' in patch && Date.parse(patch.starts_at!) <= now
  const body = event ? patch : full
  const save = useMutation({
    mutationFn: () =>
      api<{ event: { id: string }; notified?: number }>(event ? `/admin/events/${event.id}` : '/admin/events', { method: event ? 'PATCH' : 'POST', body }),
    onSuccess: (r) => {
      if (!event) {
        toastOk('Evento creado', 'Ya lo ven todos; no se avisa a nadie.')
        setD(initial)
        setSeen(new Set())
        setTried(false)
        onCreated?.(d.day)
      } else toastOk('Evento guardado', r.notified ? plural(r.notified, 'aviso', 'avisos') : undefined)
    },
    onError: field.fail,
    onSettled: () => void refresh(),
  })
  const close = () => {
    setD(initial)
    setSeen(new Set())
    setTried(false)
    field.clear()
    onClose()
  }
  return (
    <FormSheet
      open={open}
      onClose={close}
      title={event ? 'Editar el evento' : 'Nuevo evento'}
      description={
        event
          ? 'Precio, público y cobertura de riesgo no cambian a quien ya está inscrito.'
          : 'Se publica al crearlo: lo ve cualquier perfil con sesión, sin avisar a nadie.'
      }
      submitLabel={event ? 'Guardar' : 'Crear el evento'}
      disabled={event ? !body || Object.keys(body).length === 0 || movedToPast : false}
      loading={save.isPending}
      confirm={
        patch && notifiesOnPatch(patch)
          ? {
              title: '¿Guardar y avisar?',
              description:
                'Cambiar el inicio, el fin o el lugar avisa a los inscritos (push, o email si no tienen push). No da reembolso: quien no pueda venir tiene que contactar con la academia.',
            }
          : undefined
      }
      onSubmit={() => {
        if (Object.keys(errors).length) {
          setTried(true)
          return Promise.reject(new Error('invalid'))
        }
        return save.mutateAsync()
      }}
    >
      <TextField label="Título" value={d.title} maxLength={120} onChange={set('title')} onBlur={touch('title')} error={shown('title') ?? field.error('title')} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="event-description" className="text-sm font-medium">
          Descripción (opcional)
        </label>
        <Textarea id="event-description" value={d.description} maxLength={2000} onChange={(e) => set('description')(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Día de inicio" type="date" value={d.day} onChange={set('day')} onBlur={touch('day')} error={shown('day') ?? field.error('starts_at')} />
        <TextField label="Hora de inicio" type="time" value={d.time} onChange={set('time')} onBlur={touch('time')} error={shown('time')} hint="Hora de Madrid" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Día de fin" type="date" value={d.endDay} onChange={set('endDay')} onBlur={touch('endDay')} error={shown('endDay') ?? field.error('ends_at')} />
        <TextField label="Hora de fin" type="time" value={d.endTime} onChange={set('endTime')} onBlur={touch('endTime')} error={shown('endTime')} />
      </div>
      <TextField label="Lugar" value={d.location} maxLength={200} onChange={set('location')} onBlur={touch('location')} error={shown('location') ?? field.error('location')} />
      <SelectField label="Disciplina (opcional)">
        <Filter
          label="Disciplina"
          value={d.discipline}
          onChange={set('discipline')}
          items={[{ value: 'none', label: 'Sin disciplina' }, ...(disciplines.data ?? []).filter((x) => x.is_active || String(x.id) === d.discipline).map((x) => ({ value: String(x.id), label: x.name }))]}
        />
      </SelectField>
      <SelectField label="Profesor (opcional)">
        <Filter label="Profesor" value={d.trainer} onChange={set('trainer')} items={[{ value: 'none', label: 'Sin profesor de la academia' }, ...(trainers.data ?? []).map((t) => ({ value: t.id, label: name(t) }))]} />
      </SelectField>
      <TextField label="Aforo (opcional)" type="number" min={1} value={d.capacity} onChange={set('capacity')} onBlur={touch('capacity')} hint="Vacío = sin límite. Nunca por debajo de las inscripciones." error={shown('capacity') ?? field.error('capacity')} />
      <SelectField label="Público">
        <Filter label="Público" value={d.audience} onChange={(v) => set('audience')(v as Audience)} items={(Object.keys(AUDIENCE_LABEL) as Audience[]).map((a) => ({ value: a, label: AUDIENCE_LABEL[a] }))} />
      </SelectField>
      <SwitchRow label="Exige cobertura de riesgo" hint="Apágalo en los eventos sociales. Un no socio solo la tiene con la exención firmada." checked={d.risk} onChange={set('risk')} />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Precio (€)" inputMode="decimal" value={d.price} onChange={set('price')} onBlur={touch('price')} hint="Vacío = gratis. Mínimo 0,50 €." error={shown('price') ?? field.error('price_cents')} />
        <TextField label="Precio de socio (€)" inputMode="decimal" value={d.memberPrice} onChange={set('memberPrice')} onBlur={touch('memberPrice')} hint="Opcional; no más que el precio." error={shown('memberPrice') ?? field.error('member_price_cents')} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Fecha límite (opcional)" type="date" value={d.deadlineDay} onChange={set('deadlineDay')} onBlur={touch('deadlineDay')} error={shown('deadlineDay') ?? field.error('registration_deadline')} />
        <TextField label="Hora límite" type="time" value={d.deadlineTime} onChange={set('deadlineTime')} hint="Sin ella, hasta el inicio" />
      </div>
    </FormSheet>
  )
}

// ── Detalle ──────────────────────────────────────────────────────────────────

type Detail = { event: AdminEvent; registrations: EventRegistration[] }

export function AdminEventPage() {
  const { id = '' } = useParams()
  const query = useQuery({ queryKey: ['admin', 'event', id], queryFn: () => api<Detail>(`/admin/events/${id}`) })
  if (query.isPending) {
    return (
      <Page title="Evento" wide>
        <ListSkeleton rows={3} />
      </Page>
    )
  }
  if (query.isError) {
    return (
      <Page title="Evento" wide>
        <Back to="/admin/sessions">Horario</Back>
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Page>
    )
  }
  return <EventDetail key={id} {...query.data} />
}

function EventDetail({ event: e, registrations }: Detail) {
  const now = useNow()
  const [editing, setEditing] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const scheduled = e.status === 'scheduled'
  const member = memberPriceLabel(e)
  const rows: [string, React.ReactNode][] = [
    ['Cuándo', <span key="w" className="first-letter:uppercase">{when(e)}</span>],
    ['Lugar', e.location],
    ['Disciplina', e.discipline?.name ?? '—'],
    ['Profesor', e.trainer ? name(e.trainer) : '—'],
    ['Aforo', eventSeats(e)],
    ['Público', AUDIENCE_LABEL[e.audience]],
    ['Cobertura de riesgo', e.requires_risk_cover ? 'Exigida' : 'No exigida'],
    ['Precio', priceLabel(e.price_cents)],
    ...(member ? [['Precio de socio', member] as [string, React.ReactNode]] : []),
    ['Inscripciones hasta', e.registration_deadline ? formatDeadline(e.registration_deadline) : 'El inicio del evento'],
  ]
  return (
    <Page title={e.title} wide actions={<StateTag e={e} />}>
      <Back to="/admin/sessions">Horario</Back>
      {!scheduled && (
        <p className="flex items-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm" role="status">
          <BanIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>Evento cancelado{e.cancel_note ? `: «${e.cancel_note}»` : '.'}</span>
        </p>
      )}
      <section aria-label="Datos" className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
        {e.description && <p className="text-[15px] whitespace-pre-line">{e.description}</p>}
        <Kv rows={rows} />
        {scheduled && (
          <div className="flex flex-wrap gap-2 border-t pt-3">
            <Button variant="outline" onClick={() => setEditing(true)}>
              Editar
            </Button>
            <Button variant="outline" onClick={() => setCancelling(true)}>
              Cancelar el evento
            </Button>
          </div>
        )}
      </section>
      <Registrations e={e} registrations={registrations} />
      {attendanceOpen(e, now) && <Attendance e={e} registrations={registrations} />}
      <EventSheet key={JSON.stringify(draftOf(e))} event={e} open={editing} onClose={() => setEditing(false)} />
      <CancelEventDialog e={e} registrations={registrations} open={cancelling} onClose={() => setCancelling(false)} />
    </Page>
  )
}

// ── Cancelar el evento ───────────────────────────────────────────────────────

function CancelEventDialog({ e, registrations, open, onClose }: { e: AdminEvent; registrations: EventRegistration[]; open: boolean; onClose: () => void }) {
  const [note, setNote] = useState('')
  const { live, paid, cents } = cancelSummary(registrations)
  const cancel = useMutation({
    mutationFn: () => api<{ refunded: number; refund_failed: number; notified: number }>(`/admin/events/${e.id}/cancel`, { method: 'POST', body: { note: note.trim() || undefined } }),
    onSuccess: (r) => {
      if (r.refund_failed) toastManager.add({ type: 'warning', title: 'Evento cancelado, pero algún reembolso ha fallado', description: cancelResult(r), timeout: 8000 })
      else toastOk('Evento cancelado', cancelResult(r))
    },
    onError: (err) => toastError(err),
    onSettled: () => {
      onClose()
      setNote('')
      void refresh()
    },
  })
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => !o && !cancel.isPending && onClose()}
      title="¿Cancelar el evento?"
      description={
        live === 0
          ? 'Nadie está inscrito: no hay avisos ni reembolsos. No se puede deshacer.'
          : `Se cancelan sus ${plural(live, 'inscripción', 'inscripciones')} y se avisa a los inscritos. ${
              paid ? `Se devuelve todo lo pagado: ${formatEuros(cents)} (${plural(paid, 'pago', 'pagos')}), automático. ` : 'No hay nada pagado que devolver. '
            }Los pagos pendientes se caducan. No se puede deshacer.`
      }
      confirmLabel="Cancelar el evento"
      loading={cancel.isPending}
      onConfirm={() => cancel.mutate()}
    >
      <label htmlFor="event-cancel-note" className="font-medium">
        Motivo (opcional, solo lo ve la academia)
      </label>
      <Textarea id="event-cancel-note" value={note} maxLength={500} onChange={(ev) => setNote(ev.target.value)} />
    </ConfirmDialog>
  )
}

// ── Inscritos ────────────────────────────────────────────────────────────────

const STATUS_TAG: Record<EventRegistration['status'], React.ReactNode> = {
  pending: <Tag variant="warning">Pendiente</Tag>,
  confirmed: <Tag variant="success">Confirmada</Tag>,
  cancelled: <Tag variant="secondary">Cancelada</Tag>,
}

function Registrations({ e, registrations }: { e: AdminEvent; registrations: EventRegistration[] }) {
  const [target, setTarget] = useState<{ r: EventRegistration; retry: boolean } | null>(null)
  const [refund, setRefund] = useState(false)
  const { ask, dialog } = useConfirm(() => void refresh())
  const cancel = useMutation({
    mutationFn: ({ r, refund: back }: { r: EventRegistration; refund: boolean }) =>
      api<{ registration: { refund_status: string | null } }>(`/admin/event-registrations/${r.id}/cancel`, { method: 'POST', body: { refund: back } }),
    onSuccess: ({ registration }, v) => {
      const status = registration.refund_status
      if (status === 'failed') toastManager.add({ type: 'warning', title: 'Stripe ha rechazado el reembolso', description: 'Puedes reintentarlo desde la inscripción.', timeout: 8000 })
      else toastOk(target?.retry ? 'Reembolso hecho' : 'Inscripción cancelada', v.refund ? (status === 'refunded' ? 'Importe devuelto.' : 'Reembolso pedido a Stripe.') : undefined)
    },
    onError: (err) => toastError(err),
    onSettled: () => {
      setTarget(null)
      void refresh()
    },
  })
  const live = registrations.filter(isLive)
  const r = target?.r
  return (
    <section aria-label="Inscritos" className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <h2 className="font-semibold">
        Inscritos <span className="font-normal text-muted-foreground tabular-nums">{eventSeats({ taken: live.length, capacity: e.capacity })}</span>
      </h2>
      {registrations.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nadie se ha inscrito todavía.</p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border">
          {registrations.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
              <div className="min-w-0 flex-1 basis-48">
                <Link to={`/admin/users/${x.student.id}`} className={cn(userLink, 'block truncate', x.status === 'cancelled' && 'text-muted-foreground')}>
                  {name(x.student)}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {payLabel(x)}
                  {x.payer && !x.guest && x.payer.id !== x.student.id && ` · paga ${name(x.payer)}`}
                  {x.status === 'cancelled' && x.cancel_reason && ` · ${CANCEL_REASON_LABEL[x.cancel_reason] ?? x.cancel_reason}`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {x.guest && <Tag variant="info">Invitado</Tag>}
                {STATUS_TAG[x.status]}
                {refundLabel(x) && <Tag variant={x.refund_status === 'failed' ? 'error' : x.refund_status === 'refunded' ? 'success' : 'warning'}>{refundLabel(x)}</Tag>}
              </div>
              {e.status === 'scheduled' && isLive(x) && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Cancelar la inscripción de ${name(x.student)}`}
                  onClick={() => {
                    setRefund(false)
                    setTarget({ r: x, retry: false })
                  }}
                >
                  Cancelar
                </Button>
              )}
              {canRetryRefund(x) && (
                <Button variant="outline" size="sm" aria-label={`Reintentar el reembolso de ${name(x.student)}`} onClick={() => setTarget({ r: x, retry: true })}>
                  Reintentar el reembolso
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {e.status === 'scheduled' && <GuestPicker event={e} taken={live.map((x) => x.student.id)} ask={ask} />}
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(o) => !o && !cancel.isPending && setTarget(null)}
        title={target?.retry ? '¿Reintentar el reembolso?' : `¿Cancelar la inscripción de ${name(r?.student)}?`}
        description={
          !r
            ? ''
            : target?.retry
              ? `Se vuelve a pedir a Stripe la devolución de ${formatEuros(r.amount_cents)} a quien pagó.`
              : `Se le avisa (push, o email si no tiene push) y la plaza queda libre.${r.status === 'pending' ? ' Su pago pendiente se caduca; si pagara a destiempo, se le devolvería.' : ''}`
        }
        confirmLabel={target?.retry ? 'Reintentar el reembolso' : 'Cancelar la inscripción'}
        variant={target?.retry ? 'default' : 'destructive'}
        loading={cancel.isPending}
        onConfirm={() => r && cancel.mutate({ r, refund: target!.retry || refund })}
      >
        {r && !target?.retry && canRefund(r) && (
          <SwitchRow label={`Devolver el importe (${formatEuros(r.amount_cents)})`} hint="Se devuelve entero a quien pagó; no hay reembolsos parciales. Si no lo marcas, no se devuelve nada." checked={refund} onChange={setRefund} />
        )}
      </ConfirmDialog>
      {dialog}
    </section>
  )
}

// Inscribir a un invitado: sin cobro y sin cierre de inscripciones, pero con requisitos y aforo.
function GuestPicker({ event, taken, ask }: { event: AdminEvent; taken: string[]; ask: ReturnType<typeof useConfirm>['ask'] }) {
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<ProfileRow | null>(null)
  const search = useDebounced(q.trim())
  const found = useQuery({
    queryKey: ['admin', 'profiles', 'students', search],
    enabled: search.length > 1,
    queryFn: () => api<Paged<'profiles', ProfileRow>>(path('/admin/profiles', { q: search, role: 'alumno', limit: '10' })),
  })
  const options = (found.data?.profiles ?? []).filter((x) => !taken.includes(x.id))
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
        <ComboboxInput aria-label="Inscribir a un invitado" placeholder="Busca un alumno por nombre o email" className="sm:max-w-sm" size="lg" showTrigger={false} />
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
            title: `¿Inscribir a ${name(picked)} como invitado?`,
            description: 'No paga nada y las inscripciones cerradas no cuentan, pero se piden el perfil completo, la cobertura de riesgo (si el evento la exige) y que haya plaza.',
            label: 'Inscribir',
            done: 'Invitado inscrito',
            run: async () => {
              const r = await api(`/admin/events/${event.id}/registrations`, { method: 'POST', body: { profile_id: picked.id } })
              setPicked(null)
              setQ('')
              return r
            },
          })
        }
      >
        Inscribir invitado
      </Button>
    </div>
  )
}

// ── Lista de asistencia ──────────────────────────────────────────────────────

// Presentes sí o no, sin cerrar ni corregir; no cuenta para racha, horas, badges, ranking ni informes.
function Attendance({ e, registrations }: { e: AdminEvent; registrations: EventRegistration[] }) {
  const rows = registrations.filter((r) => r.status === 'confirmed')
  const present = rows.filter((r) => r.attended === true).length
  return (
    <section aria-label="Lista de asistencia" className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <h2 className="font-semibold">Lista de asistencia</h2>
      {rows.length === 0 ? (
        <EmptyState icon={<UsersIcon />} title="No hay inscripciones confirmadas" />
      ) : (
        <>
          <p className="text-sm font-semibold text-muted-foreground" aria-live="polite">
            {present} de {rows.length} presentes
          </p>
          <ul className="divide-y overflow-hidden rounded-xl border">
            {rows.map((r) => (
              <AttendanceRow key={r.id} eventId={e.id} r={r} />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function AttendanceRow({ eventId, r }: { eventId: string; r: EventRegistration }) {
  const mark = useMutation({
    mutationFn: (present: boolean) => api(`/events/${eventId}/attendance/${r.student.id}`, { method: 'PUT', body: { present } }),
    onError: (err) => toastError(err),
    onSettled: () => void refresh(),
  })
  const on = mark.isPending ? mark.variables : r.attended === true
  return (
    <li className="flex min-h-14 items-center gap-3 px-4 py-2">
      <span className="min-w-0 flex-1 truncate font-medium">{name(r.student)}</span>
      <span className={cn('text-xs font-semibold', on ? 'text-foreground' : 'text-muted-foreground')} aria-live="polite">
        {mark.isPending ? 'Guardando…' : on ? 'Presente' : r.attended === false ? 'Ausente' : 'Sin marcar'}
      </span>
      <Switch checked={on} disabled={mark.isPending} onCheckedChange={(c) => mark.mutate(c)} aria-label={`Presente: ${name(r.student)}`} />
    </li>
  )
}
