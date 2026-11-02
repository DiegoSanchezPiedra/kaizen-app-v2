import { addDays, madridDay, mondayOf } from '@/lib/dates'
import { formatTime } from '@/lib/format'

// Horario del panel (docs/pantallas-b19.md § Horario). La forma de la API sale de docs/api.md § Admin.

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const isDay = (s: string | null): s is string => !!s && DAY_RE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s)

// `?semana=` es cualquier día de la semana; una URL a mano rota cae en la semana de hoy. Siempre su lunes.
export const weekStart = (raw: string | null, today: string = madridDay()): string => mondayOf(isDay(raw) ? raw : today)
export const weekRange = (monday: string): { from: string; to: string } => ({ from: monday, to: addDays(monday, 6) })

export const FIELDS = ['trainer_id', 'starts_at', 'duration_min', 'capacity', 'location'] as const
export type Field = (typeof FIELDS)[number]
export const FIELD_LABEL: Record<Field, string> = {
  trainer_id: 'Profesor',
  starts_at: 'Inicio',
  duration_min: 'Duración',
  capacity: 'Aforo',
  location: 'Lugar',
}

export type AdminSession = {
  id: string
  class_id: string | null
  starts_at: string
  ends_at: string
  discipline: { id: number | string; name: string }
  trainer: { id: string; display_name: string } | null
  location: string | null
  capacity: number
  duration_min: number
  status: 'scheduled' | 'cancelled'
  held: boolean
  adjusted_fields: string[]
  // null en una sesión suelta; `starts_at` es el slot (la hora que le toca según su clase).
  class_values: { trainer_id: string; starts_at: string; duration_min: number; capacity: number; location: string | null } | null
  cancel_note: string | null
}
export type SessionBooking = { id: string; student: { id: string; display_name: string | null }; status: 'confirmed' | 'waitlisted'; created_at: string }

// Los campos ajustados, en el orden de la pantalla. En una suelta no hay clase con la que comparar: ninguno.
export const adjustedFields = (s: Pick<AdminSession, 'adjusted_fields' | 'class_values'>): Field[] =>
  s.class_values ? FIELDS.filter((f) => s.adjusted_fields.includes(f)) : []

// Desde que empieza, cancelar es retroactivo: anula la lista, no avisa y pide motivo (cancel_session).
export const isRetroactive = (s: Pick<AdminSession, 'starts_at'>, now: number): boolean => Date.parse(s.starts_at) <= now
// Ajustar y deshacer un ajuste: programada y sin empezar (session_not_adjustable). Recuperar: cancelada y sin empezar.
export const canAdjust = (s: Pick<AdminSession, 'status' | 'starts_at'>, now: number): boolean => s.status === 'scheduled' && !isRetroactive(s, now)
export const canRestore = (s: Pick<AdminSession, 'status' | 'starts_at'>, now: number): boolean => s.status === 'cancelled' && !isRetroactive(s, now)

// El valor de un campo como se enseña. El inicio, en hora de Madrid.
export function fieldValue(s: Pick<AdminSession, 'trainer' | 'starts_at' | 'duration_min' | 'capacity' | 'location'>, f: Field): string {
  if (f === 'trainer_id') return s.trainer?.display_name ?? 'Sin profesor'
  if (f === 'starts_at') return `${madridDay(s.starts_at)} ${formatTime(s.starts_at)}`
  if (f === 'duration_min') return `${s.duration_min} min`
  if (f === 'capacity') return String(s.capacity)
  return s.location || 'Sin lugar'
}

// Lo que dice la clase de un campo. `trainerName`: el nombre del profesor de la clase, si se conoce.
export function classValue(s: Pick<AdminSession, 'class_values'>, f: Field, trainerName?: string): string | null {
  const c = s.class_values
  if (!c) return null
  if (f === 'trainer_id') return trainerName ?? null
  if (f === 'starts_at') return `${madridDay(c.starts_at)} ${formatTime(c.starts_at)}`
  if (f === 'duration_min') return `${c.duration_min} min`
  if (f === 'capacity') return String(c.capacity)
  return c.location || 'Sin lugar'
}

// AAAA-MM-DD HH:MM de Madrid → ISO con zona, que es lo que pide la API. null si no es una fecha y hora reales.
export function madridToIso(day: string, time: string): string | null {
  if (!isDay(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null
  // Se prueba el desfase de verano y el de invierno: vale el que, pasado a Madrid, devuelve la misma hora.
  for (const off of ['+02:00', '+01:00']) {
    const d = new Date(`${day}T${time}:00${off}`)
    if (madridDay(d) === day && formatTime(d) === time) return d.toISOString()
  }
  return null
}

export const WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

export type AdminClass = {
  id: string
  discipline_id: number | string
  discipline_name: string
  trainer_id: string
  trainer_name: string | null
  weekday: number
  start_time: string
  duration_min: number
  capacity: number
  location: string | null
  starts_on: string
  ends_on: string | null
}
// Las columnas DATE llegan como medianoche de Madrid en UTC (2026-10-31T23:00:00.000Z = el 1 de noviembre): siempre por madridDay.
export const classState = (c: Pick<AdminClass, 'ends_on'>, today: string = madridDay()): 'active' | 'ending' | 'retired' => {
  if (!c.ends_on) return 'active'
  return madridDay(c.ends_on) < today ? 'retired' : 'ending'
}
