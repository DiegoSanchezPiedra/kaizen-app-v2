// Tipos de la API tal como los da docs/api.md (a mano: el backend es JS).
export type Discipline = { id: number | string; name: string; minors_only: boolean; is_active: boolean; is_open: boolean }

export type BookingStatus = 'confirmed' | 'waitlisted' | 'cancelled'
export type CancelReason = 'student' | 'late' | 'admin' | 'session_cancelled' | 'no_coverage' | 'discipline_change'

export type CalendarSession = {
  id: string
  starts_at: string
  ends_at: string
  discipline: { id: number | string; name: string }
  trainer: { id: string; display_name: string } | null
  location: string | null
  capacity: number
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
}

export type Progress = {
  streak: { current: number; best: number }
  badges: { code: string; earned_at: string }[]
  hours: { month: string; disciplines: { id: number | string; name: string; hours: number }[] }
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

export type Me = { id: string; role: string; display_name: string | null; email: string; birth_date: string | null; has_password: boolean }

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
  role: string
  bio?: string | null
  social_links?: unknown
  disciplines?: { id: number | string; name: string }[] | string[]
  member_since?: string | null
  achievements?: { code: string; earned_at?: string }[] | string[]
}
