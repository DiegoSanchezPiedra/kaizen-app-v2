import { useMutation, useQuery } from '@tanstack/react-query'
import { LoaderCircleIcon, WalletIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { Back, Kv, Note, OptionCard, StickyFooter, Tag } from '@/components/billing-bits'
import { Page } from '@/components/page'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/screen-state'
import { SubjectGate, subjectName } from '@/components/subject-gate'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup } from '@/components/ui/radio-group'
import { usePoll } from '@/hooks/use-poll'
import { useCheckoutSubject, useSubject } from '@/hooks/use-subject'
import { ApiError, api } from '@/lib/api'
import { eligibleDisciplines, isLive, perMonth, rememberCheckoutSubject, visiblePlans } from '@/lib/billing'
import { formatDeadline, formatShortDate } from '@/lib/format'
import { MISSING_TEXT } from '@/lib/notices'
import { errorCode, toastError } from '@/lib/notify'
import { path, refreshBilling, useDisciplines, usePlans, useProfileStatus, useSubscription } from '@/lib/queries'
import { useSession } from '@/lib/session'
import { ageRangeLabel } from '@/lib/catalog'
import type { Subject } from '@/lib/subject'
import type { PayerChange, Subscription } from '@/lib/types'

type Props = { subject: Subject | null; profileId?: string }
const list = (items: string[]) => items.join(', ').replace(/, ([^,]*)$/, ' y $1')

// ── Contratar (3 pasos: plan → disciplinas → pago) ──────────

const CHECKOUT_ERRORS: Record<string, [string, string]> = {
  plan_minors_only: ['Este plan es solo para menores', 'Elige otro plan.'],
  plan_not_purchasable: ['Este plan ya no se puede contratar', 'La academia lo ha retirado. Elige otro.'],
  plan_not_found: ['Este plan ya no se puede contratar', 'La academia lo ha retirado. Elige otro.'],
  discipline_not_eligible: ['Esa disciplina no entra en este plan', 'Elige otra o cambia de plan.'],
  invalid_field: ['Revisa las disciplinas', 'Elige tantas como permite el plan.'],
}

