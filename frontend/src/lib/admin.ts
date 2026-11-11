import { addDays, madridDay } from '@/lib/dates'
import type { Role } from '@/lib/paths'
import { formatEuros } from '@/lib/format'
import { phaseOf, plural } from '@/lib/professor'
import type { ProfileStatus, Subscription } from '@/lib/types'

// GET /auth/me (B4): el aviso del MFA sale solo si la API dice que no está activo; mientras carga, no.
export type AuthMe = { user: { id: string; role: string }; mfa_enabled: boolean }
export const showMfaNotice = (me: AuthMe | undefined): boolean => me?.mfa_enabled === false

// GET /admin/reports/subscriptions: un día o un mes sin foto llega con las cifras a null, salvo `trained` (sale de las asistencias, no de la foto: nunca es null).
export type StatFigures = {
  active: number | null
  past_due: number | null
  unpaid: number | null
  new_subscriptions: number | null
  cancelled_subscriptions: number | null
  trained: number
}
export type DayStat = StatFigures & { date: string }
export type MonthStat = StatFigures & { month: string; days_with_data: number; days_in_month: number }
export type SubscriptionReport<R> = { group: 'day' | 'month'; from: string; to: string; rows: R[]; trained: number }

export const hasData = (r: StatFigures): boolean => r.active !== null

// Cifras de Inicio: la última foto con dato. `stale`: no es la de ayer (la foto es nocturna, ADR 0012).
export function latestStat(rows: DayStat[], today: string = madridDay()): { row: DayStat; stale: boolean } | null {
  const row = rows.findLast(hasData)
  return row ? { row, stale: row.date !== addDays(today, -1) } : null
}

// Las listas paginadas del panel: Inicio solo lee su `total` (con limit=1).
export type Paged<K extends string, T> = Record<K, T[]> & { total: number; limit: number; offset: number }

export type AcademyNotice = { id: string; created_at: string; action: string; resource_type: string; resource_id: string; details: Record<string, unknown> }

// Los avisos que tienen al admin de destinatario (docs/pantallas-b19.md § Avisos). Uno desconocido sale tal cual.
const NOTICE_LABEL: Record<string, string> = {
  'notice.stripe_risk': 'Riesgo de Stripe: revísalo en el Dashboard de Stripe',
  'notice.checkout_race_refunded': 'Dos pagos a la vez: se devolvió el duplicado',
  'notice.payer_change_expired': 'Un cambio de pagador ha caducado',
  'notice.event_refund_failed': 'Stripe ha rechazado el reembolso de una inscripción: reintenta el reembolso desde el evento',
  'notice.clock_correction_requested': 'Un profesor ha pedido una corrección de su jornada',
  'notice.clock_open': 'Un profesor lleva más de 16 horas con la jornada abierta',
}
export const noticeLabel = (action: string): string => NOTICE_LABEL[action] ?? action

// A quién se abre un aviso de la academia: la ficha del alumno si el aviso la trae (`student_id`).
export const noticeStudent = (n: AcademyNotice): string | null => (typeof n.details.student_id === 'string' ? n.details.student_id : null)

// De qué profesor es un aviso del registro de jornada (lo trae en `profile_id`): abre su jornada en el panel.
export const noticeClock = (n: AcademyNotice): string | null =>
  n.action.startsWith('notice.clock_') && typeof n.details.profile_id === 'string' ? n.details.profile_id : null

// A qué evento se refiere un aviso de la academia (el de un reembolso fallido lo trae en `event_id`).
export const noticeEvent = (n: AcademyNotice): string | null => (typeof n.details.event_id === 'string' ? n.details.event_id : null)

