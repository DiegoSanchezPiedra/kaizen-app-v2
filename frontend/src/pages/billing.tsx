import { useMutation } from '@tanstack/react-query'
import type React from 'react'
import { LockIcon, PauseIcon, UsersIcon, WalletIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Back, Kv, Note, OptionCard, StickyFooter, Tag } from '@/components/billing-bits'
import { usePortal } from '@/hooks/use-portal'
import { bankConfirms } from '@/lib/stripe'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Page } from '@/components/page'
import { PauseSheet } from '@/components/pause-sheet'
import { EmptyState, ErrorState, ListSkeleton, QueryView } from '@/components/screen-state'
import { SubjectGate, subjectName } from '@/components/subject-gate'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup } from '@/components/ui/radio-group'
import { Sheet, SheetDescription, SheetFooter, SheetHeader, SheetPanel, SheetPopup, SheetTitle, SheetClose, SheetTrigger } from '@/components/ui/sheet'
import { useSubject } from '@/hooks/use-subject'
import { ApiError, api } from '@/lib/api'
import {
  canEndEarly,
  changesLeft,
  disciplineLocked,
  eligibleDisciplines,
  fitsAge,
  freeChange,
  isLive,
  keepDisciplines,
  pauseFee,
  pauseLock,
  pauseTitle,
  perMonth,
  planChange,
  planLock,
  visiblePlans,
} from '@/lib/billing'
import { errorText } from '@/lib/errors'
import { formatDeadline, formatShortDate } from '@/lib/format'
import { errorCode, toastError, toastOk } from '@/lib/notify'
import { path, refreshBilling, refreshBookings, useDisciplines, usePlans, useSubscription } from '@/lib/queries'
import { useSession } from '@/lib/session'
import { ageRangeLabel } from '@/lib/catalog'
import type { Subject } from '@/lib/subject'
import type { Subscription } from '@/lib/types'

type Props = { subject: Subject | null; profileId?: string }

const names = (xs: { name: string }[]) => xs.map((x) => x.name).join(', ').replace(/, ([^,]*)$/, ' y $1')
const BADGE: Record<string, [string, 'success' | 'warning' | 'error' | 'secondary']> = {
  active: ['Activa', 'success'],
  past_due: ['Cobro pendiente', 'warning'],
  unpaid: ['Impagada', 'error'],
  incomplete: ['Pendiente de pago', 'secondary'],
}

// Los cambios de plan los aplica el webhook: se espera un poco a verlos antes de volver a Mi cuota.
async function waitForSubscription(profileId: string | undefined, done: (s: Subscription) => boolean) {
  for (let i = 0; i < 10; i++) {
    const s = await api<Subscription>(path('/billing/subscription', { profile_id: profileId })).catch(() => null)
    if (s && done(s)) return
    await new Promise((r) => setTimeout(r, 1500))
  }
}

// ── Mi cuota ─────────────────────────────────────────────────────────────

function Lock({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-sm text-muted-foreground">
      <LockIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  )
}

function PayerChangeNote({ s, me, price, name }: { s: Subscription; me?: string; price: string; name?: string }) {
  const pc = s.payer_change
  if (!pc) return null
  const mine = pc.new_payer_id === me
  if (pc.status === 'expired') {
    return <Note kind="info" title="El cambio de pagador ha caducado">No se pagó a tiempo: sigue pagando quien pagaba. Para intentarlo otra vez, pídeselo a la academia.</Note>
  }
  if (pc.status === 'paid') {
    return (
      <Note kind="info" title="Cambio de pagador confirmado">
        Desde el {formatShortDate(pc.starts_at)} {mine ? 'pagas tú la cuota' : 'paga la cuota otra persona'}. Hasta entonces sigue igual.
      </Note>
    )
  }
  if (mine) {
    return (
      <Note
        kind="warning"
        title={name ? `Te toca pagar la cuota de ${name}` : 'Te toca pagar tu cuota'}
        action={
          <Button size="lg" variant="outline" render={<Link to={`/billing/payer-changes/${pc.id}`} />}>
            Revisar y pagar
          </Button>
        }
      >
        Hoy no se cobra nada; desde el {formatShortDate(pc.starts_at)}, {price}. Tienes hasta el {formatDeadline(pc.deadline)}.
      </Note>
    )
  }
  return (
    <Note kind="info" title="Cambio de pagador en marcha">
      Si la otra persona paga antes del {formatDeadline(pc.deadline)}, desde el {formatShortDate(pc.starts_at)} pagará ella. Hasta que termine no se pueden cambiar el plan ni las
      disciplinas.
    </Note>
  )
}

