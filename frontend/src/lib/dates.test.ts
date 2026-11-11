import { describe, expect, it } from 'vitest'
import { madridToIso } from '@/lib/dates'

describe('madridToIso', () => {
  it('hora de Madrid a ISO en UTC, en verano y en invierno', () => {
    expect(madridToIso('2026-07-01', '09:30')).toBe('2026-07-01T07:30:00.000Z')
    expect(madridToIso('2026-11-10', '09:30')).toBe('2026-11-10T08:30:00.000Z')
    expect(madridToIso('2026-11-10', '00:15')).toBe('2026-11-09T23:15:00.000Z')
  })
})
