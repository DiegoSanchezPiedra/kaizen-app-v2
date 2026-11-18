import { useQuery } from '@tanstack/react-query'
import {
  BanIcon,
  CalendarDaysIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  HeartPulseIcon,
  LockIcon,
  PhoneIcon,
  PlayIcon,
  UsersIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type React from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { attKey, AttendanceItem, CorrectDialog, useCloseList } from '@/components/attendance'
import { CARD } from '@/components/child-access'
import { ClockCard } from '@/components/clock-card'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { NextUp } from '@/components/next-up'
import { Page } from '@/components/page'
import { Rise } from '@/components/rise'
import { SessionRow, SessionRows } from '@/components/session-row'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/screen-state'
import { StatusAlert } from '@/components/status-alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { WeekBoard } from '@/components/week-board'
import { useNow } from '@/hooks/use-now'
import { useWeek } from '@/hooks/use-week'
import { api, ApiError } from '@/lib/api'
import { addDays, formatDay, madridDay } from '@/lib/dates'
import { mergeByStart, type Entry, type EventInfo } from '@/lib/events'
import { errorText } from '@/lib/errors'
import { formatTime } from '@/lib/format'
import {
  canSeeHealth,
  isClosed,
  phaseOf,
  plural,
  presentCount,
  splitHealth,
  telHref,
  unmarked,
  type Attendance,
  type AttendanceRow,
  type HealthStudent,
  type Phase,
  type TrainerSession,
} from '@/lib/professor'
import { groupByDay } from '@/lib/sessions'
import { path } from '@/lib/url'
import { pickDay } from '@/lib/week'
import { cn } from '@/lib/utils'

// Sus sesiones y sus eventos, mezclados por fecha (B21.2).
const range = (from: string, to: string): Promise<Entry<TrainerSession>[]> =>
  Promise.all([
    api<{ sessions: TrainerSession[] }>(path('/professor/sessions', { from, to })),
    api<{ events: EventInfo[] }>(path('/professor/events', { from, to })),
  ]).then(([s, e]) => mergeByStart(s.sessions, e.events))

const PHASE_BADGE: Record<Phase, { variant: 'outline' | 'info' | 'secondary' | 'error'; Icon: typeof ClockIcon; text: string } | null> = {
  upcoming: null,
  now: { variant: 'info', Icon: PlayIcon, text: 'En curso · pasa lista' },
  ended: { variant: 'secondary', Icon: CheckIcon, text: 'Terminada' },
  cancelled: { variant: 'error', Icon: BanIcon, text: 'Cancelada' },
}

const chevron = <ChevronRightIcon className="size-5 text-muted-foreground" aria-hidden="true" />

// En la lista, «En curso» a secas: la llamada a pasar lista va en el hueco de arriba (y cabe en las 7 columnas de `lg`).
function phaseBadge(phase: Phase) {
  const badge = PHASE_BADGE[phase]
  return badge ? (
    <Badge variant={badge.variant} size="lg">
      <badge.Icon aria-hidden="true" />
      {phase === 'now' ? 'En curso' : badge.text}
    </Badge>
  ) : (
    chevron
  )
}

function SessionLink({ s, now }: { s: TrainerSession; now: number }) {
  const phase = phaseOf(s, now)
  return (
    <SessionRow
      to={`/professor/sessions/${s.id}`}
      start={s.starts_at}
      end={s.ends_at}
      title={s.discipline_name}
      meta={`${s.location ? `${s.location} · ` : ''}${plural(s.capacity, 'plaza', 'plazas')}`}
      off={phase === 'cancelled'}
      aside={phaseBadge(phase)}
    />
  )
}

function EventLink({ e, now }: { e: EventInfo; now: number }) {
  const phase = phaseOf(e, now)
  return (
    <SessionRow
      to={`/professor/events/${e.id}`}
      start={e.starts_at}
      end={e.ends_at}
      title={e.title}
      meta={[e.location, e.discipline?.name].filter(Boolean).join(' · ')}
      off={phase === 'cancelled'}
      below={
        <Badge variant="outline" size="lg">
          <CalendarDaysIcon aria-hidden="true" />
          Evento
        </Badge>
      }
      aside={phaseBadge(phase)}
    />
  )
}

// Sesiones y eventos de la semana elegida (docs/pantallas-b22.md § Calendario semanal); antes y después, con las flechas.
// El botón blanco sobre la cara azul de NextUp (el mismo que «Hacer check-in» en Reservas).
const ON_FACE = 'w-full border-transparent bg-white text-primary hover:bg-white/90 focus-visible:ring-white focus-visible:ring-offset-0 dark:bg-white dark:hover:bg-white/90'

// La sesión o el evento en curso: el único caso con un elemento dominante. Lleva a pasar lista.
const liveOf = (it: Entry<TrainerSession>) =>
  it.kind === 'session' ? { ...it.s, title: it.s.discipline_name, to: `/professor/sessions/${it.s.id}` } : { ...it.e, to: `/professor/events/${it.e.id}` }

// Lo que está en curso: el único caso con un elemento dominante. La primera ocupa el hueco; si coincide otra
// (dos tatamis, una sesión y un evento), su botón va debajo con su nombre, en el mismo hueco.
function LiveNow({ items, now }: { items: Entry<TrainerSession>[]; now: number }) {
  const [x, ...more] = items.map(liveOf)
  return (
    <NextUp
      startsAt={x.starts_at}
      endsAt={x.ends_at}
      title={x.title}
      location={x.location}
      live
      now={now}
      action={[x, ...more].map((y, i) => (
        <Button key={y.to} size="xl" variant="outline" className={ON_FACE} render={<Link to={y.to} />}>
          <UsersIcon />
          {i === 0 ? 'Pasar lista' : `Pasar lista de ${y.title}`}
        </Button>
      ))}
    />
  )
}

// La entrada escalonada, solo la primera vez de la sesión de la app.
let played = false

export function ProfessorSessionsPage() {
  const [first] = useState(!played)
  useEffect(() => {
    played = true
  }, [])
  const now = useNow()
  const w = useWeek()
  const query = useQuery({ queryKey: ['prof-sessions', w.week], queryFn: () => range(w.week, addDays(w.week, 6)) })
  // La semana de hoy, con la misma clave: en la semana actual no pide nada más y, al ir a otra, el hueco se queda.
  const thisWeek = pickDay(w.today).week
  const today = useQuery({ queryKey: ['prof-sessions', thisWeek], queryFn: () => range(thisWeek, addDays(thisWeek, 6)) })
  const live = (today.data ?? []).filter((it) => phaseOf(it.kind === 'session' ? it.s : it.e, now) === 'now')
  const byDay = new Map(groupByDay(query.data ?? [], (it) => (it.kind === 'session' ? it.s : it.e).starts_at))

  return (
    <Page title="Sesiones" wide>
      {/* En `lg`, el hueco y la Jornada lado a lado; si solo hay uno, ocupa todo el ancho. */}
      <div className="flex flex-col gap-4 not-has-[>:not(:empty)]:hidden lg:grid lg:auto-cols-fr lg:grid-flow-col lg:items-start">
        {live.length > 0 && (
          <Rise on={first} i={0} className={first ? undefined : 'enter-soft'}>
            <LiveNow items={live} now={now} />
          </Rise>
        )}
        <Rise on={first} i={1} className="empty:hidden">
          <ClockCard />
        </Rise>
      </div>
      <Rise on={first} i={2}>
        <WeekBoard
          w={w}
          query={query}
          marked={new Set(byDay.keys())}
          noun="sesiones"
          renderDay={(day) => (
            <SessionRows>
              {(byDay.get(day) ?? []).map((it) => (it.kind === 'session' ? <SessionLink key={it.s.id} s={it.s} now={now} /> : <EventLink key={it.e.id} e={it.e} now={now} />))}
            </SessionRows>
          )}
        />
      </Rise>
    </Page>
  )
}

// Fichas de salud: solo se piden al montar esto (tras tocar «Ver fichas»), sin caché ni refetch, y se van al salir.
export function HealthView({ sessionId, kind = 'sessions' }: { sessionId: string; kind?: 'sessions' | 'events' }) {
  const query = useQuery({
    queryKey: ['prof-health', kind, sessionId],
    queryFn: () => api<{ students: HealthStudent[] }>(`/professor/${kind}/${sessionId}/health`).then((r) => r.students),
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  if (query.isPending) return <ListSkeleton rows={3} />
  if (query.isError) {
    if (query.error instanceof ApiError && (query.error.code === 'session_not_found' || query.error.status === 404)) {
      return <EmptyState icon={<LockIcon />} title="Estas fichas ya no se pueden ver" text={`Solo se ven ${kind === 'events' ? 'los días del evento' : 'el día de la sesión'} y si no está cancelad${kind === 'events' ? 'o' : 'a'}.`} />
    }
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  }
  const { withInfo, without } = splitHealth(query.data)
  const contact = (s: HealthStudent) =>
    s.emergency_contact_phone ? (
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 text-[13px] text-muted-foreground">
          Contacto: {s.emergency_contact_name ? `${s.emergency_contact_name} · ` : ''}
          <span className="whitespace-nowrap">{s.emergency_contact_phone}</span>
        </span>
        <Button size="xl" variant="outline" render={<a href={telHref(s.emergency_contact_phone)} aria-label={`Llamar al contacto de ${s.display_name}`} />}>
          <PhoneIcon />
          Llamar
        </Button>
      </div>
    ) : (
      <span className="text-[13px] text-muted-foreground">Sin contacto de emergencia</span>
    )
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">Esta consulta queda registrada. Las fichas no se guardan en el móvil y desaparecen al salir.</p>
      {withInfo.length === 0 && <EmptyState icon={<HeartPulseIcon />} title="Nadie ha indicado nada" text="Los contactos de emergencia, aquí abajo." />}
      {withInfo.length > 0 && (
        <section aria-label="Con algo que indicar" className="flex flex-col gap-3">
          <h2 className="px-0.5 text-[13px] font-bold tracking-wide text-muted-foreground uppercase">Con algo que indicar · {withInfo.length}</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {withInfo.map(({ student, fields }) => (
              <article key={student.student_id} className="flex flex-col gap-2.5 rounded-xl border bg-card p-3.5">
                <h3 className="font-semibold">{student.display_name}</h3>
                <dl className="flex flex-col gap-1.5">
                  {fields.map((f) => (
                    <div key={f.label}>
                      <dt className="text-xs font-semibold text-muted-foreground uppercase">{f.label}</dt>
                      <dd className="text-[15px] leading-snug">{f.value}</dd>
                    </div>
                  ))}
                </dl>
                {contact(student)}
              </article>
            ))}
          </div>
        </section>
      )}
      {without.length > 0 && (
        <section aria-label="Sin nada que indicar" className="flex flex-col gap-3">
          <h2 className="px-0.5 text-[13px] font-bold tracking-wide text-muted-foreground uppercase">
            {withInfo.length === 0 ? 'Contactos de emergencia' : 'Sin nada que indicar'} · {without.length}
          </h2>
          <ul className="overflow-hidden rounded-xl border bg-card">
            {without.map((s) => (
              <li key={s.student_id} className="flex flex-col gap-1 border-b px-3.5 py-2.5 last:border-b-0">
                <span className="font-semibold">{s.display_name}</span>
                {contact(s)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

// Las fichas como una entrada del historial: el «atrás» del móvil vuelve a la lista en vez de salir de la sesión.
// La entrada lleva una marca que solo conoce esta visita: al recargar (o volver a la entrada otro día) no casa y
// se ve la lista, así que las fichas nunca se piden sin tocar «Ver fichas».
export function useHealthView() {
  const location = useLocation()
  const navigate = useNavigate()
  const [mark, setMark] = useState<string | null>(null)
  const open = () => {
    const m = Math.random().toString(36).slice(2)
    setMark(m)
    navigate(`${location.pathname}${location.search}`, { state: { fichas: m } })
  }
  return { show: mark !== null && (location.state as { fichas?: string } | null)?.fichas === mark, open, close: () => navigate(-1) }
}

export function BackLink({ to, onClick, children }: { to?: string; onClick?: () => void; children: React.ReactNode }) {
  const cls = '-mt-3 inline-flex min-h-11 items-center gap-1 self-start font-semibold text-link'
  const icon = <ChevronLeftIcon className="size-4" aria-hidden="true" />
  return to ? (
    <Link to={to} className={cls}>{icon}{children}</Link>
  ) : (
    <button type="button" className={cls} onClick={onClick}>{icon}{children}</button>
  )
}

// La entrada escalonada del detalle, solo la primera vez de la sesión de la app.
let detailPlayed = false

function Detail({ session }: { session: TrainerSession }) {
  const now = useNow()
  const phase = phaseOf(session, now)
  const cancelled = phase === 'cancelled'
  const att = useQuery({ queryKey: attKey(session.id), queryFn: () => api<Attendance>(`/sessions/${session.id}/attendance`), enabled: !cancelled })
  const health = useHealthView()
  const [asking, setAsking] = useState(false)
  const [correcting, setCorrecting] = useState<AttendanceRow | null>(null)
  // El plazo lo da la API; `expired` cubre que el parámetro cambie con la pantalla abierta.
  const [expired, setExpired] = useState(false)
  // Al volver de las fichas no se repite la entrada.
  const [first, setFirst] = useState(!detailPlayed)
  // Si pasa a «en curso» con la pantalla abierta, el hueco entra suave (enter-soft); si ya lo estaba, sin más.
  const [liveAtStart] = useState(phase === 'now')
  const close = useCloseList(session.id, () => setAsking(false))
  useEffect(() => {
    detailPlayed = true
  }, [])

  if (health.show) {
    return (
      <Page title="Fichas de salud">
        <BackLink onClick={health.close}>{session.discipline_name} · {formatTime(session.starts_at)}</BackLink>
        <HealthView sessionId={session.id} />
      </Page>
    )
  }

  const day = madridDay(session.starts_at)
  const when = `${day === madridDay(now) ? 'Hoy, ' : ''}${formatDay(day)} · ${formatTime(session.starts_at)}–${formatTime(session.ends_at)}`
  const rows = att.data?.students ?? []
  const closed = att.data ? isClosed(att.data) : false
  const until = att.data?.correctable_until
  const canCorrect = !expired && !(until && now >= Date.parse(until))
  const badge = closed ? { variant: 'success' as const, Icon: CheckIcon, text: 'Lista cerrada' } : PHASE_BADGE[phase]
  const mode = closed ? 'closed' : phase === 'upcoming' ? 'read' : 'switch'
  const open = mode === 'switch' && rows.length > 0
  const missing = unmarked(rows)
  const present = presentCount(rows)
  const seats = att.data ? `${plural(rows.length, 'reserva', 'reservas')} de ${plural(session.capacity, 'plaza', 'plazas')}` : plural(session.capacity, 'plaza', 'plazas')

  return (
    <Page title={session.discipline_name} wide>
      <BackLink to={`/professor?dia=${day}`}>Sesiones</BackLink>
      <div className={cn('grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:items-start lg:gap-x-7 lg:gap-y-3', open && 'pb-28 lg:pb-0')}>
        <div className="flex flex-col gap-3">
          <Rise on={first} i={0}>
            {/* En curso y con la lista abierta, el hueco azul es lo dominante (la disciplina ya es el título). key: sin ella
                React reutiliza el div de la tarjeta (mismo sitio) y @starting-style no se dispara. */}
            {phase === 'now' && !closed ? (
              <div key="live" className={liveAtStart ? undefined : 'enter-soft'}>
                <NextUp startsAt={session.starts_at} endsAt={session.ends_at} title={seats} location={session.location} live now={now} />
              </div>
            ) : (
              <div className={cn(CARD, 'gap-1')}>
                <p className="font-semibold tabular-nums first-letter:uppercase">{when}</p>
                <p className="text-sm text-muted-foreground">
                  {session.location ? `${session.location} · ` : ''}
                  {seats}
                </p>
                {badge && (
                  <Badge variant={badge.variant} size="lg" className="mt-1.5 self-start">
                    <badge.Icon aria-hidden="true" />
                    {badge.text}
                  </Badge>
                )}
                {closed && canCorrect && until && (
                  <p className="mt-1 text-[13px] text-muted-foreground tabular-nums">
                    Puedes corregir hasta {madridDay(until) === madridDay(now) ? 'hoy' : `el ${formatDay(madridDay(until))}`} a las {formatTime(until)}
                  </p>
                )}
              </div>
            )}
          </Rise>
          {canSeeHealth(session, now) && (
            <Rise on={first} i={1}>
              <button
                type="button"
                onClick={() => {
                  setFirst(false)
                  health.open()
                }}
                className="flex min-h-14 w-full items-center gap-3 rounded-2xl border bg-card px-4 py-2.5 text-left outline-none transition-[scale] duration-150 ease-(--ease-out) focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]"
              >
                <HeartPulseIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">Ver fichas de salud</span>
                  <span className="block text-[13px] text-muted-foreground">Solo hoy. Esta consulta queda registrada.</span>
                </span>
                <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            </Rise>
          )}
        </div>

        <Rise on={first} i={2} className="flex flex-col gap-3 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          {cancelled ? (
            <EmptyState icon={<BanIcon />} title="Sesión cancelada" text="No tiene lista." />
          ) : att.isPending ? (
            <ListSkeleton rows={4} className="h-18" />
          ) : att.isError ? (
            <ErrorState error={att.error} onRetry={() => void att.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState icon={<UsersIcon />} title="Aún no hay reservas" text="Cuando alguien reserve esta sesión aparecerá aquí." />
          ) : (
            <>
              {/* Antes de empezar, lo primero es saber cuándo se abre. */}
              {phase === 'upcoming' && !closed && (
                <StatusAlert notice={{ kind: 'info', icon: 'clock', title: `La lista se abre a las ${formatTime(session.starts_at)}` }} />
              )}
              {closed && !canCorrect && <StatusAlert notice={{ kind: 'error', icon: 'clock', title: errorText('correction_window_expired') }} />}
              <h2 className="px-0.5 text-sm font-semibold text-muted-foreground tabular-nums">
                {mode === 'read'
                  ? `${plural(rows.length, 'reserva', 'reservas')} · ${rows.filter((r) => r.method === 'qr').length} con check-in`
                  : closed
                    ? `${plural(present, 'presente', 'presentes')} · ${plural(rows.length - present, 'falta', 'faltas')}`
                    : `Alumnos · ${rows.length}`}
              </h2>
              <ul className="overflow-hidden rounded-2xl border bg-card">
                {rows.map((r) => (
                  <AttendanceItem key={r.booking_id} sessionId={session.id} row={r} mode={mode} onCorrect={setCorrecting} touch canCorrect={canCorrect} />
                ))}
              </ul>
            </>
          )}
        </Rise>
        {/* Después de la lista (en el móvil va abajo, fija; en lg, debajo de las fichas por la rejilla). Fuera de Rise: un
            transform en el padre rompería el `fixed`. El único contador, y el único aria-live. */}
        {open && (
          <div className="fixed inset-x-3 bottom-[calc(70px+env(safe-area-inset-bottom))] z-10 flex items-center justify-between gap-3 rounded-2xl border bg-card p-3 pl-4 shadow-lg lg:static lg:col-start-1 lg:row-start-2 lg:flex-col lg:items-stretch lg:p-4 lg:shadow-xs/5">
            <p className="min-w-0" aria-live="polite">
              <span className="block text-sm font-semibold">
                <span className="font-heading text-3xl leading-none font-bold tabular-nums">{present}</span>
                <span className="tabular-nums"> de {rows.length}</span> {present === 1 ? 'presente' : 'presentes'}
              </span>
              <span className="block text-[13px] text-muted-foreground tabular-nums">{missing.length ? `${missing.length} sin marcar` : 'Todos marcados'}</span>
            </p>
            <Button size="xl" onClick={() => setAsking(true)}>Cerrar lista</Button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title="¿Cerrar la lista?"
        description={missing.length ? 'Quien no esté marcado pasa a falta.' : 'Todos están presentes.'}
        confirmLabel="Cerrar lista"
        cancelLabel="Volver"
        variant="default"
        loading={close.isPending}
        onConfirm={() => close.mutate()}
      >
        {missing.length > 0 && (
          <ul className="list-disc pl-5">
            {missing.map((r) => (
              <li key={r.student_id}>{r.display_name}</li>
            ))}
          </ul>
        )}
      </ConfirmDialog>
      <CorrectDialog sessionId={session.id} row={correcting} onClose={() => setCorrecting(null)} onExpired={() => setExpired(true)} />
    </Page>
  )
}

export function ProfessorSessionPage() {
  const { id = '' } = useParams()
  const query = useQuery({
    queryKey: ['prof-session', id],
    queryFn: () => api<{ session: TrainerSession }>(`/professor/sessions/${id}`).then((r) => r.session),
  })
  if (query.isPending) return <Page title="Sesión"><ListSkeleton rows={3} /></Page>
  if (query.isError) {
    return (
      <Page title="Sesión">
        <BackLink to="/professor">Sesiones</BackLink>
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Page>
    )
  }
  return <Detail key={id} session={query.data} />
}