function PayerSheet() {
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="ghost" size="xl" className="justify-start" />}>
        <UsersIcon />
        <span className="flex flex-col items-start">
          <span className="font-semibold">Que pague otra persona</span>
          <span className="text-[13px] font-normal text-muted-foreground">Lo cambia la academia</span>
        </span>
      </SheetTrigger>
      <SheetPopup side="bottom">
        <SheetHeader>
          <SheetTitle>Que pague otra persona</SheetTitle>
          <SheetDescription>
            El cambio de pagador lo hace la academia: pídeselo. Puede pagar un tutor vinculado o, si es mayor de edad, el propio alumno.
          </SheetDescription>
        </SheetHeader>
        <SheetPanel>
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-[15px]">
            <li>La otra persona recibe un email con un enlace a la app.</li>
            <li>Paga 0 € hoy en Stripe, antes de la fecha límite.</li>
            <li>Desde la renovación, la cuota se le cobra a ella. Hasta entonces, nada cambia.</li>
          </ol>
        </SheetPanel>
        <SheetFooter>
          <SheetClose render={<Button size="xl" />}>Entendido</SheetClose>
        </SheetFooter>
      </SheetPopup>
    </Sheet>
  )
}

function Payments() {
  const portal = usePortal()
  return (
    <section aria-labelledby="pay" className="flex flex-col gap-1 rounded-2xl border bg-card p-2">
      <h2 id="pay" className="px-2 pt-2 text-sm font-semibold text-muted-foreground">
        Pagos
      </h2>
      <Button variant="ghost" size="xl" className="justify-start" loading={portal.busy} onClick={portal.open}>
        <WalletIcon />
        <span className="flex flex-col items-start">
          <span className="font-semibold">Gestionar pagos</span>
          <span className="text-[13px] font-normal text-muted-foreground">Tarjeta y recibos · se abre Stripe</span>
        </span>
      </Button>
      {portal.notPayer && <p className="px-3 pb-2 text-sm text-muted-foreground">{errorText('no_billing_account')}</p>}
      <PayerSheet />
    </section>
  )
}

function ScheduledNote({ s, profileId, name }: { s: Subscription; profileId?: string; name?: string }) {
  const [open, setOpen] = useState(false)
  const plans = usePlans()
  const disciplines = useDisciplines()
  const undo = useMutation({
    mutationFn: async () => {
      await api(`/billing/subscriptions/${s.id}/plan/scheduled`, { method: 'DELETE' })
      await waitForSubscription(profileId, (x) => !x.scheduled_change)
    },
    onSuccess: () => {
      setOpen(false)
      toastOk(`Cambio anulado. ${name ? 'Sigue' : 'Sigues'} con ${s.plan.name}.`)
      void refreshBilling()
    },
    onError: (err) => {
      setOpen(false)
      toastError(err)
      if (errorCode(err) === 'no_scheduled_change') void refreshBilling()
    },
  })
  const c = s.scheduled_change
  if (!c) return null
  const target = plans.data?.find((p) => String(p.id) === c.plan_id)
  const kept = (disciplines.data ?? []).filter((d) => c.discipline_ids.includes(String(d.id)))
  const lost = s.disciplines.filter((d) => !c.discipline_ids.includes(String(d.id)))
  return (
    <>
      <Note
        kind="info"
        title={`El ${formatShortDate(c.scheduled_at)} ${name ? `${name} pasa` : 'pasas'} a ${c.plan_name}`}
        action={
          <Button size="lg" variant="outline" onClick={() => setOpen(true)}>
            Anular el cambio
          </Button>
        }
      >
        Desde ese día{target ? `, ${perMonth(target.price_cents)} (impuestos incluidos)` : ''}
        {kept.length ? ` con ${names(kept)}` : ''}.{lost.length && target?.max_disciplines !== null ? ` Las reservas de ${names(lost)} desde ese día se cancelarán.` : ''}
      </Note>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="¿Anular el cambio?"
        description={`Al renovar, el ${formatShortDate(c.scheduled_at)}, ${name ? `${name} seguirá` : 'seguirás'} con ${s.plan.name} por ${perMonth(s.plan.price_cents)}.`}
        confirmLabel="Anular el cambio"
        cancelLabel="Mantenerlo"
        loading={undo.isPending}
        onConfirm={() => undo.mutate()}
      />
    </>
  )
}

