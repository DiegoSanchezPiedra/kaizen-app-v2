import { useMutation } from '@tanstack/react-query'
import { CalendarIcon, LoaderCircleIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { Back, Kv, Note, StickyFooter } from '@/components/billing-bits'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EventBadge, EventCard } from '@/components/event-card'
import { Page } from '@/components/page'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/screen-state'
import { SubjectGate, subjectName } from '@/components/subject-gate'
import { Button } from '@/components/ui/button'
import { useNow } from '@/hooks/use-now'
import { usePoll } from '@/hooks/use-poll'
import { useCheckoutSubject, useSubject } from '@/hooks/use-subject'
import { api } from '@/lib/api'
import { rememberCheckoutSubject } from '@/lib/billing'
import {
  amountFor, audienceTag, audienceText, eventWhen, isMember, joinState, priceView, spotsLabel, type EventInfo, type JoinState,
} from '@/lib/events'
import { formatDeadline, formatEuros } from '@/lib/format'
import { bookBlock, joinBlock } from '@/lib/minor'
import { homeNotices } from '@/lib/notices'
import { errorCode, toastError, toastOk } from '@/lib/notify'
import { eventOf, refreshEvents, useEvent, useEvents, useMinor, useProfileStatus, useSubscription } from '@/lib/queries'
import type { Subject } from '@/lib/subject'
import { toastManager } from '@/components/ui/toast'

type Props = { subject: Subject | null; profileId?: string }

// El socio sale de la cuota del sujeto: sin cargar aún, no se sabe (el precio de socio se enseña como nota).
function useMember(profileId?: string): boolean | undefined {
  const sub = useSubscription(profileId)
  return sub.data === undefined ? undefined : isMember(sub.data)
}

// ── Lista (pestaña Eventos del Calendario) ───────────────────────────────

export function EventList({ profileId }: Props) {
  const { withSubject } = useSubject()
  const events = useEvents(profileId)
  const member = useMember(profileId)
  if (events.isPending) return <ListSkeleton rows={3} />
  if (events.isError) return <ErrorState error={events.error} onRetry={() => void events.refetch()} />
  if (events.data.length === 0)
    return <EmptyState icon={<CalendarIcon />} title="No hay eventos próximos" text="Cuando la academia publique un seminario, un torneo o una quedada aparecerá aquí." />
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {events.data.map((e) => (
        <EventCard key={e.id} e={e} member={member} to={withSubject(`/events/${e.id}`)} />
      ))}
    </div>
  )
}

// ── Detalle ──────────────────────────────────────────────────────────────

const joinLabel = (amount: number, name?: string) => `${name ? `Inscribir a ${name}` : 'Inscribirse'}${amount > 0 ? ` · ${formatEuros(amount)}` : ''}`

