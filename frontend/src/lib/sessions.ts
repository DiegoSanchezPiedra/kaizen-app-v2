import { madridDay } from '@/lib/dates'
import type { Booking, CalendarSession, CancelReason } from '@/lib/types'

// Estado de una sesión para el sujeto (docs/pantallas-b18.md § Calendario). `blockedFrom`: el inicio de la primera
// sesión que falló con outside_booking_window; la API no dice la ventana, así que solo se sabe al intentar reservar,
// y desde esa hora (incluida) ninguna sesión posterior cabe tampoco.
export type SessionState = 'available' | 'booked' | 'waitlisted' | 'uncovered' | 'blocked' | 'cancelled' | 'held' | 'started'

export function sessionState(s: CalendarSession, now: number, blockedFrom?: number): SessionState {
  if (s.status === 'cancelled') return 'cancelled'
  if (s.held) return 'held'
  if (s.booking?.status === 'confirmed') return 'booked'
  if (s.booking?.status === 'waitlisted') return 'waitlisted'
  if (Date.parse(s.starts_at) <= now) return 'started'
  if (s.covered === false) return 'uncovered'
  if (blockedFrom !== undefined && Date.parse(s.starts_at) >= blockedFrom) return 'blocked'
  return 'available'
}

// Plazas: «10/13». Por encima del aforo (un admin reduce plazas) cuenta como llena y la barra no se sale.
export function seatsOf(taken: number, capacity: number): { label: string; full: boolean; ratio: number } {
  return { label: `${taken}/${capacity}`, full: taken >= capacity, ratio: capacity > 0 ? Math.min(taken / capacity, 1) : 1 }
}

// Cancelar o salir de la espera solo antes de empezar (después, session_started).
export const canCancel = (s: CalendarSession, now: number): boolean => Date.parse(s.starts_at) > now

// Agrupa por día de Madrid, conservando el orden de llegada (la API ya ordena por hora).
export function groupBy<T>(items: T[], key: (t: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>()
  for (const it of items) {
    const k = key(it)
    map.set(k, [...(map.get(k) ?? []), it])
  }
  return [...map]
}
export const groupByDay = <T>(items: T[], startsAt: (t: T) => string) => groupBy(items, (t) => madridDay(startsAt(t)))

export const CANCEL_REASON: Record<CancelReason, string> = {
  student: 'Cancelada por ti',
  late: 'Cancelación tardía',
  admin: 'Cancelada por la academia',
  session_cancelled: 'La sesión se canceló',
  no_coverage: 'Tu cuota no la cubría',
  discipline_change: 'Cambio de disciplina',
  out_of_age: 'Fuera de edad',
  pause: 'Pausa',
}

// Próximas: todo lo que no ha empezado. Pasadas: lo que ya empezó, de más reciente a más antigua.
export function splitBookings(bookings: Booking[], now: number) {
  const byStart = (a: Booking, b: Booking) => Date.parse(a.starts_at) - Date.parse(b.starts_at)
  return {
    upcoming: bookings.filter((b) => Date.parse(b.starts_at) > now).sort(byStart),
    past: bookings.filter((b) => Date.parse(b.starts_at) <= now).sort((a, b) => byStart(b, a)),
  }
}

// El alumno no conoce la ventana de check-in (la fija el admin: por defecto 30 min antes y 10 después; solo la ve GET /admin/settings).
// Se usa una holgada para saber cuándo ofrecerlo: 'soon' (falta ≤ 60 min) y 'live' (empezó hace ≤ 30 min). Si la academia la
// cambia, /checkin explica el rechazo. shortcut: pedir la ventana a la API cuando el alumno pueda leerla.
export const CHECKIN_SOON_MIN = 60
export const CHECKIN_LIVE_MIN = 30
export function checkinPhase(startsAt: string, now: number): 'soon' | 'live' | null {
  const min = (Date.parse(startsAt) - now) / 60_000
  return min > 0 && min <= CHECKIN_SOON_MIN ? 'soon' : min <= 0 && min >= -CHECKIN_LIVE_MIN ? 'live' : null
}

// La API limita los rangos a 92 días: las pasadas se piden por tramos hacia atrás, el último día incluido.
export const PAST_CHUNK_DAYS = 92