function Contract({ subject, profileId }: Props) {
  const { withSubject } = useSubject()
  const self = !subject || subject.self
  const name = subjectName(subject)
  const subscription = useSubscription(profileId)
  const status = useProfileStatus(profileId)
  const plans = usePlans()
  const disciplines = useDisciplines()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [planId, setPlanId] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const title = useRef<HTMLHeadingElement>(null)

  // El paso a paso no desliza: el foco va al título del paso (canvas, nota b183n2).
  const moved = useRef(false)
  useEffect(() => {
    if (moved.current) title.current?.focus()
    moved.current = true
  }, [step])

  const checkout = useMutation({
    mutationFn: () =>
      api<{ url: string }>('/billing/checkout', {
        method: 'POST',
        body: { plan_id: planId, discipline_ids: picked, profile_id: profileId },
      }),
    onSuccess: ({ url }) => {
      rememberCheckoutSubject(profileId)
      window.location.assign(url)
    },
    onError: (err) => {
      const code = errorCode(err)
      if (code === 'subscription_exists' || code === 'profile_incomplete') void Promise.all([subscription.refetch(), status.refetch()])
      if (CHECKOUT_ERRORS[code]) {
        setProblem(code)
        if (['plan_minors_only', 'plan_not_purchasable', 'plan_not_found'].includes(code)) setStep(1)
        if (code === 'discipline_not_eligible') setStep(2)
      } else toastError(err)
    },
  })

  const loading = subscription.isPending || status.isPending || plans.isPending || disciplines.isPending
  const failed = [subscription, status, plans, disciplines].find((q) => q.isError)
  if (loading) return <ListSkeleton rows={3} />
  if (failed) return <ErrorState error={failed.error} onRetry={() => void Promise.all([subscription.refetch(), status.refetch(), plans.refetch(), disciplines.refetch()])} />

  if (subscription.data && isLive(subscription.data.status)) {
    return (
      <Note
        kind="info"
        title={name ? `${name} ya tiene una cuota` : 'Ya tienes una cuota'}
        action={
          <Button size="lg" variant="outline" render={<Link to={withSubject('/billing')} />}>
            Ver la cuota
          </Button>
        }
      >
        No se puede contratar otra. Mira su estado en la cuota.
      </Note>
    )
  }
  const missing = status.data?.missing ?? []
  if (missing.length) {
    return (
      <Note
        kind="warning"
        title={name ? `Antes de pagar hay que completar el perfil de ${name}` : 'Antes de pagar hay que completar tu perfil'}
        action={
          <Button size="lg" variant="outline" render={<Link to={withSubject(profileId ? '/account/health' : '/onboarding')} />}>
            Completar perfil
          </Button>
        }
      >
        Falta {list(missing.map((m) => MISSING_TEXT[m]).filter(Boolean))}.
      </Note>
    )
  }

  const allDisciplines = disciplines.data ?? []
  const options = visiblePlans(plans.data ?? [], self)
  const plan = options.find((p) => String(p.id) === planId)
  const birth = subject?.birth_date ?? null
  const eligible = plan ? eligibleDisciplines(plan, allDisciplines, birth) : []
  const max = plan?.max_disciplines ?? null
  const discNames = allDisciplines.filter((d) => picked.includes(String(d.id))).map((d) => d.name)

  const pickPlan = (id: string) => {
    setPlanId(id)
    setProblem(null)
    const p = options.find((x) => String(x.id) === id)
    const e = p ? eligibleDisciplines(p, allDisciplines, birth) : []
    // Si no hay dónde elegir (Kids con una sola), van elegidas.
    setPicked(p && p.max_disciplines !== null && e.length === p.max_disciplines ? e.map((d) => String(d.id)) : [])
  }
  const next = () => {
    setProblem(null)
    setStep(step === 1 && max !== null ? 2 : 3)
  }
  const prev = () => setStep(step === 3 && max !== null ? 2 : 1)

  const stepText = ['Plan', 'Disciplinas', 'Pago'][step - 1]
  const canNext = step === 1 ? !!plan : picked.length === max

  return (
    <>
      <ol className="grid grid-cols-3 gap-1.5" aria-label="Pasos">
        {[1, 2, 3].map((n) => (
          <li key={n} aria-current={n === step ? 'step' : undefined} className={`h-1.5 rounded-full ${n <= step ? 'bg-primary' : 'bg-muted'}`}>
            <span className="sr-only">
              Paso {n}
              {n < step ? ', hecho' : n === step ? ', ahora' : ''}
            </span>
          </li>
        ))}
      </ol>
      <h2 ref={title} tabIndex={-1} className="text-lg font-semibold outline-none">
        Paso {step} de 3 · {stepText}
      </h2>
      {problem && (
        <Note kind="error" title={CHECKOUT_ERRORS[problem][0]}>
          {CHECKOUT_ERRORS[problem][1]}
        </Note>
      )}

      {step === 1 && (
        <>
          <p className="text-sm text-muted-foreground">Precios al mes, impuestos incluidos. La cuota se renueva cada mes.</p>
          <RadioGroup value={planId} onValueChange={(v) => pickPlan(String(v))} aria-label="Plan" className="flex flex-col gap-2.5">
            {options.map((p) => (
              <OptionCard
                key={p.id}
                value={String(p.id)}
                title={p.name}
                price={perMonth(p.price_cents).replace(' al mes', '')}
                priceNote="al mes"
                description={p.max_disciplines === null ? 'Todas las disciplinas' : `${p.max_disciplines} ${p.max_disciplines === 1 ? 'disciplina' : 'disciplinas'} a elegir`}
                tags={p.minors_only ? <Tag variant="secondary">Solo menores</Tag> : undefined}
              />
            ))}
          </RadioGroup>
          {options.length === 0 && <EmptyState icon={<WalletIcon />} title="Ahora no hay planes que contratar" text="Pregunta en la academia." />}
        </>
      )}

      {step === 2 && plan && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 flex w-full items-center justify-between gap-2 text-sm">
            <span>
              Plan <strong>{plan.name}</strong> · {perMonth(plan.price_cents)}
            </span>
            <Button variant="link" size="sm" onClick={prev}>
              Cambiar
            </Button>
          </legend>
          <p className="font-semibold" aria-live="polite">
            {eligible.length === max ? `Este plan solo incluye ${list(eligible.map((d) => d.name))}: ${max === 1 ? 'va elegida' : 'van elegidas'}.` : `${picked.length} de ${max} elegidas`}
          </p>
          {eligible.map((d) => {
            const on = picked.includes(String(d.id))
            const range = ageRangeLabel(d.min_age, d.max_age)
            return (
              <label key={d.id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border bg-card px-4 has-data-checked:border-primary has-data-disabled:cursor-default">
                <Checkbox
                  aria-label={d.name}
                  checked={on}
                  disabled={eligible.length === max || (!on && picked.length >= max!)}
                  onCheckedChange={(c) => setPicked((xs) => (c ? [...xs, String(d.id)] : xs.filter((x) => x !== String(d.id))))}
                />
                <span className="flex-1 font-medium">{d.name}</span>
                {range && <Tag variant="secondary">{range}</Tag>}
              </label>
            )
          })}
          {eligible.length > max! && picked.length >= max! && <p className="text-sm text-muted-foreground">Ya has elegido {max}. Quita una para elegir otra.</p>}
          {eligible.length < max! && <Note kind="info" title="Este plan no tiene disciplinas suficientes ahora">Elige otro plan o pregunta en la academia.</Note>}
        </fieldset>
      )}

      {step === 3 && plan && (
        <>
          <section aria-label="Resumen" className="rounded-2xl border bg-card px-4 py-1">
            <Kv
              rows={[
                ['Para', name ?? 'Ti'],
                ['Plan', plan.name],
                ['Disciplinas', max === null ? 'Todas' : list(discNames)],
                [
                  'Al mes',
                  <>
                    {perMonth(plan.price_cents).replace(' al mes', '')} <small className="font-normal text-muted-foreground">impuestos incluidos</small>
                  </>,
                ],
              ]}
            />
          </section>
          <p className="text-sm text-muted-foreground">Se abre Stripe para pagar con tarjeta. Kaizen no ve los datos de la tarjeta.</p>
        </>
      )}

      <StickyFooter>
        {step < 3 ? (
          <Button size="xl" disabled={!canNext} onClick={next}>
            Continuar
          </Button>
        ) : (
          <Button size="xl" loading={checkout.isPending || checkout.isSuccess} onClick={() => checkout.mutate()}>
            {checkout.isPending || checkout.isSuccess ? 'Abriendo Stripe…' : 'Ir al pago'}
          </Button>
        )}
        {step === 1 && !plan && <p className="text-center text-sm text-muted-foreground">Elige un plan para seguir.</p>}
        {step > 1 && (
          <Button variant="ghost" size="xl" onClick={prev}>
            Atrás
          </Button>
        )}
      </StickyFooter>
    </>
  )
}

