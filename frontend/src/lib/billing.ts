import { ageOn, madridDay } from '@/lib/dates'
import { formatEuros, formatShortDate } from '@/lib/format'
import type { Discipline, Pause, Plan, Subscription } from '@/lib/types'

// Lógica de la cuota (B18.3), sin React. Viva = active, past_due o unpaid (CONTEXT § Suscripción).
const LIVE = ['active', 'past_due', 'unpaid']
export const isLive = (status: string | undefined): boolean => !!status && LIVE.includes(status)

export const perMonth = (cents: number): string => `${formatEuros(cents)} al mes`

// «Queda 1 cambio», «Quedan 2 cambios», «No quedan cambios»: los cambios de disciplina del periodo.
export const changesLeft = (n: number): string => (n <= 0 ? 'No quedan cambios' : n === 1 ? 'Queda 1 cambio' : `Quedan ${n} cambios`)

const sameId = (a: number | string, b: number | string) => String(a) === String(b)

// Para uno mismo se ocultan los planes «solo menores»; para un hijo se ven todos. La edad de las disciplinas va en eligibleDisciplines.
// Un plan a 0 € no se contrata por la pasarela (plan_not_purchasable).
export const visiblePlans = (plans: Plan[], self: boolean): Plan[] =>
  plans.filter((p) => p.is_active && p.price_cents > 0 && !(self && p.minors_only)).sort((a, b) => a.price_cents - b.price_cents)

// Edad de hoy (Madrid) del sujeto, como el backend: sin fecha de nacimiento, adulto.
const ADULT_AGE = 18
export const ageToday = (birthDate: string | null): number => (birthDate ? ageOn(birthDate, madridDay()) : ADULT_AGE)
// Cubre la disciplina hoy: sin máximo, o la edad de hoy no lo supera. La mínima no se mira al contratar.
export const fitsAge = (d: Discipline, birthDate: string | null): boolean => d.max_age === null || ageToday(birthDate) <= d.max_age
// Del plan (lista vacía = todas).
export const inPlan = (plan: Plan, d: Discipline): boolean => plan.eligible_discipline_ids.length === 0 || plan.eligible_discipline_ids.some((id) => sameId(id, d.id))

// Activas, no abiertas y del plan, sin mirar la edad (el admin no tiene la fecha: lo decide el backend).
export const planDisciplines = (plan: Plan, disciplines: Discipline[]): Discipline[] => disciplines.filter((d) => d.is_active && !d.is_open && inPlan(plan, d))

// Las que se pueden elegir con un plan: las de planDisciplines que cubren la edad de hoy del sujeto.
export const eligibleDisciplines = (plan: Plan, disciplines: Discipline[], birthDate: string | null): Discipline[] =>
  planDisciplines(plan, disciplines).filter((d) => fitsAge(d, birthDate))

// Preselección al cambiar de plan: las actuales que siguen valiendo, y todas si no hay dónde elegir.
export function keepDisciplines(current: (number | string)[], eligible: Discipline[], max: number | null): string[] {
  if (max === null) return []
  if (eligible.length === max) return eligible.map((d) => String(d.id))
  return eligible.filter((d) => current.some((c) => sameId(c, d.id))).slice(0, max).map((d) => String(d.id))
}

export type PlanChange = 'up' | 'down' | 'same'

// Como el backend (B10.5): más caro = subida inmediata con prorrateo; igual o más barato = se programa para la renovación.
// Un adulto en un plan solo menores cambia ya, suba o baje (`selfInMinors`).
// El mismo precio también se programa: lo enseñamos como cambio sin coste, no como bajada.
export function planChange(currentCents: number, target: Plan, selfInMinors: boolean): PlanChange {
  if (selfInMinors || target.price_cents > currentCents) return 'up'
  return target.price_cents === currentCents ? 'same' : 'down'
}

export const PAUSE_LOCK = 'Con una pausa programada o en curso no se pueden cambiar el plan, las disciplinas ni el pagador.'

// Por qué no se puede cambiar el plan (null = se puede). Solo con la cuota active y sin baja ni cambio de pagador.
export function planLock(s: Subscription): string | null {
  if (s.payer_change) return 'Con un cambio de pagador en marcha no se pueden cambiar el plan ni las disciplinas.'
  if (s.pause) return PAUSE_LOCK
  if (s.status === 'unpaid') return 'Con la cuota impagada no se puede cambiar nada.'
  if (s.status === 'past_due') return 'El plan se podrá cambiar cuando el cobro esté al día.'
  if (s.cancel_at_period_end) return 'La cuota termina: ya no se puede cambiar el plan.'
  if (s.status !== 'active') return 'Ahora no se puede cambiar el plan.'
  return null
}

// La disciplina se cambia con la cuota en vigor (active o past_due), sin cambio de pagador. Un plan «todas» no tiene.
export const disciplineLocked = (s: Subscription): boolean =>
  !!s.payer_change || !!s.pause || !['active', 'past_due'].includes(s.status)

