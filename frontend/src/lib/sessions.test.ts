import { describe, expect, it } from 'vitest'
import { checkinPhase } from '@/lib/sessions'

// Reloj fijo: 12:00 en Madrid. La sesión empieza a la hora que se indica el mismo día.
const now = Date.parse('2026-11-18T12:00:00+01:00')
const at = (hm: string) => `2026-11-18T${hm}:00+01:00`

describe('checkinPhase (ventana holgada: 60 min antes, 30 después)', () => {
  it('«soon» hasta una hora antes, ambos extremos según corresponda', () => {
    expect(checkinPhase(at('12:20'), now)).toBe('soon')
    expect(checkinPhase(at('13:00'), now)).toBe('soon')
    expect(checkinPhase(at('13:01'), now)).toBeNull()
  })

  it('«live» desde el inicio hasta media hora después', () => {
    expect(checkinPhase(at('12:00'), now)).toBe('live')
    expect(checkinPhase(at('11:30'), now)).toBe('live')
    expect(checkinPhase(at('11:29'), now)).toBeNull()
  })

  it('sesiones lejanas, ya terminadas o de otro día: null', () => {
    expect(checkinPhase(at('19:00'), now)).toBeNull()
    expect(checkinPhase(at('09:00'), now)).toBeNull()
    expect(checkinPhase('2026-11-19T12:10:00+01:00', now)).toBeNull()
  })
})
