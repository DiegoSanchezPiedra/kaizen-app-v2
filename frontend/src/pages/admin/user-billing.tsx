import { useMutation } from '@tanstack/react-query'
import { ArrowDownIcon, CircleAlertIcon, CircleCheckIcon, CircleDashedIcon, ClockIcon, PauseIcon, UserRoundIcon, WalletIcon, type LucideIcon } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Kv, Tag } from '@/components/billing-bits'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { PauseSheet } from '@/components/pause-sheet'
import { EmptyState } from '@/components/screen-state'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { toastManager } from '@/components/ui/toast'
import { payerCandidates, type ProfileFile } from '@/lib/admin'
import { api } from '@/lib/api'
import {
  canEndEarly,
  changesLeft,
  disciplineLocked,
  inPlan,
  isLive,
  planDisciplines,
  keepDisciplines,
  PAUSE_LOCK,
  pauseFee,
  pauseLock,
  pastPlanMax,
  pauseTitle,
  perMonth,
  planChange,
  planLock,
  visiblePlans,
} from '@/lib/billing'
import { errorText } from '@/lib/errors'
import { formatDeadline, formatShortDate } from '@/lib/format'
import { errorCode, toastError, toastOk } from '@/lib/notify'
import { refreshBookings, useDisciplines, usePlans } from '@/lib/queries'
import { Filter } from '@/components/filter'
import { FormSheet, TextField } from '@/pages/admin/schedule-bits'

type Sub = NonNullable<ProfileFile['subscription']>

const SUB_BADGE: Record<string, [string, 'success' | 'warning' | 'error', LucideIcon]> = {
  active: ['Activa', 'success', CircleCheckIcon],
  past_due: ['En gracia', 'warning', ClockIcon],
  unpaid: ['Impagada', 'error', CircleAlertIcon],
}
// Estado de la cuota con icono y texto (DESIGN.md: nunca solo color).
export function SubBadge({ status }: { status: string | null | undefined }) {
  const [label, variant, Icon] = (status && SUB_BADGE[status]) || ['Sin cuota', 'outline' as const, CircleDashedIcon]
  return (
    <Tag variant={variant}>
      <Icon aria-hidden="true" />
      {label}
    </Tag>
  )
}

const name = (p: { display_name: string | null } | undefined) => p?.display_name ?? 'Sin nombre'

// Una acción con su AlertDialog (docs/pantallas-b19.md § Reglas de UI): dice qué pasa y a quién se avisa.
// `done` puede ser una función del resultado (los avisados, los que pasan de la espera).
type Ask = { title: string; description: string; label: string; done: string | ((result: any) => string); run: () => Promise<unknown>; destructive?: boolean }
export function useConfirm(refresh: () => void) {
  const [ask, setAsk] = useState<Ask | null>(null)
  const act = useMutation({
    mutationFn: (a: Ask) => a.run(),
    onSuccess: (r, a) => toastOk(typeof a.done === 'function' ? a.done(r) : a.done),
    onError: (err) => toastError(err),
    onSettled: () => {
      setAsk(null)
      refresh()
    },
  })
  const dialog = (
    <ConfirmDialog
      open={ask !== null}
      onOpenChange={(o) => !o && !act.isPending && setAsk(null)}
      title={ask?.title ?? ''}
      description={ask?.description ?? ''}
      confirmLabel={ask?.label ?? ''}
      variant={ask?.destructive ? 'destructive' : 'default'}
      loading={act.isPending}
      onConfirm={() => ask && act.mutate(ask)}
    />
  )
  return { ask: setAsk, dialog }
}

export const post = (url: string) => () => api(url, { method: 'POST' })
export const del = (url: string) => () => api(url, { method: 'DELETE' })

