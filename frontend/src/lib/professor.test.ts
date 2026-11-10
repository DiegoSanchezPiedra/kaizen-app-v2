import { describe, expect, it } from 'vitest'
import {
  canSeeHealth, classTitle, classTrainer, mobileLabels, monthlyTotals, niceMax, periodRange, phaseOf, splitHealth, sumFigures, telHref,
  unmarked, validRange, withMark, type Attendance, type Figures, type HealthStudent, type ReportRow,
} from '@/lib/professor'

const T = (s: string) => Date.parse(s)
const sess = { starts_at: '2026-11-02T18:00:00Z', ends_at: '2026-11-02T19:30:00Z', status: 'scheduled' as const }

describe('fase y fichas', () => {
  it('fase por hora y por estado', () => {
    expect(phaseOf(sess, T('2026-11-02T17:00:00Z'))).toBe('upcoming')
    expect(phaseOf(sess, T('2026-11-02T18:30:00Z'))).toBe('now')
    expect(phaseOf(sess, T('2026-11-02T19:30:00Z'))).toBe('ended')
    expect(phaseOf({ ...sess, status: 'cancelled' }, T('2026-11-02T18:30:00Z'))).toBe('cancelled')
  })
  it('fichas: solo hoy (Madrid) y no cancelada', () => {
    expect(canSeeHealth(sess, T('2026-11-02T08:00:00Z'))).toBe(true)
    expect(canSeeHealth(sess, T('2026-11-01T23:30:00Z'))).toBe(true) // 00:30 del 2 en Madrid
    expect(canSeeHealth(sess, T('2026-11-01T22:30:00Z'))).toBe(false) // 23:30 del 1 en Madrid
    expect(canSeeHealth(sess, T('2026-11-03T12:00:00Z'))).toBe(false)
    expect(canSeeHealth({ ...sess, status: 'cancelled' }, T('2026-11-02T08:00:00Z'))).toBe(false)
  })
})

describe('lista', () => {
  const a: Attendance = {
    closed_at: null,
    students: [
      { booking_id: 'b1', student_id: 's1', display_name: 'Ana', status: null, method: null, corrected_at: null, correction_reason: null },
      { booking_id: 'b2', student_id: 's2', display_name: 'Bea', status: 'present', method: 'qr', corrected_at: null, correction_reason: null },
    ],
  }
  it('marca y desmarca solo a esa persona', () => {
    const on = withMark(a, 's1', true)
    expect(on.students[0]).toMatchObject({ status: 'present', method: 'manual' })
    expect(on.students[1]).toBe(a.students[1])
    expect(withMark(on, 's2', false).students[1]).toMatchObject({ status: null, method: null })
  })
  it('quien no está presente pasa a falta al cerrar', () => {
    expect(unmarked(a.students).map((r) => r.display_name)).toEqual(['Ana'])
  })
})

describe('fichas de salud', () => {
  const h = (o: Partial<HealthStudent>): HealthStudent => ({
    student_id: 'x', display_name: 'X', injuries: null, conditions: null, allergies: null, medication: null,
    emergency_contact_name: null, emergency_contact_phone: null, ...o,
  })
  it('primero quien tiene algo, solo campos rellenos y en orden', () => {
    const { withInfo, without } = splitHealth([
      h({ display_name: 'A' }),
      h({ display_name: 'B', medication: 'Inhalador', injuries: ' Rodilla ', allergies: '  ' }),
    ])
    expect(without.map((s) => s.display_name)).toEqual(['A'])
    expect(withInfo[0].fields).toEqual([{ label: 'Lesiones', value: 'Rodilla' }, { label: 'Medicación', value: 'Inhalador' }])
  })
  it('tel: solo con dígitos y +', () => expect(telHref('+34 612 345-678')).toBe('tel:+34612345678'))
})

describe('informes', () => {
  const f = (o: Partial<Figures>): Figures => ({ sessions: 0, capacity: 0, booked: 0, occupancy: null, present: 0, absent: 0, unrecorded: 0, late: 0, ...o })
  it('la ocupación es la razón de las sumas, no la media', () => {
    const t = sumFigures([f({ sessions: 1, capacity: 10, booked: 10, occupancy: 1 }), f({ sessions: 3, capacity: 90, booked: 0, occupancy: 0 })])
    expect(t.occupancy).toBeCloseTo(0.1)
    expect(t.sessions).toBe(4)
    expect(sumFigures([]).occupancy).toBeNull()
  })
  it('totales por mes entre disciplinas', () => {
    const row = (booked: number): ReportRow => ({ discipline: { id: 1, name: 'x' }, total: f({}), months: [{ month: '2026-10', ...f({ capacity: 10, booked }) }, { month: '2026-11', ...f({ capacity: 10, booked: 10 }) }] })
    const m = monthlyTotals([row(5), row(5)])
    expect(m.map((x) => x.month)).toEqual(['2026-10', '2026-11'])
    expect(m[0].occupancy).toBe(0.5)
  })
  it('periodos y rango', () => {
    const now = new Date('2026-11-02T10:00:00Z')
    expect(periodRange('this', now)).toEqual({ from: '2026-11', to: '2026-11' })
    expect(periodRange('last', now)).toEqual({ from: '2026-10', to: '2026-10' })
    expect(periodRange('six', now)).toEqual({ from: '2026-06', to: '2026-11' })
    expect(periodRange('twelve', now)).toEqual({ from: '2025-12', to: '2026-11' })
    expect(validRange('2025-11', '2026-11')).toBe(false)
    expect(validRange('2026-11', '2026-10')).toBe(false)
    expect(validRange('2025-12', '2026-11')).toBe(true)
  })
  it('eje redondo', () => {
    expect([niceMax(0), niceMax(7), niceMax(23), niceMax(120)]).toEqual([1, 10, 50, 200])
  })
  it('títulos de clase', () => {
    const base = { discipline: { id: 1, name: 'Muay Thai' }, months: [], total: f({}) }
    expect(classTitle({ ...base, class_id: 'c', weekday: 1, start_time: '18:30', trainer: { id: 't', name: 'Marc' } })).toBe('Muay Thai · lunes 18:30')
    expect(classTrainer({ ...base, class_id: 'c', weekday: 1, start_time: '18:30', trainer: { id: 't', name: null } })).toBe('Clase de otro profesor · tus sustituciones')
    expect(classTitle({ ...base, class_id: null })).toBe('Muay Thai · sesiones sueltas')
  })
})

describe('etiquetas del eje en el móvil', () => {
  it('12 meses: como mucho 6, siempre la última', () => {
    const shown = mobileLabels(Array.from({ length: 12 }, (_, i) => `m${i}`))
    expect(shown.filter(Boolean)).toHaveLength(6)
    expect(shown.at(-1)).toBe(true)
    expect(shown.slice(0, 2)).toEqual([false, true])
  })
  it('24 meses: cada 4, desde la última', () => {
    const shown = mobileLabels(Array.from({ length: 24 }, (_, i) => `m${i}`))
    expect(shown.flatMap((v, i) => (v ? [i] : []))).toEqual([3, 7, 11, 15, 19, 23])
  })
  it('las vacías no cuentan y no se muestran; con pocas, todas', () => {
    const days = Array.from({ length: 30 }, (_, i) => (i % 7 === 0 ? String(i) : ''))
    expect(mobileLabels(days)).toEqual(days.map(Boolean))
    expect(mobileLabels(['a', 'b', 'c'])).toEqual([true, true, true])
  })
})
