import { useMutation } from '@tanstack/react-query'
import { CalendarIcon, LoaderCircleIcon, MapPinIcon } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { Back, Kv, Note, StickyFooter } from '@/components/billing-bits'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EventBadge, EventCard } from '@/components/event-card'
import { Page } from '@/components/page'
import { Rise } from '@/components/rise'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/screen-state'
import { Seats } from '@/components/seats'
import { SubjectGate, subjectName } from '@/components/subject-gate'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useNow } from '@/hooks/use-now'
import { usePoll } from '@/hooks/use-poll'
import { useCheckoutSubject, useSubject } from '@/hooks/use-subject'
import { api } from '@/lib/api'
import { rememberCheckoutSubject } from '@/lib/billing'
import {
  amountFor, audienceTag, audienceText, eventHeadline, eventSpan, isMember, joinState, priceView, spotsLabel, type EventInfo, type JoinState,
} from '@/lib/events'
import { formatDeadline, formatEuros } from '@/lib/format'
import { bookBlock, joinBlock } from '@/lib/minor'
import { homeNotices } from '@/lib/notices'
import { errorCode, toastError, toastOk } from '@/lib/notify'
import { eventOf, refreshEvents, useEvent, useEvents, useMinor, useProfileStatus, useSubscription } from '@/lib/queries'
import type { Subject } from '@/lib/subject'
import { toastManager } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

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

// La entrada escalonada se juega una vez por sesión de la app (en memoria), como en Inicio y Progreso.
let played = false

// Rejilla del detalle: una columna en móvil (el HTML va en ese orden) y, desde lg, la izquierda y los datos en 21 rem a la derecha.
// El pie fijo es hijo directo de la rejilla (si no, dejaría de pegarse) y va a la columna izquierda.
const GRID = 'flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start lg:gap-x-8'

const joinLabel = (amount: number, name?: string) => `${name ? `Inscribir a ${name}` : 'Inscribirse'}${amount > 0 ? ` · ${formatEuros(amount)}` : ''}`