// Gratis si la que se deja ya no se cubre: desactivada, o la edad de hoy supera su máximo.
export const freeChange = (from: Discipline | undefined, birthDate: string | null): boolean => !!from && (!from.is_active || !fitsAge(from, birthDate))

// Reintentos de /billing/success y del cambio de pagador: cada 2 s; a los 20 s, «puede tardar unos minutos»; a los 2 min, parar.
export const POLL_EVERY_MS = 2000
export const SLOW_AFTER_MS = 20_000
export const STOP_AFTER_MS = 120_000
export type PollPhase = 'checking' | 'slow' | 'stopped'
export const pollPhase = (elapsedMs: number): PollPhase =>
  elapsedMs >= STOP_AFTER_MS ? 'stopped' : elapsedMs >= SLOW_AFTER_MS ? 'slow' : 'checking'

// El sujeto del Checkout sobrevive a la ida y vuelta a Stripe (la URL de vuelta la fija el backend y no lleva ?para=).
// Solo el id del perfil, en sessionStorage (esta pestaña), y se borra al leerlo.
const CHECKOUT_KEY = 'kz.checkout-for'
export function rememberCheckoutSubject(profileId: string | undefined): void {
  try {
    if (profileId) sessionStorage.setItem(CHECKOUT_KEY, profileId)
    else sessionStorage.removeItem(CHECKOUT_KEY)
  } catch {
    // Sin sessionStorage, la vuelta comprueba la cuota de uno mismo o del primer hijo.
  }
}
export function takeCheckoutSubject(): string | undefined {
  try {
    const id = sessionStorage.getItem(CHECKOUT_KEY) ?? undefined
    sessionStorage.removeItem(CHECKOUT_KEY)
    return id
  } catch {
    return undefined
  }
}

// ── Pausa con cuota de mantenimiento (B30). La API manda el estado; esto solo lo presenta. ──

// Por qué no se puede pedir una pausa (null = se puede). Como `planLock`. `upgrade_pending` no se detecta en cliente:
// la API no lo da en la suscripción y el servidor responde 409.
export function pauseLock(s: Subscription): string | null {
  if (s.pause_settings?.price_cents == null) return 'La academia no ofrece pausas.'
  if (s.pause) return 'Ya hay una pausa programada o en curso.'
  if (s.cancel_at_period_end) return 'La cuota termina: ya no se puede pausar.'
  if (s.scheduled_change) return 'Hay una bajada de plan programada: anúlala antes de pausar.'
  if (s.payer_change) return 'Con un cambio de pagador en marcha no se puede pausar.'
  if (s.status === 'unpaid') return 'Con la cuota impagada no se puede pausar.'
  if (s.status === 'past_due') return 'Se podrá pausar cuando el cobro esté al día.'
  if (s.status !== 'active' || !s.current_period_end) return 'Ahora no se puede pausar.'
  return null
}
export const canPause = (s: Subscription): boolean => pauseLock(s) === null

// Vista previa del fin de la pausa que se va a pedir (solo en la hoja; tras pedirla se usa el `ends_at` de la respuesta): `months` meses enteros desde el inicio, en día de Madrid y sin pasarse de mes
// (el 31 + 2 meses = fin de febrero). El definitivo lo calcula Stripe y llega en `ends_at`.
export function pauseEnd(startsAt: string, months: number): string {
  const [y, m, d] = madridDay(startsAt).split('-').map(Number)
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0))
  const day = Math.min(d, last.getUTCDate())
  return new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), day)).toISOString().slice(0, 10)
}

// Un día de Madrid (AAAA-MM-DD) en fecha corta.
export const shortDay = (day: string): string => formatShortDate(`${day}T12:00:00Z`)

// El importe de la pausa en una sola fuente: el precio al mes o «sin cuota de mantenimiento» (exenta).
const feeOf = (p: Pause): string => (p.exempt ? 'sin cuota de mantenimiento' : perMonth(p.price_cents))
export const pauseTitle = (p: Pause): string =>
  p.status === 'active' ? `En pausa hasta el ${formatShortDate(p.ends_at)}` : `Pausa programada del ${formatShortDate(p.starts_at)} al ${formatShortDate(p.ends_at)} · ${feeOf(p)}`
export const pauseFee = (p: Pause): string => (p.exempt ? 'Sin cuota de mantenimiento' : `${feeOf(p)} de cuota de mantenimiento`)

// «Volver antes» vuelve en la siguiente fecha de cobro: no tiene sentido si la pausa ya acaba en ella (pause_ending).
export const canEndEarly = (s: Subscription): boolean =>
  s.pause?.status === 'active' && !!s.current_period_end && Date.parse(s.pause.ends_at) > Date.parse(s.current_period_end)

export const cancelledText = (n: number): string =>
  n === 0 ? 'No había reservas en esos días.' : n === 1 ? 'Se canceló 1 reserva de esos días.' : `Se cancelaron ${n} reservas de esos días.`
