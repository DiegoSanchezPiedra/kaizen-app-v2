import { describe, expect, it } from 'vitest'
import { accountBadges } from '@/lib/notices'
import type { Subscription } from '@/lib/types'

const sub = (status: string) => ({ id: 's1', status, plan: { id: 1, name: 'Plan', price_cents: 3500, max_disciplines: 2 }, disciplines: [], current_period_end: null }) as Subscription

describe('insignias de las filas de Cuenta', () => {
  it('todo en orden: ninguna', () => {
    expect(accountBadges({ status: { ok: true }, subscription: sub('active'), self: { ok: true } })).toEqual({})
    expect(accountBadges({})).toEqual({})
  })
  it('ficha de salud incompleta por la ficha o por el contacto de emergencia', () => {
    for (const m of ['health_info', 'emergency_contact']) {
      expect(accountBadges({ status: { ok: false, missing: [m] } })).toEqual({ health: { variant: 'warning', label: 'Incompleta' } })
    }
  })
  it('acuerdos sin firmar, del sujeto o del propio tutor', () => {
    const w = { agreements: { variant: 'warning', label: 'Falta firmar' } }
    expect(accountBadges({ status: { ok: false, missing: ['data_protection'] } })).toEqual(w)
    expect(accountBadges({ status: { ok: false, missing: ['rights_of_image'] } })).toEqual(w)
    expect(accountBadges({ status: { ok: true }, self: { ok: false, missing: ['data_protection'] } })).toEqual(w)
    // lo que falte al tutor aparte de la protección de datos no cuenta
    expect(accountBadges({ self: { ok: false, missing: ['rights_of_image'] } })).toEqual({})
  })
  it('cuota: impagada, cobro pendiente, sin cuota; sin cargar, nada', () => {
    expect(accountBadges({ subscription: sub('unpaid') }).billing).toEqual({ variant: 'error', label: 'Impagada' })
    for (const s of ['past_due', 'grace_period']) expect(accountBadges({ subscription: sub(s) }).billing).toEqual({ variant: 'warning', label: 'Cobro pendiente' })
    expect(accountBadges({ subscription: null }).billing).toEqual({ variant: 'info', label: 'Sin cuota' })
    expect(accountBadges({ subscription: undefined })).toEqual({})
  })
})