function Detail({ e, subject, profileId }: Props & { e: EventInfo }) {
  const { withSubject } = useSubject()
  const name = subjectName(subject)
  const member = useMember(profileId)
  const subLoading = useSubscription(profileId).isLoading
  const status = useProfileStatus(profileId)
  // Con un hijo, además el estado del propio tutor (su protección de datos): hace falta para actuar por él.
  const selfStatus = useProfileStatus(undefined)
  const [mismatch, setMismatch] = useState(false)
  const [asking, setAsking] = useState(false)
  const [params] = useSearchParams()
  const [first] = useState(!played)
  useEffect(() => {
    played = true
  }, [])
  const descId = useId()

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

  const notes = (() => {
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
        return state === 'pending' ? (
          <Note kind="warning" title="Falta pagar la inscripción">
            La plaza está reservada mientras se completa el pago (30 minutos). Si no lo has terminado, cancela e inscríbete de nuevo.
          </Note>
        ) : (
          <Note kind="success" title={name ? `${name} está inscrito` : 'Estás inscrito'}>
            {cancelBlock ?? 'Puedes cancelar hasta que empiece.'}
          </Note>
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
        return blocked ? <Note kind="info" title={blocked} /> : null
    }
  })()

  // El pie fijo con la acción (cancelar o inscribirse). Va fuera del bloque de estado: pegado a un hermano suyo no se sostendría.
  const joinable = !waiting && state === 'open' && !blocked
  // Hasta saber si es socio, el importe del botón podría cambiar: se espera si hay precio de socio.
  // isLoading y no isPending: un menor (consulta desactivada) o un error no deben dejar el botón cargando para siempre.
  const memberKnown = !subLoading || e.member_price_cents == null
  const footer = waiting ? null : state === 'cancellable' || state === 'pending' ? (
    !cancelBlock && (
      <StickyFooter>
        <Button size="xl" variant="outline" loading={cancel.isPending} onClick={() => setAsking(true)}>
          Cancelar inscripción
        </Button>
      </StickyFooter>
    )
  ) : joinable ? (
    <StickyFooter>
      <Button size="xl" loading={!ready || !memberKnown || join.isPending || redirecting} onClick={() => join.mutate()}>
        {joinLabel(amount, name)}
      </Button>
      {amount > 0 && <p className="text-center text-xs text-muted-foreground">Pagas con tarjeta en la página segura de Stripe. Impuestos incluidos.</p>}
    </StickyFooter>
  ) : null

  const rows: [string, React.ReactNode][] = [
    ['Precio', <>{price.main}{price.note && <span className="ml-1.5 text-xs font-medium text-muted-foreground">{price.note}</span>}</>],
  ]
  if (spots)
    rows.push([
      'Plazas',
      <span key="plazas" className="flex flex-col items-end gap-1">
        {spots}
        {e.capacity !== null && spots !== 'Completo' && <Seats taken={e.taken} capacity={e.capacity} />}
      </span>,
    ])
  if (e.registration_deadline) rows.push(['Inscripción hasta', formatDeadline(e.registration_deadline)])
  if (e.discipline) rows.push(['Disciplina', e.discipline.name])
  if (e.trainer?.display_name) rows.push(['Profesor', e.trainer.display_name])

  // Turno de entrada de cada bloque: el de estado solo cuenta si se pinta.
  const o = notes ? 1 : 0

  return (
    <>
      <div className={cn(GRID, 'lg:[&>.sticky]:col-start-1')}>
        <Rise on={first} i={0} className="lg:col-start-1">
          <div className="flex flex-col gap-2 rounded-2xl border bg-card p-4">
            <div>
              <p className="font-heading text-4xl leading-none font-bold tabular-nums text-balance first-letter:uppercase">{eventHeadline(e.starts_at)}</p>
              <p className="mt-1.5 text-sm text-muted-foreground first-letter:uppercase">{eventSpan(e)}</p>
            </div>
            <h2 className="mt-1 text-lg leading-snug font-semibold">{e.title}</h2>
            <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
              <MapPinIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {e.location}
            </p>
            <div className="flex flex-wrap items-center gap-2 empty:hidden">
              <EventBadge e={e} />
              {tag && <Badge variant="secondary">{tag}</Badge>}
            </div>
          </div>
        </Rise>
        {notes && (
          <Rise on={first} i={1} className="flex flex-col gap-4 lg:col-start-1">
            {notes}
          </Rise>
        )}
        <Rise on={first} i={o + 1} className="lg:col-start-2 lg:row-span-3 lg:row-start-1">
          <div className="rounded-2xl border bg-card px-4 py-1">
            <Kv rows={rows} />
            {e.price_cents > 0 && !joinable && <p className="border-t py-2 text-xs text-muted-foreground">Importes con impuestos incluidos.</p>}
          </div>
        </Rise>
        {e.description && (
          <Rise on={first} i={o + 2} className="lg:col-start-1">
            <section aria-labelledby={descId} className="flex flex-col gap-2">
              <h3 id={descId} className="text-base font-semibold">Sobre el evento</h3>
              <p className="max-w-[70ch] text-[15px] leading-relaxed whitespace-pre-line">{e.description}</p>
            </section>
          </Rise>
        )}
        {footer}
      </div>
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

function DetailSkeleton() {
  return (
    <div className={GRID} aria-busy="true" aria-label="Cargando">
      <Skeleton className="h-40 rounded-2xl lg:col-start-1" />
      <Skeleton className="h-16 rounded-2xl lg:col-start-1" />
      <Skeleton className="h-32 rounded-2xl lg:col-start-2 lg:row-span-2 lg:row-start-1" />
    </div>
  )
}

function Loaded({ id, subject, profileId }: Props & { id: string }) {
  const query = useEvent(id, profileId)
  // Sin red la consulta se pausa y se quedaría en esqueleto: se dice «Sin conexión» (ErrorState lo detecta con error null).
  if (query.isPending && query.fetchStatus === 'paused') return <ErrorState error={null} onRetry={() => void query.refetch()} />
  if (query.isPending) return <DetailSkeleton />
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
    <Page title="Evento" lgWide>
      <Back to={back}>Eventos</Back>
      <SubjectGate>{(s) => <Loaded key={`${id}-${s.profileId ?? 'self'}`} id={id} {...s} />}</SubjectGate>
    </Page>
  )
}
