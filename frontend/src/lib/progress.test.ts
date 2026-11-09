import { describe, expect, it } from 'vitest'
import { LADDER, medalOf, medalsToCelebrate, nextMedal, streakTheme, streakTier, topMedal } from '@/lib/progress'
import type { DisciplineMedals } from '@/lib/types'

const now = new Date('2026-11-09T12:00:00Z')
const b = (code: string, earned_at: string) => ({ code, earned_at })
const d = (id: string, theme: string | null, badges: { code: string; earned_at: string }[], hours = 0): DisciplineMedals =>
  ({ id, name: `D${id}`, theme, hours, streak: { current: 0, best: 0 }, badges })

describe('LADDER', () => {
  it('las once de cada disciplina (019), en orden de escalera', () => expect(LADDER.map((m) => m.code)).toEqual([
    'first_day', 'hours_10', 'hours_50', 'hours_100', 'hours_250', 'hours_500', 'hours_1000',
    'streak_4', 'streak_12', 'streak_26', 'streak_52',
  ]))
})

describe('medalOf', () => {
  it('nombre y arte de la temática', () => {
    expect(medalOf('ippo', 'hours_1000')?.name).toBe('Campeón del mundo')
    expect(medalOf('saiyan', 'hours_250')?.name).toBe('Super Saiyan God')
    expect(medalOf('titanes', 'hours_1000')?.name).toBe('Titán Fundador')
    expect(medalOf('mugiwara', 'hours_500')?.name).toBe('Yonkō')
  })
  it('sin temática, o una sin arte todavía: la neutra Kaizen', () => {
    expect(medalOf(null, 'first_day')).toMatchObject({ name: 'Primer paso', theme: 'kaizen' })
    expect(medalOf('aun_sin_arte', 'streak_52')).toMatchObject({ name: 'Un año', theme: 'kaizen' })
  })
  it('un código que no está en la escalera: ninguna', () => expect(medalOf('ippo', 'streak_99')).toBeUndefined())
})

describe('nextMedal', () => {
  it('sin nada conseguido (0 h), la primera de cada escalera de su temática', () => {
    expect(nextMedal('ippo', 'hours', new Set())).toMatchObject({ code: 'first_day', name: 'Gimnasio Kamogawa' })
    expect(nextMedal(null, 'streak', new Set())?.code).toBe('streak_4')
  })
  it('la primera sin conseguir, aunque se crucen varias a la vez', () =>
    expect(nextMedal('saiyan', 'hours', new Set(['first_day', 'hours_10', 'hours_50', 'hours_100']))?.code).toBe('hours_250'))
  it('con la escalera completa, ninguna', () =>
    expect(nextMedal('titanes', 'streak', new Set(['streak_4', 'streak_12', 'streak_26', 'streak_52']))).toBeUndefined())
})

describe('medalsToCelebrate', () => {
  const codes = (x: ReturnType<typeof medalsToCelebrate>) => x.map((c) => c.key)
  it('sin badges, nada', () => expect(medalsToCelebrate([], null, now)).toEqual([]))
  it('sin visto previo: solo las de los últimos 14 días (no inunda al veterano)', () =>
    expect(codes(medalsToCelebrate([d('1', 'ippo', [b('hours_10', '2026-03-01T18:00:00Z'), b('hours_50', '2026-11-01T18:00:00Z')])], null, now)))
      .toEqual(['1:hours_50']))
  it('con visto: las que aún no celebró, aunque tengan más de 14 días (retroactiva) y por disciplina', () =>
    expect(codes(medalsToCelebrate([
      d('1', 'ippo', [b('hours_10', '2026-09-01T18:00:00Z')]),
      d('2', 'saiyan', [b('hours_10', '2026-10-01T18:00:00Z')]),
    ], ['1:hours_10'], now))).toEqual(['2:hours_10']))
  it('lo ya celebrado no se repite', () =>
    expect(medalsToCelebrate([d('1', null, [b('hours_50', '2026-11-08T18:00:00Z')])], ['1:hours_50'], now)).toEqual([]))
  it('varias a la vez y en varias disciplinas: la más reciente primero y, empatadas, la más alta; con su arte y disciplina', () => {
    const r = medalsToCelebrate([
      d('1', 'ippo', [b('first_day', '2026-11-03T18:00:00Z'), b('hours_10', '2026-11-03T18:00:00Z')]),
      d('2', 'saiyan', [b('streak_4', '2026-11-08T18:00:00Z')]),
    ], null, now)
    expect(codes(r)).toEqual(['2:streak_4', '1:hours_10', '1:first_day'])
    expect(r[0]).toMatchObject({ medal: { name: 'Kaioken', theme: 'saiyan' }, discipline: { id: '2', name: 'D2' } })
  })
  it('ignora un código que no está en la escalera', () =>
    expect(medalsToCelebrate([d('1', 'ippo', [b('streak_99', '2026-11-08T18:00:00Z')])], null, now)).toEqual([]))
})

describe('topMedal', () => {
  it('la de horas más alta de todas sus disciplinas antes que cualquier racha, con su temática', () =>
    expect(topMedal([
      d('1', 'ippo', [b('first_day', 'x'), b('streak_52', 'x')], 3),
      d('2', 'saiyan', [b('first_day', 'x'), b('hours_10', 'x')], 12),
    ])).toMatchObject({ medal: { code: 'hours_10', theme: 'saiyan' }, discipline: { id: '2' } }))
  it('empatadas, la de la disciplina con más horas', () =>
    expect(topMedal([d('1', 'ippo', [b('hours_10', 'x')], 11), d('2', 'titanes', [b('hours_10', 'x')], 40)])?.discipline.id).toBe('2'))
  it('sin horas (más allá de la primera sesión), la racha más alta', () =>
    expect(topMedal([d('1', null, [b('first_day', 'x'), b('streak_4', 'x'), b('streak_12', 'x')])])?.medal.code).toBe('streak_12'))
  it('nada, o un código desconocido: ninguna', () => {
    expect(topMedal([])).toBeUndefined()
    expect(topMedal(undefined)).toBeUndefined()
    expect(topMedal([d('1', 'ippo', [b('streak_99', 'x')])])).toBeUndefined()
  })
})

describe('streakTheme', () => {
  it('la temática de la disciplina con más horas', () =>
    expect(streakTheme([d('1', 'ippo', [], 30), d('2', 'saiyan', [], 120), d('3', 'titanes', [], 80)])).toBe('saiyan'))
  it('empatadas, la primera', () => expect(streakTheme([d('1', 'ippo', [], 10), d('2', 'saiyan', [], 10)])).toBe('ippo'))
  it('la de más horas sin temática: Kaizen (null), aunque otra la tenga', () =>
    expect(streakTheme([d('1', null, [], 50), d('2', 'saiyan', [], 5)])).toBeNull())
  it('sin disciplinas, null', () => expect(streakTheme([])).toBeNull())
})

describe('streakTier', () => {
  it('cortes en 0, 1, 4, 12, 26 y 52 semanas', () =>
    expect([0, 1, 3, 4, 11, 12, 25, 26, 51, 52, 80].map(streakTier)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]))
})
