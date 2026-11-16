import { describe, expect, it } from 'vitest'
import { checkinPhase } from '@/lib/sessions'

// Reloj fijo: 12:00 en Madrid. La sesión empieza a la hora que se indica el mismo día.
const now = Date.parse('2026-11-18T12:00:00+01:00')
const at = (hm: string) => `2026-11-18T${hm}:00+01:00`

describe('checkinPhase con la ventana exacta de la academia', () => {
  const win = { opens_minutes: 30, closes_minutes: 10 }

  it('solo ofrece el check-in con la ventana abierta', () => {
    expect(checkinPhase(at('12:20'), now, win)).toBe('soon')
    expect(checkinPhase(at('12:30'), now, win)).toBe('soon')
    expect(checkinPhase(at('12:31'), now, win)).toBeNull()
    expect(checkinPhase(at('11:50'), now, win)).toBe('live')
    expect(checkinPhase(at('11:49'), now, win)).toBeNull()
  })

  it('con otra ventana, otros límites', () => {
    expect(checkinPhase(at('12:40'), now, { opens_minutes: 45, closes_minutes: 10 })).toBe('soon')
    expect(checkinPhase(at('12:20'), now, { opens_minutes: 10, closes_minutes: 10 })).toBeNull()
  })
})

describe('checkinPhase (sin ventana: la holgada, 60 min antes y 30 después)', () => {
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
