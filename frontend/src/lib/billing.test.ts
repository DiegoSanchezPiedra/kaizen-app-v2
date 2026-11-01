import { describe, expect, it, vi } from 'vitest'
import {
  changesLeft,
  disciplineLocked,
  eligibleDisciplines,
  freeChange,
  keepDisciplines,
  planChange,
  planLock,
  pollPhase,
  rememberCheckoutSubject,
  takeCheckoutSubject,
  visiblePlans,
} from '@/lib/billing'
import { formatDeadline, formatShortDate } from '@/lib/format'
import type { Discipline, Plan, Subscription } from '@/lib/types'

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
const disc = (id: number, o: Partial<Discipline> = {}): Discipline => ({ id, name: `D${id}`, minors_only: false, is_active: true, is_open: false, ...o })
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
    const ds = [disc(1), disc(2, { minors_only: true }), disc(3, { is_open: true }), disc(4, { is_active: false }), disc(5)]
    expect(eligibleDisciplines(plan({ eligible_discipline_ids: [] }), ds, true).map((d) => d.id)).toEqual([1, 5])
    expect(eligibleDisciplines(plan({ eligible_discipline_ids: ['2', '5'] }), ds, false).map((d) => d.id)).toEqual([2, 5])
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
  it('gratis si la que se deja ya no se cubre', () => {
    expect(freeChange(disc(1, { is_active: false }), false)).toBe(true)
    expect(freeChange(disc(1, { minors_only: true }), true)).toBe(true)
    expect(freeChange(disc(1, { minors_only: true }), false)).toBe(false)
    expect(freeChange(undefined, true)).toBe(false)
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
