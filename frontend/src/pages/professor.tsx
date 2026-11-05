import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  BanIcon,
  CalendarDaysIcon,
  CalendarIcon,
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
import { useState } from 'react'
import type React from 'react'
import { Link, useParams } from 'react-router'
import { attKey, AttendanceItem, CorrectDialog, useCloseList } from '@/components/attendance'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Page } from '@/components/page'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/screen-state'
import { StatusAlert } from '@/components/status-alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useNow } from '@/hooks/use-now'
import { api, ApiError } from '@/lib/api'
import { addDays, formatDay, madridDay } from '@/lib/dates'
import { entryStart, mergeByStart, type Entry, type EventInfo } from '@/lib/events'
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
import { groupByDay, PAST_CHUNK_DAYS } from '@/lib/sessions'
import { path } from '@/lib/url'
import { cn } from '@/lib/utils'

const MAX_PAST_CHUNKS = 8

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

function SessionLink({ s, now }: { s: TrainerSession; now: number }) {
  const phase = phaseOf(s, now)
  const badge = PHASE_BADGE[phase]
  const off = phase === 'cancelled'
  return (
    <Link
      to={`/professor/sessions/${s.id}`}
      className={cn(
        'grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-x-3 rounded-xl border bg-card p-3 shadow-xs/5 outline-none transition-transform duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] motion-reduce:active:scale-100',
        phase === 'now' && 'border-primary/55 shadow-[inset_3px_0_0_var(--primary)]',
        off && 'bg-transparent shadow-none',
      )}
    >
      <div className="font-mono text-[15px] leading-tight tabular-nums">
        <div>{formatTime(s.starts_at)}</div>
        <div className="text-xs text-muted-foreground">{formatTime(s.ends_at)}</div>
      </div>
      <div className="min-w-0">
        <h3 className={cn('text-base leading-snug font-semibold', off && 'text-muted-foreground line-through')}>{s.discipline_name}</h3>
        <p className="text-[13px] leading-snug text-muted-foreground">
          {s.location ? `${s.location} · ` : ''}
          {plural(s.capacity, 'plaza', 'plazas')}
        </p>
        {badge && (
          <Badge variant={badge.variant} size="lg" className="mt-2">
            <badge.Icon aria-hidden="true" />
            {badge.text}
          </Badge>
        )}
      </div>
      <ChevronRightIcon className="size-5 text-muted-foreground" aria-hidden="true" />
    </Link>
  )
}

function EventLink({ e, now }: { e: EventInfo; now: number }) {
  const phase = phaseOf(e, now)
  const badge = PHASE_BADGE[phase]
  const off = phase === 'cancelled'
  return (
    <Link
      to={`/professor/events/${e.id}`}
      className={cn(
        'grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-x-3 rounded-xl border bg-card p-3 shadow-xs/5 outline-none transition-transform duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] motion-reduce:active:scale-100',
        phase === 'now' && 'border-primary/55 shadow-[inset_3px_0_0_var(--primary)]',
        off && 'bg-transparent shadow-none',
      )}
    >
      <div className="font-mono text-[15px] leading-tight tabular-nums">
        <div>{formatTime(e.starts_at)}</div>
        <div className="text-xs text-muted-foreground">{formatTime(e.ends_at)}</div>
      </div>
      <div className="min-w-0">
        <h3 className={cn('text-base leading-snug font-semibold', off && 'text-muted-foreground line-through')}>{e.title}</h3>
        <p className="text-[13px] leading-snug text-muted-foreground">{[e.location, e.discipline?.name].filter(Boolean).join(' · ')}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge variant="outline" size="lg">
            <CalendarDaysIcon aria-hidden="true" />
            Evento
          </Badge>
          {badge && (
            <Badge variant={badge.variant} size="lg">
              <badge.Icon aria-hidden="true" />
              {badge.text}
            </Badge>
          )}
        </div>
      </div>
      <ChevronRightIcon className="size-5 text-muted-foreground" aria-hidden="true" />
    </Link>
  )
}

