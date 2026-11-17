import { useMutation } from '@tanstack/react-query'
import type React from 'react'
import { ChevronRightIcon, CircleAlertIcon, CircleCheckIcon, ClockIcon, ExternalLinkIcon, ListChecksIcon, LockIcon, PauseIcon, RepeatIcon, UsersIcon, WalletIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, type LinkProps } from 'react-router'
import { Back, Kv, Note, OptionCard, StickyFooter, Tag } from '@/components/billing-bits'
import { usePortal } from '@/hooks/use-portal'
import { bankConfirms } from '@/lib/stripe'
import { CARD } from '@/components/child-access'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Page } from '@/components/page'
import { PauseSheet } from '@/components/pause-sheet'
import { EmptyState, ErrorState, ListSkeleton, QueryView } from '@/components/screen-state'
import { SubjectGate, subjectName } from '@/components/subject-gate'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Radio, RadioGroup } from '@/components/ui/radio-group'
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
  pastPlanMax,
  pauseTitle,
  perMonth,
  planChange,
  planLock,
  visiblePlans,
} from '@/lib/billing'
import { errorText } from '@/lib/errors'
import { formatDeadline, formatEuros, formatShortDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Spinner } from '@/components/ui/spinner'
import { errorCode, toastError, toastOk } from '@/lib/notify'
import { path, refreshBilling, refreshBookings, useDisciplines, usePlans, useSubscription } from '@/lib/queries'
import { useSession } from '@/lib/session'
import { ageRangeLabel } from '@/lib/catalog'
import type { Subject } from '@/lib/subject'
import type { Subscription } from '@/lib/types'

type Props = { subject: Subject | null; profileId?: string }

const names = (xs: { name: string }[]) => xs.map((x) => x.name).join(', ').replace(/, ([^,]*)$/, ' y $1')
const BADGE: Record<string, [string, 'success' | 'warning' | 'error' | 'secondary', typeof ClockIcon]> = {
  active: ['Activa', 'success', CircleCheckIcon],
  past_due: ['Cobro pendiente', 'warning', CircleAlertIcon],
  unpaid: ['Impagada', 'error', CircleAlertIcon],
  incomplete: ['Pendiente de pago', 'secondary', ClockIcon],
}

// Filas de acción de las tarjetas, como las de Cuenta: 56 px, chapa con icono, título, pista y chevrón.
const ROW_BASE = 'flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left'
const ROW = cn(
  ROW_BASE,
  'outline-none transition-colors duration-150 ease-(--ease-out) hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-accent',
)
const CHEVRON = <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
const ROWS = '-mx-4 -mb-4 divide-y border-t'

function RowBody({ icon: Icon, label, hint, end, locked }: { icon: typeof ClockIcon; label: string; hint?: string; end?: React.ReactNode; locked?: boolean }) {
  return (
    <>
      <span
        className={cn('grid size-9 shrink-0 place-items-center rounded-lg', locked ? 'bg-muted text-muted-foreground' : 'bg-primary/8 text-link dark:bg-primary/16')}
        aria-hidden="true"
      >
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block font-semibold', locked && 'text-muted-foreground')}>{label}</span>
        {hint && <span className="block text-[13px] text-pretty text-muted-foreground">{hint}</span>}
      </span>
      {end}
    </>
  )
}

