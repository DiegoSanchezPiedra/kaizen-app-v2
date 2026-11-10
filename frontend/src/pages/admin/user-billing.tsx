import { useMutation } from '@tanstack/react-query'
import { WalletIcon } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Kv, Tag } from '@/components/billing-bits'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/screen-state'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { toastManager } from '@/components/ui/toast'
import { payerCandidates, type ProfileFile } from '@/lib/admin'
import { api } from '@/lib/api'
import {
  changesLeft,
  disciplineLocked,
  eligibleDisciplines,
  freeChange,
  isLive,
  keepDisciplines,
  perMonth,
  planChange,
  planLock,
  visiblePlans,
} from '@/lib/billing'
import { errorText } from '@/lib/errors'
import { formatDeadline, formatShortDate } from '@/lib/format'
import { errorCode, toastError, toastOk } from '@/lib/notify'
import { refreshBookings, useDisciplines, usePlans } from '@/lib/queries'
import { Filter } from '@/pages/community'

type Sub = NonNullable<ProfileFile['subscription']>

const SUB_BADGE: Record<string, [string, 'success' | 'warning' | 'error']> = {
  active: ['Activa', 'success'],
  past_due: ['En gracia', 'warning'],
  unpaid: ['Impagada', 'error'],
}
export function SubBadge({ status }: { status: string | null | undefined }) {
  const b = status ? SUB_BADGE[status] : undefined
  return b ? <Tag variant={b[1]}>{b[0]}</Tag> : <Tag>Sin cuota</Tag>
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
  const self = !minor // «solo menores», solo para un menor
  const [planId, setPlanId] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const all = plans.data ?? []
  const current = all.find((p) => String(p.id) === String(s.plan.id))
  const list = visiblePlans(all, self).filter((p) => p !== current)
  const target = list.find((p) => String(p.id) === planId)
  const eligible = target ? eligibleDisciplines(target, disciplines.data ?? [], self) : []
  const max = target?.max_disciplines ?? null
  const kind = target ? planChange(s.plan.price_cents, target, self && !!current?.minors_only) : null
  const period = s.current_period_end ? `el ${formatShortDate(s.current_period_end)}` : 'al renovar'

  const pick = (id: string) => {
    setPlanId(id)
    const p = list.find((x) => String(x.id) === id)
    if (p) setPicked(keepDisciplines(s.disciplines.map((d) => d.id), eligibleDisciplines(p, disciplines.data ?? [], self), p.max_disciplines))
  }
  const change = useMutation({
    mutationFn: () =>
      api<{ change: 'upgrade' | 'downgrade'; scheduled_at?: string }>(`/admin/subscriptions/${s.id}/plan`, {
        method: 'POST',
        body: { plan_id: target!.id, discipline_ids: picked },
      }),
    onSuccess: (r) =>
      toastOk(r.change === 'upgrade' ? `Plan cambiado a ${target!.name}` : `Cambio a ${target!.name} programado para ${r.scheduled_at ? `el ${formatShortDate(r.scheduled_at)}` : period}`),
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
            : `Pasa a ${target.name} ${period}; hasta entonces sigue igual. Se avisa al pagador.`
      }
      confirmLabel={kind === 'up' ? 'Cambiar y cobrar' : 'Programar el cambio'}
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
function DisciplineDialog({ s, minor, onClose, refresh }: { s: Sub; minor: boolean; onClose: () => void; refresh: () => void }) {
  const plans = usePlans()
  const disciplines = useDisciplines()
  const self = !minor
  const [from, setFrom] = useState(String(s.disciplines[0]?.id ?? ''))
  const [to, setTo] = useState('')
  const all = disciplines.data ?? []
  const plan = plans.data?.find((p) => String(p.id) === String(s.plan.id))
  const chosen = s.disciplines.map((d) => String(d.id))
  // Un plan retirado no sale en /plans: entonces, todas las que el backend aceptaría.
  const options = (plan ? eligibleDisciplines(plan, all, self) : all.filter((d) => d.is_active && !d.is_open && !(self && d.minors_only))).filter(
    (d) => !chosen.includes(String(d.id)),
  )
  const fromName = s.disciplines.find((d) => String(d.id) === from)?.name ?? ''
  const free = freeChange(
    all.find((d) => String(d.id) === from),
    self,
  )
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

function Section({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <h2 className="font-semibold">{title}</h2>
      {children}
      {actions && <div className="flex flex-wrap gap-2 border-t pt-3">{actions}</div>}
    </section>
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
  const [dialog, setDialog] = useState<'plan' | 'discipline' | 'payer' | null>(null)
  const { ask, dialog: confirm } = useConfirm(refresh)
  const pc = s.payer_change
  const people = [file.profile, ...file.guardians]
  const lock = planLock(s)
  const scheduled = s.scheduled_change
  const end = s.current_period_end ? formatShortDate(s.current_period_end) : null

  const rows: [string, React.ReactNode][] = [
    ['Plan', `${s.plan.name} · ${perMonth(s.plan.price_cents)}`],
    ['Disciplinas', s.plan.max_disciplines === null ? 'Todas' : s.disciplines.map((d) => d.name).join(', ') || '—'],
    ['Estado', <SubBadge status={s.status} />],
    ['Fin del periodo', end ?? '—'],
    ['Pagador', <PersonLink p={s.payer} />],
  ]
  if (s.cancel_at_period_end) rows.push(['Baja programada', end ? `Termina el ${end}` : 'Sí'])
  if (scheduled) rows.push(['Bajada programada', `A ${scheduled.plan_name} el ${formatShortDate(scheduled.scheduled_at)}`])
  if (s.discipline_changes_left != null) rows.push(['Cambios de disciplina', changesLeft(s.discipline_changes_left)])
  if (pc) {
    const to = people.find((p) => p.id === pc.new_payer_id)
    rows.push([
      'Cambio de pagador',
      pc.status === 'paid'
        ? `Pagado: desde el ${formatShortDate(pc.starts_at)} paga ${name(to)}`
        : `${name(to)} tiene hasta el ${formatDeadline(pc.deadline)} para pagar`,
    ])
  }

  return (
    <Section
      title="Cuota"
      actions={
        <>
          <Button variant="outline" disabled={!!lock} title={lock ?? undefined} onClick={() => setDialog('plan')}>
            Cambiar de plan
          </Button>
          {s.plan.max_disciplines !== null && (
            <Button variant="outline" disabled={disciplineLocked(s)} onClick={() => setDialog('discipline')}>
              Cambiar de disciplina
            </Button>
          )}
          <Button variant="outline" disabled={!!pc || !!s.cancel_at_period_end || payerCandidates(file).length === 0} onClick={() => setDialog('payer')}>
            Cambiar de pagador
          </Button>
          {scheduled && (
            <Button
              variant="outline"
              onClick={() =>
                ask({
                  title: 'Anular la bajada programada',
                  description: `Seguirá en ${s.plan.name} al renovar.`,
                  label: 'Anular la bajada',
                  done: 'Bajada anulada',
                  run: del(`/admin/subscriptions/${s.id}/plan/scheduled`),
                })
              }
            >
              Anular la bajada
            </Button>
          )}
          {pc?.status === 'requested' && (
            <Button
              variant="outline"
              onClick={() =>
                ask({
                  title: 'Anular el cambio de pagador',
                  description: `Sigue pagando ${name(s.payer)}.`,
                  label: 'Anular el cambio',
                  done: 'Cambio de pagador anulado',
                  run: del(`/admin/subscriptions/${s.id}/payer-change`),
                })
              }
            >
              Anular el cambio de pagador
            </Button>
          )}
          {!s.cancel_at_period_end && (
            <Button
              variant="outline"
              onClick={() =>
                ask({
                  title: 'Baja a fin de periodo',
                  description: `Sigue en vigor hasta ${end ? `el ${end}` : 'el fin del periodo'} y no se renueva. Se avisa al pagador.${scheduled ? ' La bajada programada se descarta.' : ''}${pc ? ' El cambio de pagador se anula.' : ''}`,
                  label: 'Dar de baja',
                  done: 'Baja programada',
                  destructive: true,
                  run: post(`/admin/subscriptions/${s.id}/cancel-at-period-end`),
                })
              }
            >
              Baja a fin de periodo
            </Button>
          )}
          <Button
            variant="destructive-outline"
            onClick={() =>
              ask({
                title: 'Baja inmediata',
                description: `Termina ya: anula los recibos pendientes y cancela sus reservas futuras. Se avisa al pagador.${scheduled ? ' La bajada programada se descarta.' : ''}`,
                label: 'Dar de baja ya',
                done: 'Cuota dada de baja',
                destructive: true,
                run: post(`/admin/subscriptions/${s.id}/cancel-now`),
              })
            }
          >
            Baja inmediata
          </Button>
        </>
      }
    >
      <Kv rows={rows} />
      {confirm}
      {dialog === 'plan' && <PlanDialog s={s} minor={minor} onClose={() => setDialog(null)} refresh={refresh} />}
      {dialog === 'discipline' && <DisciplineDialog s={s} minor={minor} onClose={() => setDialog(null)} refresh={refresh} />}
      {dialog === 'payer' && <PayerDialog file={file} onClose={() => setDialog(null)} refresh={refresh} />}
    </Section>
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
