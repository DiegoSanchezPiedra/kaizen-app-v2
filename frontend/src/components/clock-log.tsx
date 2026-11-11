import { useMutation } from '@tanstack/react-query'
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, PrinterIcon } from 'lucide-react'
import { useId, useState } from 'react'
import type React from 'react'
import { Link } from 'react-router'
import { Note, Tag } from '@/components/billing-bits'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import {
  authorName,
  formatDuration,
  hasPending,
  KIND_LABEL,
  KINDS,
  originalOf,
  STATUS_LABEL,
  whatOf,
  type ClockEvent,
  type ClockKind,
  type ClockMonth,
  type Correction,
} from '@/lib/clock'
import { addMonths, formatDay, formatMonth, madridDay, madridMonth, madridToIso } from '@/lib/dates'
import { formatDeadline, formatTime } from '@/lib/format'
import { toastError, toastOk } from '@/lib/notify'
import { FormSheet, SelectField } from '@/pages/admin/schedule-bits'
import { post, useConfirm } from '@/pages/admin/user-billing'
import { Filter } from '@/pages/community'

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

type Target = { mode: 'change' | 'annul'; event: ClockEvent } | { mode: 'add'; day?: string } | { mode: 'reject'; correction: Correction }

// La hoja de las cuatro cosas que piden un motivo: cambiar la hora, anular, añadir el que falta y (el admin) rechazar.
function ClockSheet({ target, admin, profileId, onClose, onDone }: { target: Target; admin: boolean; profileId: string; onClose: () => void; onDone: () => void }) {
  const id = useId()
  const [reason, setReason] = useState('')
  const [kind, setKind] = useState<ClockKind>('in')
  const event = 'event' in target ? target.event : undefined
  const [day, setDay] = useState(event ? madridDay(event.at) : target.mode === 'add' && target.day ? target.day : madridDay())
  const [time, setTime] = useState(event ? formatTime(event.at) : '')
  const needsTime = target.mode === 'change' || target.mode === 'add'

  const send = useMutation({
    mutationFn: () => {
      const why = reason.trim()
      if (target.mode === 'reject') return api(`/admin/clock/corrections/${target.correction.id}/reject`, { method: 'POST', body: { reason: why } })
      const at = needsTime ? madridToIso(day, time) : undefined
      const body = target.mode === 'add' ? { kind, at, reason: why } : { event_id: event!.id, at, reason: why }
      return admin ? api('/admin/clock/corrections', { method: 'POST', body: { profile_id: profileId, ...body } }) : api('/me/clock/corrections', { method: 'POST', body })
    },
    onSuccess: () => toastOk(target.mode === 'reject' ? 'Corrección rechazada' : admin ? 'Corrección aplicada' : 'Corrección pedida'),
    onError: (err) => toastError(err),
    onSettled: onDone, // refresca también si falla: puede que la secuencia haya cambiado
  })

  const copy = {
    change: { title: 'Cambiar la hora', description: `${KIND_LABEL[event?.kind ?? 'in']} fichada a las ${event ? formatTime(event.at) : ''}.`, submit: 'Cambiar' },
    annul: { title: 'Anular el fichaje', description: `${KIND_LABEL[event?.kind ?? 'in']} de las ${event ? formatTime(event.at) : ''}: dejará de contar.`, submit: 'Anular' },
    add: { title: 'Añadir un fichaje', description: admin ? 'El que falta en su jornada.' : 'El que no llegaste a fichar.', submit: 'Añadir' },
    reject: { title: 'Rechazar la corrección', description: 'El profesor verá el motivo.', submit: 'Rechazar' },
  }[target.mode]
  const submit = target.mode === 'reject' || admin ? copy.submit : 'Pedir corrección'
  const notifies = admin && target.mode !== 'reject'

  return (
    <FormSheet
      open
      onClose={onClose}
      title={copy.title}
      description={copy.description}
      submitLabel={submit}
      disabled={!reason.trim() || (needsTime && (!day || !time))}
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
            <Input id={`${id}-time`} type="time" size="lg" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-reason`} className="text-sm font-medium">
          Motivo (obligatorio)
        </label>
        <Textarea id={`${id}-reason`} value={reason} maxLength={MAX_REASON} onChange={(e) => setReason(e.target.value)} />
        <p className="text-right text-xs text-muted-foreground tabular-nums">
          {reason.length} / {MAX_REASON}
        </p>
      </div>
    </FormSheet>
  )
}

const CORRECTION_TAG = { pending: 'warning', applied: 'success', rejected: 'error' } as const

function CorrectionRow({ c, text, admin, onReject, apply }: { c: Correction; text: string; admin: boolean; onReject: () => void; apply: () => void }) {
  return (
    <li className="flex flex-col gap-1.5 border-b px-4 py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-2">
        <span className="font-semibold">{text}</span>
        <Tag variant={CORRECTION_TAG[c.status]}>{STATUS_LABEL[c.status]}</Tag>
      </div>
      <p className="text-sm">{c.reason}</p>
      <p className="text-[13px] text-muted-foreground">
        Pedida por {authorName(c.requested_by)} · {formatDeadline(c.created_at)}
      </p>
      {c.resolved_at && (
        <p className="text-[13px] text-muted-foreground">
          {c.status === 'applied' ? 'Aplicada' : 'Rechazada'} por {authorName(c.resolved_by)} · {formatDeadline(c.resolved_at)}
          {c.resolution_reason && ` · ${c.resolution_reason}`}
        </p>
      )}
      {admin && c.status === 'pending' && (
        <div className="mt-1 flex gap-2">
          <Button size="lg" className="flex-1" onClick={apply}>
            Aplicar
          </Button>
          <Button size="lg" variant="outline" className="flex-1" onClick={onReject}>
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

// «Mi registro» y la jornada de un profesor en el panel: el mismo mes, con las correcciones. Solo el empleado corrige.
export function ClockLog({ data, admin = false, printTo, onChanged }: { data: ClockMonth; admin?: boolean; printTo: string; onChanged: () => void }) {
  const [target, setTarget] = useState<Target | null>(null)
  const { ask, dialog } = useConfirm(onChanged)
  const employee = data.profile.employment === 'employee'
  const pending = data.corrections.filter((c) => c.status === 'pending')
  const corrections = [...pending, ...data.corrections.filter((c) => c.status !== 'pending')]
  const days = [...data.days].reverse()

  const correctionsView = corrections.length > 0 && (
    <Section title={admin ? `Correcciones · ${pending.length} pendientes` : 'Correcciones'}>
      <ul className="overflow-hidden rounded-xl border bg-card">
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
  )

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-baseline justify-between gap-3 rounded-2xl border bg-card p-4">
        <span className="text-sm text-muted-foreground">Total del mes</span>
        <span className="font-heading text-3xl font-bold tabular-nums">{formatDuration(data.total_seconds)} h</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {employee && (
          <Button variant="outline" size="xl" className="flex-1" onClick={() => setTarget({ mode: 'add' })}>
            <PlusIcon />
            Añadir fichaje que falta
          </Button>
        )}
        <Button variant="outline" size="xl" render={<Link to={printTo} />}>
          <PrinterIcon />
          Imprimir
        </Button>
      </div>
      {!employee && (
        <Note kind="info" title="Autónomo">
          {admin ? 'No ficha ni tiene correcciones; aquí se ve lo que fichó cuando era empleado.' : 'Ya no fichas ni pides correcciones; aquí ves lo que fichaste cuando eras empleado.'}
        </Note>
      )}
      {admin && correctionsView}
      {days.length === 0 && <p className="rounded-xl border bg-card p-4 text-center text-sm text-muted-foreground">Sin fichajes este mes.</p>}
      {days.map((d) => (
        <Section key={d.date} title={formatDay(d.date)}>
          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-foreground/4 px-4 py-2.5">
              <span className="font-semibold tabular-nums">
                {formatDuration(d.worked_seconds)} h
                {d.pause_seconds > 0 && <span className="font-normal text-muted-foreground"> · pausas {formatDuration(d.pause_seconds)}</span>}
              </span>
              {d.open && <Tag variant="warning">Jornada abierta</Tag>}
            </div>
            <ul>
              {d.events.map((e) => {
                const original = e.corrected ? originalOf(data, e.id) : undefined
                return (
                  <li key={`${e.id}-${e.at}`} className="flex flex-col gap-1.5 border-b px-4 py-2.5 last:border-b-0">
                    <div className="flex items-center justify-between gap-2">
                      <span>
                        <span className="font-semibold tabular-nums">{formatTime(e.at)}</span> · {KIND_LABEL[e.kind]}
                      </span>
                      <span className="flex gap-1.5">
                        {e.origin === 'tablet' && <Tag>Tablet</Tag>}
                        {e.corrected && <Tag variant="info">Corregido</Tag>}
                      </span>
                    </div>
                    {original && <p className="text-[13px] text-muted-foreground">Fichado a las {formatTime(original.at)}</p>}
                    {employee && hasPending(data, e.id) && <Tag variant="warning">Corrección pendiente</Tag>}
                    {employee && !hasPending(data, e.id) && (
                      <div className="flex flex-wrap gap-2">
                        <Button size="lg" variant="outline" className="flex-1" onClick={() => setTarget({ mode: 'change', event: e })}>
                          {admin ? 'Corregir hora' : 'Pedir cambio de hora'}
                        </Button>
                        <Button size="lg" variant="outline" className="flex-1" onClick={() => setTarget({ mode: 'annul', event: e })}>
                          {admin ? 'Anular' : 'Pedir anularlo'}
                        </Button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        </Section>
      ))}
      {!admin && correctionsView}
      {target && (
        <ClockSheet
          key={target.mode + ('event' in target ? target.event.id : 'correction' in target ? target.correction.id : '')}
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
