import { madridDay, addMonths } from '@/lib/dates'

// Tipos y lógica pura del profesor (B18.4). La forma de la API sale de docs/api.md.
export type TrainerSession = {
  id: string
  class_id: string | null
  discipline_id: number | string
  discipline_name: string
  starts_at: string
  ends_at: string
  duration_min: number
  capacity: number
  location: string | null
  status: 'scheduled' | 'cancelled'
}

export type AttendanceRow = {
  booking_id: string
  student_id: string
  display_name: string
  avatar?: string | null
  status: 'present' | 'absent' | null
  method: 'manual' | 'qr' | null
  corrected_at: string | null
  correction_reason: string | null
  risk_cover: boolean
}
export type Attendance = { closed_at: string | null; students: AttendanceRow[] }

export type HealthStudent = {
  student_id: string
  display_name: string
  injuries: string | null
  conditions: string | null
  allergies: string | null
  medication: string | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
}

export type Figures = {
  sessions: number
  capacity: number
  booked: number
  occupancy: number | null
  present: number
  absent: number
  unrecorded: number
  late: number
}
export type ReportRow = {
  class_id?: string | null
  discipline: { id: number | string; name: string }
  weekday?: number
  start_time?: string
  trainer?: { id: string; name: string | null }
  months: (Figures & { month: string })[]
  total: Figures
}
export type Report = { by: 'discipline' | 'class'; from: string; to: string; rows: ReportRow[]; total?: number; limit?: number; offset?: number }

// «Terminada» y «En curso» salen de la hora; «Cancelada», del estado.
export type Phase = 'upcoming' | 'now' | 'ended' | 'cancelled'
export function phaseOf(s: Pick<TrainerSession, 'starts_at' | 'ends_at' | 'status'>, now: number): Phase {
  if (s.status === 'cancelled') return 'cancelled'
  if (now < Date.parse(s.starts_at)) return 'upcoming'
  return now < Date.parse(s.ends_at) ? 'now' : 'ended'
}

// Las fichas de salud solo se piden en una sesión de hoy (Madrid) no cancelada: la BD lo exige y lo audita.
export const canSeeHealth = (s: Pick<TrainerSession, 'starts_at' | 'status'>, now: number): boolean =>
  s.status === 'scheduled' && madridDay(s.starts_at) === madridDay(now)

export const isClosed = (a: Attendance): boolean => a.closed_at !== null
export const presentCount = (rows: AttendanceRow[]): number => rows.filter((r) => r.status === 'present').length
// Al cerrar, quien no está presente pasa a falta.
export const unmarked = (rows: AttendanceRow[]): AttendanceRow[] => rows.filter((r) => r.status !== 'present')

export const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

// Cambio local tras guardar un interruptor (el PUT solo devuelve { student_id, present }).
export function withMark(a: Attendance, studentId: string, present: boolean): Attendance {
  return {
    ...a,
    students: a.students.map((r) =>
      r.student_id === studentId
        ? { ...r, status: present ? 'present' : null, method: present ? (r.method ?? 'manual') : null }
        : r,
    ),
  }
}

const HEALTH_FIELDS = [
  ['injuries', 'Lesiones'],
  ['conditions', 'Condiciones'],
  ['allergies', 'Alergias'],
  ['medication', 'Medicación'],
] as const

// Primero quien tiene algo (solo los campos rellenos, en orden); después el resto. Nunca edad ni nacimiento.
export function splitHealth(students: HealthStudent[]) {
  const withInfo: { student: HealthStudent; fields: { label: string; value: string }[] }[] = []
  const without: HealthStudent[] = []
  for (const student of students) {
    const fields = HEALTH_FIELDS.flatMap(([k, label]) => {
      const value = student[k]?.trim()
      return value ? [{ label, value }] : []
    })
    if (fields.length) withInfo.push({ student, fields })
    else without.push(student)
  }
  return { withInfo, without }
}

export const telHref = (phone: string): string => `tel:${phone.replace(/[^\d+]/g, '')}`

// Informes: el periodo son meses de Madrid; la API admite 12 como mucho.
export type Period = 'this' | 'last' | 'six' | 'twelve' | 'custom'
export const MAX_MONTHS = 12

export function periodRange(period: Exclude<Period, 'custom'>, now: Date = new Date()): { from: string; to: string } {
  const cur = madridDay(now).slice(0, 7)
  if (period === 'this') return { from: cur, to: cur }
  if (period === 'last') return { from: addMonths(cur, -1), to: addMonths(cur, -1) }
  return { from: addMonths(cur, period === 'six' ? -5 : -11), to: cur }
}

export const monthsBetween = (from: string, to: string): number =>
  (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5)) - Number(from.slice(5)) + 1

export const validRange = (from: string, to: string): boolean => {
  const n = monthsBetween(from, to)
  return n >= 1 && n <= MAX_MONTHS
}

const ZERO: Figures = { sessions: 0, capacity: 0, booked: 0, occupancy: null, present: 0, absent: 0, unrecorded: 0, late: 0 }
const KEYS = ['sessions', 'capacity', 'booked', 'present', 'absent', 'unrecorded', 'late'] as const

// Suma las cifras de by=discipline; la ocupación es la razón de las sumas, no la media de ocupaciones.
export function sumFigures(list: Figures[]): Figures {
  const out = { ...ZERO }
  for (const f of list) for (const k of KEYS) out[k] += Number(f[k]) || 0
  out.occupancy = out.capacity ? out.booked / out.capacity : null
  return out
}

// Una cifra por mes (sumando las filas del informe por disciplina) para los gráficos.
export function monthlyTotals(rows: ReportRow[]): (Figures & { month: string })[] {
  const months = rows[0]?.months.map((m) => m.month) ?? []
  return months.map((month) => ({ month, ...sumFigures(rows.map((r) => r.months.find((m) => m.month === month) ?? ZERO)) }))
}

const WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
export function classTitle(r: ReportRow): string {
  if (!r.class_id) return `${r.discipline.name} · sesiones sueltas`
  return `${r.discipline.name} · ${WEEKDAYS[(r.weekday ?? 1) - 1]} ${r.start_time ?? ''}`.trim()
}
export const classTrainer = (r: ReportRow): string | null =>
  !r.class_id ? null : r.trainer?.name ? `Clase de ${r.trainer.name} (tú)` : 'Clase de otro profesor · tus sustituciones'

export const percent = (v: number | null): string => (v === null ? '–' : `${Math.round(v * 100)} %`)

// Tope «redondo» del eje de un gráfico (1, 2, 5 × 10^k) para que las marcas no salgan raras.
export function niceMax(n: number): number {
  if (n <= 0) return 1
  const mag = 10 ** Math.floor(Math.log10(n))
  const step = [1, 2, 5, 10].find((s) => s * mag >= n)!
  return step * mag
}

const shortMonthFmt = new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', month: 'short' })
// Qué etiquetas del eje caben en el móvil: de las no vacías, una de cada `step` contando desde la última (que siempre sale).
export function mobileLabels(labels: string[], max = 6): boolean[] {
  const filled = labels.flatMap((l, i) => (l ? [i] : []))
  const step = Math.ceil(filled.length / max)
  const keep = new Set(filled.filter((_, k) => (filled.length - 1 - k) % step === 0))
  return labels.map((_, i) => keep.has(i))
}

export const shortMonth =(m: string): string => shortMonthFmt.format(new Date(`${m}-01T12:00:00Z`)).replace('.', '')