// Pausa programada o en curso (B30): anularla (gratis, antes de empezar) o volver antes (en la siguiente fecha de cobro).
function PauseNote({ s, profileId, name }: { s: Subscription; profileId?: string; name?: string }) {
  const [open, setOpen] = useState(false)
  const p = s.pause
  const end = useMutation({
    mutationFn: () => api<{ status: 'cancelled' | 'active'; ends_at: string }>(path('/billing/pause', { profile_id: profileId }), { method: 'DELETE' }),
    onSuccess: (r) => toastOk(r.status === 'cancelled' ? 'Pausa anulada' : `Vuelta programada para el ${formatShortDate(r.ends_at)}`),
    onError: (err) => {
      toastError(err)
      if (['no_pause', 'pause_ending'].includes(errorCode(err))) void refreshBilling()
    },
    onSettled: () => {
      setOpen(false)
      void refreshBilling()
      void refreshBookings()
    },
  })
  if (!p) return null
  const scheduled = p.status === 'scheduled'
  const early = canEndEarly(s)
  return (
    <>
      <Note
        kind="info"
        title={pauseTitle(p)}
        action={
          (scheduled || early) && (
            <Button size="lg" variant="outline" onClick={() => setOpen(true)}>
              {scheduled ? 'Anular la pausa' : 'Volver antes'}
            </Button>
          )
        }
      >
        {scheduled
          ? `Hasta el ${formatShortDate(p.starts_at)} todo sigue igual; luego no se puede reservar y se cobra la cuota de mantenimiento en vez del plan. Al acabar vuelve sola a ${s.plan.name}.`
          : `${pauseFee(p)}. No se puede reservar durante la pausa; el ${formatShortDate(p.ends_at)} vuelve sola a ${s.plan.name} con sus disciplinas.`}
      </Note>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        variant="default"
        title={scheduled ? '¿Anular la pausa?' : '¿Volver antes?'}
        description={
          scheduled
            ? `Es gratis: ${name ? `${name} sigue` : 'sigues'} con ${s.plan.name} como hasta ahora. Las reservas que se cancelaron al pedirla no vuelven.`
            : `${name ? `${name} vuelve` : 'Vuelves'} a ${s.plan.name} en la siguiente fecha de cobro${s.current_period_end ? `, el ${formatShortDate(s.current_period_end)}` : ''}, sin devolución ni prorrateo. Hasta entonces sigue la pausa.`
        }
        confirmLabel={scheduled ? 'Anular la pausa' : 'Volver antes'}
        cancelLabel="Mantenerla"
        loading={end.isPending}
        onConfirm={() => end.mutate()}
      />
    </>
  )
}