// Entregas fallidas: el nombre en español del aviso. Uno desconocido sale tal cual.
const DELIVERY_LABEL: Record<string, string> = {
  'notice.payment_failed': 'Cobro fallido',
  'notice.checkout_payment_failed': 'Pago de contratación fallido',
  'notice.checkout_race_refunded': 'Pago duplicado devuelto',
  'notice.plan_downgraded': 'Plan rebajado',
  'notice.upgrade_requires_action': 'Subida de plan pendiente de autorizar',
  'notice.subscription_unpaid': 'Cuota impagada',
  'notice.subscription_cancelled': 'Cuota dada de baja',
  'notice.payer_change_requested': 'Cambio de pagador pedido',
  'notice.payer_change_paid': 'Cambio de pagador pagado',
  'notice.payer_change_expired': 'Cambio de pagador caducado',
  'notice.payer_change_cancelled': 'Cambio de pagador anulado',
  'notice.booking_promoted': 'Plaza conseguida',
  'notice.session_cancelled': 'Sesión cancelada',
  'notice.session_changed': 'Sesión cambiada',
  'notice.session_restored': 'Sesión recuperada',
  'notice.no_coverage': 'Sin cobertura',
  'notice.out_of_age': 'Fuera de edad',
  'notice.out_of_age_soon': 'Fuera de edad pronto',
  'notice.discipline_change': 'Cambio de disciplina',
  'notice.agreement_published': 'Documento nuevo para firmar',
  'notice.event_changed': 'Evento cambiado',
  'notice.pause_scheduled': 'Pausa programada',
  'notice.pause_started': 'Pausa empezada',
  'notice.pause_ending_soon': 'La pausa termina pronto',
  'notice.pause_ended': 'Pausa terminada',
  'notice.pause': 'Reserva cancelada por una pausa',
  'notice.event_cancelled': 'Evento cancelado',
  'notice.event_registration_cancelled': 'Inscripción cancelada',
  'notice.event_refunded': 'Reembolso de un evento',
  'notice.event_refund_failed': 'Reembolso de un evento fallido',
  'notice.clock_corrected': 'Fichaje corregido por la academia',
  'notice.clock_open': 'Jornada sin cerrar',
  'notice.clock_correction_applied': 'Corrección de jornada aplicada',
  'notice.clock_correction_rejected': 'Corrección de jornada rechazada',
}
export const deliveryLabel = (action: string): string => DELIVERY_LABEL[action] ?? action
export const CHANNEL_LABEL: Record<string, string> = { email: 'Email', push: 'Push' }

export type Delivery = { id: string; created_at: string; action: string; channel: string; recipient: { id: string; display_name: string | null }; attempts: number; last_error: string | null }

// Auditoría (docs/pantallas-b19.md § Auditoría). Categoría → prefijos de `action` para `GET /admin/audit?action=`.
export const AUDIT_CATEGORIES = [
  { value: 'attendance', label: 'Asistencia', prefixes: ['attendance.'] },
  { value: 'health', label: 'Salud', prefixes: ['health.'] },
  { value: 'sessions', label: 'Sesiones y clases', prefixes: ['session.', 'class.'] },
  { value: 'catalog', label: 'Catálogo', prefixes: ['plan.', 'discipline.'] },
  { value: 'billing', label: 'Cobros', prefixes: ['subscription.', 'subscription_schedule.', 'pause.'] },
  { value: 'users', label: 'Usuarios', prefixes: ['profile.', 'guardian.'] },
  { value: 'documents', label: 'Documentos', prefixes: ['agreement_document.'] },
  { value: 'settings', label: 'Ajustes', prefixes: ['settings.'] },
  { value: 'bookings', label: 'Reservas', prefixes: ['booking.'] },
  { value: 'events', label: 'Eventos', prefixes: ['event.', 'event_registration.'] },
] as const
// Una categoría desconocida (URL a mano) no filtra.
export const categoryPrefixes = (value: string | null): string | undefined => AUDIT_CATEGORIES.find((c) => c.value === value)?.prefixes.join(',')

