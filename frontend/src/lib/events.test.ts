import { describe, expect, it } from 'vitest'
import {
  attendanceOpen, canRefund, canRetryRefund, cancelResult, cancelSummary, draftOf, emptyDraft, eventBody, eventPatch, notifiesOnPatch, refundLabel,
  type AdminEvent, type EventDraft, type EventRegistration,
} from '@/lib/events'

const now = Date.parse('2026-11-05T10:00:00Z')
const base: EventDraft = {
  ...emptyDraft(), title: ' Seminario ', day: '2026-12-12', time: '10:00', endDay: '2026-12-12', endTime: '14:00', location: 'Dojo',
}
const saved: AdminEvent = {
  id: 'e1', title: 'Seminario', description: null, starts_at: '2026-12-12T09:00:00.000Z', ends_at: '2026-12-12T13:00:00.000Z', location: 'Dojo',
  discipline: null, trainer: null, capacity: null, taken: 0, audience: 'all', requires_risk_cover: true, price_cents: 0, member_price_cents: null,
  registration_deadline: null, status: 'scheduled', cancel_note: null,
}
const reg = (o: Partial<EventRegistration>): EventRegistration => ({
  id: 'r', student: { id: 's', display_name: 'A' }, status: 'confirmed', amount_cents: 1200, guest: false, payer: null, refund_status: null,
  refunded_cents: 0, attended: null, cancel_reason: null, created_at: '2026-11-05T10:00:00Z', ...o,
})

describe('euros del evento', () => {
  it('vacío es gratis; los euros pasan a céntimos sin float', () => {
    expect(eventBody(base, now)).toMatchObject({ price_cents: 0, member_price_cents: null, title: 'Seminario' })
    expect(eventBody({ ...base, price: '12,50', memberPrice: '8' }, now)).toMatchObject({ price_cents: 1250, member_price_cents: 800 })
    expect(eventBody({ ...base, price: '19.99' }, now)?.price_cents).toBe(1999)
  })
  it('un precio es 0 o ≥ 0,50 €; el de socio no supera al precio', () => {
    expect(eventBody({ ...base, price: '0,40' }, now)).toBeNull()
    expect(eventBody({ ...base, price: '10', memberPrice: '0,30' }, now)).toBeNull()
    expect(eventBody({ ...base, price: '10', memberPrice: '12' }, now)).toBeNull()
    expect(eventBody({ ...base, price: '10', memberPrice: '0' }, now)?.member_price_cents).toBe(0)
    expect(eventBody({ ...base, price: 'diez' }, now)).toBeNull()
  })
  it('el fin va después del inicio; el inicio, en el futuro; la fecha límite, antes del inicio', () => {
    expect(eventBody({ ...base, endTime: '10:00' }, now)).toBeNull()
    expect(eventBody({ ...base, day: '2026-11-01' }, now)).toBeNull()
    expect(eventBody({ ...base, day: '2026-11-01', endDay: '2026-11-02' }, now, false)).not.toBeNull()
    expect(eventBody({ ...base, deadlineDay: '2026-12-13', deadlineTime: '10:00' }, now)).toBeNull()
    expect(eventBody({ ...base, deadlineDay: '2026-12-10', deadlineTime: '10:00' }, now)?.registration_deadline).toBe('2026-12-10T09:00:00.000Z')
    expect(eventBody({ ...base, deadlineDay: '2026-12-10' }, now)).toBeNull()
  })
  it('el aforo vacío es sin límite; 0 o raro no vale', () => {
    expect(eventBody({ ...base, capacity: '' }, now)?.capacity).toBeNull()
    expect(eventBody({ ...base, capacity: '30' }, now)?.capacity).toBe(30)
    expect(eventBody({ ...base, capacity: '0' }, now)).toBeNull()
    expect(eventBody({ ...base, capacity: '2x' }, now)).toBeNull()
  })
})

