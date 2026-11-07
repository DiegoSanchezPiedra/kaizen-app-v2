import { describe, expect, it } from 'vitest'
import { addDays, addMonths, madridDay, madridMonth, mondayOf } from '@/lib/dates'
import { isoToSpanish } from '@/lib/format'
import { homeNotices } from '@/lib/notices'
import { onboardingSteps, profileNotice } from '@/lib/profile'
import { BADGES } from '@/lib/progress'
import { path } from '@/lib/url'
import { groupByDay, seatsOf, sessionState, splitBookings } from '@/lib/sessions'
import type { Booking, CalendarSession } from '@/lib/types'

const session = (o: Partial<CalendarSession> = {}): CalendarSession => ({
  id: 's1',
  starts_at: '2026-11-10T17:00:00Z',
  ends_at: '2026-11-10T18:00:00Z',
  discipline: { id: 1, name: 'Judo' },
  trainer: null,
  location: null,
  capacity: 10,
  taken: 0,
  status: 'scheduled',
  held: false,
  covered: true,
  booking: null,
  ...o,
})
const NOW = Date.parse('2026-11-01T10:00:00Z')

describe('días de Madrid', () => {
  it('una hora que en UTC es del día anterior (o posterior) cae en su día de Madrid', () => {
    // npm test corre en UTC: 23:30 UTC del 31 de octubre ya es 1 de noviembre en Madrid (UTC+1).
    expect(madridDay('2026-10-31T23:30:00Z')).toBe('2026-11-01')
    // En verano (UTC+2), 22:30 UTC del 30 de junio ya es el 1 de julio.
    expect(madridDay('2026-06-30T22:30:00Z')).toBe('2026-07-01')
    expect(madridMonth('2026-10-31T23:30:00Z')).toBe('2026-11')
  })
  it('suma días y meses y busca el lunes de la semana', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(mondayOf('2026-11-01')).toBe('2026-10-26') // domingo
    expect(mondayOf('2026-11-02')).toBe('2026-11-02') // lunes
  })
  it('agrupa por el día de Madrid, no el de UTC', () => {
    const a = session({ id: 'a', starts_at: '2026-10-31T23:30:00Z' })
    const b = session({ id: 'b', starts_at: '2026-11-01T09:00:00Z' })
    const c = session({ id: 'c', starts_at: '2026-10-31T10:00:00Z' })
    expect(groupByDay([c, a, b], (s) => s.starts_at).map(([d, l]) => [d, l.map((s) => s.id)])).toEqual([
      ['2026-10-31', ['c']],
      ['2026-11-01', ['a', 'b']],
    ])
  })
})

describe('estado de una sesión', () => {
  it('sigue el orden de docs/pantallas-b18.md', () => {
    expect(sessionState(session(), NOW)).toBe('available')
    expect(sessionState(session({ covered: false }), NOW)).toBe('uncovered')
    expect(sessionState(session({ status: 'cancelled', booking: { id: 'b', status: 'confirmed' } }), NOW)).toBe('cancelled')
    expect(sessionState(session({ booking: { id: 'b', status: 'confirmed' } }), NOW)).toBe('booked')
    expect(sessionState(session({ booking: { id: 'b', status: 'waitlisted' } }), NOW)).toBe('waitlisted')
    expect(sessionState(session({ held: true }), NOW)).toBe('held')
    expect(sessionState(session({ starts_at: '2026-11-01T09:00:00Z' }), NOW)).toBe('started')
  })
  it('lo que falla con outside_booking_window bloquea esa hora y las siguientes, no las anteriores', () => {
    const from = Date.parse('2026-11-10T17:00:00Z')
    expect(sessionState(session(), NOW, from)).toBe('blocked')
    expect(sessionState(session({ starts_at: '2026-11-20T17:00:00Z' }), NOW, from)).toBe('blocked')
    expect(sessionState(session({ starts_at: '2026-11-05T17:00:00Z' }), NOW, from)).toBe('available')
    // una reservada sigue reservada aunque caiga después
    expect(sessionState(session({ booking: { id: 'b', status: 'confirmed' } }), NOW, from)).toBe('booked')
  })
})

