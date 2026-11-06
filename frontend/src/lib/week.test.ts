import { describe, expect, it } from 'vitest'
import { nextMarked, pickDay, resolveWeekDay, shiftWeek, stripDays, weekQuery } from '@/lib/week'

const TODAY = '2026-11-06' // viernes; su semana empieza el lunes 2026-11-02

describe('resolveWeekDay', () => {
  it('sin parámetros: hoy en la semana actual', () => {
    expect(resolveWeekDay(null, null, TODAY)).toEqual({ week: '2026-11-02', day: TODAY })
  })
  it('otra semana: el lunes si no hay día', () => {
    expect(resolveWeekDay('2026-11-11', null, TODAY)).toEqual({ week: '2026-11-09', day: '2026-11-09' })
  })
  it('semana y día de esa semana', () => {
    expect(resolveWeekDay('2026-11-09', '2026-11-12', TODAY)).toEqual({ week: '2026-11-09', day: '2026-11-12' })
  })
  it('un día fuera de la semana se ignora', () => {
    expect(resolveWeekDay('2026-11-09', '2026-11-03', TODAY)).toEqual({ week: '2026-11-09', day: '2026-11-09' })
  })
  it('solo ?dia= pone su semana', () => {
    expect(resolveWeekDay(null, '2026-11-12', TODAY)).toEqual({ week: '2026-11-09', day: '2026-11-12' })
  })
  it('basura: cae en hoy', () => {
    expect(resolveWeekDay('mañana', '2026-13-45', TODAY)).toEqual({ week: '2026-11-02', day: TODAY })
  })
})

describe('shiftWeek', () => {
  it('se queda el mismo día de la semana', () => {
    expect(shiftWeek({ week: '2026-11-09', day: '2026-11-11' }, 1, TODAY)).toEqual({ week: '2026-11-16', day: '2026-11-18' })
    expect(shiftWeek({ week: '2026-11-09', day: '2026-11-11' }, -2, TODAY)).toEqual({ week: '2026-10-26', day: '2026-10-28' })
  })
  it('al llegar a la semana actual, hoy', () => {
    expect(shiftWeek({ week: '2026-11-09', day: '2026-11-11' }, -1, TODAY)).toEqual({ week: '2026-11-02', day: TODAY })
  })
  it('cruza el cambio de hora sin mover el día', () => {
    expect(shiftWeek({ week: '2026-10-26', day: '2026-10-31' }, 1, TODAY)).toEqual({ week: '2026-11-02', day: TODAY })
    expect(shiftWeek({ week: '2026-03-23', day: '2026-03-29' }, 1, '2026-01-01')).toEqual({ week: '2026-03-30', day: '2026-04-05' })
  })
})

describe('weekQuery', () => {
  it('lo que es el defecto no se escribe', () => {
    expect(weekQuery({ week: '2026-11-02', day: TODAY }, TODAY)).toEqual({ semana: null, dia: null })
    expect(weekQuery({ week: '2026-11-09', day: '2026-11-09' }, TODAY)).toEqual({ semana: '2026-11-09', dia: null })
  })
  it('ida y vuelta con resolveWeekDay', () => {
    for (const w of [pickDay('2026-11-04'), pickDay('2026-11-12'), pickDay('2026-11-09'), pickDay(TODAY)]) {
      const q = weekQuery(w, TODAY)
      expect(resolveWeekDay(q.semana, q.dia, TODAY)).toEqual(w)
    }
  })
})

describe('stripDays', () => {
  const days = stripDays({ week: '2026-11-02', day: '2026-11-04' }, TODAY, new Set(['2026-11-03']))
  it('siete días de lunes a domingo, con X el miércoles', () => {
    expect(days.map((d) => d.letter).join('')).toBe('LMXJVSD')
    expect(days.map((d) => d.number)).toEqual([2, 3, 4, 5, 6, 7, 8])
  })
  it('marca elegido, hoy, pasados y con clases', () => {
    expect(days.filter((d) => d.selected).map((d) => d.day)).toEqual(['2026-11-04'])
    expect(days.filter((d) => d.today).map((d) => d.day)).toEqual([TODAY])
    expect(days.filter((d) => d.past).length).toBe(4)
    expect(days.filter((d) => d.marked).map((d) => d.day)).toEqual(['2026-11-03'])
  })
})

describe('nextMarked', () => {
  const w = { week: '2026-11-02', day: '2026-11-04' }
  it('el siguiente día con clases de la semana', () => {
    expect(nextMarked(w, new Set(['2026-11-03', '2026-11-06', '2026-11-07']))).toBe('2026-11-06')
  })
  it('null si no queda ninguno', () => {
    expect(nextMarked(w, new Set(['2026-11-03']))).toBeNull()
  })
})