// Cambiar de plan (B10.5): subida = se cobra ya la parte proporcional al pagador; bajada = a la renovación.
function PlanDialog({ s, minor, onClose, refresh }: { s: Sub; minor: boolean; onClose: () => void; refresh: () => void }) {
  const plans = usePlans()
  const disciplines = useDisciplines()
  // shortcut: la API del admin no da la fecha de nacimiento; un adulto cuenta como 18 y un menor no se filtra (decide el backend).
  // Exacto para máximas ≤ 17 y mínimas ≤ 18; si hay planes de otros rangos, dar la fecha en la ficha del admin.
  const birth = minor ? undefined : null
  const [planId, setPlanId] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const all = plans.data ?? []
  const current = all.find((p) => String(p.id) === String(s.plan.id))
  const list = visiblePlans(all, birth).filter((p) => p !== current)
  const target = list.find((p) => String(p.id) === planId)
  // Sin la edad: la API del admin no da la fecha de nacimiento (409 discipline_not_eligible si no entra).
  const eligible = target ? planDisciplines(target, disciplines.data ?? []) : []
  const max = target?.max_disciplines ?? null
  const kind = target ? planChange(s.plan.price_cents, target, !!current && pastPlanMax(current, birth)) : null
  const period = s.current_period_end ? `el ${formatShortDate(s.current_period_end)}` : 'al renovar'

  const pick = (id: string) => {
    setPlanId(id)
    const p = list.find((x) => String(x.id) === id)
    if (p) setPicked(keepDisciplines(s.disciplines.map((d) => d.id), planDisciplines(p, disciplines.data ?? []), p.max_disciplines))
  }
  const change = useMutation({
    mutationFn: () =>
      api<{ change: 'upgrade' | 'downgrade' | 'age_change'; scheduled_at?: string }>(`/admin/subscriptions/${s.id}/plan`, {
        method: 'POST',
        body: { plan_id: target!.id, discipline_ids: picked },
      }),
    onSuccess: (r) =>
      toastOk(r.change !== 'downgrade' ? `Plan cambiado a ${target!.name}` : `Cambio a ${target!.name} programado para ${r.scheduled_at ? `el ${formatShortDate(r.scheduled_at)}` : period}`),
    onError: (err) =>
      errorCode(err) === 'requires_payer_action' ? toastManager.add({ type: 'info', title: errorText('requires_payer_action'), timeout: 6000 }) : toastError(err),
    onSettled: () => {
      onClose()
      refresh()
    },
  })

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && !change.isPending && onClose()}
      title="Cambiar de plan"
      description={
        !target
          ? 'Elige el plan nuevo.'
          : kind === 'up'
            ? `Se cobra ya al pagador (${name(s.payer)}) la parte proporcional de ${target.name}. Si su banco pide autorizarlo, le llega un email.`
            : kind === 'now'
              ? `Pasa ya a ${target.name}, sin cobro ni devolución: lo pagado de este periodo se queda como está.`
              : `Pasa a ${target.name} ${period}; hasta entonces sigue igual. Se avisa al pagador.`
      }
      confirmLabel={kind === 'up' ? 'Cambiar y cobrar' : kind === 'now' ? 'Cambiar ya' : 'Programar el cambio'}
      variant="default"
      disabled={!target || (max !== null && picked.length !== max)}
      loading={change.isPending}
      onConfirm={() => change.mutate()}
    >
      <Filter
        label="Plan nuevo"
        value={planId || 'none'}
        onChange={pick}
        items={[{ value: 'none', label: 'Elige un plan' }, ...list.map((p) => ({ value: String(p.id), label: `${p.name} · ${perMonth(p.price_cents)}` }))]}
      />
      {target && max !== null && eligible.length > max && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-semibold">
            Elige {max === 1 ? 'la disciplina' : `${max} disciplinas`} ({picked.length} de {max})
          </legend>
          {eligible.map((d) => {
            const on = picked.includes(String(d.id))
            return (
              <label key={d.id} className="flex min-h-11 items-center gap-3 rounded-lg border px-3 has-data-disabled:opacity-64">
                <Checkbox
                  checked={on}
                  disabled={!on && picked.length >= max}
                  onCheckedChange={(c) => setPicked((xs) => (c ? [...xs, String(d.id)] : xs.filter((x) => x !== String(d.id))))}
                />
                {d.name}
              </label>
            )
          })}
        </fieldset>
      )}
    </ConfirmDialog>
  )
}

