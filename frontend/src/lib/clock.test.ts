import { describe, expect, it } from 'vitest'
import { actionsFor, formatDuration, hasPending, monthParam, originalOf, pausesOf, stateLine, sinceOf, whatOf, type ClockEvent, type ClockMonth, type Correction } from '@/lib/clock'
import { madridMonth } from '@/lib/dates'

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

  it('el original de un fichaje, si es del mes', () => {
    const m = { events: [{ id: '1', kind: 'in', at: 'orig', origin: 'app' }] } as unknown as ClockMonth
    expect(originalOf(m, '1')?.at).toBe('orig')
    expect(originalOf(m, '2')).toBeUndefined()
    expect(originalOf(m, null)).toBeUndefined()
  })

  const c = (over: Partial<Correction>): Correction => ({ id: 'c1', event_id: null, kind: 'in', at: null, reason: 'x', created_at: '', requested_by: { id: 'p', display_name: 'P' }, status: 'pending', resolved_by: null, resolved_at: null, resolution_reason: null, ...over })
  const month = { events: [{ id: '1', kind: 'in', at: '2026-11-10T08:05:00Z', origin: 'app' }], corrections: [] } as unknown as ClockMonth

  it('qué hace una corrección, con el original visible', () => {
    expect(whatOf(c({ at: '2026-11-10T08:10:00Z' }), month)).toBe('Añadir entrada a las 09:10')
    expect(whatOf(c({ event_id: '1', at: '2026-11-10T08:10:00Z' }), month)).toBe('Cambiar entrada de las 09:05 a las 09:10')
    expect(whatOf(c({ event_id: '1' }), month)).toBe('Anular entrada de las 09:05')
  })

  it('un original que no es del mes lo dice', () => {
    expect(whatOf(c({ event_id: '9', kind: 'out' }), month)).toBe('Anular salida (fichaje de otro mes)')
    expect(whatOf(c({ event_id: '9', at: '2026-11-10T08:10:00Z' }), month)).toBe('Cambiar entrada a las 09:10 (fichaje de otro mes)')
  })

  it('un fichaje con una corrección pendiente no admite otra', () => {
    const m = { corrections: [c({ event_id: '1' }), c({ id: 'c2', event_id: '2', status: 'applied' })] } as unknown as ClockMonth
    expect(hasPending(m, '1')).toBe(true)
    expect(hasPending(m, '2')).toBe(false)
    expect(hasPending(m, '3')).toBe(false)
  })

  it('el mes de ?month= o el actual', () => {
    expect(monthParam(new URLSearchParams('month=2026-03'))).toBe('2026-03')
    for (const bad of ['', 'month=2026-13', 'month=hoy', 'month=2026-3']) expect(monthParam(new URLSearchParams(bad))).toBe(madridMonth())
  })
})

describe('pausas del día (impresión)', () => {
  const ev = (id: string, kind: ClockEvent['kind']): ClockEvent => ({ id, kind, at: '2026-11-03T10:00:00Z', origin: 'app' })

  it('empareja inicio y fin; la pausa abierta no tiene fin', () => {
    const p = pausesOf([ev('a', 'in'), ev('b', 'pause_start'), ev('c', 'pause_end'), ev('d', 'pause_start'), ev('e', 'out')])
    expect(p.map(([s, f]) => [s.id, f?.id])).toEqual([
      ['b', 'c'],
      ['d', undefined],
    ])
    expect(pausesOf([ev('a', 'in'), ev('b', 'out')])).toEqual([])
  })
})