function Billing({ subject, profileId }: Props) {
  const session = useSession()
  const { withSubject } = useSubject()
  const subscription = useSubscription(profileId)
  const portal = usePortal()
  const name = subjectName(subject)
  const [pausing, setPausing] = useState(false)
  const contract = (
    <Button size="xl" render={<Link to={withSubject('/billing/contract')} />}>
      Contratar una cuota
    </Button>
  )
  return (
    <QueryView query={subscription} skeleton={<ListSkeleton rows={3} className="h-32" />}>
      {(s) => {
        if (!s) {
          return (
            <EmptyState
              icon={<WalletIcon />}
              title={name ? `${name} aún no tiene cuota` : 'Aún no tienes cuota'}
              text={`${name ? 'Para reservar sus sesiones necesita una cuota.' : 'Para reservar sesiones necesitas una cuota.'} Elige plan y disciplinas; se paga con tarjeta en Stripe.`}
              action={contract}
            />
          )
        }
        if (!isLive(s.status) && s.status !== 'incomplete') {
          return (
            <EmptyState
              icon={<WalletIcon />}
              title={`${name ? `La cuota de ${name}` : 'Tu cuota'} terminó${s.current_period_end ? ` el ${formatShortDate(s.current_period_end)}` : ''}`}
              text="Para volver a reservar, contrata una cuota nueva. Se paga con tarjeta en Stripe."
              action={contract}
            />
          )
        }
        const lock = planLock(s)
        const discLocked = disciplineLocked(s)
        const pLock = pauseLock(s)
        const withChanges = s.plan.max_disciplines !== null
        const [label, variant] = s.cancel_at_period_end && isLive(s.status) && s.status === 'active' ? ['Termina pronto', 'warning' as const] : (BADGE[s.status] ?? ['', 'secondary' as const])
        const portalAction = (
          <Button size="lg" variant="outline" loading={portal.busy} onClick={portal.open}>
            Gestionar pagos
          </Button>
        )
        return (
          <div className="flex flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start xl:gap-6">
            <div className="flex flex-col gap-4">
              {s.status === 'past_due' && (
                <Note kind="warning" title="Hay un cobro pendiente" action={!portal.notPayer && portalAction}>
                  No hemos podido cobrar la cuota y lo seguimos intentando. Mientras tanto, todo sigue igual.
                  {portal.notPayer && ` ${errorText('no_billing_account')}`}
                </Note>
              )}
              {s.status === 'unpaid' && (
                <Note kind="error" title="Hay un cobro pendiente" action={!portal.notPayer && portalAction}>
                  La cuota está impagada: hasta que se pague no cubre las sesiones.{portal.notPayer && ` ${errorText('no_billing_account')}`}
                </Note>
              )}
              {s.cancel_at_period_end && s.current_period_end && (
                <Note kind="info" title={`La cuota termina el ${formatShortDate(s.current_period_end)}`}>
                  La baja la ha tramitado la academia. Hasta ese día {name ? 'puede' : 'puedes'} reservar con normalidad; después ya no se renueva.
                </Note>
              )}
              <ScheduledNote s={s} profileId={profileId} name={name} />
              <PauseNote s={s} profileId={profileId} name={name} />
              <PayerChangeNote s={s} me={session?.id} price={perMonth(s.plan.price_cents)} name={name} />
              <section aria-labelledby="plan" className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 id="plan" className="text-sm font-semibold text-muted-foreground">
                    Plan
                  </h2>
                  {label && <Tag variant={variant === 'error' ? 'warning' : variant}>{label}</Tag>}
                </div>
                <div>
                  <p className="font-heading text-[28px] leading-tight font-bold">{s.plan.name}</p>
                  <p className="text-sm text-muted-foreground">{perMonth(s.plan.price_cents)} · impuestos incluidos</p>
                </div>
                <ul className="flex flex-wrap gap-1.5" aria-label="Disciplinas">
                  {(withChanges ? s.disciplines : [{ id: 'all', name: 'Todas las disciplinas' }]).map((d) => (
                    <li key={d.id}>
                      <Tag variant="secondary">{d.name}</Tag>
                    </li>
                  ))}
                </ul>
                <Kv
                  rows={[
                    ...(s.current_period_end ? ([[s.cancel_at_period_end ? 'Termina' : 'Se renueva', formatShortDate(s.current_period_end)]] as [string, string][]) : []),
                    ...(withChanges && s.discipline_changes_left != null
                      ? ([['Cambios de disciplina', `${changesLeft(s.discipline_changes_left)} este periodo`]] as [string, string][])
                      : []),
                  ]}
                />
                <div className="flex flex-col gap-2 sm:flex-row">
                  {lock ? (
                    <Button variant="outline" size="xl" disabled>
                      <LockIcon />
                      Cambiar de plan
                    </Button>
                  ) : (
                    <Button variant="outline" size="xl" render={<Link to={withSubject('/billing/plan')} />}>
                      Cambiar de plan
                    </Button>
                  )}
                  {withChanges &&
                    (discLocked ? (
                      <Button variant="outline" size="xl" disabled>
                        <LockIcon />
                        Cambiar de disciplina
                      </Button>
                    ) : (
                      <Button variant="outline" size="xl" render={<Link to={withSubject('/billing/discipline')} />}>
                        Cambiar de disciplina
                      </Button>
                    ))}
                </div>
                {s.pause_settings?.price_cents != null && !s.pause &&
                  (pLock ? (
                    <Button variant="outline" size="xl" disabled>
                      <LockIcon />
                      Pausar membresía
                    </Button>
                  ) : (
                    <Button variant="outline" size="xl" onClick={() => setPausing(true)}>
                      <PauseIcon />
                      Pausar membresía
                    </Button>
                  ))}
                {lock && <Lock>{lock}</Lock>}
                {pLock && s.pause_settings?.price_cents != null && !s.pause && <Lock>{pLock}</Lock>}
                {pausing && (
                  <PauseSheet
                    s={s}
                    name={name}
                    request={(months) => api(`/billing/pause`, { method: 'POST', body: { profile_id: profileId, months } })}
                    onClose={() => setPausing(false)}
                    onDone={() => {
                      void refreshBilling()
                      void refreshBookings()
                    }}
                  />
                )}
              </section>
            </div>
            <Payments />
          </div>
        )
      }}
    </QueryView>
  )
}

