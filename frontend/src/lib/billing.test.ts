import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  canEndEarly,
  canPause,
  cancelledText,
  changesLeft,
  disciplineLocked,
  eligibleDisciplines,
  freeChange,
  keepDisciplines,
  pauseEnd,
  pauseFee,
  pauseLock,
  pauseTitle,
  perMonth,
  planChange,
  planLock,
  pollPhase,
  rememberCheckoutSubject,
  takeCheckoutSubject,
  visiblePlans,
} from '@/lib/billing'
import { formatDeadline, formatShortDate } from '@/lib/format'
import type { Discipline, Pause, Plan, Subscription } from '@/lib/types'

// Fija el «hoy» (Madrid) de las pruebas de edad.
const today = (iso: string) => vi.useFakeTimers().setSystemTime(new Date(iso))

const plan = (o: Partial<Plan>): Plan => ({
  id: 1,
  name: 'P',
  price_cents: 4500,
  billing_period: 'month',
  max_disciplines: 1,
  minors_only: false,
  is_active: true,
  eligible_discipline_ids: [],
  ...o,
})
const disc = (id: number, o: Partial<Discipline> = {}): Discipline => ({ id, name: `D${id}`, min_age: null, max_age: null, is_active: true, is_open: false, ...o })
const sub = (o: Partial<Subscription>): Subscription => ({
  id: 's',
  status: 'active',
  plan: { id: 1, name: 'P', price_cents: 4500, max_disciplines: 1 },
  disciplines: [],
  current_period_end: '2026-12-01T09:24:00Z',
  cancel_at_period_end: false,
  scheduled_change: null,
  payer_change: null,
  ...o,
})

describe('planes y disciplinas visibles', () => {
  const plans = [plan({ id: 3, price_cents: 8500 }), plan({ id: 1, minors_only: true, price_cents: 3900 }), plan({ id: 2, price_cents: 0 }), plan({ id: 4, is_active: false })]
  it('uno mismo no ve los solo menores; un hijo sí; nunca los de 0 € ni los inactivos; por precio', () => {
    expect(visiblePlans(plans, true).map((p) => p.id)).toEqual([3])
    expect(visiblePlans(plans, false).map((p) => p.id)).toEqual([1, 3])
  })
  it('elegibles del plan (vacío = todas), sin abiertas ni inactivas ni solo menores para uno mismo', () => {
    const ds = [disc(1), disc(2, { max_age: 12 }), disc(3, { is_open: true }), disc(4, { is_active: false }), disc(5)]
    expect(eligibleDisciplines(plan({ eligible_discipline_ids: [] }), ds, null).map((d) => d.id)).toEqual([1, 5])
    expect(eligibleDisciplines(plan({ eligible_discipline_ids: ['2', '5'] }), ds, '2015-03-02').map((d) => d.id)).toEqual([2, 5])
  })
  it('al cambiar de plan conserva las que valen, y todas si no hay dónde elegir', () => {
    expect(keepDisciplines(['1', 2], [disc(1), disc(2), disc(3)], 1)).toEqual(['1'])
    expect(keepDisciplines([9], [disc(1), disc(2)], 2)).toEqual(['1', '2'])
    expect(keepDisciplines([1], [disc(1)], null)).toEqual([])
  })
})

describe('subida, bajada o mismo precio', () => {
  it('por precio, como el backend; un adulto en un plan solo menores cambia ya', () => {
    expect(planChange(4500, plan({ price_cents: 6500 }), false)).toBe('up')
    expect(planChange(4500, plan({ price_cents: 3900 }), false)).toBe('down')
    expect(planChange(4500, plan({ price_cents: 4500 }), false)).toBe('same')
    expect(planChange(4500, plan({ price_cents: 3900 }), true)).toBe('up')
  })
})

describe('edad el día de la sesión (Madrid)', () => {
  afterEach(() => vi.useRealTimers())
  it('contratar: solo cuenta el máximo; la mínima no se mira; sin fecha, 18 años', () => {
    today('2026-11-10T12:00:00Z')
    const ds = [disc(1, { min_age: 14, max_age: 12 }), disc(2, { min_age: 5, max_age: 12 }), disc(3, { max_age: 10 }), disc(4, { max_age: 17 }), disc(5, { max_age: 18 }), disc(6)]
    const ids = (b: string | null) => eligibleDisciplines(plan({}), ds, b).map((d) => d.id)
    expect(ids('2015-03-02')).toEqual([1, 2, 4, 5, 6]) // 11 años: entra en la de máximo 12, no en la de 10
    expect(ids(null)).toEqual([5, 6]) // sin fecha, 18: no entra en la de máximo 17
  })
  it('cumple años hoy cuenta ya; el día de antes, no', () => {
    today('2026-11-10T12:00:00Z')
    expect(eligibleDisciplines(plan({}), [disc(1, { max_age: 13 })], '2013-11-10').map((d) => d.id)).toEqual([1]) // 13 hoy
    expect(eligibleDisciplines(plan({}), [disc(1, { max_age: 12 })], '2013-11-10').map((d) => d.id)).toEqual([]) // 13 hoy, máximo 12
    expect(eligibleDisciplines(plan({}), [disc(1, { max_age: 12 })], '2013-11-11').map((d) => d.id)).toEqual([1]) // 12 hoy
  })
  it('usa el día de Madrid, no el UTC', () => {
    today('2026-11-10T23:30:00Z') // ya es 11 de noviembre en Madrid
    expect(eligibleDisciplines(plan({}), [disc(1, { max_age: 12 })], '2013-11-11').map((d) => d.id)).toEqual([]) // 13 cumplidos hoy
  })
})