function Days({ sessions, now }: { sessions: Entry<TrainerSession>[]; now: number }) {
  const today = madridDay(now)
  return (
    <>
      {groupByDay(sessions, (it) => (it.kind === 'session' ? it.s : it.e).starts_at).map(([day, list]) => (
        <section key={day} aria-label={formatDay(day)} className="flex flex-col gap-2.5">
          <h2 className="px-0.5 text-[13px] font-bold tracking-wide text-muted-foreground uppercase first-letter:uppercase">
            {day === today ? `Hoy · ${formatDay(day)}` : formatDay(day)}
          </h2>
          <div className="grid gap-2.5 lg:grid-cols-2">
            {list.map((it) =>
              it.kind === 'session' ? <SessionLink key={it.s.id} s={it.s} now={now} /> : <EventLink key={it.e.id} e={it.e} now={now} />,
            )}
          </div>
        </section>
      ))}
    </>
  )
}

// Sesiones: de hoy a 30 días (el defecto de la API). Las pasadas se piden por tramos de 92 días hacia atrás.
export function ProfessorSessionsPage() {
  const now = useNow()
  const today = madridDay(now)
  const upcoming = useQuery({ queryKey: ['prof-sessions', today], queryFn: () => range(today, addDays(today, 30)) })
  const [askedPast, setAskedPast] = useState(false)
  const past = useInfiniteQuery({
    queryKey: ['prof-sessions', 'past'],
    enabled: askedPast,
    initialPageParam: addDays(today, -1),
    queryFn: ({ pageParam: end }) => range(addDays(end, -(PAST_CHUNK_DAYS - 1)), end),
    getNextPageParam: (_l, pages) => (pages.length < MAX_PAST_CHUNKS ? addDays(today, -1 - PAST_CHUNK_DAYS * pages.length) : undefined),
  })
  const old = (past.data?.pages.flat() ?? []).sort((a, b) => entryStart(a) - entryStart(b))

  return (
    <Page title="Sesiones" wide>
      {upcoming.isPending ? (
        <ListSkeleton rows={4} />
      ) : upcoming.isError ? (
        <ErrorState error={upcoming.error} onRetry={() => void upcoming.refetch()} />
      ) : (
        <>
          {!askedPast || past.hasNextPage || past.isFetchingNextPage ? (
            <Button
              size="xl"
              variant="outline"
              loading={past.isFetching}
              onClick={() => (askedPast ? void past.fetchNextPage() : setAskedPast(true))}
            >
              {askedPast ? 'Cargar meses anteriores' : 'Ver sesiones anteriores'}
            </Button>
          ) : null}
          {past.isError && <ErrorState error={past.error} onRetry={() => void past.refetch()} />}
          {askedPast && past.data && old.length === 0 && <p className="text-center text-sm text-muted-foreground">No hay sesiones ni eventos anteriores.</p>}
          <Days sessions={old} now={now} />
          {upcoming.data.length === 0 ? (
            <EmptyState icon={<CalendarIcon />} title="No tienes sesiones ni eventos estos días" text="Cuando la academia te asigne una sesión o un evento aparecerá aquí." />
          ) : (
            <Days sessions={upcoming.data} now={now} />
          )}
        </>
      )}
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
        <Button size="lg" variant="outline" render={<a href={telHref(s.emergency_contact_phone)} aria-label={`Llamar al contacto de ${s.display_name}`} />}>
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

export function BackLink({ to, onClick, children }: { to?: string; onClick?: () => void; children: React.ReactNode }) {
  const cls = '-mt-3 inline-flex min-h-11 items-center gap-1 self-start font-semibold text-link'
  const icon = <ChevronLeftIcon className="size-4" aria-hidden="true" />
  return to ? (
    <Link to={to} className={cls}>{icon}{children}</Link>
  ) : (
    <button type="button" className={cls} onClick={onClick}>{icon}{children}</button>
  )
}

function Detail({ session }: { session: TrainerSession }) {
  const now = useNow()
  const phase = phaseOf(session, now)
  const cancelled = phase === 'cancelled'
  const att = useQuery({ queryKey: attKey(session.id), queryFn: () => api<Attendance>(`/sessions/${session.id}/attendance`), enabled: !cancelled })
  const [showHealth, setShowHealth] = useState(false)
  const [asking, setAsking] = useState(false)
  const [correcting, setCorrecting] = useState<AttendanceRow | null>(null)
  const close = useCloseList(session.id, () => setAsking(false))

  if (showHealth) {
    return (
      <Page title="Fichas de salud">
        <BackLink onClick={() => setShowHealth(false)}>{session.discipline_name} · {formatTime(session.starts_at)}</BackLink>
        <HealthView sessionId={session.id} />
      </Page>
    )
  }

  const day = madridDay(session.starts_at)
  const when = `${day === madridDay(now) ? 'Hoy, ' : ''}${formatDay(day)} · ${formatTime(session.starts_at)}–${formatTime(session.ends_at)}`
  const rows = att.data?.students ?? []
  const closed = att.data ? isClosed(att.data) : false
  const badge = closed ? { variant: 'success' as const, Icon: CheckIcon, text: 'Lista cerrada' } : PHASE_BADGE[phase]
  const mode = closed ? 'closed' : phase === 'upcoming' ? 'read' : 'switch'
  const open = mode === 'switch' && rows.length > 0
  const missing = unmarked(rows)
  const present = presentCount(rows)

  return (
    <Page title={session.discipline_name} wide>
      <BackLink to="/professor">Sesiones</BackLink>
      <div className={cn('grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start lg:gap-7', open && 'pb-24 lg:pb-0')}>
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border bg-card p-3.5">
            <p className="font-semibold first-letter:uppercase">{when}</p>
            <p className="text-sm text-muted-foreground">
              {session.location ? `${session.location} · ` : ''}
              {att.data ? `${plural(rows.length, 'reserva', 'reservas')} de ${plural(session.capacity, 'plaza', 'plazas')}` : plural(session.capacity, 'plaza', 'plazas')}
            </p>
            {badge && (
              <Badge variant={badge.variant} size="lg" className="mt-2">
                <badge.Icon aria-hidden="true" />
                {badge.text}
              </Badge>
            )}
          </div>
          {canSeeHealth(session, now) && (
            <button
              type="button"
              onClick={() => setShowHealth(true)}
              className="flex min-h-14 items-center gap-3 rounded-xl border bg-card px-4 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <HeartPulseIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">Ver fichas de salud</span>
                <span className="block text-[13px] text-muted-foreground">Solo hoy. Esta consulta queda registrada.</span>
              </span>
              <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          )}
          {open && (
            <div className="fixed inset-x-3 bottom-[calc(70px+env(safe-area-inset-bottom))] z-10 flex items-center justify-between gap-3 rounded-2xl border bg-card p-3 shadow-lg lg:static lg:flex-col lg:items-stretch lg:shadow-xs/5">
              <p className="text-sm font-semibold" aria-live="polite">{present} presentes · {missing.length} sin marcar</p>
              <Button size="xl" onClick={() => setAsking(true)}>Cerrar lista</Button>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3">
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
              <p className="px-0.5 text-sm font-semibold text-muted-foreground" aria-live="polite">
                {phase === 'upcoming'
                  ? `${plural(rows.length, 'reserva', 'reservas')} · ${rows.filter((r) => r.method === 'qr').length} con check-in`
                  : closed
                    ? `${plural(present, 'presente', 'presentes')} · ${plural(rows.length - present, 'falta', 'faltas')}`
                    : `${present} de ${rows.length} presentes`}
              </p>
              {phase === 'upcoming' && (
                <StatusAlert notice={{ kind: 'info', icon: 'clock', title: `La lista se abre a las ${formatTime(session.starts_at)}` }} />
              )}
              <ul className="overflow-hidden rounded-xl border bg-card">
                {rows.map((r) => (
                  <AttendanceItem key={r.booking_id} sessionId={session.id} row={r} mode={mode} onCorrect={setCorrecting} />
                ))}
              </ul>
            </>
          )}
        </div>
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
      <CorrectDialog sessionId={session.id} row={correcting} onClose={() => setCorrecting(null)} />
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