// Cambiar de disciplina (ADR 0007): inmediato; gratis si la que deja ya no se cubría.
// La API del admin no da la fecha de nacimiento: la edad la decide el backend (409 discipline_not_eligible).
function DisciplineDialog({ s, onClose, refresh }: { s: Sub; onClose: () => void; refresh: () => void }) {
  const plans = usePlans()
  const disciplines = useDisciplines()
  const [from, setFrom] = useState(String(s.disciplines[0]?.id ?? ''))
  const [to, setTo] = useState('')
  const all = disciplines.data ?? []
  const plan = plans.data?.find((p) => String(p.id) === String(s.plan.id))
  const chosen = s.disciplines.map((d) => String(d.id))
  // Un plan retirado no sale en /plans: entonces, todas las activas.
  const options = all.filter((d) => d.is_active && !d.is_open && (!plan || inPlan(plan, d)) && !chosen.includes(String(d.id)))
  const fromName = s.disciplines.find((d) => String(d.id) === from)?.name ?? ''
  // Gratis solo si la que deja está desactivada (sin edad, el backend responde `free`).
  const fromD = all.find((d) => String(d.id) === from)
  const free = !!fromD && !fromD.is_active
  const change = useMutation({
    mutationFn: () => api<{ changes_left: number; free: boolean }>(`/admin/subscriptions/${s.id}/disciplines`, { method: 'POST', body: { from_id: from, to_id: to } }),
    onSuccess: (r) => toastOk('Disciplina cambiada', r.free ? 'No ha gastado ningún cambio.' : `${changesLeft(r.changes_left)}.`),
    onError: (err) => toastError(err),
    onSettled: () => {
      onClose()
      refresh()
      void refreshBookings()
    },
  })
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && !change.isPending && onClose()}
      title="Cambiar de disciplina"
      description={`Es inmediato y cancela sus reservas de ${fromName || 'la que deja'}. ${free ? 'Es gratis: esa ya no se cubría.' : `${changesLeft(s.discipline_changes_left ?? 0)} en este periodo.`}`}
      confirmLabel="Cambiar"
      variant="default"
      disabled={!from || !to}
      loading={change.isPending}
      onConfirm={() => change.mutate()}
    >
      <Filter label="Deja" value={from} onChange={setFrom} items={s.disciplines.map((d) => ({ value: String(d.id), label: `Deja ${d.name}` }))} />
      <Filter
        label="Pasa a"
        value={to || 'none'}
        onChange={(v) => setTo(v === 'none' ? '' : v)}
        items={[{ value: 'none', label: 'Elige a cuál pasa' }, ...options.map((d) => ({ value: String(d.id), label: d.name }))]}
      />
    </ConfirmDialog>
  )
}

// Cambiar de pagador (B11): el nuevo paga desde la app antes de la fecha límite; si no, sigue el de ahora.
function PayerDialog({ file, onClose, refresh }: { file: ProfileFile; onClose: () => void; refresh: () => void }) {
  const s = file.subscription!
  const candidates = payerCandidates(file)
  const [payer, setPayer] = useState(candidates[0]?.id ?? '')
  const change = useMutation({
    mutationFn: () => api<{ deadline: string }>(`/admin/subscriptions/${s.id}/payer-change`, { method: 'POST', body: { payer_id: payer } }),
    onSuccess: (r) => toastOk('Cambio de pagador pedido', `Tiene hasta el ${formatDeadline(r.deadline)} para pagar.`),
    onError: (err) => toastError(err),
    onSettled: () => {
      onClose()
      refresh()
    },
  })
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && !change.isPending && onClose()}
      title="Cambiar de pagador"
      description={`El nuevo pagador recibe un email y tiene unos días para pagar; si no paga a tiempo, sigue pagando ${name(s.payer)}.`}
      confirmLabel="Pedir el cambio"
      variant="default"
      disabled={!payer}
      loading={change.isPending}
      onConfirm={() => change.mutate()}
    >
      <Filter label="Nuevo pagador" value={payer} onChange={setPayer} items={candidates.map((p) => ({ value: p.id, label: name(p) }))} />
    </ConfirmDialog>
  )
}