describe('qué se puede cambiar', () => {
  it('el plan solo con la cuota active, sin baja ni cambio de pagador', () => {
    expect(planLock(sub({}))).toBeNull()
    expect(planLock(sub({ status: 'past_due' }))).toMatch(/al día/)
    expect(planLock(sub({ status: 'unpaid' }))).toMatch(/impagada/)
    expect(planLock(sub({ cancel_at_period_end: true }))).toMatch(/termina/)
    expect(planLock(sub({ payer_change: { id: 'x', status: 'requested', new_payer_id: 'p', starts_at: '', deadline: '' } }))).toMatch(/pagador/)
  })
  it('la disciplina, en vigor (también en gracia) y sin cambio de pagador', () => {
    expect(disciplineLocked(sub({ status: 'past_due' }))).toBe(false)
    expect(disciplineLocked(sub({ cancel_at_period_end: true }))).toBe(false)
    expect(disciplineLocked(sub({ status: 'unpaid' }))).toBe(true)
    expect(disciplineLocked(sub({ payer_change: { id: 'x', status: 'paid', new_payer_id: 'p', starts_at: '', deadline: '' } }))).toBe(true)
  })
  it('cambios que quedan, sin «0 cambios»', () => {
    expect(changesLeft(0)).toBe('No quedan cambios')
    expect(changesLeft(-1)).toBe('No quedan cambios')
    expect(changesLeft(1)).toBe('Queda 1 cambio')
    expect(changesLeft(2)).toBe('Quedan 2 cambios')
  })
  it('gratis si la que se deja ya no se cubre: desactivada o fuera de edad hoy', () => {
    today('2026-11-10T12:00:00Z')
    expect(freeChange(disc(1, { is_active: false }), null)).toBe(true)
    expect(freeChange(disc(1, { max_age: 12 }), '2013-01-01')).toBe(true) // 13
    expect(freeChange(disc(1, { max_age: 12 }), '2015-03-02')).toBe(false) // 11
    expect(freeChange(disc(1, { max_age: 17 }), null)).toBe(true) // sin fecha, 18
    expect(freeChange(disc(1, { max_age: 18 }), null)).toBe(false)
    expect(freeChange(undefined, null)).toBe(false)
  })
})

describe('reintentos de la vuelta de Stripe', () => {
  it('comprobando hasta los 20 s, «puede tardar» hasta los 2 min, y para', () => {
    expect(pollPhase(0)).toBe('checking')
    expect(pollPhase(19_999)).toBe('checking')
    expect(pollPhase(20_000)).toBe('slow')
    expect(pollPhase(119_999)).toBe('slow')
    expect(pollPhase(120_000)).toBe('stopped')
  })
  it('el sujeto del Checkout se lee una vez', () => {
    const m = new Map<string, string>()
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v), removeItem: (k: string) => m.delete(k) })
    rememberCheckoutSubject('kid-1')
    expect(takeCheckoutSubject()).toBe('kid-1')
    expect(takeCheckoutSubject()).toBeUndefined()
    rememberCheckoutSubject(undefined)
    expect(takeCheckoutSubject()).toBeUndefined()
    vi.unstubAllGlobals()
  })
})

describe('fechas cortas de Madrid', () => {
  it('fin de periodo y fecha límite', () => {
    expect(formatShortDate('2026-12-01T09:24:00Z')).toBe('1 dic 2026')
    expect(formatShortDate('2026-10-31T23:30:00Z')).toBe('1 nov 2026')
    expect(formatDeadline('2026-12-01T08:24:00Z')).toBe('1 dic a las 9:24')
  })
})

// ── Pausa con cuota de mantenimiento (B30.1) ──
const pause = (o: Partial<Pause> = {}): Pause => ({ id: 'p', status: 'scheduled', months: 2, starts_at: '2026-12-01T09:24:00Z', ends_at: '2027-02-01T09:24:00Z', price_cents: 1500, exempt: false, ...o })
const offered = { price_cents: 1500, max_months: 3, per_year: 1 }