export function ContractPage() {
  const { withSubject } = useSubject()
  return (
    <Page title="Contratar cuota">
      <Back to={withSubject('/billing')}>Cuota</Back>
      <SubjectGate>{(p) => <Contract key={p.profileId ?? 'self'} {...p} />}</SubjectGate>
    </Page>
  )
}

// ── Vuelta del Checkout ──────────────────────────────────────────────────

function Returning({ subject, profileId }: Props) {
  const { withSubject } = useSubject()
  const name = subjectName(subject)
  const poll = usePoll(
    ['subscription', profileId ?? 'self'],
    () =>
      api<Subscription>(path('/billing/subscription', { profile_id: profileId })).catch((err) => {
        if (err instanceof ApiError && err.code === 'subscription_not_found') return null
        throw err
      }),
    (s) => !!s && isLive(s.status),
  )
  useEffect(() => {
    if (poll.phase === 'done') void refreshBilling()
  }, [poll.phase])

  if (poll.phase === 'done' && poll.data) {
    const s = poll.data
    return (
      <>
        <Note kind="success" title={name ? `${name} ya tiene cuota` : 'Ya tienes cuota'}>
          {s.plan.name}
          {s.plan.max_disciplines !== null && s.disciplines.length ? ` · ${list(s.disciplines.map((d) => d.name))}` : ''}
          {s.current_period_end ? ` · se renueva el ${formatShortDate(s.current_period_end)}` : ''}
        </Note>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button size="xl" render={<Link to={withSubject('/calendar')} />}>
            Reservar una sesión
          </Button>
          <Button size="xl" variant="outline" render={<Link to={withSubject('/billing')} />}>
            Ver la cuota
          </Button>
        </div>
      </>
    )
  }
  if (poll.phase === 'stopped') {
    return (
      <>
        <Note kind="warning" title="No podemos comprobarlo ahora">
          El pago no se repite. Reintenta o mira la cuota en un rato.
        </Note>
        <Button size="xl" onClick={poll.restart}>
          Reintentar
        </Button>
      </>
    )
  }
  return (
    <>
      <div role="status" className="flex flex-col items-center gap-3 rounded-2xl border bg-card px-5 py-8 text-center">
        <LoaderCircleIcon className="size-8 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
        <p className="text-lg font-semibold">{poll.phase === 'slow' ? 'Puede tardar unos minutos' : 'Confirmando el pago…'}</p>
        <p className="text-sm text-muted-foreground">
          {poll.phase === 'slow'
            ? 'El pago está hecho en Stripe. Puedes esperar aquí o salir: la cuota aparecerá en Cuenta › Cuota. Lo seguimos comprobando.'
            : 'Stripe ya lo ha cobrado. Falta que nos llegue el aviso; suele tardar unos segundos.'}
        </p>
      </div>
      {poll.phase === 'slow' && (
        <Button size="xl" variant="outline" render={<Link to={withSubject('/')} />}>
          Ir a Inicio
        </Button>
      )}
    </>
  )
}