// Eximir una pausa de la cuota de mantenimiento (B30): motivo obligatorio, queda en la auditoría.
function ExemptDialog({ pauseId, onClose, refresh }: { pauseId: string; onClose: () => void; refresh: () => void }) {
  const [reason, setReason] = useState('')
  const exempt = useMutation({
    mutationFn: () => api<{ exempt_from: string }>(`/admin/pauses/${pauseId}/exempt`, { method: 'POST', body: { reason: reason.trim() } }),
    onSuccess: (r) => toastOk('Pausa eximida', `Sin cuota de mantenimiento desde el ${formatShortDate(r.exempt_from)}. Lo ya cobrado no se devuelve.`),
    onError: (err) => toastError(err),
    onSettled: refresh,
  })
  return (
    <FormSheet
      open
      onClose={onClose}
      title="Eximir de la cuota de mantenimiento"
      description="Esta pausa no cobra cuota de mantenimiento (0 €). Si ya ha empezado, vale desde el siguiente cobro; lo ya cobrado no se devuelve."
      submitLabel="Eximir"
      disabled={!reason.trim()}
      loading={exempt.isPending}
      confirm={{ title: '¿Eximir la pausa?', description: 'No se puede deshacer desde la app. El motivo queda en la auditoría.' }}
      onSubmit={() => exempt.mutateAsync()}
    >
      <TextField label="Motivo" value={reason} onChange={setReason} maxLength={500} hint="Obligatorio, hasta 500 caracteres." />
    </FormSheet>
  )
}

// Un grupo de acciones de la cuota con su título y, si alguna no se puede, el porqué a la vista (no en un title).
function Group({ title, children, note }: { title: string; children: React.ReactNode; note?: string | null }) {
  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">{children}</div>
      {note && <p className="text-sm text-muted-foreground">{note}</p>}
    </div>
  )
}
const ACT = 'max-sm:h-11'

// Algo en curso (cambio de pagador, pausa, bajada o baja programada) con su acción al lado.
function Pending({ icon, title, text, action, variant = 'info' }: { icon: React.ReactNode; title: string; text?: string; action?: React.ReactNode; variant?: 'info' | 'warning' }) {
  return (
    // El icono, en la variante «-texto» del color: el de base no llega a 3:1 sobre el aviso claro.
    <Alert variant={variant} role="status" className={variant === 'info' ? '[&>svg]:text-info-foreground' : '[&>svg]:text-warning-foreground'}>
      {icon}
      <AlertTitle>{title}</AlertTitle>
      {text && <AlertDescription>{text}</AlertDescription>}
      {action && <AlertAction className="flex-wrap max-sm:flex-col max-sm:items-stretch">{action}</AlertAction>}
    </Alert>
  )
}

const PersonLink = ({ p }: { p: { id: string; display_name: string | null } }) => (
  <Link to={`/admin/users/${p.id}`} className="text-link underline-offset-3 hover:underline">
    {name(p)}
  </Link>
)

