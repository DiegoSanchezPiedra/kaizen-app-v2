import { describe, expect, it } from 'vitest'
import { MEDALS, medalsToCelebrate, nextMedal, topMedal } from '@/lib/progress'

const now = new Date('2026-11-09T12:00:00Z')
const b = (code: string, earned_at: string) => ({ code, earned_at })

describe('MEDALS', () => {
  it('las once de la lista cerrada (019), en orden de escalera', () => expect(MEDALS.map((m) => m.code)).toEqual([
    'first_day', 'hours_10', 'hours_50', 'hours_100', 'hours_250', 'hours_500', 'hours_1000',
    'streak_4', 'streak_12', 'streak_26', 'streak_52',
  ]))
})

describe('nextMedal', () => {
  it('sin nada conseguido (0 h), la primera de cada escalera', () => {
    expect(nextMedal('hours', new Set())?.code).toBe('first_day')
    expect(nextMedal('streak', new Set())?.code).toBe('streak_4')
  })
  it('la primera sin conseguir, aunque se crucen varias a la vez', () =>
    expect(nextMedal('hours', new Set(['first_day', 'hours_10', 'hours_50', 'hours_100']))?.code).toBe('hours_250'))
  it('con la escalera completa, ninguna', () =>
    expect(nextMedal('streak', new Set(['streak_4', 'streak_12', 'streak_26', 'streak_52']))).toBeUndefined())
})

describe('medalsToCelebrate', () => {
  it('sin badges, nada', () => expect(medalsToCelebrate([], null, now)).toEqual([]))
  it('sin visto previo: solo las de los últimos 14 días (no inunda al veterano)', () =>
    expect(medalsToCelebrate([b('hours_10', '2026-03-01T18:00:00Z'), b('hours_50', '2026-11-01T18:00:00Z')], null, now)
      .map((m) => m.code)).toEqual(['hours_50']))
  it('con visto: las que aún no celebró, aunque tengan más de 14 días', () =>
    expect(medalsToCelebrate([b('hours_10', '2026-09-01T18:00:00Z'), b('streak_4', '2026-10-01T18:00:00Z')],
      ['first_day', 'hours_10'], now).map((m) => m.code)).toEqual(['streak_4']))
  it('una lista pasada tarde (earned_at anterior al último visto) también se celebra', () =>
    expect(medalsToCelebrate([b('hours_50', '2026-11-01T18:00:00Z')], ['hours_10'], now).map((m) => m.code)).toEqual(['hours_50']))
  it('lo ya celebrado no se repite', () =>
    expect(medalsToCelebrate([b('hours_50', '2026-11-08T18:00:00Z')], ['hours_50'], now)).toEqual([]))
  it('varias a la vez: la más reciente primero y, empatadas, la más alta', () =>
    expect(medalsToCelebrate([b('first_day', '2026-11-03T18:00:00Z'), b('hours_10', '2026-11-03T18:00:00Z'),
      b('streak_4', '2026-11-08T18:00:00Z')], null, now).map((m) => m.code)).toEqual(['streak_4', 'hours_10', 'first_day']))
  it('ignora un código que no está en la lista', () =>
    expect(medalsToCelebrate([b('streak_99', '2026-11-08T18:00:00Z')], null, now)).toEqual([]))
})

describe('topMedal', () => {
  it('la de horas más alta antes que cualquier racha', () =>
    expect(topMedal(['first_day', 'hours_10', 'streak_12'])?.code).toBe('hours_10'))
  it('sin horas (más allá de la primera sesión), la racha más alta', () =>
    expect(topMedal(['first_day', 'streak_4', 'streak_12'])?.code).toBe('streak_12'))
  it('solo la primera sesión', () => expect(topMedal(['first_day'])?.code).toBe('first_day'))
  it('nada, o un código desconocido: ninguna', () => {
    expect(topMedal([])).toBeUndefined()
    expect(topMedal(['streak_99'])).toBeUndefined()
  })
})
