import { useMutation } from '@tanstack/react-query'
import {
  CalendarX2Icon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Clock3Icon,
  LogOutIcon,
  PauseIcon,
  PencilIcon,
  PlusIcon,
  PrinterIcon,
  TabletIcon,
  TimerIcon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react'
import { useId, useState } from 'react'
import type React from 'react'
import { Link } from 'react-router'
import { Note, Tag } from '@/components/billing-bits'
import { Rise } from '@/components/rise'
import { EmptyState, InlineError } from '@/components/screen-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '@/components/ui/menu'
import { Textarea } from '@/components/ui/textarea'
import { api, ApiError } from '@/lib/api'
import {
  authorName,
  formatDuration,
  hasPending,
  KIND_LABEL,
  KINDS,
  originalOf,
  sinceOf,
  stateLine,
  STATUS_LABEL,
  whatOf,
  type ClockDay,
  type ClockEvent,
  type ClockKind,
  type ClockMonth,
  type Correction,
} from '@/lib/clock'
import { addMonths, dayOfMonth, formatMonth, longWeekday, madridDay, madridMonth, madridToIso } from '@/lib/dates'
import { errorText } from '@/lib/errors'
import { formatDayMonth, formatDeadline, formatTime } from '@/lib/format'
import { errorCode, toastOk } from '@/lib/notify'
import { plural } from '@/lib/professor'
import { cn } from '@/lib/utils'
import { FormSheet, SelectField } from '@/pages/admin/schedule-bits'
import { post, useConfirm } from '@/pages/admin/user-billing'
import { Filter } from '@/components/filter'
import { useNow } from '@/hooks/use-now'

const MAX_REASON = 500

// Mes anterior / siguiente (no hay futuro que mirar).
export function MonthNav({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border bg-card p-1">
      <Button variant="ghost" size="xl" aria-label="Mes anterior" onClick={() => onChange(addMonths(month, -1))}>
        <ChevronLeftIcon />
      </Button>
      <span className="inline-block font-semibold first-letter:uppercase" aria-live="polite">
        {formatMonth(month)}
      </span>
      <Button variant="ghost" size="xl" aria-label="Mes siguiente" disabled={month >= madridMonth()} onClick={() => onChange(addMonths(month, 1))}>
        <ChevronRightIcon />
      </Button>
    </div>
  )
}

type Target = { mode: 'change' | 'annul'; event: ClockEvent } | { mode: 'add'; day?: string; kind?: ClockKind } | { mode: 'reject'; correction: Correction }

// «martes 17»: el mes ya lo dice MonthNav.
const dayName = (day: string) => `${longWeekday(day)} ${dayOfMonth(day)}`
// «entrada de las 09:00 del 17 nov», para los nombres accesibles y la hoja.
const eventText = (e: ClockEvent) => `${KIND_LABEL[e.kind].toLowerCase()} de las ${formatTime(e.at)} del ${formatDayMonth(e.at)}`
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// La hoja de las cuatro cosas que piden un motivo: cambiar la hora, anular, añadir el que falta y (el admin) rechazar.
function ClockSheet({ target, admin, profileId, onClose, onDone }: { target: Target; admin: boolean; profileId: string; onClose: () => void; onDone: () => void }) {
  const id = useId()
  const [reason, setReason] = useState('')
  const [kind, setKind] = useState<ClockKind>(target.mode === 'add' ? (target.kind ?? 'in') : 'in')
  const event = 'event' in target ? target.event : undefined
  const [day, setDay] = useState(event ? madridDay(event.at) : target.mode === 'add' && target.day ? target.day : madridDay())
  const [time, setTime] = useState(event ? formatTime(event.at) : '')
  const needsTime = target.mode === 'change' || target.mode === 'add'
  // El servidor no admite una hora posterior a ahora (400 invalid_field): se dice aquí, junto al campo.
  const now = useNow()
  const future = needsTime && !!day && !!time && Date.parse(madridToIso(day, time)) > now

  const send = useMutation({
    mutationFn: () => {
      const why = reason.trim()
      if (target.mode === 'reject') return api(`/admin/clock/corrections/${target.correction.id}/reject`, { method: 'POST', body: { reason: why } })
      const at = needsTime ? madridToIso(day, time) : undefined
      const body = target.mode === 'add' ? { kind, at, reason: why } : { event_id: event!.id, at, reason: why }
      return admin ? api('/admin/clock/corrections', { method: 'POST', body: { profile_id: profileId, ...body } }) : api('/me/clock/corrections', { method: 'POST', body })
    },
    onSuccess: () => toastOk(target.mode === 'reject' ? 'Corrección rechazada' : admin ? 'Corrección aplicada' : 'Corrección pedida'),
    onSettled: onDone, // refresca también si falla: puede que la secuencia haya cambiado
  })

  const what = event ? capital(eventText(event)) : ''
  const copy = {
    change: { title: 'Cambiar la hora', description: `${what}.`, submit: 'Cambiar' },
    annul: { title: 'Anular el fichaje', description: `${what}: dejará de contar.`, submit: 'Anular' },
    add: { title: 'Añadir un fichaje', description: admin ? 'El que falta en su jornada.' : 'El que no llegaste a fichar.', submit: 'Añadir' },
    reject: { title: 'Rechazar la corrección', description: 'El profesor verá el motivo.', submit: 'Rechazar' },
  }[target.mode]
  const submit = target.mode === 'reject' || admin ? copy.submit : 'Pedir corrección'
  const notifies = admin && target.mode !== 'reject'
  const err = send.error

  return (
    <FormSheet
      open
      onClose={onClose}
      title={copy.title}
      description={copy.description}
      submitLabel={submit}
      disabled={!reason.trim() || (needsTime && (!day || !time)) || future}
      loading={send.isPending}
      confirm={notifies ? { title: '¿Aplicar la corrección?', description: 'Se aplica al momento y se avisa al profesor por email.', destructive: target.mode === 'annul' } : undefined}
      onSubmit={() => send.mutateAsync()}
    >
      {target.mode === 'add' && (
        <SelectField label="Fichaje">
          <Filter label="Fichaje" value={kind} onChange={(v) => setKind(v as ClockKind)} items={KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
        </SelectField>
      )}
      {needsTime && (
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-day`} className="text-sm font-medium">
              Día
            </label>
            <Input id={`${id}-day`} type="date" size="lg" max={madridDay()} value={day} onChange={(e) => setDay(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-time`} className="text-sm font-medium">
              Hora
            </label>
            <Input
              id={`${id}-time`}
              type="time"
              size="lg"
              value={time}
              aria-invalid={future || undefined}
              aria-describedby={future ? `${id}-future` : undefined}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>
          {future && (
            <p id={`${id}-future`} className="col-span-2 flex items-center gap-1.5 text-sm font-medium text-destructive-foreground">
              <TriangleAlertIcon className="size-4 shrink-0" aria-hidden />
              La hora no puede ser posterior a ahora.
            </p>
          )}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-reason`} className="text-sm font-medium">
          Motivo
        </label>
        <Textarea id={`${id}-reason`} rows={3} value={reason} maxLength={MAX_REASON} aria-describedby={`${id}-hint`} onChange={(e) => setReason(e.target.value)} />
        <p id={`${id}-hint`} className="flex justify-between gap-3 text-[13px] text-muted-foreground">
          <span>Obligatorio · {target.mode === 'reject' || admin ? 'lo verá el profesor' : 'lo verá la academia'}</span>
          <span className="font-mono tabular-nums">
            {reason.length} / {MAX_REASON}
          </span>
        </p>
      </div>
      {/* El error, dentro de la hoja: con el teclado abierto un toast arriba no se ve. La hoja se queda abierta para reintentar. */}
      {err && (
        <InlineError>
          {errorCode(err) === 'invalid_field' ? 'Revisa el día, la hora y el motivo.' : errorText(errorCode(err), err instanceof ApiError ? err.details : {})}
        </InlineError>
      )}
    </FormSheet>
  )
}

// Estado de una corrección: color, icono y texto (nunca solo color).
const CORRECTION_TAG = {
  pending: { variant: 'warning', Icon: Clock3Icon },
  applied: { variant: 'success', Icon: CheckIcon },
  rejected: { variant: 'error', Icon: XIcon },
} as const

function CorrectionRow({ c, text, admin, onReject, apply }: { c: Correction; text: string; admin: boolean; onReject: () => void; apply: () => void }) {
  const { variant, Icon } = CORRECTION_TAG[c.status]
  return (
    <li className="flex flex-col gap-1.5 border-b px-4 py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-2">
        <span className="font-semibold text-pretty">{text}</span>
        <Tag variant={variant}>
          <Icon aria-hidden />
          {STATUS_LABEL[c.status]}
        </Tag>
      </div>
      <p className="text-sm text-pretty">{c.reason}</p>
      <p className="text-[13px] text-muted-foreground">
        Pedida por {authorName(c.requested_by)} · {formatDeadline(c.created_at)}
      </p>
      {c.resolved_at && (
        <p className="text-[13px] text-muted-foreground">
          {c.status === 'applied' ? 'Aplicada' : 'Rechazada'} por {authorName(c.resolved_by)} · {formatDeadline(c.resolved_at)}
        </p>
      )}
      {c.resolution_reason && (
        <p className="text-sm text-pretty">
          <span className="font-semibold">{c.status === 'rejected' ? 'Motivo del rechazo' : 'Nota'}:</span> {c.resolution_reason}
        </p>
      )}
      {admin && c.status === 'pending' && (
        <div className="mt-1 flex gap-2">
          <Button size="xl" className="flex-1" onClick={apply}>
            Aplicar
          </Button>
          <Button size="xl" variant="outline" className="flex-1" onClick={onReject}>
            Rechazar
          </Button>
        </div>
      )}
    </li>
  )
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section aria-label={title} className="flex flex-col gap-2">
    <h2 className="px-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">{title}</h2>
    {children}
  </section>
)

const STATE_ICON = { in: TimerIcon, paused: PauseIcon, out: LogOutIcon }

// Total del mes y, en el mes en curso, cómo está la jornada ahora. Una jornada abierta de un día anterior es una salida olvidada.
function Summary({ data, admin, openPast }: { data: ClockMonth; admin: boolean; openPast?: ClockDay }) {
  const employee = data.profile.employment === 'employee'
  const worked = data.days.filter((d) => d.worked_seconds > 0).length
  const StateIcon = openPast ? TriangleAlertIcon : STATE_ICON[data.state]
  return (
    <section aria-label="Resumen del mes" className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Total del mes</span>
          <span className="text-[13px] text-muted-foreground">{worked > 0 ? `en ${plural(worked, 'día', 'días')}` : 'Sin horas fichadas'}</span>
        </div>
        <span className="font-heading text-4xl leading-none font-bold tabular-nums">{formatDuration(data.total_seconds)} h</span>
      </div>
      {employee && data.month === madridMonth() && (
        <div className="-mb-1 flex items-center justify-between gap-3 border-t pt-2">
          <p className={cn('flex min-h-11 items-center gap-2 font-semibold', openPast && 'text-warning-foreground')}>
            <StateIcon className={cn('size-4 shrink-0', !openPast && 'text-muted-foreground')} aria-hidden />
            {openPast ? `Falta la salida del ${dayName(openPast.date)}` : stateLine(data.state, sinceOf(data))}
          </p>
          {!admin && (
            <Link to="/professor" aria-label="Fichar en Sesiones" className="-me-1 inline-flex min-h-11 shrink-0 items-center gap-0.5 px-1 text-sm font-semibold text-link">
              Fichar
              <ChevronRightIcon className="size-4" aria-hidden />
            </Link>
          )}
        </div>
      )}
    </section>
  )
}

function EventRow({ e, data, employee, onTarget }: { e: ClockEvent; data: ClockMonth; employee: boolean; onTarget: (t: Target) => void }) {
  const original = e.corrected ? originalOf(data, e.id) : undefined
  const pending = employee && hasPending(data, e.id)
  return (
    <li className="flex min-h-12 items-center gap-3 border-b py-1 ps-4 pe-1 last:border-b-0">
      <span className="w-12 shrink-0 font-mono text-[15px] font-semibold tabular-nums">{formatTime(e.at)}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-1.5">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {KIND_LABEL[e.kind]}
          {e.origin === 'tablet' && (
            <Tag>
              <TabletIcon aria-hidden />
              Tablet
            </Tag>
          )}
          {e.corrected && (
            <Tag variant="info">
              <PencilIcon aria-hidden />
              Corregido
            </Tag>
          )}
          {pending && (
            <Tag variant="warning">
              <Clock3Icon aria-hidden />
              Corrección pendiente
            </Tag>
          )}
        </span>
        {original && (
          <span className="text-[13px] text-muted-foreground">
            Fichado a las <span className="font-mono tabular-nums">{formatTime(original.at)}</span>
          </span>
        )}
      </div>
      {employee && !pending && (
        <Menu>
          <MenuTrigger render={<Button variant="ghost" size="xl" className="shrink-0 text-muted-foreground" aria-label={`Corregir ${eventText(e)}`} />}>Corregir</MenuTrigger>
          <MenuPopup align="end">
            <MenuItem className="min-h-11" onClick={() => onTarget({ mode: 'change', event: e })}>
              Cambiar la hora
            </MenuItem>
            <MenuItem className="min-h-11" onClick={() => onTarget({ mode: 'annul', event: e })}>
              Anularlo
            </MenuItem>
          </MenuPopup>
        </Menu>
      )}
    </li>
  )
}

function DayCard({ d, data, employee, today, onTarget }: { d: ClockDay; data: ClockMonth; employee: boolean; today: string; onTarget: (t: Target) => void }) {
  const id = useId()
  const missingOut = d.open && d.date < today
  const paused = d.open && data.state === 'paused'
  return (
    <section aria-labelledby={id} className="overflow-hidden rounded-2xl border bg-card">
      <div className="flex items-start justify-between gap-3 px-4 pt-3 pb-2.5">
        <div className="flex flex-col gap-0.5">
          <h2 id={id} className="font-semibold first-letter:uppercase">
            {dayName(d.date)}
          </h2>
          {d.pause_seconds > 0 && (
            <span className="text-[13px] text-muted-foreground">
              Pausas <span className="font-mono tabular-nums">{formatDuration(d.pause_seconds)}</span> h
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {d.open && !missingOut && (
            <Tag variant="info">
              {paused ? <PauseIcon aria-hidden /> : <TimerIcon aria-hidden />}
              {paused ? 'En pausa' : 'En curso'}
            </Tag>
          )}
          <span className="font-semibold">
            <span className="font-mono text-[15px] tabular-nums">{formatDuration(d.worked_seconds)}</span> h
          </span>
        </div>
      </div>
      {missingOut && (
        <div className="mx-2 mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl bg-warning/8 py-1 ps-3 pe-1 dark:bg-warning/16">
          <p className="flex min-h-11 items-center gap-2 text-sm font-semibold text-warning-foreground">
            <TriangleAlertIcon className="size-4 shrink-0" aria-hidden />
            Falta la salida
          </p>
          {employee && (
            <Button variant="outline" size="xl" onClick={() => onTarget({ mode: 'add', day: d.date, kind: 'out' })}>
              <PlusIcon />
              Añadir la salida
            </Button>
          )}
        </div>
      )}
      <ul className="border-t">
        {d.events.map((e) => (
          <EventRow key={`${e.id}-${e.at}`} e={e} data={data} employee={employee} onTarget={onTarget} />
        ))}
      </ul>
    </section>
  )
}

// «Mi registro» y la jornada de un profesor en el panel: el mismo mes, con las correcciones. Solo el empleado corrige.
// En escritorio, el resumen y las correcciones a la derecha (rejilla; el HTML va en el orden del móvil). `rise`: entrada escalonada.
export function ClockLog({ data, admin = false, printTo, onChanged, rise = false }: { data: ClockMonth; admin?: boolean; printTo: string; onChanged: () => void; rise?: boolean }) {
  const [target, setTarget] = useState<Target | null>(null)
  const { ask, dialog } = useConfirm(onChanged)
  const employee = data.profile.employment === 'employee'
  const pending = data.corrections.filter((c) => c.status === 'pending')
  const corrections = [...pending, ...data.corrections.filter((c) => c.status !== 'pending')]
  const days = [...data.days].reverse()
  const today = madridDay()
  const openPast = data.days.find((d) => d.open && d.date < today)
  const current = data.month === madridMonth()

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start lg:gap-x-8">
      <Rise on={rise} i={0} className="flex flex-col gap-4 lg:sticky lg:top-4 lg:col-start-2 lg:row-start-1">
        {!employee && (
          <Note kind="info" title="Autónomo">
            {admin ? 'No ficha ni tiene correcciones; aquí se ve lo que fichó cuando era empleado.' : 'Ya no fichas ni pides correcciones; aquí ves lo que fichaste cuando eras empleado.'}
          </Note>
        )}
        <Summary data={data} admin={admin} openPast={openPast} />
        <div className="flex gap-2">
          {employee && (
            <Button variant="outline" size="xl" className="flex-1" onClick={() => setTarget({ mode: 'add' })}>
              <PlusIcon />
              Añadir fichaje
            </Button>
          )}
          <Button variant="outline" size="xl" className={cn(!employee && 'flex-1')} render={<Link to={printTo} />}>
            <PrinterIcon />
            Imprimir
          </Button>
        </div>
        {corrections.length > 0 && (
          <Section title={pending.length > 0 ? `Correcciones · ${plural(pending.length, 'pendiente', 'pendientes')}` : 'Correcciones'}>
            <ul className="overflow-hidden rounded-2xl border bg-card">
              {corrections.map((c) => (
                <CorrectionRow
                  key={c.id}
                  c={c}
                  text={whatOf(c, data)}
                  admin={admin}
                  onReject={() => setTarget({ mode: 'reject', correction: c })}
                  apply={() =>
                    ask({
                      title: '¿Aplicar la corrección?',
                      description: `${whatOf(c, data)}. Se avisa al profesor por email.`,
                      label: 'Aplicar',
                      done: 'Corrección aplicada',
                      run: post(`/admin/clock/corrections/${c.id}/apply`),
                    })
                  }
                />
              ))}
            </ul>
          </Section>
        )}
      </Rise>
      <Rise on={rise} i={1} className="flex flex-col gap-3 lg:col-start-1 lg:row-start-1">
        {days.length === 0 ? (
          <EmptyState
            icon={<CalendarX2Icon />}
            title="Sin fichajes este mes"
            text={employee && current && !admin ? 'Ficha la entrada desde Sesiones.' : undefined}
            plainTitle
          />
        ) : (
          days.map((d) => <DayCard key={d.date} d={d} data={data} employee={employee} today={today} onTarget={setTarget} />)
        )}
      </Rise>
      {target && (
        <ClockSheet
          key={target.mode + ('event' in target ? target.event.id : 'correction' in target ? target.correction.id : (target.day ?? ''))}
          target={target}
          admin={admin}
          profileId={data.profile.id}
          onClose={() => setTarget(null)}
          onDone={onChanged}
        />
      )}
      {dialog}
    </div>
  )
}