export function BillingPage() {
  return (
    <Page title="Cuota" wide>
      <Back to="/account">Cuenta</Back>
      <SubjectGate>{(s) => <Billing key={s.profileId ?? 'self'} {...s} />}</SubjectGate>
    </Page>
  )
}

// Las pantallas de cambio piden la suscripción viva; si no la hay, vuelven a Mi cuota.
function WithSubscription({ profileId, children }: { profileId?: string; children: (s: Subscription) => React.ReactNode }) {
  const { withSubject } = useSubject()
  const subscription = useSubscription(profileId)
  return (
    <QueryView query={subscription}>
      {(s) =>
        s && isLive(s.status) ? (
          <>{children(s)}</>
        ) : (
          <EmptyState
            icon={<WalletIcon />}
            title="No hay una cuota en vigor"
            action={
              <Button size="xl" render={<Link to={withSubject('/billing')} />}>
                Volver a la cuota
              </Button>
            }
          />
        )
      }
    </QueryView>
  )
}

// ── Cambiar de plan ──────────────────────────────────────────────────────

function PlanChange({ s, subject, profileId }: Props & { s: Subscription }) {
  const navigate = useNavigate()
  const { withSubject } = useSubject()
  const plans = usePlans()
  const disciplines = useDisciplines()
  const self = !subject || subject.self
  const birth = subject?.birth_date ?? null
  const [planId, setPlanId] = useState<string>('')
  const [picked, setPicked] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [problem, setProblem] = useState<{ code: string } | null>(null)
  const lock = planLock(s)
  const name = subjectName(subject)

  const all = plans.data ?? []
  const current = all.find((p) => String(p.id) === String(s.plan.id))
  const list = visiblePlans(all, self)
  const target = list.find((p) => String(p.id) === planId)
  const eligible = target ? eligibleDisciplines(target, disciplines.data ?? [], birth) : []
  const max = target?.max_disciplines ?? null
  const choose = target && max !== null && eligible.length > max
  const ready = !!target && (max === null || picked.length === max)
  const kind = target ? planChange(s.plan.price_cents, target, self && !!current?.minors_only) : null
  const period = s.current_period_end ? formatShortDate(s.current_period_end) : 'la renovación'

  const pick = (id: string) => {
    setPlanId(id)
    setProblem(null)
    const p = list.find((x) => String(x.id) === id)
    if (p) setPicked(keepDisciplines(s.disciplines.map((d) => d.id), eligibleDisciplines(p, disciplines.data ?? [], birth), p.max_disciplines))
  }

  const change = useMutation({
    mutationFn: async () => {
      const r = await api<{ change: 'upgrade' | 'downgrade'; status?: string; client_secret?: string; scheduled_at?: string }>(`/billing/subscriptions/${s.id}/plan`, {
        method: 'POST',
        body: { plan_id: target!.id, discipline_ids: picked },
      })
      if (r.change === 'upgrade' && r.status === 'requires_action') {
        setOpen(false)
        if (!(await bankConfirms(r.client_secret!))) throw new ApiError(402, { code: 'bank_not_confirmed' })
      }
      const id = String(target!.id)
      await waitForSubscription(profileId, (x) => (r.change === 'upgrade' ? String(x.plan.id) === id : x.scheduled_change?.plan_id === id))
      return r
    },
    onSuccess: (r) => {
      setOpen(false)
      if (r.change === 'upgrade') toastOk(`Pago hecho. Ya tienes ${target!.name}.`, 'El recibo te llega por email.')
      else toastOk(`Cambio programado para el ${r.scheduled_at ? formatShortDate(r.scheduled_at) : period}.`)
      void refreshBilling()
      navigate(withSubject('/billing'))
    },
    onError: (err) => {
      setOpen(false)
      const code = errorCode(err)
      if (['payment_failed', 'bank_not_confirmed', 'not_payer', 'upgrade_pending', 'period_ending_soon'].includes(code)) setProblem({ code })
      else toastError(err)
      if (['subscription_not_active', 'cancel_scheduled', 'payer_change_pending', 'same_plan'].includes(code)) void refreshBilling()
    },
  })

  if (lock) return <Note kind="info" title={lock} />
  if (plans.isPending || disciplines.isPending) return <ListSkeleton rows={3} />
  if (plans.isError || disciplines.isError) return <ErrorState error={plans.error ?? disciplines.error} onRetry={() => void Promise.all([plans.refetch(), disciplines.refetch()])} />

  const PROBLEM: Record<string, [string, string]> = {
    not_payer: ['Solo puede cambiar el plan quien paga la cuota', 'Si eres tú quien debería pagarla, pídele a la academia el cambio de pagador.'],
    payment_failed: ['El banco ha rechazado el pago', 'No ha cambiado nada. Revisa la tarjeta en Gestionar pagos y vuelve a intentarlo.'],
    bank_not_confirmed: ['El banco no ha confirmado el pago', 'No ha cambiado nada. Puedes volver a intentarlo.'],
    upgrade_pending: ['Hay otro cambio de plan a medias', 'Espera unos minutos a que termine y vuelve a intentarlo.'],
    period_ending_soon: ['La cuota se renueva en menos de 2 horas', 'Vuelve a intentarlo después de la renovación.'],
  }

  return (
    <>
      {problem && (
        <Note kind={problem.code === 'not_payer' ? 'info' : 'error'} title={PROBLEM[problem.code][0]}>
          {PROBLEM[problem.code][1]}
        </Note>
      )}
      <p className="text-sm text-muted-foreground">
        Precios al mes, impuestos incluidos. Una subida se aplica ya y se cobra hoy la parte proporcional; una bajada se aplica al renovar.
      </p>
      <RadioGroup value={planId} onValueChange={(v) => pick(String(v))} aria-label="Plan nuevo" className="flex flex-col gap-2.5 lg:grid lg:grid-cols-2">
        {list.map((p) => {
          const cur = String(p.id) === String(s.plan.id)
          const k = planChange(s.plan.price_cents, p, self && !!current?.minors_only)
          return (
            <OptionCard
              key={p.id}
              value={String(p.id)}
              disabled={cur}
              title={p.name}
              price={perMonth(p.price_cents).replace(' al mes', '')}
              priceNote="al mes"
              description={p.max_disciplines === null ? 'Todas las disciplinas' : `${p.max_disciplines} ${p.max_disciplines === 1 ? 'disciplina' : 'disciplinas'} a elegir`}
              tags={
                <>
                  {cur && <Tag variant="info">Tu plan ahora</Tag>}
                  {!cur && k === 'up' && <Tag>Subida · se aplica ya</Tag>}
                  {!cur && k === 'down' && <Tag>Bajada · desde el {period}</Tag>}
                  {!cur && k === 'same' && <Tag>Mismo precio · desde el {period}</Tag>}
                  {p.minors_only && <Tag variant="secondary">Solo menores</Tag>}
                </>
              }
            />
          )
        })}
      </RadioGroup>
      {target && max === null && <Note kind="info" title={`${target.name} incluye todas las disciplinas`}>No hay que elegir. Con este plan no hay cambios de disciplina.</Note>}
      {choose && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-semibold">
            {kind === 'up' ? `Elige ${max === 1 ? 'la disciplina' : `${max} disciplinas`}` : `Elige con ${max === 1 ? 'qué disciplina' : `qué ${max} disciplinas`} ${name ? `se queda ${name}` : 'te quedas'}`}
          </legend>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {picked.length} de {max} elegidas
          </p>
          {eligible.map((d) => {
            const on = picked.includes(String(d.id))
            const range = ageRangeLabel(d.min_age, d.max_age)
            return (
              <label key={d.id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border bg-card px-4 has-data-checked:border-primary has-data-disabled:cursor-default has-data-disabled:opacity-64">
                <Checkbox
                  aria-label={d.name}
                  checked={on}
                  disabled={!on && picked.length >= max!}
                  onCheckedChange={(c) => setPicked((xs) => (c ? [...xs, String(d.id)] : xs.filter((x) => x !== String(d.id))))}
                />
                <span className="flex-1 font-medium">{d.name}</span>
                {range && <Tag variant="secondary">{range}</Tag>}
              </label>
            )
          })}
          {picked.length >= max! && <p className="text-sm text-muted-foreground">Ya has elegido {max}. Quita una para elegir otra.</p>}
        </fieldset>
      )}
      <StickyFooter>
        <Button size="xl" disabled={!ready} loading={change.isPending} onClick={() => setOpen(true)}>
          {change.isPending ? 'Confirmando con tu banco…' : kind === 'up' && target ? `Pasar a ${target.name}` : 'Continuar'}
        </Button>
        {!target && <p className="text-center text-sm text-muted-foreground">Elige un plan para seguir.</p>}
      </StickyFooter>
      {target && (
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          variant="default"
          title={`Pasar a ${target.name}`}
          description={
            kind === 'up'
              ? `Se aplica ahora. Hoy se cobra la parte proporcional hasta el ${period} con la tarjeta de la cuota; después, ${perMonth(target.price_cents)}, impuestos incluidos. El recibo con el importe te llega por email.`
              : kind === 'same'
                ? `Tiene el mismo precio: no se cobra nada. Se aplica al renovar, el ${period}; hasta entonces ${name ? 'sigue' : 'sigues'} con ${s.plan.name}.`
                : `Se aplica al renovar, el ${period}: hasta entonces ${name ? 'sigue' : 'sigues'} con ${s.plan.name}. No se devuelve nada.`
          }
          confirmLabel={kind === 'up' ? `Pasar a ${target.name}` : 'Programar el cambio'}
          cancelLabel="Cancelar"
          loading={change.isPending}
          onConfirm={() => change.mutate()}
        >
          {kind === 'up' && <p>Si el banco lo pide, tendrás que confirmarlo.</p>}
          {max !== null && <p>Las reservas de las disciplinas que dejas {kind === 'up' ? 'se cancelan al aplicarse.' : `desde el ${period} se cancelarán.`}</p>}
        </ConfirmDialog>
      )}
    </>
  )
}