function Subscription({ file, refresh }: { file: ProfileFile; refresh: () => void }) {
  const s = file.subscription!
  const minor = file.profile.is_minor
  const [dialog, setDialog] = useState<'plan' | 'discipline' | 'payer' | 'pause' | 'exempt' | null>(null)
  const { ask, dialog: confirm } = useConfirm(refresh)
  const pc = s.payer_change
  const people = [file.profile, ...file.guardians]
  const lock = planLock(s)
  const scheduled = s.scheduled_change
  const pause = s.pause
  const pLock = pauseLock(s)
  const end = s.current_period_end ? formatShortDate(s.current_period_end) : null

  const rows: [string, React.ReactNode][] = [
    ['Plan', `${s.plan.name} · ${perMonth(s.plan.price_cents)}`],
    ['Disciplinas', s.plan.max_disciplines === null ? 'Todas' : s.disciplines.map((d) => d.name).join(', ') || '—'],
    ['Estado', <SubBadge key="status" status={s.status} />],
    ['Fin del periodo', end ?? '—'],
    ['Pagador', <PersonLink key="payer" p={s.payer} />],
  ]
  if (s.discipline_changes_left != null) rows.push(['Cambios de disciplina', changesLeft(s.discipline_changes_left)])
  const to = people.find((p) => p.id === pc?.new_payer_id)
  const candidates = payerCandidates(file).length > 0
  const payerNote = !lock && !candidates ? 'Para cambiar de pagador hace falta otro adulto: un tutor vinculado.' : null
  const btn = (label: string, onClick: () => void, o: { disabled?: boolean; destructive?: boolean; small?: boolean } = {}) => (
    <Button variant={o.destructive ? 'destructive-outline' : 'outline'} size={o.small ? 'sm' : 'default'} className={ACT} disabled={o.disabled} onClick={onClick}>
      {label}
    </Button>
  )

  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4" aria-labelledby="sub-title">
      <h2 id="sub-title" className="font-semibold">
        Cuota
      </h2>
      {pc && (
        <Pending
          icon={<UserRoundIcon />}
          title={pc.status === 'paid' ? `Cambio de pagador pagado: desde el ${formatShortDate(pc.starts_at)} paga ${name(to)}` : `Cambio de pagador en curso: ${name(to)} tiene hasta el ${formatDeadline(pc.deadline)} para pagar`}
          text={pc.status === 'requested' ? `Si no paga a tiempo, sigue pagando ${name(s.payer)}.` : undefined}
          action={
            pc.status === 'requested' &&
            btn(
              'Anular el cambio',
              () =>
                ask({
                  title: 'Anular el cambio de pagador',
                  description: `Sigue pagando ${name(s.payer)}.`,
                  label: 'Anular el cambio',
                  done: 'Cambio de pagador anulado',
                  run: del(`/admin/subscriptions/${s.id}/payer-change`),
                }),
              { small: true },
            )
          }
        />
      )}
      {pause && (
        <Pending
          icon={<PauseIcon />}
          title={pauseTitle(pause)}
          text={`${pauseFee(pause)}. ${PAUSE_LOCK}`}
          action={
            <>
              {(pause.status === 'scheduled' || canEndEarly(s)) &&
                btn(
                  pause.status === 'scheduled' ? 'Anular la pausa' : 'Volver antes',
                  () =>
                    ask(
                      pause.status === 'scheduled'
                        ? {
                            title: 'Anular la pausa',
                            description: `Gratis: sigue en ${s.plan.name} como hasta ahora. Las reservas canceladas al pedirla no vuelven. Se avisa al pagador.`,
                            label: 'Anular la pausa',
                            done: 'Pausa anulada',
                            run: del(`/admin/subscriptions/${s.id}/pause`),
                          }
                        : {
                            title: 'Volver antes de la pausa',
                            description: `Vuelve a ${s.plan.name} en la siguiente fecha de cobro${end ? `, el ${end}` : ''}, sin prorrateo. Se avisa al pagador.`,
                            label: 'Volver antes',
                            done: 'Vuelta anticipada programada',
                            run: del(`/admin/subscriptions/${s.id}/pause`),
                          },
                    ),
                  { small: true },
                )}
              {!pause.exempt && btn('Eximir de la cuota de mantenimiento', () => setDialog('exempt'), { small: true })}
            </>
          }
        />
      )}
      {scheduled && (
        <Pending
          icon={<ArrowDownIcon />}
          title={`Bajada programada a ${scheduled.plan_name} el ${formatShortDate(scheduled.scheduled_at)}`}
          action={btn(
            'Anular la bajada',
            () =>
              ask({
                title: 'Anular la bajada programada',
                description: `Seguirá en ${s.plan.name} al renovar.`,
                label: 'Anular la bajada',
                done: 'Bajada anulada',
                run: del(`/admin/subscriptions/${s.id}/plan/scheduled`),
              }),
            { small: true },
          )}
        />
      )}
      {s.cancel_at_period_end && <Pending variant="warning" icon={<CircleAlertIcon />} title={end ? `Baja programada: termina el ${end}` : 'Baja programada a fin de periodo'} />}
      <Kv rows={rows} />
      <Group title="Cambios" note={pause ? null : (lock ?? payerNote)}>
        {btn('Cambiar de plan', () => setDialog('plan'), { disabled: !!lock })}
        {s.plan.max_disciplines !== null && btn('Cambiar de disciplina', () => setDialog('discipline'), { disabled: disciplineLocked(s) })}
        {btn('Cambiar de pagador', () => setDialog('payer'), { disabled: !!pc || !!pause || !!s.cancel_at_period_end || !candidates })}
      </Group>
      {!pause && (
        <Group title="Pausa" note={pLock}>
          {btn('Pausar la membresía', () => setDialog('pause'), { disabled: !!pLock })}
        </Group>
      )}
      <Group title="Baja">
        {!s.cancel_at_period_end &&
          btn('Baja a fin de periodo', () =>
            ask({
              title: 'Baja a fin de periodo',
              description: `Sigue en vigor hasta ${end ? `el ${end}` : 'el fin del periodo'} y no se renueva. Se avisa al pagador.${scheduled ? ' La bajada programada se descarta.' : ''}${pause ? ' La pausa se descarta.' : ''}${pc ? ' El cambio de pagador se anula.' : ''}`,
              label: 'Dar de baja',
              done: 'Baja programada',
              destructive: true,
              run: post(`/admin/subscriptions/${s.id}/cancel-at-period-end`),
            }),
          )}
        {btn(
          'Baja inmediata',
          () =>
            ask({
              title: 'Baja inmediata',
              description: `Termina ya: anula los recibos pendientes y cancela sus reservas futuras. Se avisa al pagador.${scheduled ? ' La bajada programada se descarta.' : ''}${pause ? ' La pausa se descarta.' : ''}`,
              label: 'Dar de baja ya',
              done: 'Cuota dada de baja',
              destructive: true,
              run: post(`/admin/subscriptions/${s.id}/cancel-now`),
            }),
          { destructive: true },
        )}
      </Group>
      {confirm}
      {dialog === 'plan' && <PlanDialog s={s} minor={minor} onClose={() => setDialog(null)} refresh={refresh} />}
      {dialog === 'discipline' && <DisciplineDialog s={s} onClose={() => setDialog(null)} refresh={refresh} />}
      {dialog === 'payer' && <PayerDialog file={file} onClose={() => setDialog(null)} refresh={refresh} />}
      {dialog === 'pause' && (
        <PauseSheet
          s={s}
          name={name(file.profile)}
          admin
          request={(months) => api(`/admin/subscriptions/${s.id}/pause`, { method: 'POST', body: { months } })}
          onClose={() => setDialog(null)}
          onDone={() => {
            refresh()
            void refreshBookings()
          }}
        />
      )}
      {dialog === 'exempt' && pause && <ExemptDialog pauseId={pause.id} onClose={() => setDialog(null)} refresh={refresh} />}
    </section>
  )
}

// docs/pantallas-b19.md § Usuarios › Cuota. El admin no contrata por el alumno: lo hace el pagador.
export function BillingTab({ file, refresh }: { file: ProfileFile; refresh: () => void }) {
  const s = file.subscription && isLive(file.subscription.status) ? file.subscription : null
  return (
    <div className="flex flex-col gap-4">
      {s ? (
        <Subscription file={file} refresh={refresh} />
      ) : (
        <EmptyState icon={<WalletIcon />} title="No tiene cuota" text="La contrata quien la paga, desde su cuenta." />
      )}
    </div>
  )
}
