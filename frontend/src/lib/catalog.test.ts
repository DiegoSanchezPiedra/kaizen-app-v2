import { describe, expect, it } from 'vitest'
import {
  centsToEuros,
  catalogRedirect,
  changed,
  checkinBody,
  eurosToCents,
  groupDocuments,
  MAX_PDF,
  pdfProblem,
  perPeriodBody,
  tabletState,
  type AgreementDoc,
} from '@/lib/catalog'

describe('precio: euros ↔ céntimos', () => {
  it('lee coma, punto y enteros sin pasar por float', () => {
    expect(eurosToCents('12,50')).toBe(1250)
    expect(eurosToCents('12.5')).toBe(1250)
    expect(eurosToCents('30')).toBe(3000)
    expect(eurosToCents('0,07')).toBe(7)
    expect(eurosToCents('19.99')).toBe(1999)
  })
  it('rechaza lo que no es un importe', () => {
    for (const bad of ['', 'abc', '-3', '1,234', '1,', ',5', '1e3']) expect(eurosToCents(bad)).toBeNull()
  })
  it('vuelve a euros con dos decimales y coma', () => {
    expect(centsToEuros(1250)).toBe('12,50')
    expect(centsToEuros(0)).toBe('0,00')
    expect(eurosToCents(centsToEuros(1999))).toBe(1999)
  })
})

describe('ajustes: qué grupos han cambiado', () => {
  const checkin = { opens_minutes: 30, closes_minutes: 15, qr_seconds: 60 }
  it('check-in: 1–1440 enteros', () => {
    expect(checkinBody({ opens_minutes: '30', closes_minutes: '15', qr_seconds: '60' })).toEqual(checkin)
    expect(checkinBody({ opens_minutes: '0', closes_minutes: '15', qr_seconds: '60' })).toBeNull()
    expect(checkinBody({ opens_minutes: '30', closes_minutes: '1441', qr_seconds: '60' })).toBeNull()
    expect(checkinBody({ opens_minutes: '30', closes_minutes: '1,5', qr_seconds: '60' })).toBeNull()
    expect(changed(checkin, checkinBody({ opens_minutes: '30', closes_minutes: '15', qr_seconds: '60' }))).toBe(false)
    expect(changed(checkin, checkinBody({ opens_minutes: '45', closes_minutes: '15', qr_seconds: '60' }))).toBe(true)
  })
  it('cambios de disciplina: 0 o más', () => {
    expect(perPeriodBody('0')).toEqual({ per_period: 0 })
    expect(perPeriodBody('-1')).toBeNull()
    expect(perPeriodBody('')).toBeNull()
    expect(changed({ per_period: 1 }, perPeriodBody('1'))).toBe(false)
    expect(changed({ per_period: 1 }, perPeriodBody('2'))).toBe(true)
  })
})

describe('PDF antes de enviar', () => {
  const pdf = { type: 'application/pdf', size: 1000 }
  it('deja pasar un PDF con tipo y versión X.Y', () => {
    expect(pdfProblem('data_protection', '1.0', pdf)).toBeNull()
    expect(pdfProblem('rights_of_image', ' 2.10 ', { ...pdf, size: MAX_PDF })).toBeNull()
  })
  it('para en lo primero que falla', () => {
    expect(pdfProblem('', '1.0', pdf)).toMatch(/tipo/)
    expect(pdfProblem('otro', '1.0', pdf)).toMatch(/tipo/)
    for (const v of ['', '1', '1.0.1', 'v1.0', '1.x']) expect(pdfProblem('data_protection', v, pdf)).toMatch(/versión/)
    expect(pdfProblem('data_protection', '1.0', null)).toMatch(/Elige el PDF/)
    expect(pdfProblem('data_protection', '1.0', { type: 'image/png', size: 10 })).toMatch(/PDF/)
    expect(pdfProblem('data_protection', '1.0', { ...pdf, size: 0 })).toMatch(/vacío/)
    expect(pdfProblem('data_protection', '1.0', { ...pdf, size: MAX_PDF + 1 })).toMatch(/10 MB/)
  })
})

describe('documentos por tipo', () => {
  const doc = (id: string, type: string, status: AgreementDoc['status']): AgreementDoc => ({
    id,
    type,
    version: '1.0',
    checksum: id,
    created_at: '2026-11-01T10:00:00Z',
    published_at: status === 'created' ? null : '2026-11-01T10:00:00Z',
    retired_at: status === 'retired' ? '2026-11-02T10:00:00Z' : null,
    status,
  })
  it('separa vigente, borradores y retirados; un tipo sin vigente queda en null', () => {
    const groups = groupDocuments([doc('a', 'data_protection', 'created'), doc('b', 'data_protection', 'published'), doc('c', 'data_protection', 'retired'), doc('d', 'rights_of_image', 'created')])
    const byType = Object.fromEntries(groups.map((g) => [g.type, g]))
    expect(groups.map((g) => g.type)).toEqual(['data_protection', 'rights_of_image'])
    expect(byType.data_protection.current?.id).toBe('b')
    expect(byType.data_protection.drafts.map((d) => d.id)).toEqual(['a'])
    expect(byType.data_protection.retired.map((d) => d.id)).toEqual(['c'])
    expect(byType.rights_of_image).toEqual({ type: 'rights_of_image', current: null, drafts: [doc('d', 'rights_of_image', 'created')], retired: [] })
  })
})

describe('estado de una tablet', () => {
  it('revocada gana a vinculada; sin vincular espera', () => {
    expect(tabletState({ linked_at: null, revoked_at: null })).toBe('waiting')
    expect(tabletState({ linked_at: '2026-11-01T10:00:00Z', revoked_at: null })).toBe('linked')
    expect(tabletState({ linked_at: '2026-11-01T10:00:00Z', revoked_at: '2026-11-02T10:00:00Z' })).toBe('revoked')
    expect(tabletState({ linked_at: null, revoked_at: '2026-11-02T10:00:00Z' })).toBe('revoked')
  })
})

describe('redirección de /admin/catalog', () => {
  it('?tab=plans va a Membresías; el resto, a Disciplinas', () => {
    expect(catalogRedirect('plans')).toBe('/admin/memberships')
    expect(catalogRedirect('disciplines')).toBe('/admin/disciplines')
    expect(catalogRedirect(null)).toBe('/admin/disciplines')
    expect(catalogRedirect('otra')).toBe('/admin/disciplines')
  })
})