const AUDIT_LABEL: Record<string, string> = {
  'attendance.close': 'Cerró la lista',
  'attendance.correct': 'Corrigió una asistencia',
  'health.view': 'Vio las fichas de salud',
  'session.create': 'Creó una sesión',
  'session.adjust': 'Ajustó una sesión',
  'session.cancel': 'Canceló una sesión',
  'session.restore': 'Recuperó una sesión',
  'session.reset': 'Devolvió una sesión a su clase',
  'class.create': 'Creó una clase',
  'class.change': 'Cambió una clase',
  'class.retire': 'Retiró una clase',
  'plan.price_change': 'Cambió el precio de un plan',
  'plan.activate': 'Activó un plan',
  'plan.retire': 'Retiró un plan',
  'plan.set_eligible': 'Cambió las disciplinas de un plan',
  'discipline.update': 'Editó una disciplina',
  'subscription.create': 'Contrató una cuota',
  'subscription.cancel_now': 'Dio de baja una suscripción',
  'subscription.cancel_at_period_end': 'Programó la baja de una suscripción',
  'subscription.upgrade': 'Subió de plan',
  'subscription.downgrade': 'Programó una bajada de plan',
  'subscription.downgrade_cancel': 'Canceló una bajada de plan',
  'subscription.discipline_change': 'Cambió una disciplina de la cuota',
  'subscription.payer_change_request': 'Pidió un cambio de pagador',
  'subscription.payer_change_cancel': 'Anuló un cambio de pagador',
  'subscription.pause': 'Programó una pausa',
  'subscription.pause_cancel': 'Anuló una pausa',
  'subscription.pause_end_early': 'Volvió antes de una pausa',
  'pause.exempt': 'Eximió una pausa de la cuota de mantenimiento',
  'profile.role_change': 'Cambió el rol',
  'profile.unpublish': 'Despublicó un perfil',
  'guardian.add': 'Vinculó un tutor',
  'guardian.remove': 'Desvinculó un tutor',
  'agreement_document.publish': 'Publicó un documento',
  'settings.discipline_changes': 'Cambió los cambios de disciplina por periodo',
  'settings.pause': 'Cambió los ajustes de la pausa',
  'booking.create': 'Hizo una reserva',
  'booking.cancel': 'Canceló una reserva',
  'event.create': 'Creó un evento',
  'event.update': 'Cambió un evento',
  'event.cancel': 'Canceló un evento',
  'event_registration.guest': 'Inscribió a un invitado',
  'event_registration.cancel': 'Canceló una inscripción',
  'event_registration.refund': 'Reintentó un reembolso',
}
export const auditLabel = (action: string): string => AUDIT_LABEL[action] ?? action

export type AuditRow = {
  id: string
  created_at: string
  action: string
  actor: { id: string | null; display_name: string | null }
  resource_type: string
  resource_id: string
  changes: Record<string, unknown> | null
}

const STATUS_LABEL: Record<string, string> = { present: 'presente', absent: 'ausente', late: 'tarde' }
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
// El detalle en una línea; vacío si no hay nada que decir. Nunca ids de alumnos ni salud: `health.view` no da detalle.
export function auditDetail(a: Pick<AuditRow, 'action' | 'changes'>, roleLabel: Record<string, string> = ROLE_LABEL): string {
  const c = a.changes ?? {}
  const from = str(c.from)
  const to = str(c.to)
  if (a.action === 'attendance.correct' && from && to) {
    const reason = str(c.reason)
    return `${STATUS_LABEL[from] ?? from} → ${STATUS_LABEL[to] ?? to}${reason ? ` · ${reason}` : ''}`
  }
  if (a.action === 'profile.role_change' && from && to) return `${roleLabel[from] ?? from} → ${roleLabel[to] ?? to}`
  if (/price_change$/.test(a.action) && typeof c.from === 'number' && typeof c.to === 'number') return `${c.from / 100} € → ${c.to / 100} €`
  if (a.action === 'pause.exempt') return str(c.reason) ?? ''
  if (a.action === 'session.cancel') return str(c.note) ?? ''
  if (a.action === 'event.create') return str(c.title) ?? ''
  if (a.action === 'event.cancel') return [str(c.note), typeof c.registrations === 'number' && plural(c.registrations, 'inscripción', 'inscripciones')].filter(Boolean).join(' · ')
  if (a.action === 'event.update') return eventChanges(c.to)
  if (a.action === 'event_registration.cancel') return c.refund === true ? 'Con reembolso' : 'Sin reembolso'
  if (a.action === 'event_registration.refund' && typeof c.amount_cents === 'number') return formatEuros(c.amount_cents)
  if (a.action === 'agreement_document.publish') return [str(c.type), str(c.version) && `v${c.version}`].filter(Boolean).join(' ')
  return ''
}