describe('qué campos cambian en el PATCH', () => {
  it('sin tocar nada no manda nada (draftOf → eventBody)', () => {
    const body = eventBody(draftOf(saved), now, false)!
    expect(eventPatch(saved, body)).toEqual({})
  })
  it('solo lo que cambia, y el precio de socio vuelve a null', () => {
    const e = { ...saved, price_cents: 1000, member_price_cents: 500 }
    const body = eventBody({ ...draftOf(e), location: 'Pabellón', memberPrice: '' }, now, false)!
    expect(eventPatch(e, body)).toEqual({ location: 'Pabellón', member_price_cents: null })
  })
  it('compara instantes, no textos', () => {
    const body = eventBody(draftOf({ ...saved, starts_at: '2026-12-12T10:00:00+01:00' }), now, false)!
    expect(eventPatch({ ...saved, starts_at: '2026-12-12T10:00:00+01:00' }, body)).toEqual({})
  })
  it('inicio, fin y lugar avisan; precio, público y cobertura no', () => {
    expect(notifiesOnPatch({ location: 'x' })).toBe(true)
    expect(notifiesOnPatch({ ends_at: 'x' })).toBe(true)
    expect(notifiesOnPatch({ price_cents: 100, audience: 'adults', requires_risk_cover: false, capacity: 5 })).toBe(false)
  })
})

describe('reembolsos', () => {
  it('solo se devuelve una pagada y confirmada', () => {
    expect(canRefund(reg({}))).toBe(true)
    expect(canRefund(reg({ status: 'pending' }))).toBe(false)
    expect(canRefund(reg({ amount_cents: 0 }))).toBe(false)
  })
  it('reintentar: cancelada con reembolso fallido, o cancelada por la academia sin devolver', () => {
    const c = { status: 'cancelled' as const, cancel_reason: 'admin' as const }
    expect(canRetryRefund(reg({ ...c, refund_status: 'failed' }))).toBe(true)
    expect(canRetryRefund(reg({ ...c, refund_status: null }))).toBe(true)
    expect(canRetryRefund(reg({ ...c, refund_status: 'requested' }))).toBe(false)
    expect(canRetryRefund(reg({ ...c, refund_status: 'refunded' }))).toBe(false)
    expect(canRetryRefund(reg({ status: 'confirmed', refund_status: 'failed' }))).toBe(false)
    expect(canRetryRefund(reg({ ...c, refund_status: null, guest: true, amount_cents: 0 }))).toBe(false)
    expect(canRetryRefund(reg({ status: 'cancelled', cancel_reason: 'checkout_expired', refund_status: null }))).toBe(false)
    expect(canRetryRefund(reg({ status: 'cancelled', cancel_reason: 'event_cancelled', refund_status: null }))).toBe(false)
  })
  it('cancelar el evento devuelve lo pagado de las confirmadas; las pendientes y gratis no suman', () => {
    const regs = [reg({ amount_cents: 1200 }), reg({ amount_cents: 800 }), reg({ status: 'pending', amount_cents: 1200 }), reg({ amount_cents: 0 }), reg({ status: 'cancelled' })]
    expect(cancelSummary(regs)).toEqual({ live: 4, paid: 2, cents: 2000 })
    expect(cancelSummary([])).toEqual({ live: 0, paid: 0, cents: 0 })
  })
  it('el aviso de éxito dice reembolsos, fallos y avisos', () => {
    expect(cancelResult({ refunded: 1, refund_failed: 0, notified: 3 })).toBe('1 reembolso · 3 avisos')
    expect(cancelResult({ refunded: 2, refund_failed: 1, notified: 1 })).toBe('2 reembolsos · 1 fallido (reintenta desde el detalle) · 1 aviso')
  })
})

describe('etiqueta del reembolso', () => {
  it('sin el importe del webhook (aún 0) no enseña 0 €', () => {
    expect(refundLabel({ refund_status: 'refunded', refunded_cents: 0 })).toBe('Devuelto')
    expect(refundLabel({ refund_status: 'refunded', refunded_cents: 1250 })).toContain('12,50')
    expect(refundLabel({ refund_status: null, refunded_cents: 0 })).toBeNull()
  })
})

describe('asistencia', () => {
  it('se abre al empezar, solo en un evento programado', () => {
    expect(attendanceOpen(saved, Date.parse(saved.starts_at) - 1)).toBe(false)
    expect(attendanceOpen(saved, Date.parse(saved.starts_at))).toBe(true)
    expect(attendanceOpen({ ...saved, status: 'cancelled' }, Date.parse(saved.starts_at) + 1)).toBe(false)
  })
})