export function SuccessPage() {
  useCheckoutSubject()
  return (
    <Page title="Pago">
      <SubjectGate>{(p) => <Returning key={p.profileId ?? 'self'} {...p} />}</SubjectGate>
    </Page>
  )
}

export function CancelPage() {
  useCheckoutSubject()
  const { withSubject } = useSubject()
  return (
    <Page title="Pago">
      <Note kind="info" title="No se ha cobrado nada">
        Has salido del pago antes de terminar. Puedes volver a intentarlo cuando quieras.
      </Note>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button size="xl" render={<Link to={withSubject('/billing/contract')} />}>
          Volver a intentarlo
        </Button>
        <Button size="xl" variant="outline" render={<Link to={withSubject('/billing')} />}>
          Ir a la cuota
        </Button>
      </div>
    </Page>
  )
}

// ── Cambio de pagador (enlace del email al nuevo pagador) ───────────────

function PayerChangeView({ id }: { id: string }) {
  const session = useSession()
  const [params] = useSearchParams()
  const back = !!params.get('session_id')
  const [problem, setProblem] = useState<ApiError | null>(null)
  const get = () => api<PayerChange>(`/billing/payer-changes/${id}`)
  const change = useQuery({ queryKey: ['payer-change', id], queryFn: get, retry: false })
  // Al volver del Checkout, el paso a «paid» lo trae el webhook.
  const poll = usePoll(['payer-change', id], get, (pc) => !!pc && pc.status !== 'requested', back && change.data?.status === 'requested')
  const pc = (poll.phase === 'done' ? poll.data : undefined) ?? change.data

  const pay = useMutation({
    mutationFn: () => api<{ url: string }>(`/billing/payer-changes/${id}/checkout`, { method: 'POST' }),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (err) => {
      if (!(err instanceof ApiError)) return toastError(err)
      if (['payer_change_expired', 'payer_change_cancelled', 'payer_change_paid'].includes(err.code)) return void change.refetch()
      if (['not_new_payer', 'profile_incomplete'].includes(err.code)) return setProblem(err)
      toastError(err)
    },
  })

  if (change.isPending) return <ListSkeleton rows={2} />
  if (change.isError) {
    if (change.error instanceof ApiError && change.error.status === 404)
      return (
        <EmptyState
          icon={<WalletIcon />}
          title="No lo encontramos"
          text="Puede que el enlace esté mal copiado."
          action={
            <Button size="xl" variant="outline" render={<Link to="/" />}>
              Volver al inicio
            </Button>
          }
        />
      )
    return <ErrorState error={change.error} onRetry={() => void change.refetch()} />
  }
  if (!pc) return null
  const student = pc.student.id === session?.id ? undefined : pc.student
  const quota = student ? `la cuota de ${student.name}` : 'tu cuota'
  const toBilling = student ? `/billing?${new URLSearchParams({ para: student.id })}` : '/billing'

  if (problem?.code === 'not_new_payer') {
    return (
      <EmptyState
        icon={<WalletIcon />}
        title="Este pago no es para ti"
        text="Lo tiene que hacer la persona a la que se lo pidió la academia."
        action={
          <Button size="xl" variant="outline" render={<Link to="/" />}>
            Volver al inicio
          </Button>
        }
      />
    )
  }
  if (pc.status === 'paid' || pc.status === 'completed') {
    return (
      <>
        <Note kind="success" title="Hecho">
          Desde el {formatShortDate(pc.starts_at)} pagas tú {quota}: {perMonth(pc.price_cents)}, impuestos incluidos. Hasta entonces, nada cambia.
        </Note>
        <Button size="xl" variant="outline" render={<Link to={toBilling} />}>
          Ver {quota}
        </Button>
      </>
    )
  }
  if (pc.status === 'expired') {
    return (
      <Note kind="info" title="Este enlace ha caducado">
        El plazo terminó el {formatDeadline(pc.deadline)} y sigue pagando quien pagaba. Si aún quieres pagar tú, pídeselo a la academia.
      </Note>
    )
  }
  if (pc.status === 'cancelled') {
    return (
      <Note kind="info" title="Este cambio se ha anulado">
        El enlace ya no vale. No tienes que hacer nada.
      </Note>
    )
  }
  if (back && poll.phase !== 'stopped') {
    return (
      <div role="status" className="flex flex-col items-center gap-3 rounded-2xl border bg-card px-5 py-8 text-center">
        <LoaderCircleIcon className="size-8 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
        <p className="text-lg font-semibold">{poll.phase === 'slow' ? 'Puede tardar unos minutos' : 'Confirmando…'}</p>
        <p className="text-sm text-muted-foreground">Stripe ya tiene tu tarjeta. Falta que nos llegue el aviso.</p>
      </div>
    )
  }
  const missing = problem?.code === 'profile_incomplete' && Array.isArray(problem.details.missing) ? (problem.details.missing as string[]) : null
  return (
    <>
      {back && poll.phase === 'stopped' && (
        <Note kind="warning" title="No podemos comprobarlo ahora">
          Si ya has pagado, no lo repitas: mira {quota} en un rato.
        </Note>
      )}
      <p>La academia te ha pedido que pagues tú {quota} a partir de su renovación.</p>
      <section aria-label="Detalle" className="rounded-2xl border bg-card px-4 py-1">
        <Kv
          rows={[
            ['Alumno', pc.student.name],
            ['Plan', pc.plan.name],
            ...(pc.disciplines.length ? ([['Disciplinas', list(pc.disciplines.map((d) => d.name))]] as [string, string][]) : []),
            ['Desde', formatShortDate(pc.starts_at)],
            [
              'Al mes',
              <>
                {perMonth(pc.price_cents).replace(' al mes', '')} <small className="font-normal text-muted-foreground">impuestos incluidos</small>
              </>,
            ],
            ['Hoy pagas', '0,00 €'],
          ]}
        />
      </section>
      <Note kind="warning" title={`Tienes hasta el ${formatDeadline(pc.deadline)}`}>
        Si no, sigue pagando quien pagaba y este enlace deja de valer.
      </Note>
      {missing && (
        <Note
          kind="warning"
          title="Antes de pagar hay que completar el perfil"
          action={
            <Button size="lg" variant="outline" render={<Link to={student ? `/account/health?${new URLSearchParams({ para: student.id })}` : '/onboarding'} />}>
              Completar
            </Button>
          }
        >
          Falta {list(missing.map((m) => MISSING_TEXT[m]).filter(Boolean))}.
        </Note>
      )}
      <p className="text-sm text-muted-foreground">
        Stripe te pedirá la tarjeta. Hoy no se cobra nada; desde el {formatShortDate(pc.starts_at)}, {perMonth(pc.price_cents)}.
      </p>
      <Button size="xl" disabled={!!missing} loading={pay.isPending || pay.isSuccess} onClick={() => pay.mutate()}>
        {pay.isPending || pay.isSuccess ? 'Abriendo Stripe…' : 'Pagar · 0 € hoy'}
      </Button>
    </>
  )
}

export function PayerChangePage() {
  const { id = '' } = useParams()
  return (
    <Page title="Cambio de pagador">
      <PayerChangeView id={id} />
    </Page>
  )
}
