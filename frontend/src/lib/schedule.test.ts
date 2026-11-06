import { describe, expect, it } from 'vitest'
import { adjustedFields, type AdminClass, canAdjust, canRestore, classState, groupByWeekday, classErrors, isRetroactive, looseErrors, madridToIso, weekRange, weekStart } from '@/lib/schedule'

const classValues = { trainer_id: 't1', starts_at: '2026-11-04T18:00:00Z', duration_min: 60, capacity: 20, location: 'Sala 1' }

describe('semana de lunes a domingo', () => {
  it('cualquier día cae en su lunes', () => {
    expect(weekStart('2026-11-04', '2026-01-01')).toBe('2026-11-02') // miércoles
    expect(weekStart('2026-11-08', '2026-01-01')).toBe('2026-11-02') // domingo
    expect(weekStart('2026-11-09', '2026-01-01')).toBe('2026-11-09') // el lunes siguiente
  })
  it('una URL rota o vacía cae en la semana de hoy', () => {
    expect(weekStart(null, '2026-11-04')).toBe('2026-11-02')
    expect(weekStart('mañana', '2026-11-04')).toBe('2026-11-02')
    expect(weekStart('2026-13-45', '2026-11-04')).toBe('2026-11-02') // fecha imposible: no revienta
    expect(weekStart('2026-02-31', '2026-11-04')).toBe('2026-11-02')
  })
  it('el rango son siete días, cruzando fin de año', () => {
    expect(weekRange('2026-11-02')).toEqual({ from: '2026-11-02', to: '2026-11-08' })
    expect(weekRange('2026-12-28')).toEqual({ from: '2026-12-28', to: '2027-01-03' })
  })
})

describe('campos ajustados', () => {
  it('solo los que dice la API, en el orden de la pantalla', () => {
    expect(adjustedFields({ adjusted_fields: ['location', 'trainer_id'], class_values: classValues })).toEqual(['trainer_id', 'location'])
  })
  it('una sesión suelta no tiene ajustes que deshacer', () => {
    expect(adjustedFields({ adjusted_fields: ['capacity'], class_values: null })).toEqual([])
  })
  it('ignora lo que no es un campo', () => {
    expect(adjustedFields({ adjusted_fields: ['otra'], class_values: classValues })).toEqual([])
  })
})

describe('cancelación retroactiva', () => {
  const start = Date.parse('2026-11-04T18:00:00Z')
  it('es retroactiva desde la hora de inicio, incluida', () => {
    expect(isRetroactive({ starts_at: '2026-11-04T18:00:00Z' }, start - 1)).toBe(false)
    expect(isRetroactive({ starts_at: '2026-11-04T18:00:00Z' }, start)).toBe(true)
  })
  it('ajustar y recuperar solo antes de empezar', () => {
    const s = { starts_at: '2026-11-04T18:00:00Z' }
    expect(canAdjust({ ...s, status: 'scheduled' }, start - 1)).toBe(true)
    expect(canAdjust({ ...s, status: 'cancelled' }, start - 1)).toBe(false)
    expect(canAdjust({ ...s, status: 'scheduled' }, start)).toBe(false)
    expect(canRestore({ ...s, status: 'cancelled' }, start - 1)).toBe(true)
    expect(canRestore({ ...s, status: 'cancelled' }, start)).toBe(false)
    expect(canRestore({ ...s, status: 'scheduled' }, start - 1)).toBe(false)
  })
})

describe('hora de Madrid a ISO', () => {
  it('en verano y en invierno', () => {
    expect(madridToIso('2026-07-01', '10:00')).toBe('2026-07-01T08:00:00.000Z')
    expect(madridToIso('2026-12-01', '10:00')).toBe('2026-12-01T09:00:00.000Z')
  })
  it('rechaza lo que no existe', () => {
    expect(madridToIso('2026-03-29', '02:30')).toBeNull() // salto de hora de primavera
    expect(madridToIso('2026-02-31', '10:00')).toBeNull()
    expect(madridToIso('2026-07-01', '25:00')).toBeNull()
    expect(madridToIso('', '')).toBeNull()
  })
})

