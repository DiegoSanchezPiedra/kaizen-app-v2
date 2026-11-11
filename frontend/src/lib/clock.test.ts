import { describe, expect, it } from 'vitest'
import { actionsFor, formatDuration, madridToIso, originalOf, stateLine, sinceOf, type ClockMonth } from '@/lib/clock'

describe('registro de jornada (B31.1)', () => {
  it('los botones que permite la secuencia', () => {
    expect(actionsFor('out').map((a) => a.kind)).toEqual(['in'])
    expect(actionsFor('in').map((a) => a.kind)).toEqual(['pause_start', 'out'])
    expect(actionsFor('paused').map((a) => a.kind)).toEqual(['pause_end'])
    expect(actionsFor('in').map((a) => a.label)).toEqual(['Pausa', 'Salir'])
  })

  it('duraciones H:MM, sin redondear hacia arriba', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(59)).toBe('0:00')
    expect(formatDuration(3600 + 5 * 60 + 59)).toBe('1:05')
    expect(formatDuration(37 * 3600)).toBe('37:00')
  })

  it('el estado en una línea', () => {
    expect(stateLine('out')).toBe('Fuera')
    expect(stateLine('paused')).toBe('En pausa')
    expect(stateLine('in', '2026-11-10T08:05:00Z')).toBe('Trabajando desde 09:05')
    expect(stateLine('in')).toBe('Trabajando')
  })

  it('desde cuándo trabaja: la última entrada del mes', () => {
    const m = { days: [{ events: [{ kind: 'in', at: 'a' }, { kind: 'out', at: 'b' }] }, { events: [{ kind: 'in', at: 'c' }, { kind: 'pause_start', at: 'd' }] }] } as unknown as ClockMonth
    expect(sinceOf(m)).toBe('c')
    expect(sinceOf({ days: [] } as unknown as ClockMonth)).toBeUndefined()
  })

  it('hora de Madrid a ISO con su zona, en verano y en invierno', () => {
    expect(madridToIso('2026-07-01', '09:30')).toBe('2026-07-01T07:30:00.000Z')
    expect(madridToIso('2026-11-10', '09:30')).toBe('2026-11-10T08:30:00.000Z')
    expect(madridToIso('2026-11-10', '00:15')).toBe('2026-11-09T23:15:00.000Z')
  })

  it('el original de un fichaje corregido', () => {
    const m = { events: [{ id: '1', kind: 'in', at: 'orig', origin: 'app' }] } as unknown as ClockMonth
    expect(originalOf(m, { id: '1', kind: 'in', at: 'new', origin: 'app', corrected: true })?.at).toBe('orig')
    expect(originalOf(m, { id: '1', kind: 'in', at: 'x', origin: 'app', corrected: false })).toBeUndefined()
    expect(originalOf(m, { id: '2', kind: 'in', at: 'x', origin: 'correction', corrected: true })).toBeUndefined()
  })
})
