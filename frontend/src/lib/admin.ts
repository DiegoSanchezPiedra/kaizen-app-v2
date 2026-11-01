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
