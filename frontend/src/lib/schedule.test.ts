import { describe, expect, it } from 'vitest'
import { adjustedFields, canAdjust, canRestore, classState, isRetroactive, madridToIso, weekRange, weekStart } from '@/lib/schedule'

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
