import { describe, expect, it } from 'vitest'
import { agendaByDay, isLoose } from '@/lib/agenda'
import type { AdminEvent } from '@/lib/events'
import type { CalendarSession } from '@/lib/types'

const session = (id: string, starts_at: string, over: Partial<CalendarSession> = {}): CalendarSession => ({
  id, class_id: 'c1', starts_at, ends_at: starts_at, discipline: { id: 1, name: 'Judo' }, trainer: null, location: null, capacity: 10, taken: 0, status: 'scheduled', held: false, ...over,
})
const event = (id: string, starts_at: string, over: Partial<AdminEvent> = {}): AdminEvent =>
  ({ id, title: id, starts_at, ends_at: starts_at, discipline: null, status: 'scheduled', ...over }) as AdminEvent

describe('agenda de la semana', () => {
  it('mezcla sesiones y eventos por día y por hora', () => {
    const m = agendaByDay(
      [session('s2', '2026-11-04T19:00:00Z'), session('s1', '2026-11-04T09:00:00Z')],
      [event('e1', '2026-11-04T13:00:00Z'), event('e2', '2026-11-05T10:00:00Z')],
      'all',
    )
    expect([...m.keys()]).toEqual(['2026-11-04', '2026-11-05'])
    expect(m.get('2026-11-04')!.map((x) => (x.kind === 'session' ? x.s.id : x.e.id))).toEqual(['s1', 'e1', 's2'])
  })
  it('un evento de varios días va solo el día de inicio', () => {
    const m = agendaByDay([], [event('e', '2026-11-04T10:00:00Z', { ends_at: '2026-11-06T10:00:00Z' })], 'all')
    expect([...m.keys()]).toEqual(['2026-11-04'])
  })
  it('la disciplina filtra los eventos que la tienen y deja los que no', () => {
    const evs = [event('judo', '2026-11-04T10:00:00Z', { discipline: { id: 1, name: 'Judo' } }), event('bjj', '2026-11-04T11:00:00Z', { discipline: { id: 2, name: 'BJJ' } }), event('todos', '2026-11-04T12:00:00Z')]
    const ids = (d: string) => (agendaByDay([], evs, d).get('2026-11-04') ?? []).map((x) => (x.kind === 'event' ? x.e.id : ''))
    expect(ids('1')).toEqual(['judo', 'todos'])
    expect(ids('all')).toEqual(['judo', 'bjj', 'todos'])
  })
  it('suelta solo si class_id es null', () => {
    expect(isLoose({ class_id: null })).toBe(true)
    expect(isLoose({ class_id: 'c1' })).toBe(false)
    expect(isLoose({})).toBe(false)
  })
})
