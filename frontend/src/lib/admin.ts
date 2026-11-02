import { addDays, madridDay } from '@/lib/dates'
import type { Role } from '@/lib/paths'
import type { Insurance, ProfileStatus, Subscription } from '@/lib/types'

// GET /auth/me (B4): el aviso del MFA sale solo si la API dice que no está activo; mientras carga, no.
export type AuthMe = { user: { id: string; role: string }; mfa_enabled: boolean }
export const showMfaNotice = (me: AuthMe | undefined): boolean => me?.mfa_enabled === false

// GET /admin/reports/subscriptions: un día o un mes sin foto llega con las cifras a null.
export type StatFigures = {
  active: number | null
  past_due: number | null
  unpaid: number | null
  new_subscriptions: number | null
  cancelled_subscriptions: number | null
  mrr_cents: number | null
}
export type DayStat = StatFigures & { date: string }
export type MonthStat = StatFigures & { month: string; days_with_data: number; days_in_month: number }
export type SubscriptionReport<R> = { group: 'day' | 'month'; from: string; to: string; rows: R[] }

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
}
export const noticeLabel = (action: string): string => NOTICE_LABEL[action] ?? action

// A quién se abre un aviso de la academia: la ficha del alumno si el aviso la trae (`student_id`).
export const noticeStudent = (n: AcademyNotice): string | null => (typeof n.details.student_id === 'string' ? n.details.student_id : null)

// Entregas fallidas: el nombre en español del aviso. Uno desconocido sale tal cual.
const DELIVERY_LABEL: Record<string, string> = {
  'notice.payment_failed': 'Cobro fallido',
  'notice.checkout_payment_failed': 'Pago de contratación fallido',
  'notice.checkout_race_refunded': 'Pago duplicado devuelto',
  'notice.insurance_not_paid': 'Seguro sin pagar',
  'notice.insurance_renewal': 'Renovación del seguro',
  'notice.insurance_wont_renew': 'El seguro no se renovará',
  'notice.insurance_cancelled': 'Seguro dado de baja',
  'notice.plan_downgraded': 'Plan rebajado',
  'notice.upgrade_requires_action': 'Subida de plan pendiente de autorizar',
  'notice.subscription_unpaid': 'Cuota impagada',
  'notice.insurance_unpaid': 'Seguro impagado',
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
  'notice.discipline_change': 'Cambio de disciplina',
  'notice.agreement_published': 'Documento nuevo para firmar',
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
  { value: 'billing', label: 'Cobros', prefixes: ['subscription.', 'subscription_schedule.', 'insurance.'] },
  { value: 'users', label: 'Usuarios', prefixes: ['profile.', 'guardian.'] },
  { value: 'documents', label: 'Documentos', prefixes: ['agreement_document.'] },
  { value: 'settings', label: 'Ajustes', prefixes: ['settings.'] },
  { value: 'bookings', label: 'Reservas', prefixes: ['booking.'] },
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
  'subscription.cancel_now': 'Dio de baja una suscripción',
  'subscription.cancel_at_period_end': 'Programó la baja de una suscripción',
  'subscription.upgrade': 'Subió de plan',
  'subscription.downgrade': 'Programó una bajada de plan',
  'subscription.downgrade_cancel': 'Canceló una bajada de plan',
  'subscription.discipline_change': 'Cambió una disciplina de la cuota',
  'subscription.payer_change_request': 'Pidió un cambio de pagador',
  'subscription.payer_change_cancel': 'Anuló un cambio de pagador',
  'insurance.cancel_now': 'Dio de baja un seguro',
  'insurance.cancel_at_period_end': 'Programó la baja de un seguro',
  'insurance.price_change': 'Cambió el precio del seguro',
  'insurance.enable': 'Activó el seguro',
  'insurance.disable': 'Desactivó el seguro',
  'profile.role_change': 'Cambió el rol',
  'profile.unpublish': 'Despublicó un perfil',
  'guardian.add': 'Vinculó un tutor',
  'guardian.remove': 'Desvinculó un tutor',
  'agreement_document.publish': 'Publicó un documento',
  'settings.discipline_changes': 'Cambió los cambios de disciplina por periodo',
  'booking.create': 'Hizo una reserva',
  'booking.cancel': 'Canceló una reserva',
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
  if (a.action === 'session.cancel') return str(c.note) ?? ''
  if (a.action === 'agreement_document.publish') return [str(c.type), str(c.version) && `v${c.version}`].filter(Boolean).join(' ')
  return ''
}

// A dónde lleva el recurso: la ficha de un perfil (o el hijo de un tutor) o la sesión. El resto, sin enlace.
export function auditTarget(a: Pick<AuditRow, 'resource_type' | 'resource_id'>): { to: string | null; label: string } {
  if (a.resource_type === 'profile' || a.resource_type === 'guardian') return { to: `/admin/users/${a.resource_id}`, label: 'Ficha' }
  if (a.resource_type === 'session') return { to: `/admin/sessions/${a.resource_id}`, label: 'Sesión' }
  const label: Record<string, string> = { class: 'Clase', plan: 'Plan', discipline: 'Disciplina', subscription: 'Suscripción', insurance: 'Seguro', booking: 'Reserva', agreement_document: 'Documento', settings: 'Ajustes' }
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
  kind: 'subscription' | 'insurance'
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
  email: string | null
  role: Role
  is_minor: boolean
  pending_claim: boolean
  created_at: string
  subscription_status: string | null
}
export type ProfileFile = {
  profile: Omit<ProfileRow, 'subscription_status'> & { is_public: boolean; has_password: boolean; has_google: boolean }
  status: ProfileStatus | null
  guardians: Person[]
  children: { id: string; display_name: string | null; pending_claim: boolean }[]
  subscription: (Subscription & { payer: Person }) | null
  insurance: (Insurance & { payer: Person }) | null
}

// Un hijo es un perfil sin acceso propio: sin credenciales, así que sin email.
export const isChild = (p: { email: string | null }): boolean => p.email === null
// El rol admin y el de un hijo no se cambian desde la app (admin_role_locked, child_role_locked).
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
