import { describe, expect, it } from 'vitest'
import {
  amountFor, audienceTag, audienceText, entryStart, eventHealthDay, eventWhen, isMember, isUpcomingRegistration, joinState, mergeByStart, priceView, spotsLabel,
  attendanceOpen, canRefund, canRetryRefund, cancelResult, cancelSummary, draftOf, emptyDraft, eventBody, eventPatch, notifiesOnPatch, refundLabel,
  type AdminEvent, type EventDraft, type EventInfo, type EventRegistration,
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

// ── B21.2: alumno, tutor y profesor ─────────────────────────────────────────

const { cancel_note: _note, ...rest } = saved
const ev = (o: Partial<EventInfo> = {}): EventInfo => ({ ...rest, registration: null, ...o })
const mine = (status: 'pending' | 'confirmed' | 'cancelled', amount_cents = 0) => ({ id: 'r1', status, amount_cents })
const before = Date.parse('2026-12-01T10:00:00Z') // antes del evento (12 dic)
const during = Date.parse('2026-12-12T10:00:00Z')
const ctx = { now: before, blocked: false, riskCover: true }

describe('importe que verá el sujeto', () => {
  const paid = ev({ price_cents: 2000, member_price_cents: 1200 })
  it('socio = suscripción active o past_due; unpaid, cancelada o sin cuota no', () => {
    expect(isMember({ status: 'active' })).toBe(true)
    expect(isMember({ status: 'past_due' })).toBe(true)
    expect(isMember({ status: 'unpaid' })).toBe(false)
    expect(isMember({ status: 'canceled' })).toBe(false)
    expect(isMember(null)).toBe(false)
  })
  it('el socio paga el precio de socio; el no socio, el precio', () => {
    expect(amountFor(paid, true)).toBe(1200)
    expect(amountFor(paid, false)).toBe(2000)
    expect(amountFor(ev({ price_cents: 2000 }), true)).toBe(2000)
    expect(amountFor(ev({ price_cents: 2000, member_price_cents: 0 }), true)).toBe(0)
  })
  it('lo que se enseña: el no socio ve el suyo y el de socio como nota; el socio, el suyo', () => {
    expect(priceView(paid, false)).toEqual({ main: expect.stringContaining('20'), note: expect.stringContaining('para socios') })
    expect(priceView(paid, undefined).note).toContain('para socios') // la cuota aún no ha cargado
    expect(priceView(paid, true)).toEqual({ main: expect.stringContaining('12'), note: 'Precio de socio' })
    expect(priceView(ev(), false)).toEqual({ main: 'Gratis', note: null })
    expect(priceView(ev({ price_cents: 2000, member_price_cents: 0 }), true).main).toBe('Gratis')
  })
  it('ya inscrito, se ve lo pagado aunque luego cambie el precio', () => {
    expect(priceView(ev({ price_cents: 3000, registration: mine('confirmed', 1200) }), false)).toEqual({ main: expect.stringContaining('12'), note: null })
  })
  it('una inscripción cancelada no fija el importe', () => {
    expect(priceView(ev({ price_cents: 2000, registration: mine('cancelled', 1200) }), false).main).toContain('20')
  })
})

describe('estado del botón de inscripción', () => {
  it('abierto: inscribirse', () => expect(joinState(ev(), ctx)).toBe('open'))
  it('completo con pendientes y confirmadas; con sitio, abierto', () => {
    expect(joinState(ev({ capacity: 10, taken: 10 }), ctx)).toBe('full')
    expect(joinState(ev({ capacity: 10, taken: 9 }), ctx)).toBe('open')
    expect(joinState(ev({ capacity: null, taken: 500 }), ctx)).toBe('open')
  })
  it('cerrado en la fecha límite o, sin ella, al inicio', () => {
    expect(joinState(ev({ registration_deadline: '2026-11-30T00:00:00Z' }), ctx)).toBe('closed')
    expect(joinState(ev(), { ...ctx, now: during })).toBe('closed')
    expect(joinState(ev({ registration_deadline: '2026-12-11T00:00:00Z' }), ctx)).toBe('open')
  })
  it('falta perfil o cobertura (solo si el evento la exige)', () => {
    expect(joinState(ev(), { ...ctx, blocked: true })).toBe('profile')
    expect(joinState(ev(), { ...ctx, riskCover: false })).toBe('cover')
    expect(joinState(ev({ requires_risk_cover: false }), { ...ctx, riskCover: false })).toBe('open')
    expect(joinState(ev(), { ...ctx, riskCover: undefined })).toBe('open') // aún sin cargar: lo decide el servidor
  })
  it('el perfil se mira antes que la cobertura; el público (tras audience_mismatch), antes que ambos', () => {
    expect(joinState(ev(), { ...ctx, blocked: true, riskCover: false })).toBe('profile')
    expect(joinState(ev(), { ...ctx, blocked: true, audienceBlocked: true })).toBe('audience')
  })
  it('completo o cerrado gana a los requisitos (no se pide nada que no sirva)', () => {
    expect(joinState(ev({ capacity: 1, taken: 1 }), { ...ctx, blocked: true })).toBe('full')
  })
  it('cancelar: gratis o pendiente sí; pagada, «pídelo a la academia»', () => {
    expect(joinState(ev({ registration: mine('confirmed', 0) }), ctx)).toBe('cancellable')
    expect(joinState(ev({ registration: mine('pending', 1200) }), ctx)).toBe('pending')
    expect(joinState(ev({ registration: mine('confirmed', 1200) }), ctx)).toBe('paid')
  })
  it('empezado el evento ya no se cancela (la pagada sigue siendo «pídelo a la academia»)', () => {
    expect(joinState(ev({ registration: mine('confirmed', 0) }), { ...ctx, now: during })).toBe('registered')
    expect(joinState(ev({ registration: mine('confirmed', 1200) }), { ...ctx, now: during })).toBe('paid')
  })
  it('tras cancelar se puede volver a inscribir; un evento cancelado no', () => {
    expect(joinState(ev({ registration: mine('cancelled', 1200) }), ctx)).toBe('open')
    expect(joinState(ev({ status: 'cancelled' }), ctx)).toBe('cancelled')
    expect(joinState(ev({ status: 'cancelled', registration: mine('confirmed') }), ctx)).toBe('cancelled')
  })
})

describe('público por edad, sin enseñar la edad', () => {
  it('solo se nombra el público del evento', () => {
    expect(audienceTag('all')).toBeNull()
    expect(audienceTag('minors')).toBe('Solo menores')
    expect(audienceTag('adults')).toBe('Solo adultos')
  })
  it('el texto de «no es para tu edad» no lleva cifras', () => {
    expect(audienceText()).toBe('Este evento no es para tu edad.')
    expect(audienceText('Pau')).toBe('Este evento no es para la edad de Pau.')
    expect(audienceText()).not.toMatch(/\d/)
  })
})

describe('plazas, fechas y listas', () => {
  it('plazas: sin aforo no se dice nada; lleno es «Completo»', () => {
    expect(spotsLabel({ capacity: null, taken: 3 })).toBeNull()
    expect(spotsLabel({ capacity: 10, taken: 10 })).toBe('Completo')
    expect(spotsLabel({ capacity: 10, taken: 9 })).toBe('Queda 1 plaza')
    expect(spotsLabel({ capacity: 10, taken: 4 })).toBe('Quedan 6 plazas')
  })
  it('cuándo: un día con horas; varios días con las dos fechas (Madrid)', () => {
    expect(eventWhen(saved)).toContain('10:00–14:00')
    expect(eventWhen({ starts_at: '2026-12-12T09:00:00Z', ends_at: '2026-12-13T17:00:00Z' })).toMatch(/12 dic a las 10:00 – 13 dic a las 18:00/)
  })
  it('Reservas e Inicio enseñan inscripciones vivas de eventos sin terminar', () => {
    expect(isUpcomingRegistration(ev({ registration: mine('confirmed') }), before)).toBe(true)
    expect(isUpcomingRegistration(ev({ registration: mine('pending', 500) }), before)).toBe(true)
    expect(isUpcomingRegistration(ev({ registration: mine('cancelled') }), before)).toBe(false)
    expect(isUpcomingRegistration(ev(), before)).toBe(false)
    expect(isUpcomingRegistration(ev({ registration: mine('confirmed') }), Date.parse('2026-12-13T00:00:00Z'))).toBe(false)
    expect(isUpcomingRegistration(ev({ status: 'cancelled', registration: mine('confirmed') }), before)).toBe(false)
  })
  it('fichas de salud: cualquier día del evento, en Madrid, y si no está cancelado', () => {
    const multi = ev({ starts_at: '2026-12-12T09:00:00Z', ends_at: '2026-12-13T17:00:00Z' })
    expect(eventHealthDay(multi, Date.parse('2026-12-11T22:30:00Z'))).toBe(false) // 23:30 del 11 en Madrid
    expect(eventHealthDay(multi, Date.parse('2026-12-11T23:30:00Z'))).toBe(true) // 00:30 del 12
    expect(eventHealthDay(multi, Date.parse('2026-12-13T22:30:00Z'))).toBe(true) // 23:30 del 13
    expect(eventHealthDay(multi, Date.parse('2026-12-13T23:30:00Z'))).toBe(false) // 00:30 del 14
    expect(eventHealthDay({ ...multi, status: 'cancelled' }, during)).toBe(false)
  })
  it('profesor: sesiones y eventos mezclados por inicio; a igual hora, la sesión primero', () => {
    const s = (id: string, starts_at: string) => ({ id, starts_at })
    const merged = mergeByStart([s('a', '2026-12-12T08:00:00Z'), s('b', '2026-12-12T09:00:00Z')], [ev({ id: 'e', starts_at: '2026-12-12T09:00:00Z' })])
    expect(merged.map((m) => (m.kind === 'session' ? m.s.id : m.e.id))).toEqual(['a', 'b', 'e'])
    expect(entryStart(merged[2])).toBe(Date.parse('2026-12-12T09:00:00Z'))
  })
})