describe('reservas', () => {
  const b = (id: string, starts_at: string): Booking => ({
    id, session_id: id, student_id: 'x', status: 'confirmed', cancel_reason: null, discipline_id: 1, discipline_name: 'Judo',
    starts_at, ends_at: starts_at, location: null, session_status: 'scheduled',
  })
  it('separa próximas (por hora) y pasadas (la más reciente primero)', () => {
    const { upcoming, past } = splitBookings(
      [b('c', '2026-11-05T10:00:00Z'), b('p1', '2026-10-01T10:00:00Z'), b('a', '2026-11-02T10:00:00Z'), b('p2', '2026-10-20T10:00:00Z')],
      NOW,
    )
    expect(upcoming.map((x) => x.id)).toEqual(['a', 'c'])
    expect(past.map((x) => x.id)).toEqual(['p2', 'p1'])
  })
})

describe('perfil y avisos', () => {
  it('distingue completar el perfil de solo firmar', () => {
    expect(profileNotice([])).toBeNull()
    expect(profileNotice(['rights_of_image'])).toBe('sign')
    expect(profileNotice(['data_protection', 'rights_of_image'])).toBe('sign')
    expect(profileNotice(['emergency_contact', 'rights_of_image'])).toBe('complete')
  })
  it('los pasos salen de lo que falta, en orden', () => {
    expect(onboardingSteps(['display_name', 'health_info', 'data_protection'], false)).toEqual(['datos', 'ficha', 'acuerdos'])
    expect(onboardingSteps(['emergency_contact'], false)).toEqual(['ficha'])
    expect(onboardingSteps(['data_protection'], true)).toEqual(['datos', 'acuerdos'])
    expect(onboardingSteps([], false)).toEqual([])
  })
  it('apila los avisos en el orden del diseño y nombra al hijo', () => {
    const n = homeNotices({
      status: { ok: false, missing: ['rights_of_image'], risk_cover: false },
      subscription: { id: 's', status: 'past_due', plan: { id: 1, name: 'p', price_cents: 1, max_disciplines: 1 }, disciplines: [], current_period_end: null },
      subject: { id: 'h', label: 'Pau' },
      self: { ok: false, missing: ['data_protection'] },
    })
    expect(n.map((x) => x.id)).toEqual(['sign', 'self-dp', 'grace', 'risk'])
    expect(n[0].text).toContain('Pau')
    expect(homeNotices({ subscription: null, subject: null }).map((x) => x.id)).toEqual(['nosub'])
    // sin datos todavía (cargando), ningún aviso
    expect(homeNotices({ subject: null })).toEqual([])
  })
  it('un hijo con la ficha por completar va a la ficha de Cuenta; uno mismo, a completar el perfil', () => {
    const miss = { ok: false, missing: ['health_info'], risk_cover: true }
    expect(homeNotices({ status: miss, subject: { id: 'h', label: 'Pau' } })[0].to).toBe('/account/health')
    expect(homeNotices({ status: miss, subject: null })[0].to).toBe('/onboarding')
  })
})

describe('utilidades', () => {
  it('path no manda los parámetros vacíos (para uno mismo no hay profile_id)', () => {
    expect(path('/bookings', { profile_id: undefined, from: '2026-11-01' })).toBe('/bookings?from=2026-11-01')
    expect(path('/me/health', { profile_id: undefined })).toBe('/me/health')
  })
  it('isoToSpanish', () => expect(isoToSpanish('2016-05-03')).toBe('03/05/2016'))
  it('los diez badges de la lista cerrada', () => expect(BADGES.map((x) => x.code)).toEqual([
    'hours_10', 'hours_50', 'hours_100', 'hours_250', 'hours_500', 'hours_1000', 'streak_4', 'streak_12', 'streak_26', 'streak_52',
  ]))
})

describe('seatsOf', () => {
  it('ocupadas/aforo; llena al llegar o pasar del aforo, con la barra a tope', () => {
    expect(seatsOf(10, 13)).toEqual({ label: '10/13', full: false, ratio: 10 / 13 })
    expect(seatsOf(13, 13)).toMatchObject({ label: '13/13', full: true, ratio: 1 })
    expect(seatsOf(15, 13)).toMatchObject({ full: true, ratio: 1 })
    expect(seatsOf(0, 8)).toMatchObject({ label: '0/8', full: false, ratio: 0 })
  })
})