// event.update trae en `to` solo lo que cambió: se dice qué campos, sin los valores (pueden ser largos).
const EVENT_FIELD: Record<string, string> = {
  title: 'título', description: 'descripción', starts_at: 'inicio', ends_at: 'fin', location: 'lugar', discipline_id: 'disciplina', trainer_id: 'profesor',
  capacity: 'aforo', audience: 'público', price_cents: 'precio', member_price_cents: 'precio de socio',
  registration_deadline: 'fecha límite',
}
const eventChanges = (to: unknown): string =>
  to && typeof to === 'object' ? Object.keys(to).map((k) => EVENT_FIELD[k] ?? k).join(', ') : ''

// A dónde lleva el recurso: la ficha de un perfil (o el hijo de un tutor) o la sesión. El resto, sin enlace.
export function auditTarget(a: Pick<AuditRow, 'resource_type' | 'resource_id'> & { changes?: AuditRow['changes'] }): { to: string | null; label: string } {
  if (a.resource_type === 'profile' || a.resource_type === 'guardian') return { to: `/admin/users/${a.resource_id}`, label: 'Ficha' }
  // Un alta trae el alumno en changes: la ficha es la suya, no la del pagador.
  const student = str(a.changes?.student_id)
  if (a.resource_type === 'subscription' && student) return { to: `/admin/users/${student}`, label: 'Ficha' }
  if (a.resource_type === 'session') return { to: `/admin/sessions/${a.resource_id}`, label: 'Sesión' }
  if (a.resource_type === 'event') return { to: `/admin/events/${a.resource_id}`, label: 'Evento' }
  const label: Record<string, string> = { class: 'Clase', plan: 'Plan', discipline: 'Disciplina', subscription: 'Suscripción', pause: 'Pausa', booking: 'Reserva', event_registration: 'Inscripción', agreement_document: 'Documento', settings: 'Ajustes' }
  return { to: null, label: label[a.resource_type] ?? a.resource_type }
}

// Cambios de pagador (GET /admin/payer-changes). «En curso» = requested+paid; «Caducados» = expired.
type PayerRef = { id: string; display_name: string | null }
export type PayerChange = {
  id: string
  status: string
  subscription_id: string
  student: PayerRef
  old_payer: PayerRef
  new_payer: PayerRef
  plan: { id: string; name: string }
  starts_at: string
  deadline: string
  cancel_reason: string | null
  updated_at: string
}
export const PAYER_VIEWS = { live: 'requested,paid', expired: 'expired' } as const
// Anular solo si aún no está pagado (DELETE /admin/subscriptions/:id/payer-change).
export const canCancelPayerChange = (c: Pick<PayerChange, 'status'>): boolean => c.status === 'requested'

