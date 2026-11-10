import { ageOn, madridDay } from '@/lib/dates'
import { formatEuros } from '@/lib/format'
import type { Discipline, Plan, Subscription } from '@/lib/types'

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

// Edad de hoy (Madrid) del sujeto, como el backend: sin fecha de nacimiento, adulto (18).
export const ageToday = (birthDate: string | null): number => (birthDate ? ageOn(birthDate, madridDay()) : 18)
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

// Por qué no se puede cambiar el plan (null = se puede). Solo con la cuota active y sin baja ni cambio de pagador.
export function planLock(s: Subscription): string | null {
  if (s.payer_change) return 'Con un cambio de pagador en marcha no se pueden cambiar el plan ni las disciplinas.'
  if (s.status === 'unpaid') return 'Con la cuota impagada no se puede cambiar nada.'
  if (s.status === 'past_due') return 'El plan se podrá cambiar cuando el cobro esté al día.'
  if (s.cancel_at_period_end) return 'La cuota termina: ya no se puede cambiar el plan.'
  if (s.status !== 'active') return 'Ahora no se puede cambiar el plan.'
  return null
}

// La disciplina se cambia con la cuota en vigor (active o past_due), sin cambio de pagador. Un plan «todas» no tiene.
export const disciplineLocked = (s: Subscription): boolean =>
  !!s.payer_change || !['active', 'past_due'].includes(s.status)

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