export function PlanPage() {
  const { withSubject } = useSubject()
  return (
    <Page title="Cambiar de plan" wide>
      <Back to={withSubject('/billing')}>Cuota</Back>
      <SubjectGate>{(p) => <WithSubscription profileId={p.profileId}>{(s) => <PlanChange key={s.id} s={s} {...p} />}</WithSubscription>}</SubjectGate>
    </Page>
  )
}

// ── Cambiar de disciplina ────────────────────────────────────────────────

function DisciplineChange({ s, subject }: Props & { s: Subscription }) {
  const navigate = useNavigate()
  const { withSubject } = useSubject()
  const plans = usePlans()
  const disciplines = useDisciplines()
  const birth = subject?.birth_date ?? null // la edad de hoy del sujeto decide qué disciplinas cubre
  const [from, setFrom] = useState(String(s.disciplines[0]?.id ?? ''))
  const [to, setTo] = useState('')
  const [open, setOpen] = useState(false)
  const [limit, setLimit] = useState<string | null>(null)
  const name = subjectName(subject)

  const change = useMutation({
    mutationFn: () =>
      api<{ disciplines: string[]; changes_left: number; free: boolean }>(`/billing/subscriptions/${s.id}/disciplines`, {
        method: 'POST',
        body: { from_id: from, to_id: to },
      }),
    onSuccess: (r) => {
      setOpen(false)
      const now = (disciplines.data ?? []).filter((d) => r.disciplines.includes(String(d.id)))
      toastOk(`Hecho: ahora ${name ? 'tiene' : 'tienes'} ${names(now)}.`, r.free ? 'No ha gastado ningún cambio.' : `${changesLeft(r.changes_left)}.`)
      void refreshBilling()
      void refreshBookings()
      navigate(withSubject('/billing'))
    },
    onError: (err) => {
      setOpen(false)
      if (err instanceof ApiError && err.code === 'discipline_change_limit') {
        const at = typeof err.details.resets_at === 'string' ? err.details.resets_at : null
        setLimit(at)
        return
      }
      toastError(err)
      if (['payer_change_pending', 'subscription_not_in_force', 'discipline_not_chosen'].includes(errorCode(err))) void refreshBilling()
    },
  })

  if (disciplineLocked(s)) return <Note kind="info" title="Ahora no se pueden cambiar las disciplinas">{planLock(s)}</Note>
  if (s.plan.max_disciplines === null) return <Note kind="info" title={errorText('plan_all_disciplines')} />
  if (plans.isPending || disciplines.isPending) return <ListSkeleton rows={3} />
  if (plans.isError || disciplines.isError) return <ErrorState error={plans.error ?? disciplines.error} onRetry={() => void Promise.all([plans.refetch(), disciplines.refetch()])} />

  const plan = plans.data.find((p) => String(p.id) === String(s.plan.id))
  const chosen = s.disciplines.map((d) => String(d.id))
  // Un plan retirado no sale en /plans: sin sus elegibles, se ofrecen todas las disciplinas que el backend aceptaría.
  const options = (plan ? eligibleDisciplines(plan, disciplines.data, birth) : disciplines.data.filter((d) => d.is_active && !d.is_open && fitsAge(d, birth))).filter(
    (d) => !chosen.includes(String(d.id)),
  )
  const fromD = disciplines.data.find((d) => String(d.id) === from)
  const fromName = s.disciplines.find((d) => String(d.id) === from)?.name ?? ''
  const toName = options.find((d) => String(d.id) === to)?.name ?? ''
  const free = freeChange(fromD, birth)
  const left = s.discipline_changes_left ?? 0
  const out = left === 0 && !free

  return (
    <>
      {limit && (
        <Note kind="warning" title="No te quedan cambios">
          Vuelves a tener cambios el {formatShortDate(limit)}. Si una de las disciplinas deja de cubrirse, ese cambio es gratis y se puede hacer igualmente.
        </Note>
      )}
      <p className="font-semibold" aria-live="polite">
        {changesLeft(left)} en este periodo
      </p>
      {out && <p className="text-sm text-muted-foreground">Si una de las disciplinas deja de cubrirse, ese cambio es gratis y se puede hacer igualmente.</p>}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-semibold">Dejas</legend>
        <RadioGroup value={from} onValueChange={(v) => setFrom(String(v))} className="flex flex-col gap-2">
          {s.disciplines.map((d) => {
            const dd = disciplines.data.find((x) => String(x.id) === String(d.id))
            return (
              <OptionCard
                key={d.id}
                value={String(d.id)}
                title={d.name}
                tags={freeChange(dd, birth) ? <Tag variant="success">Ya no se cubre: el cambio es gratis</Tag> : undefined}
              />
            )
          })}
        </RadioGroup>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-semibold">Pasas a</legend>
        {options.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay otras disciplinas en este plan.</p>
        ) : (
          <RadioGroup value={to} onValueChange={(v) => setTo(String(v))} className="flex flex-col gap-2">
            {options.map((d) => (
              <OptionCard key={d.id} value={String(d.id)} title={d.name} tags={ageRangeLabel(d.min_age, d.max_age) ? <Tag variant="secondary">{ageRangeLabel(d.min_age, d.max_age)}</Tag> : undefined} />
            ))}
          </RadioGroup>
        )}
      </fieldset>
      <Note kind={free ? 'success' : 'warning'} title={free ? 'Este cambio no gasta ninguno de los cambios' : 'Es inmediato'}>
        {free ? `${fromName} ya no entra en la cuota. ` : ''}Se cancelan las reservas y esperas de {fromName || 'la disciplina que dejas'} desde hoy.
      </Note>
      <StickyFooter>
        <Button size="xl" className="w-full" disabled={!to || out} loading={change.isPending} onClick={() => setOpen(true)}>
          {to ? `Cambiar ${fromName} por ${toName}` : 'Elige a qué disciplina pasas'}
        </Button>
      </StickyFooter>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        variant="default"
        title={`¿Cambiar ${fromName} por ${toName}?`}
        description={`Es inmediato. Se cancelan las reservas y esperas de ${fromName} desde hoy.`}
        confirmLabel="Cambiar"
        cancelLabel="Cancelar"
        loading={change.isPending}
        onConfirm={() => change.mutate()}
      >
        {!free && <p>Después: {changesLeft(left - 1).toLowerCase()} en este periodo.</p>}
      </ConfirmDialog>
    </>
  )
}

export function DisciplinePage() {
  const { withSubject } = useSubject()
  return (
    <Page title="Cambiar de disciplina">
      <Back to={withSubject('/billing')}>Cuota</Back>
      <SubjectGate>{(p) => <WithSubscription profileId={p.profileId}>{(s) => <DisciplineChange key={s.id} s={s} {...p} />}</WithSubscription>}</SubjectGate>
    </Page>
  )
}