function Detail({ e, subject, profileId }: Props & { e: EventInfo }) {
  const { withSubject } = useSubject()
  const name = subjectName(subject)
  const member = useMember(profileId)
  const status = useProfileStatus(profileId)
  // Con un hijo, además el estado del propio tutor (su protección de datos): hace falta para actuar por él.
  const selfStatus = useProfileStatus(undefined)
  const [mismatch, setMismatch] = useState(false)
  const [asking, setAsking] = useState(false)
  const [params] = useSearchParams()

  // La vuelta del Checkout: la inscripción pasa a confirmada con el webhook, así que se relee hasta verla (B18.3).
  const returning = params.get('pago') === 'ok'
  const poll = usePoll(['events', profileId ?? 'self', 'one', e.id], () => eventOf(e.id, profileId), (ev) => !!ev && ev.registration?.status !== 'pending', returning && e.registration?.status === 'pending')
  useEffect(() => {
    if (poll.phase === 'done') void refreshEvents()
  }, [poll.phase])

  const blockers = homeNotices({ status: status.data, subject: subject && !subject.self ? subject : null, self: profileId ? selfStatus.data : undefined }).filter((n) =>
    ['profile', 'sign', 'self-dp'].includes(n.id),
  )
  const ready = !status.isPending && !(profileId && selfStatus.isPending)
  const now = useNow()
  const state: JoinState = joinState(e, { now, blocked: blockers.length > 0, audienceBlocked: mismatch })
  const amount = amountFor(e, member === true)
  // B32: un menor sin permiso de reservar (o ante un evento de pago) ve el motivo en lugar de inscribirse o cancelar.
  const minor = useMinor()
  const blocked = joinBlock(minor, e.price_cents)
  const cancelBlock = bookBlock(minor) // ya inscrito, solo cuenta el permiso de reservar: «lo inscribe tu tutor» no viene a cuento

  const join = useMutation({
    mutationFn: () => api<{ url?: string }>(`/events/${e.id}/registrations`, { method: 'POST', body: { profile_id: profileId } }),
    onSuccess: ({ url }) => {
      // Con importe, al Checkout; vuelve a /events/:id?pago=ok sin ?para=, así que se guarda el sujeto (B18.3).
      if (url) {
        rememberCheckoutSubject(profileId)
        window.location.assign(url)
      } else toastOk(name ? `${name} está inscrito` : 'Inscripción confirmada')
    },
    onError: (err) => {
      const code = errorCode(err)
      if (code === 'audience_mismatch') setMismatch(true)
      if (code === 'profile_incomplete') void Promise.all([status.refetch(), selfStatus.refetch()])
      else if (code !== 'audience_mismatch') void refreshEvents()
      if (code === 'audience_mismatch') toastManager.add({ type: 'error', title: audienceText(name), timeout: 5000 })
      else toastError(err)
    },
    onSettled: (data) => (data?.url ? undefined : refreshEvents()),
  })
  const redirecting = join.isSuccess && !!join.data.url

  const cancel = useMutation({
    mutationFn: () => api(`/events/registrations/${e.registration!.id}`, { method: 'DELETE' }),
    onSuccess: () => toastOk('Inscripción cancelada'),
    onError: (err) => {
      if (errorCode(err) === 'already_cancelled') toastManager.add({ type: 'info', title: 'La inscripción ya estaba cancelada.', timeout: 4000 })
      else toastError(err)
    },
    onSettled: async () => {
      setAsking(false)
      await refreshEvents()
    },
  })

  const price = priceView(e, member)
  const spots = spotsLabel(e)
  const tag = audienceTag(e.audience)
  const reg = e.registration
  const waiting = returning && reg?.status === 'pending' && poll.phase !== 'done'

  const action = (() => {
    if (waiting) {
      return poll.phase === 'stopped' ? (
        <>
          <Note kind="warning" title="No podemos comprobarlo ahora">
            El pago no se repite. Reintenta o mira Reservas en un rato.
          </Note>
          <Button size="xl" onClick={poll.restart}>Reintentar</Button>
        </>
      ) : (
        <div role="status" className="flex flex-col items-center gap-3 rounded-2xl border bg-card px-5 py-8 text-center">
          <LoaderCircleIcon className="size-8 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
          <p className="text-lg font-semibold">{poll.phase === 'slow' ? 'Puede tardar unos minutos' : 'Confirmando el pago…'}</p>
          <p className="text-sm text-muted-foreground">
            {poll.phase === 'slow'
              ? 'El pago está hecho en Stripe. Puedes esperar aquí o salir: la inscripción aparecerá en Reservas. Lo seguimos comprobando.'
              : 'Stripe ya lo ha cobrado. Falta que nos llegue el aviso; suele tardar unos segundos.'}
          </p>
        </div>
      )
    }
    switch (state) {
      case 'cancelled':
        return <Note kind="error" title="Evento cancelado">{reg && reg.status !== 'cancelled' ? 'Tu inscripción se ha cancelado.' : 'Ya no se puede inscribir nadie.'}</Note>
      case 'paid':
        return (
          <Note kind="success" title={name ? `${name} está inscrito` : 'Estás inscrito'}>
            Pagado {formatEuros(reg!.amount_cents)}. Para cancelar, pídelo a la academia.
          </Note>
        )
      case 'registered':
        return <Note kind="success" title={name ? `${name} está inscrito` : 'Estás inscrito'} />
      case 'cancellable':
      case 'pending':
        return (
          <>
            {state === 'pending' ? (
              <Note kind="warning" title="Falta pagar la inscripción">
                La plaza está reservada mientras se completa el pago (30 minutos). Si no lo has terminado, cancela e inscríbete de nuevo.
              </Note>
            ) : (
              <Note kind="success" title={name ? `${name} está inscrito` : 'Estás inscrito'}>
                {cancelBlock ?? 'Puedes cancelar hasta que empiece.'}
              </Note>
            )}
            {!cancelBlock && (
              <StickyFooter>
                <Button size="xl" variant="outline" loading={cancel.isPending} onClick={() => setAsking(true)}>
                  Cancelar inscripción
                </Button>
              </StickyFooter>
            )}
          </>
        )
      case 'closed':
        return <Note kind="info" title="Las inscripciones están cerradas">{e.registration_deadline ? `El plazo terminó el ${formatDeadline(e.registration_deadline)}.` : 'El evento ya ha empezado.'}</Note>
      case 'full':
        return <Note kind="info" title="Completo">No quedan plazas. Si se libera alguna, volverá a aparecer aquí.</Note>
      case 'audience':
        return <Note kind="info" title={audienceText(name)} />
      case 'profile':
        return (
          <>
            {blockers.map((n) => (
              <Note
                key={n.id}
                kind="warning"
                title={n.title}
                action={<Button size="lg" variant="outline" render={<Link to={withSubject(n.to)} />}>{n.cta}</Button>}
              >
                {n.text} Hace falta para inscribirse.
              </Note>
            ))}
          </>
        )
      case 'open':
        if (blocked) return <Note kind="info" title={blocked} />
        return (
          <StickyFooter>
            <Button size="xl" loading={!ready || join.isPending || redirecting} onClick={() => join.mutate()}>
              {joinLabel(amount, name)}
            </Button>
            {amount > 0 && <p className="text-center text-xs text-muted-foreground">Pagas con tarjeta en la página segura de Stripe. Impuestos incluidos.</p>}
          </StickyFooter>
        )
    }
  })()

  const rows: [string, React.ReactNode][] = [
    ['Precio', <>{price.main}{price.note && <span className="ml-1.5 text-xs font-medium text-muted-foreground">{price.note}</span>}</>],
  ]
  if (spots) rows.push(['Plazas', spots])
  if (e.registration_deadline) rows.push(['Inscripción hasta', formatDeadline(e.registration_deadline)])

  return (
    <>
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-3.5">
        <h2 className="text-xl leading-snug font-semibold">{e.title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <EventBadge e={e} />
          {tag && <span className="text-sm font-semibold text-muted-foreground">{tag}</span>}
        </div>
        <p className="font-semibold first-letter:uppercase">{eventWhen(e)}</p>
        <p className="text-sm text-muted-foreground">{[e.location, e.discipline?.name, e.trainer?.display_name].filter(Boolean).join(' · ')}</p>
        {e.description && <p className="text-[15px] leading-snug whitespace-pre-line">{e.description}</p>}
      </div>
      <div className="rounded-xl border bg-card px-3.5 py-1">
        <Kv rows={rows} />
        {e.price_cents > 0 && <p className="border-t py-2 text-xs text-muted-foreground">Importes con impuestos incluidos.</p>}
      </div>
      {action}
      <ConfirmDialog
        open={asking}
        onOpenChange={(o) => !o && !cancel.isPending && setAsking(false)}
        title="¿Cancelar la inscripción?"
        description={reg?.status === 'pending' ? 'Se anula el pago que tienes a medias y se libera la plaza.' : 'Se libera la plaza. Podrás volver a inscribirte si sigue abierto.'}
        confirmLabel="Cancelar inscripción"
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate()}
      />
    </>
  )
}

function Loaded({ id, subject, profileId }: Props & { id: string }) {
  const query = useEvent(id, profileId)
  if (query.isPending) return <ListSkeleton rows={2} />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  return <Detail e={query.data} subject={subject} profileId={profileId} />
}

export function EventPage() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const para = params.get('para')
  useCheckoutSubject()
  const back = { pathname: '/calendar', search: `?${new URLSearchParams({ tab: 'events', ...(para ? { para } : {}) })}` }
  return (
    <Page title="Evento">
      <Back to={back}>Eventos</Back>
      <SubjectGate>{(s) => <Loaded key={`${id}-${s.profileId ?? 'self'}`} id={id} {...s} />}</SubjectGate>
    </Page>
  )
}