describe('pausa', () => {
  it('se ofrece con precio, cuota active y sin pausa, bajada, baja ni cambio de pagador', () => {
    expect(pauseLock(sub({ pause_settings: offered }))).toBeNull()
    expect(canPause(sub({ pause_settings: offered }))).toBe(true)
    expect(canPause(sub({}))).toBe(false) // la API aún no manda ajustes
    expect(canPause(sub({ pause_settings: offered, current_period_end: null }))).toBe(false)
  })
  it('pauseLock da el motivo concreto', () => {
    expect(pauseLock(sub({}))).toMatch(/no ofrece pausas/)
    expect(pauseLock(sub({ pause_settings: { ...offered, price_cents: null } }))).toMatch(/no ofrece pausas/)
    expect(pauseLock(sub({ pause_settings: offered, pause: pause() }))).toMatch(/ya hay una pausa/i)
    expect(pauseLock(sub({ pause_settings: offered, cancel_at_period_end: true }))).toMatch(/termina/)
    expect(pauseLock(sub({ pause_settings: offered, scheduled_change: { plan_id: '2', plan_name: 'B', discipline_ids: [], scheduled_at: '' } }))).toMatch(/bajada/)
    expect(pauseLock(sub({ pause_settings: offered, payer_change: { id: 'x', status: 'requested', new_payer_id: 'p', starts_at: '', deadline: '' } }))).toMatch(/pagador/)
    expect(pauseLock(sub({ pause_settings: offered, status: 'past_due' }))).toMatch(/al día/)
    expect(pauseLock(sub({ pause_settings: offered, status: 'unpaid' }))).toMatch(/impagada/)
    expect(pauseLock(sub({ pause_settings: offered, status: 'incomplete' }))).toMatch(/Ahora no/)
  })
  it('el fin son N meses enteros desde el inicio, en día de Madrid y sin pasarse de mes', () => {
    expect(pauseEnd('2026-12-01T09:24:00Z', 2)).toBe('2027-02-01')
    expect(pauseEnd('2026-11-30T23:30:00Z', 3)).toBe('2027-03-01') // 1 dic en Madrid
    expect(pauseEnd('2026-12-31T09:00:00Z', 2)).toBe('2027-02-28')
    expect(pauseEnd('2027-12-15T09:00:00Z', 12)).toBe('2028-12-15')
  })
  it('con pausa no se cambia ni el plan ni la disciplina', () => {
    expect(planLock(sub({ pause: pause() }))).toMatch(/pausa.*pagador/)
    expect(planLock(sub({ pause: pause({ status: 'active' }) }))).toMatch(/pausa/)
    expect(disciplineLocked(sub({ pause: pause() }))).toBe(true)
    expect(disciplineLocked(sub({ pause: null }))).toBe(false)
  })
  it('textos de estado: programada, en curso y exenta', () => {
    expect(pauseTitle(pause())).toBe(`Pausa programada del 1 dic 2026 al 1 feb 2027 · ${perMonth(1500)}`)
    expect(pauseTitle(pause({ status: 'active' }))).toBe('En pausa hasta el 1 feb 2027')
    expect(pauseTitle(pause({ exempt: true }))).toBe('Pausa programada del 1 dic 2026 al 1 feb 2027 · sin cuota de mantenimiento')
    expect(pauseFee(pause())).toBe(`${perMonth(1500)} de cuota de mantenimiento`)
    expect(pauseFee(pause({ exempt: true }))).toBe('Sin cuota de mantenimiento')
  })
  it('volver antes solo con la pausa en curso y más allá de la siguiente fecha de cobro', () => {
    const live = pause({ status: 'active', ends_at: '2027-02-01T09:24:00Z' })
    expect(canEndEarly(sub({ pause: live, current_period_end: '2027-01-01T09:24:00Z' }))).toBe(true)
    expect(canEndEarly(sub({ pause: live, current_period_end: '2027-02-01T09:24:00Z' }))).toBe(false) // ya acaba en ese cobro
    expect(canEndEarly(sub({ pause: pause(), current_period_end: '2026-12-01T09:24:00Z' }))).toBe(false) // programada: se anula
    expect(canEndEarly(sub({ pause: null }))).toBe(false)
  })
  it('reservas canceladas al pedirla', () => {
    expect(cancelledText(0)).toBe('No había reservas en esos días.')
    expect(cancelledText(1)).toBe('Se canceló 1 reserva de esos días.')
    expect(cancelledText(3)).toBe('Se cancelaron 3 reservas de esos días.')
  })
})
