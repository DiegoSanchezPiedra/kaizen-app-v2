import { describe, expect, it } from 'vitest'
import {
  centsToEuros,
  catalogRedirect,
  changed,
  checkinBody,
  eurosToCents,
  groupDocuments,
  insuranceBody,
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
  it('seguro: no se activa sin los dos precios ni se borra un precio', () => {
    const off = { enabled: false, price_adult_cents: null, price_minor_cents: null }
    const on = { enabled: true, price_adult_cents: 3000, price_minor_cents: 2000 }
    expect(insuranceBody(off, { adult: '', minor: '', enabled: false })).toEqual({ enabled: false })
    expect(insuranceBody(off, { adult: '30', minor: '', enabled: true })).toBeNull()
    expect(insuranceBody(off, { adult: '30', minor: '20', enabled: true })).toEqual({ enabled: true, price_adult_cents: 3000, price_minor_cents: 2000 })
    expect(insuranceBody(on, { adult: '', minor: '20', enabled: false })).toBeNull()
    expect(insuranceBody(on, { adult: '0', minor: '20', enabled: true })).toBeNull()
    expect(changed(on, insuranceBody(on, { adult: '30,00', minor: '20', enabled: true }))).toBe(false)
    expect(changed(on, insuranceBody(on, { adult: '30', minor: '20', enabled: false }))).toBe(true)
    expect(changed(off, insuranceBody(off, { adult: '', minor: '', enabled: false }))).toBe(false)
  })
})

describe('PDF antes de enviar', () => {
  const pdf = { type: 'application/pdf', size: 1000 }
  it('deja pasar un PDF con tipo y versión X.Y', () => {
    expect(pdfProblem('waiver', '1.0', pdf)).toBeNull()
    expect(pdfProblem('rights_of_image', ' 2.10 ', { ...pdf, size: MAX_PDF })).toBeNull()
  })
  it('para en lo primero que falla', () => {
    expect(pdfProblem('', '1.0', pdf)).toMatch(/tipo/)
    expect(pdfProblem('otro', '1.0', pdf)).toMatch(/tipo/)
    for (const v of ['', '1', '1.0.1', 'v1.0', '1.x']) expect(pdfProblem('waiver', v, pdf)).toMatch(/versión/)
    expect(pdfProblem('waiver', '1.0', null)).toMatch(/Elige el PDF/)
    expect(pdfProblem('waiver', '1.0', { type: 'image/png', size: 10 })).toMatch(/PDF/)
    expect(pdfProblem('waiver', '1.0', { ...pdf, size: 0 })).toMatch(/vacío/)
    expect(pdfProblem('waiver', '1.0', { ...pdf, size: MAX_PDF + 1 })).toMatch(/10 MB/)
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
    const groups = groupDocuments([doc('a', 'waiver', 'created'), doc('b', 'waiver', 'published'), doc('c', 'waiver', 'retired'), doc('d', 'data_protection', 'created')])
    const byType = Object.fromEntries(groups.map((g) => [g.type, g]))
    expect(groups.map((g) => g.type)).toEqual(['data_protection', 'rights_of_image', 'waiver'])
    expect(byType.waiver.current?.id).toBe('b')
    expect(byType.waiver.drafts.map((d) => d.id)).toEqual(['a'])
    expect(byType.waiver.retired.map((d) => d.id)).toEqual(['c'])
    expect(byType.data_protection.current).toBeNull()
    expect(byType.rights_of_image).toEqual({ type: 'rights_of_image', current: null, drafts: [], retired: [] })
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