// Cobros (GET /admin/billing/delinquents|grace)
export type OverdueItem = {
  kind: 'subscription'
  id: string
  student_id: string
  student_name: string | null
  label: string
  status: string
  current_period_end: string | null
  cancel_at_period_end: boolean
}
export type OverdueInvoice = {
  id: string
  item_id: string
  amount_due_cents: number
  attempt_count: number
  next_payment_attempt: string | null
  last_payment_error: string | null
  hosted_invoice_url: string | null
}
export type OverduePayer = { payer_id: string; display_name: string | null; items: OverdueItem[]; invoices: OverdueInvoice[] }
// Solo https: la URL viene de Stripe, pero se abre en otra pestaña y no se fía.
export const safeInvoiceUrl = (u: string | null): string | null => (u && /^https:\/\//.test(u) ? u : null)

// Usuarios (B19.0). Nunca llegan la fecha de nacimiento ni la salud: de la edad, solo las dos marcas.
export const ROLE_LABEL: Record<Role, string> = { alumno: 'Alumno', tutor: 'Tutor', profesor: 'Profesor', admin: 'Admin' }

type Person = { id: string; display_name: string | null; email?: string | null }
export type ProfileRow = {
  id: string
  display_name: string | null
  avatar: string | null
  email: string | null
  role: Role
  is_minor: boolean
  pending_claim: boolean
  created_at: string
  subscription_status: string | null
  plan_id: string | null
  plan_name: string | null
  estado: Estado | null
  last_attendance_at: string | null
}
export type ProfileFile = {
  profile: Omit<ProfileRow, 'subscription_status' | 'plan_id' | 'plan_name' | 'estado' | 'last_attendance_at'> & { is_public: boolean; has_password: boolean; has_google: boolean }
  status: ProfileStatus | null
  guardians: Person[]
  children: { id: string; display_name: string | null; pending_claim: boolean }[]
  subscription: (Subscription & { payer: Person }) | null
}

// Un hijo es un perfil sin acceso propio: sin credenciales, así que sin email.
export const isChild = (p: { email: string | null }): boolean => p.email === null
// El rol admin no se quita desde la app (admin_role_locked) y un hijo siempre es alumno (child_role_locked); dar admin sí (B20).
export const canChangeRole = (p: { role: Role; email: string | null }): boolean => p.role !== 'admin' && !isChild(p)

export const ageMarks = (p: { is_minor: boolean; pending_claim: boolean }): string[] =>
  [p.is_minor && 'Menor', p.pending_claim && 'Mayor de edad sin reclamar'].filter((m): m is string => !!m)

// Quién puede pasar a pagar la cuota: sus tutores y él mismo si es un adulto con acceso propio; nunca el actual.
export function payerCandidates(f: ProfileFile): Person[] {
  const self = !isChild(f.profile) && !f.profile.is_minor ? [f.profile] : []
  return [...self, ...f.guardians].filter((p) => p.id !== f.subscription?.payer.id)
}

// Enlace a otra página de una tabla: conserva la pestaña y los filtros de la URL.
export function pageHref(params: URLSearchParams, page: number): string {
  const n = new URLSearchParams(params)
  if (page > 1) n.set('page', String(page))
  else n.delete('page')
  return `?${n}`
}
export const pageOf = (params: URLSearchParams): number => Math.max(1, Math.floor(Number(params.get('page'))) || 1)

// ── Usuarios: KPIs y filtros (B22.3). El estado (el más fuerte) lo calcula la API. ──

export const ESTADOS = ['activo', 'impago', 'inactivo', 'sin_plan'] as const
export type Estado = (typeof ESTADOS)[number]
export type ProfileStats = { activos: number; impago: number; inactivos: number }
export const ESTADO_TAG: Record<Estado, [string, 'success' | 'warning' | 'error' | 'outline']> = {
  activo: ['Activo', 'success'],
  inactivo: ['Inactivo', 'warning'],
  impago: ['Impago', 'error'],
  sin_plan: ['Sin plan', 'outline'],
}

const ID_RE = /^\d{1,18}$/
const ROLES: Role[] = ['alumno', 'tutor', 'profesor', 'admin']
export type UserFilters = { q: string; role: Role | null; discipline: string | null; plan: string | null; estado: Estado | null; page: number }

// La URL es la fuente: lo que no es válido se ignora (no se manda a la API, que respondería 400).
export function userFilters(params: URLSearchParams): UserFilters {
  const pick = <T extends string>(k: string, ok: (v: string) => boolean) => {
    const v = params.get(k)
    return v !== null && ok(v) ? (v as T) : null
  }
  return {
    q: params.get('q') ?? '',
    role: pick<Role>('role', (v) => ROLES.includes(v as Role)),
    discipline: pick('discipline', (v) => ID_RE.test(v)),
    plan: pick('plan', (v) => ID_RE.test(v)),
    estado: pick<Estado>('estado', (v) => ESTADOS.includes(v as Estado)),
    page: pageOf(params),
  }
}

// Cambiar un filtro vuelve a la primera página; vacío o «all» lo quita.
export function setFilter(params: URLSearchParams, key: keyof Omit<UserFilters, 'page'>, value: string | null): URLSearchParams {
  const n = new URLSearchParams(params)
  if (value && value !== 'all') n.set(key, value)
  else n.delete(key)
  n.delete('page')
  return n
}

// Pulsar una tarjeta KPI pone su estado; volver a pulsarla lo quita.
export const toggleEstado = (params: URLSearchParams, estado: Estado): URLSearchParams =>
  setFilter(params, 'estado', userFilters(params).estado === estado ? null : estado)

export const hasFilters = (f: UserFilters): boolean => !!(f.q || f.role || f.discipline || f.plan || f.estado)

// Parámetros de GET /admin/profiles (los de los KPIs: solo discipline_id).
export const profilesQuery = (f: UserFilters, pageSize: number): Record<string, string | undefined> => ({
  q: f.q || undefined,
  role: f.role ?? undefined,
  discipline_id: f.discipline ?? undefined,
  plan_id: f.plan ?? undefined,
  estado: f.estado ?? undefined,
  limit: String(pageSize),
  offset: String((f.page - 1) * pageSize),
})

const relFmt = new Intl.RelativeTimeFormat('es', { numeric: 'auto' })
// «hoy», «ayer», «hace 3 días», «hace 2 meses»; «—» si nunca. Por días de Madrid.
export function lastSeen(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '—'
  const days = Math.round((Date.parse(madridDay(now)) - Date.parse(madridDay(iso))) / 864e5)
  if (days < 31) return relFmt.format(-days, 'day')
  if (days < 365) return relFmt.format(-Math.floor(days / 30), 'month')
  return relFmt.format(-Math.floor(days / 365), 'year')
}

// ── Inicio en vivo (B23): GET /admin/home ──

export type HomeSession = {
  id: string
  starts_at: string
  ends_at: string
  discipline: { id: number | string; name: string }
  trainer: { id: string; display_name: string } | null
  location: string | null
  capacity: number
  status: 'scheduled' | 'cancelled'
  booked: number
  present: number
}
export type AdminHome = {
  trained: { last_30: number; previous_30: number; series: number[] }
  students: ProfileStats
  attendance: { today: number; last_week: number }
  sessions: HomeSession[]
  next: HomeSession | null
}

// Qué enseña «Ahora»: las sesiones en curso; si no hay, la próxima de hoy; si no, la próxima de otro día (`next`).
export function nowFocus(sessions: HomeSession[], next: HomeSession | null, now: number): { kind: 'now' | 'upcoming' | 'next'; sessions: HomeSession[] } | null {
  const live = sessions.filter((s) => phaseOf(s, now) === 'now')
  if (live.length) return { kind: 'now', sessions: live }
  const soon = sessions.filter((s) => phaseOf(s, now) === 'upcoming').sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0]
  if (soon) return { kind: 'upcoming', sessions: [soon] }
  return next ? { kind: 'next', sessions: [next] } : null
}

// Variación en % de las asistencias de hoy frente al mismo día de la semana pasada; sin base, sin porcentaje.
export const variation = (today: number, lastWeek: number): number | null => (lastWeek > 0 ? Math.round(((today - lastWeek) / lastWeek) * 100) : null)

// Diferencia entre la primera y la última foto con dato de una cifra (la línea de 30 días); con menos de dos fotos, null.
export function trend(rows: DayStat[], key: 'active'): number | null {
  const v = rows.map((r) => r[key]).filter((n): n is number => n !== null)
  return v.length > 1 ? v[v.length - 1] - v[0] : null
}