describe('estado de una clase', () => {
  it('sin fin, vigente; con fin pasado, retirada; con fin futuro, se retira', () => {
    expect(classState({ ends_on: null }, '2026-11-02')).toBe('active')
    expect(classState({ ends_on: '2026-11-01' }, '2026-11-02')).toBe('retired')
    expect(classState({ ends_on: '2026-11-02' }, '2026-11-02')).toBe('ending')
  })
})

describe('clases agrupadas por día de la semana', () => {
  const c = (id: string, weekday: number, start_time: string) => ({ id, weekday, start_time }) as AdminClass
  it('junta las clases de cada día y conserva el orden de la API', () => {
    const groups = groupByWeekday([c('a', 1, '10:00'), c('b', 1, '18:00'), c('c', 3, '09:00')])
    expect(groups.map(([day, list]) => [day, list.map((x) => x.id)])).toEqual([[1, ['a', 'b']], [3, ['c']]])
  })
  it('sin clases no hay grupos', () => {
    expect(groupByWeekday([])).toEqual([])
  })
})

describe('errores de «Clase suelta»', () => {
  const now = Date.parse('2026-11-06T10:00:00Z') // 11:00 en Madrid
  const ok = { discipline: '1', trainer: 't1', day: '2026-11-07', time: '18:00', duration: '60', capacity: '20' }
  it('un formulario completo no da errores', () => expect(looseErrors(ok, now)).toEqual({}))
  it('lo vacío pide cada campo', () => {
    const e = looseErrors({ discipline: 'none', trainer: 'none', day: '', time: '', duration: '', capacity: '0' }, now)
    expect(Object.keys(e).sort()).toEqual(['capacity', 'day', 'discipline', 'duration', 'time', 'trainer'])
  })
  it('un día pasado marca el día y no la hora', () => {
    const e = looseErrors({ ...ok, day: '2026-11-05' }, now)
    expect(e.day).toBe('Ese día ya pasó.')
    expect(e.time).toBeUndefined()
  })
  it('hoy vale si la hora no ha pasado', () => {
    expect(looseErrors({ ...ok, day: '2026-11-06', time: '10:00' }, now).time).toBe('Esa hora ya pasó.')
    expect(looseErrors({ ...ok, day: '2026-11-06', time: '19:00' }, now)).toEqual({})
  })
  it('una fecha imposible no rompe', () => expect(looseErrors({ ...ok, day: '2026-13-45' }, now).day).toBe('Esa fecha no existe.'))
  it('la hora que no existe en el cambio de hora se avisa', () => expect(looseErrors({ ...ok, day: '2027-03-28', time: '02:30' }, now).time).toBe('Esa hora no existe ese día.'))
})

describe('errores de «Nueva clase»', () => {
  const ok = { discipline: '1', trainer: 't1', time: '18:00', duration: '60', capacity: '20', starts_on: '', ends_on: '' }
  it('lo opcional vacío no da errores', () => expect(classErrors(ok)).toEqual({}))
  it('lo obligatorio vacío se pide', () => {
    const e = classErrors({ ...ok, discipline: 'none', trainer: 'none', time: '', duration: '0', capacity: '' })
    expect(Object.keys(e).sort()).toEqual(['capacity', 'discipline', 'duration', 'time', 'trainer'])
  })
  it('«Hasta» no puede ser antes de «Desde» ni una fecha imposible', () => {
    expect(classErrors({ ...ok, starts_on: '2026-12-10', ends_on: '2026-12-01' }).ends_on).toBe('No puede ser antes del inicio.')
    expect(classErrors({ ...ok, starts_on: '2026-12-10', ends_on: '2026-12-10' })).toEqual({})
    expect(classErrors({ ...ok, ends_on: '2026-13-45' }).ends_on).toBe('Esa fecha no existe.')
  })
})