// Acción de la tarjeta: enlace, botón o, si `lock` trae el motivo, fila sin enlace con candado y el porqué.
function ActionRow({ to, onClick, icon, label, hint, lock }: { to?: LinkProps['to']; onClick?: () => void; icon: typeof ClockIcon; label: string; hint?: string; lock?: string | null }) {
  if (lock) {
    return (
      <li className={ROW_BASE} data-locked="">
        <RowBody icon={LockIcon} label={label} hint={lock} locked />
      </li>
    )
  }
  const body = <RowBody icon={icon} label={label} hint={hint} end={CHEVRON} />
  return (
    <li>
      {to ? (
        <Link to={to} className={ROW}>
          {body}
        </Link>
      ) : (
        <button type="button" className={ROW} onClick={onClick}>
          {body}
        </button>
      )}
    </li>
  )
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
      <SheetTrigger render={<button type="button" className={ROW} />}>
        <RowBody icon={UsersIcon} label="Que pague otra persona" hint="Lo cambia la academia" end={CHEVRON} />
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
    <section aria-labelledby="pay" className={cn('enter-soft overflow-hidden', CARD)}>
      <h2 id="pay" className="text-lg font-semibold">
        Pagos
      </h2>
      <ul className={ROWS}>
        <li>
          {/* Cargando no se deshabilita: el foco se queda en el botón mientras se abre Stripe. */}
          <button type="button" className={ROW} aria-disabled={portal.busy} aria-busy={portal.busy} onClick={portal.busy ? undefined : portal.open}>
            <RowBody
              icon={WalletIcon}
              label="Gestionar pagos"
              hint="Tarjeta y recibos, en Stripe"
              end={portal.busy ? <Spinner className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" role={undefined} aria-label={undefined} /> : <ExternalLinkIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
            />
          </button>
          {portal.notPayer && <p className="px-4 pb-3 text-sm text-muted-foreground">{errorText('no_billing_account')}</p>}
        </li>
        <li>
          <PayerSheet />
        </li>
      </ul>
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
  const name = subjectName(subject)?.split(' ')[0]
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
              plainTitle
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
              plainTitle
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
        const [label, variant, BadgeIcon] =
          s.cancel_at_period_end && isLive(s.status) && s.status === 'active' ? (['Termina pronto', 'warning', CircleAlertIcon] as const) : (BADGE[s.status] ?? ['', 'secondary', ClockIcon])
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
                <Note kind="error" title="La cuota está impagada" action={!portal.notPayer && portalAction}>
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
              <section aria-labelledby="plan" className={cn('enter-soft', CARD)}>
                <div className="flex items-center justify-between gap-3">
                  <h2 id="plan" className="text-lg font-semibold">
                    {name ? `Cuota de ${name}` : 'Tu cuota'}
                  </h2>
                  {label && (
                    <Tag variant={variant === 'error' ? 'warning' : variant}>
                      <BadgeIcon aria-hidden="true" />
                      {label}
                    </Tag>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-[17px] leading-snug font-semibold">{s.plan.name}</p>
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-heading text-[32px] leading-none font-bold tabular-nums">{formatEuros(s.plan.price_cents)}</span>
                    <span className="text-sm text-muted-foreground">al mes · impuestos incluidos</span>
                  </p>
                </div>
                <ul className="flex flex-wrap gap-1.5" aria-label="Disciplinas">
                  {(withChanges ? s.disciplines : [{ id: 'all', name: 'Todas las disciplinas' }]).map((d) => (
                    <li key={d.id}>
                      <Tag variant="secondary">{d.name}</Tag>
                    </li>
                  ))}
                </ul>
                {s.current_period_end && <Kv rows={[[s.cancel_at_period_end ? 'Termina' : 'Se renueva', formatShortDate(s.current_period_end)]]} />}
              </section>
              <section aria-labelledby="changes" className={cn('enter-soft overflow-hidden', CARD)}>
                <h2 id="changes" className="text-lg font-semibold">
                  Cambios
                </h2>
                <ul className={ROWS}>
                  <ActionRow to={withSubject('/billing/plan')} icon={RepeatIcon} label="Cambiar de plan" hint="Subir se aplica ya; bajar, al renovar" lock={lock} />
                  {withChanges && (
                    <ActionRow
                      to={withSubject('/billing/discipline')}
                      icon={ListChecksIcon}
                      label="Cambiar de disciplina"
                      hint={s.discipline_changes_left != null ? `${changesLeft(s.discipline_changes_left)} este periodo` : undefined}
                      lock={discLocked ? (lock ?? 'Ahora no se pueden cambiar las disciplinas.') : null}
                    />
                  )}
                  {s.pause_settings?.price_cents != null && !s.pause && (
                    <ActionRow
                      onClick={() => setPausing(true)}
                      icon={PauseIcon}
                      label="Pausar membresía"
                      hint={`Mantenimiento: ${perMonth(s.pause_settings.price_cents)}`}
                      lock={pLock}
                    />
                  )}
                </ul>
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
  const { withSubject, birthDate: birth } = useSubject()
  const plans = usePlans()
  const disciplines = useDisciplines()
  const [planId, setPlanId] = useState<string>('')
  const [picked, setPicked] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [problem, setProblem] = useState<{ code: string } | null>(null)
  const lock = planLock(s)
  const name = subjectName(subject)?.split(' ')[0]

  const all = plans.data ?? []
  const current = all.find((p) => String(p.id) === String(s.plan.id))
  const list = visiblePlans(all, birth).filter((p) => String(p.id) !== String(s.plan.id))
  const outOfPlan = !!current && pastPlanMax(current, birth)
  const scheduled = s.scheduled_change ?? null
  const target = list.find((p) => String(p.id) === planId)
  const eligible = target ? eligibleDisciplines(target, disciplines.data ?? [], birth) : []
  const max = target?.max_disciplines ?? null
  const choose = target && max !== null && eligible.length > max
  const ready = !!target && (max === null || picked.length === max)
  const kind = target ? planChange(s.plan.price_cents, target, outOfPlan) : null
  const immediate = kind === 'up' || kind === 'now'
  const period = s.current_period_end ? formatShortDate(s.current_period_end) : 'la renovación'

  const pick = (id: string) => {
    setPlanId(id)
    setProblem(null)
    const p = list.find((x) => String(x.id) === id)
    if (p) setPicked(keepDisciplines(s.disciplines.map((d) => d.id), eligibleDisciplines(p, disciplines.data ?? [], birth), p.max_disciplines))
  }

  const change = useMutation({
    mutationFn: async () => {
      const r = await api<{ change: 'upgrade' | 'downgrade' | 'age_change'; status?: string; client_secret?: string; scheduled_at?: string }>(`/billing/subscriptions/${s.id}/plan`, {
        method: 'POST',
        body: { plan_id: target!.id, discipline_ids: picked },
      })
      if (r.change === 'upgrade' && r.status === 'requires_action') {
        setOpen(false)
        if (!(await bankConfirms(r.client_secret!))) throw new ApiError(402, { code: 'bank_not_confirmed' })
      }
      const id = String(target!.id)
      await waitForSubscription(profileId, (x) => (r.change === 'downgrade' ? x.scheduled_change?.plan_id === id : String(x.plan.id) === id))
      return r
    },
    onSuccess: (r) => {
      setOpen(false)
      if (r.change === 'upgrade') toastOk(`Pago hecho. Ya tienes ${target!.name}.`, 'El recibo te llega por email.')
      else if (r.change === 'age_change') toastOk(`Ya tienes ${target!.name}.`)
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

  if (lock)
    return (
      <Note
        kind="info"
        title={lock}
        action={
          <Button variant="outline" size="lg" render={<Link to={withSubject('/billing')} />}>
            Ver la cuota
          </Button>
        }
      />
    )
  if (plans.isPending || disciplines.isPending) return <ListSkeleton rows={3} />
  if (plans.isError || disciplines.isError) return <ErrorState error={plans.error ?? disciplines.error} onRetry={() => void Promise.all([plans.refetch(), disciplines.refetch()])} />

  // «+20,00 € al mes · desde hoy»: lo que cambia el importe y cuándo, en una insignia.
  const effect = (p: (typeof list)[number]) => {
    const k = planChange(s.plan.price_cents, p, outOfPlan)
    const diff = p.price_cents - s.plan.price_cents
    const amount = `${diff > 0 ? '+' : '−'}${formatEuros(Math.abs(diff))} al mes`
    if (k === 'up') return `${amount} · desde hoy`
    if (k === 'now') return diff === 0 ? 'Mismo precio · desde hoy' : `${amount} · desde hoy, sin cobro`
    if (k === 'same') return `Mismo precio · desde el ${period}`
    return `${amount} · desde el ${period}`
  }
  const busy = change.isPending

  const PROBLEM: Record<string, [string, string]> = {
    not_payer: ['Solo puede cambiar el plan quien paga la cuota', 'Si eres tú quien debería pagarla, pídele a la academia el cambio de pagador.'],
    payment_failed: ['El banco ha rechazado el pago', 'No ha cambiado nada. Revisa la tarjeta en Gestionar pagos y vuelve a intentarlo.'],
    bank_not_confirmed: ['El banco no ha confirmado el pago', 'No ha cambiado nada. Puedes volver a intentarlo.'],
    upgrade_pending: ['Hay otro cambio de plan a medias', 'Espera unos minutos a que termine y vuelve a intentarlo.'],
    period_ending_soon: ['La cuota se renueva en menos de 2 horas', 'Vuelve a intentarlo después de la renovación.'],
  }

  return (
    <>
      <section aria-labelledby="plan-now" className={cn('enter-soft', CARD)}>
        <h2 id="plan-now" className="text-lg font-semibold">
          {name ? `Plan de ${name} ahora` : 'Tu plan ahora'}
        </h2>
        <div className="flex flex-col gap-1">
          <p className="text-[17px] leading-snug font-semibold">{s.plan.name}</p>
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-heading text-[32px] leading-none font-bold tabular-nums">{formatEuros(s.plan.price_cents)}</span>
            <span className="text-sm text-muted-foreground">al mes · impuestos incluidos</span>
          </p>
        </div>
        <Kv
          rows={[
            ['Disciplinas', s.plan.max_disciplines === null ? 'Todas' : s.disciplines.map((d) => d.name).join(', ')],
            ...(s.current_period_end ? [['Se renueva', formatShortDate(s.current_period_end)] as [string, string]] : []),
          ]}
        />
      </section>
      {scheduled && (
        <Note kind="info" title={`${name ? `${name} tiene` : 'Tienes'} programado el paso a ${scheduled.plan_name} el ${formatShortDate(scheduled.scheduled_at)}`}>
          Si eliges otro plan, sustituye a este cambio.
        </Note>
      )}
      {outOfPlan && (
        <Note kind="warning" title={`${s.plan.name} ya no ${name ? 'le' : 'te'} corresponde`}>
          El cambio se aplica hoy. Si el plan nuevo cuesta más, hoy se cobra la parte proporcional; si no, no se cobra ni se devuelve nada.
        </Note>
      )}
      {problem && (
        <Note kind={problem.code === 'not_payer' ? 'info' : 'error'} title={PROBLEM[problem.code][0]}>
          {PROBLEM[problem.code][1]}
        </Note>
      )}
      {list.length === 0 ? (
        <EmptyState icon={<WalletIcon />} title={`Ahora no hay otro plan ${name ? `para ${name}` : 'para ti'}`} text="Pregunta en la academia." />
      ) : (
        <section aria-labelledby="plan-new" className="enter-soft flex flex-col gap-3">
          <div>
            <h2 id="plan-new" className="text-lg font-semibold">
              {name ? `Plan nuevo para ${name}` : 'Elige el plan nuevo'}
            </h2>
            <p className="text-sm text-muted-foreground">Precios al mes, impuestos incluidos.</p>
          </div>
          <RadioGroup value={planId} onValueChange={(v) => pick(String(v))} aria-labelledby="plan-new" className="flex flex-col gap-2.5">
            {list.map((p) => {
              const isScheduled = String(p.id) === String(scheduled?.plan_id)
              return (
                <OptionCard
                  key={p.id}
                  value={String(p.id)}
                  disabled={isScheduled}
                  title={p.name}
                  price={formatEuros(p.price_cents)}
                  priceNote="al mes"
                  stackPrice
                  description={p.max_disciplines === null ? 'Todas las disciplinas' : `${p.max_disciplines} ${p.max_disciplines === 1 ? 'disciplina' : 'disciplinas'} a elegir`}
                  tags={isScheduled ? <Tag variant="info">Programado · {formatShortDate(scheduled!.scheduled_at)}</Tag> : <Tag>{effect(p)}</Tag>}
                />
              )
            })}
          </RadioGroup>
        </section>
      )}
      {target && max === null && <Note kind="info" title={`${target.name} incluye todas las disciplinas`}>No hay que elegir. Con este plan no hay cambios de disciplina.</Note>}
      {choose && (
        // La clave lo vuelve a montar al cambiar de plan: entra suave (enter-soft) con sus disciplinas.
        <section key={planId} role="group" aria-labelledby="disc-title" className={cn('enter-soft overflow-hidden', CARD)}>
          <div className="flex items-baseline justify-between gap-3">
            <h3 id="disc-title" className="font-semibold">
              {immediate ? `Elige ${max === 1 ? 'la disciplina' : `${max} disciplinas`}` : `${max === 1 ? '¿Qué disciplina' : `¿Qué ${max} disciplinas`} ${name ? `se queda ${name}` : 'te quedas'}?`}
            </h3>
            <span className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
              {picked.length} de {max}
            </span>
          </div>
          <ul className="-mx-4 -mb-4 divide-y border-t">
            {eligible.map((d) => {
              const on = picked.includes(String(d.id))
              const range = ageRangeLabel(d.min_age, d.max_age)
              return (
                <li key={d.id}>
                  <label className="flex min-h-14 cursor-pointer items-center gap-3 px-4 py-2 transition-colors duration-150 ease-(--ease-out) hover:bg-accent has-data-disabled:cursor-default has-data-disabled:hover:bg-transparent">
                    <Checkbox
                      aria-label={d.name}
                      checked={on}
                      disabled={!on && picked.length >= max!}
                      onCheckedChange={(c) => setPicked((xs) => (c ? [...xs, String(d.id)] : xs.filter((x) => x !== String(d.id))))}
                    />
                    <span className="flex-1 font-medium">{d.name}</span>
                    {range && <Tag variant="secondary">{range}</Tag>}
                  </label>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      {choose && picked.length >= max! && <p className="text-sm text-muted-foreground">Ya has elegido {max}. Quita una para elegir otra.</p>}
      {list.length > 0 && (
        <StickyFooter>
          <Button size="xl" disabled={!ready || busy} onClick={() => setOpen(true)}>
            {busy ? (immediate ? 'Confirmando con tu banco…' : 'Programando…') : 'Revisar el cambio'}
          </Button>
          {!target && <p className="text-center text-sm text-muted-foreground">Elige un plan para seguir.</p>}
        </StickyFooter>
      )}
      {target && (
        <ConfirmDialog
          open={open}
          onOpenChange={(o) => !busy && setOpen(o)}
          variant="default"
          title={name ? `¿Cambiar el plan de ${name} a ${target.name}?` : `¿Pasar a ${target.name}?`}
          description={immediate ? 'El cambio se aplica hoy.' : `El cambio se aplica al renovar; hasta entonces ${name ? 'sigue' : 'sigues'} con ${s.plan.name}.`}
          confirmLabel={busy ? (immediate ? 'Confirmando con tu banco…' : 'Programando…') : immediate ? `Pasar a ${target.name}` : 'Programar el cambio'}
          cancelLabel="Cancelar"
          disabled={busy}
          onConfirm={() => change.mutate()}
        >
          <div>
            <p className="font-heading text-3xl leading-none font-bold text-foreground tabular-nums">{formatEuros(target.price_cents)}</p>
            <p className="mt-1.5 text-muted-foreground">al mes · impuestos incluidos</p>
          </div>
          <Kv
            rows={[
              ['Se aplica', immediate ? 'Hoy' : period],
              ['Hoy se cobra', kind === 'up' ? 'La parte proporcional' : 'Nada'],
              ...(kind === 'up' ? [[`Desde el ${period}`, perMonth(target.price_cents)] as [string, string]] : []),
            ]}
          />
          {kind === 'up' && <p className="text-muted-foreground">La parte proporcional es lo que queda hasta el {period}. El recibo con el importe te llega por email. Si el banco lo pide, tendrás que confirmarlo.</p>}
          {kind === 'now' && <p className="text-muted-foreground">Lo pagado hasta el {period} se queda como está: no se devuelve nada.</p>}
          {scheduled && <p className="text-muted-foreground">{immediate ? 'Anula' : 'Sustituye'} el paso a {scheduled.plan_name} programado para el {formatShortDate(scheduled.scheduled_at)}.</p>}
          {max !== null && <p className="text-muted-foreground">Las reservas de las disciplinas que {name ? 'deja' : 'dejas'} {immediate ? 'se cancelan al aplicarse.' : `desde el ${period} se cancelarán.`}</p>}
        </ConfirmDialog>
      )}
    </>
  )
}

export function PlanPage() {
  const { withSubject } = useSubject()
  return (
    <Page title="Cambiar de plan">
      <Back to={withSubject('/billing')}>Cuota</Back>
      <SubjectGate>{(p) => <WithSubscription profileId={p.profileId}>{(s) => <PlanChange key={s.id} s={s} {...p} />}</WithSubscription>}</SubjectGate>
    </Page>
  )
}

// ── Cambiar de disciplina ────────────────────────────────────────────────

// Fila de 56 px con radio dentro de una tarjeta, como las filas con casilla de PlanChange.
const PICK_ROW =
  'flex min-h-14 cursor-pointer items-center gap-3 px-4 py-2 transition-colors duration-150 ease-(--ease-out) hover:bg-accent has-data-checked:bg-primary/6 has-data-disabled:cursor-default has-data-disabled:text-muted-foreground has-data-disabled:hover:bg-transparent'

type PickItem = { id: string; name: string; note?: string; free?: boolean; disabled?: boolean }

function PickRows({ id, title, items, value, onChange, empty }: { id: string; title: string; items: PickItem[]; value: string; onChange: (v: string) => void; empty?: string }) {
  return (
    <section aria-labelledby={id} className={cn('enter-soft overflow-hidden', CARD)}>
      <h2 id={id} className="font-semibold">
        {title}
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <RadioGroup value={value} onValueChange={(v) => onChange(String(v))} aria-labelledby={id} className={cn(ROWS, 'gap-0')}>
          {items.map((d) => (
            <label key={d.id} className={PICK_ROW}>
              <Radio value={d.id} disabled={d.disabled} aria-label={d.note ? `${d.name}, ${d.note}` : d.name} />
              <span className="flex-1 font-medium">{d.name}</span>
              {d.note && <Tag variant={d.free ? 'success' : 'secondary'}>{d.note}</Tag>}
            </label>
          ))}
        </RadioGroup>
      )}
    </section>
  )
}

function DisciplineChange({ s, subject }: Props & { s: Subscription }) {
  const navigate = useNavigate()
  const { withSubject, birthDate: birth } = useSubject() // la edad de hoy del sujeto decide qué disciplinas cubre
  const plans = usePlans()
  const disciplines = useDisciplines()
  const [picked, setFrom] = useState<string | null>(null)
  const [to, setTo] = useState('')
  const [open, setOpen] = useState(false)
  const name = subjectName(subject)?.split(' ')[0]

  const change = useMutation({
    mutationFn: () =>
      api<{ disciplines: string[]; changes_left: number; free: boolean }>(`/billing/subscriptions/${s.id}/disciplines`, {
        method: 'POST',
        body: { from_id: from, to_id: to },
      }),
    onSuccess: (r) => {
      setOpen(false)
      const now = (disciplines.data ?? []).filter((d) => r.disciplines.includes(String(d.id)))
      toastOk(`Hecho: ahora ${name ? `${name} tiene` : 'tienes'} ${names(now)}.`, r.free ? 'No ha gastado ningún cambio.' : `${changesLeft(r.changes_left)}.`)
      void refreshBilling()
      void refreshBookings()
      navigate(withSubject('/billing'))
    },
    onError: (err) => {
      setOpen(false)
      toastError(err)
      // Sin cambios (o la cuota cambió por debajo): al refrescar, la pantalla enseña el motivo y la fecha.
      if (['discipline_change_limit', 'payer_change_pending', 'subscription_not_in_force', 'discipline_not_chosen'].includes(errorCode(err))) void refreshBilling()
    },
  })
  const busy = change.isPending

  const toBilling = (
    <Button variant="outline" size="lg" render={<Link to={withSubject('/billing')} />}>
      Ver la cuota
    </Button>
  )
  if (disciplineLocked(s))
    return (
      <Note kind="info" title="Ahora no se pueden cambiar las disciplinas" action={toBilling}>
        {planLock(s)}
      </Note>
    )
  if (s.plan.max_disciplines === null)
    return (
      <Note kind="info" title={errorText('plan_all_disciplines')} action={toBilling}>
        Con este plan no hay cambios de disciplina.
      </Note>
    )
  if (plans.isPending || disciplines.isPending) return <ListSkeleton rows={3} />
  if (plans.isError || disciplines.isError) return <ErrorState error={plans.error ?? disciplines.error} onRetry={() => void Promise.all([plans.refetch(), disciplines.refetch()])} />

  const plan = plans.data.find((p) => String(p.id) === String(s.plan.id))
  const chosen = s.disciplines.map((d) => String(d.id))
  // Un plan retirado no sale en /plans: sin sus elegibles, se ofrecen todas las disciplinas que el backend aceptaría.
  const options = (plan ? eligibleDisciplines(plan, disciplines.data, birth) : disciplines.data.filter((d) => d.is_active && !d.is_open && fitsAge(d, birth))).filter(
    (d) => !chosen.includes(String(d.id)),
  )
  const left = s.discipline_changes_left ?? 0
  const current = s.disciplines.map((d) => ({ id: String(d.id), name: d.name, free: freeChange(disciplines.data.find((x) => String(x.id) === String(d.id)), birth) }))
  // Por defecto, la que ya no se cubre: ese cambio es gratis.
  const from = picked ?? (current.find((d) => d.free) ?? current[0])?.id ?? ''
  const fromD = current.find((d) => d.id === from)
  const fromName = fromD?.name ?? ''
  const free = !!fromD?.free
  const toName = options.find((d) => String(d.id) === to)?.name ?? ''
  const out = left === 0 && !current.some((d) => d.free)
  const renews = s.current_period_end ? formatShortDate(s.current_period_end) : null
  const nowValue =
    current.length === 1 && free ? (
      <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
        {fromName} <Tag variant="success">Ya no se cubre</Tag>
      </span>
    ) : (
      names(current)
    )

  return (
    <>
      <section aria-labelledby="disc-now" className={cn('enter-soft', CARD)}>
        <h2 id="disc-now" className="text-lg font-semibold">
          {name ? `Disciplinas de ${name} ahora` : 'Tus disciplinas ahora'}
        </h2>
        <div className="flex flex-col gap-1">
          <p className="text-[17px] leading-snug font-semibold">{s.plan.name}</p>
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-heading text-[32px] leading-none font-bold tabular-nums">{left}</span>
            <span className="text-sm text-muted-foreground">{left === 1 ? 'cambio disponible' : 'cambios disponibles'} este periodo</span>
          </p>
        </div>
        <Kv
          rows={[
            [current.length === 1 ? 'Disciplina' : 'Disciplinas', nowValue],
            ...(renews ? [['Se renueva', renews] as [string, string]] : []),
          ]}
        />
      </section>
      {out ? (
        <Note kind="warning" title={`No quedan cambios hasta el ${renews ?? 'próximo periodo'}`} action={toBilling}>
          Si una disciplina deja de cubrirse, ese cambio es gratis y se puede hacer igualmente.
        </Note>
      ) : (
        <>
          {current.length > 1 && (
            <PickRows
              id="disc-from"
              title={name ? `¿Cuál deja ${name}?` : '¿Cuál dejas?'}
              value={from}
              onChange={setFrom}
              items={current.map((d) => ({ ...d, note: d.free ? 'Ya no se cubre · gratis' : undefined, disabled: left === 0 && !d.free }))}
            />
          )}
          <PickRows
            id="disc-to"
            title={name ? `¿A cuál pasa ${name}?` : '¿A cuál pasas?'}
            value={to}
            onChange={setTo}
            empty="No hay otras disciplinas en este plan."
            items={options.map((d) => ({ id: String(d.id), name: d.name, note: ageRangeLabel(d.min_age, d.max_age) || undefined }))}
          />
          {options.length > 0 && (
            <StickyFooter>
              <Button size="xl" disabled={!toName || busy} onClick={() => setOpen(true)}>
                {busy ? 'Cambiando…' : 'Revisar el cambio'}
              </Button>
              <p className="text-center text-sm text-pretty text-muted-foreground">
                {toName ? `Se aplica hoy y cancela las reservas de ${fromName}.` : `Elige a qué disciplina ${name ? `pasa ${name}` : 'pasas'}.`}
              </p>
            </StickyFooter>
          )}
        </>
      )}
      {toName && (
        <ConfirmDialog
          open={open}
          onOpenChange={(o) => !busy && setOpen(o)}
          variant="default"
          title={`¿Cambiar ${fromName} por ${toName}${name ? ` para ${name}` : ''}?`}
          description="Se aplica hoy."
          confirmLabel={busy ? 'Cambiando…' : `Cambiar a ${toName}`}
          cancelLabel="Cancelar"
          disabled={busy}
          onConfirm={() => change.mutate()}
        >
          <Kv
            rows={[
              [name ? 'Deja' : 'Dejas', fromName],
              [name ? 'Pasa a' : 'Pasas a', toName],
              ['Se aplica', 'Hoy'],
              ['Cuesta', 'Nada'],
              ['Cambios', free ? 'No gasta ninguno' : `Gasta 1 · ${changesLeft(left - 1).toLowerCase()}`],
            ]}
          />
          <p className="text-muted-foreground">Se cancelan las reservas y esperas de {fromName} desde hoy.</p>
        </ConfirmDialog>
      )}
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
