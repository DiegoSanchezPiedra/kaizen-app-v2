import { describe, expect, it } from 'vitest'
import { latestStat, noticeLabel, showMfaNotice, type DayStat } from '@/lib/admin'
import { loginPath, redirectFor } from '@/lib/paths'

describe('a dónde va cada rol (B19)', () => {
  it('el admin, siempre dentro de /admin', () => {
    expect(redirectFor('admin', '/')).toBe('/admin')
    expect(redirectFor('admin', '/calendar')).toBe('/admin')
    expect(redirectFor('admin', '/administrar')).toBe('/admin')
    expect(redirectFor('admin', '/admin')).toBeNull()
    expect(redirectFor('admin', '/admin/reports')).toBeNull()
  })
  it('el resto, fuera de /admin; el profesor empieza en lo suyo', () => {
    for (const role of ['alumno', 'tutor', 'profesor'] as const) {
      expect(redirectFor(role, '/admin')).toBe('/')
      expect(redirectFor(role, '/admin/users/1')).toBe('/')
    }
    expect(redirectFor('alumno', '/')).toBeNull()
    expect(redirectFor('tutor', '/calendar')).toBeNull()
    expect(redirectFor('profesor', '/')).toBe('/professor')
    expect(redirectFor('profesor', '/professor/reports')).toBeNull()
  })
  it('con el acceso cambiado, a /login con su motivo y sin volver a la ruta del rol viejo', () => {
    expect(loginPath('role_changed', '/admin/reports')).toBe('/login?acceso=1')
  })
})

describe('aviso del MFA (ADR 0016)', () => {
  const me = (mfa_enabled: boolean) => ({ user: { id: '1', role: 'admin' }, mfa_enabled })
  it('sale solo si GET /auth/me dice que no está activo', () => {
    expect(showMfaNotice(me(false))).toBe(true)
    expect(showMfaNotice(me(true))).toBe(false)
  })
  it('mientras carga, no', () => {
    expect(showMfaNotice(undefined)).toBe(false)
  })
})

const day = (date: string, active: number | null): DayStat => ({
  date,
  active,
  past_due: active === null ? null : 1,
  unpaid: active === null ? null : 0,
  new_subscriptions: active === null ? null : 0,
  cancelled_subscriptions: active === null ? null : 0,
  mrr_cents: active === null ? null : active * 5000,
})

describe('cifras de Inicio: la última foto no nula', () => {
  const today = '2026-11-01'
  it('con la foto de ayer', () => {
    expect(latestStat([day('2026-10-30', 9), day('2026-10-31', 10)], today)).toEqual({ row: day('2026-10-31', 10), stale: false })
  })
  it('sin dato de ayer: la última con dato, marcada', () => {
    const r = latestStat([day('2026-10-29', 8), day('2026-10-30', null), day('2026-10-31', null)], today)
    expect(r).toEqual({ row: day('2026-10-29', 8), stale: true })
  })
  it('un hueco en medio no cuenta como cero', () => {
    expect(latestStat([day('2026-10-29', null), day('2026-10-30', 0), day('2026-10-31', null)], today)?.row.active).toBe(0)
  })
  it('sin ninguna foto, null', () => {
    expect(latestStat([day('2026-10-31', null)], today)).toBeNull()
    expect(latestStat([], today)).toBeNull()
  })
})

describe('avisos de la academia', () => {
  it('uno conocido en español; uno desconocido, tal cual', () => {
    expect(noticeLabel('notice.payer_change_expired')).toBe('Un cambio de pagador ha caducado')
    expect(noticeLabel('notice.algo_nuevo')).toBe('notice.algo_nuevo')
  })
})
