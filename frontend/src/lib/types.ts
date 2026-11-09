// Tipos de la API tal como los da docs/api.md (a mano: el backend es JS).
// medal_theme: código de su temática de medallas (036); null = Kaizen.
export type Discipline = { id: number | string; name: string; minors_only: boolean; is_active: boolean; is_open: boolean; medal_theme?: string | null }

export type BookingStatus = 'confirmed' | 'waitlisted' | 'cancelled'
export type CancelReason = 'student' | 'late' | 'admin' | 'session_cancelled' | 'no_coverage' | 'discipline_change'

export type CalendarSession = {
  id: string
  class_id?: string | null // null = sesión suelta
  starts_at: string
  ends_at: string
  discipline: { id: number | string; name: string }
  trainer: { id: string; display_name: string } | null
  location: string | null
  capacity: number
  taken: number // reservas confirmadas de todos (solo la cuenta)
  status: 'scheduled' | 'cancelled'
  held: boolean
  covered?: boolean
  booking?: { id: string; status: BookingStatus } | null
}

export type Booking = {
  id: string
  session_id: string
  student_id: string
  status: BookingStatus
  cancel_reason: CancelReason | null
  discipline_id: number | string
  discipline_name: string
  starts_at: string
  ends_at: string
  location: string | null
  session_status: 'scheduled' | 'cancelled'
}

export type ProfileStatus = { ok: boolean; missing?: string[]; risk_cover?: boolean }

export type Subscription = {
  id: string
  status: string
  plan: { id: number | string; name: string; price_cents: number; max_disciplines: number | null }
  disciplines: { id: number | string; name: string }[]
  current_period_end: string | null
  cancel_at_period_end?: boolean
  scheduled_change?: { plan_id: string; plan_name: string; discipline_ids: string[]; scheduled_at: string } | null
  discipline_changes_left?: number | null
  payer_change?: { id: string; status: string; new_payer_id: string; starts_at: string; deadline: string } | null
}

export type Plan = {
  id: number | string
  name: string
  price_cents: number
  billing_period: string
  max_disciplines: number | null
  minors_only: boolean
  is_active: boolean
  eligible_discipline_ids: (number | string)[]
}

// Nunca se enseña el tramo (adult/minor): delata la edad.
export type Insurance = {
  id: string
  status: string
  bracket?: string
  current_period_end: string | null
  cancel_at_period_end: boolean
  payment_status?: string | null
  client_secret?: string | null
}

export type PayerChange = {
  id: string
  status: 'requested' | 'paid' | 'completed' | 'expired' | 'cancelled'
  student: { id: string; name: string }
  plan: { id: string; name: string }
  price_cents: number
  disciplines: { id: string; name: string }[]
  starts_at: string
  deadline: string
}

export type Badge = { code: string; earned_at: string }
// Medallas de una disciplina (037): su escalera, con su temática (null = Kaizen), horas totales y racha propias.
export type DisciplineMedals = { id: string; name: string; theme: string | null; hours: number; streak: { current: number; best: number }; badges: Badge[] }
// En la ficha pública y los rankings, sin las horas exactas (037: public_achievements).
export type PublicDisciplineMedals = Omit<DisciplineMedals, 'hours'> & { hours?: number }

export type Progress = {
  // La racha general (toda la academia, StreakPanel); la de cada escalera va en disciplines.
  streak: { current: number; best: number }
  disciplines: DisciplineMedals[]
  hours: { month: string; disciplines: { id: number | string; name: string; hours: number }[] }
  // Las claves '<disciplina>:<código>' que quien mira ya celebró (037); null si nunca cerró una medalla nueva.
  medals_seen: string[] | null
}

export type Health = {
  injuries: string | null
  conditions: string | null
  previous_experience: string | null
  previous_discipline: string | null
  medication: string | null
  allergies: string | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
}

export type Me = { id: string; role: string; display_name: string | null; email: string; birth_date: string | null; has_password: boolean; avatar: string | null }

export type MyProfile = {
  is_public: boolean
  eligible: boolean
  visible_fields: Record<string, boolean>
  bio: string | null
  social_links: unknown
}

export type PublicProfile = {
  id: string
  display_name: string
  avatar?: string | null
  role: string
  bio?: string | null
  social_links?: unknown
  disciplines?: { id: number | string; name: string }[] | string[]
  member_since?: string | null
  // public_achievements (019): solo si enseña sus logros.
  achievements?: { streak: { current: number; best: number }; disciplines: PublicDisciplineMedals[] }
}
