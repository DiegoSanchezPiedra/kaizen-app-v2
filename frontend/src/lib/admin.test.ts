import { describe, expect, it } from 'vitest'
import {
  ageMarks,
  auditDetail,
  auditLabel,
  auditTarget,
  canCancelPayerChange,
  canChangeRole,
  categoryPrefixes,
  deliveryLabel,
  hasData,
  latestStat,
  nowFocus,
  trend,
  variation,
  type HomeSession,
  noticeClock,
  noticeEvent,
  noticeLabel,
  pageHref,
  pageOf,
  payerCandidates,
  safeInvoiceUrl,
  showMfaNotice, type DayStat, type ProfileFile,
  hasFilters, lastSeen, profilesQuery, setFilter, toggleEstado, userFilters } from '@/lib/admin'
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
  it('el profesor no entra en las pantallas que actúan por un alumno (la API le da 403): a lo suyo', () => {
    for (const p of ['/calendar', '/bookings', '/progress', '/account/health', '/agreements', '/billing/plan', '/events/5']) {
      expect(redirectFor('profesor', p)).toBe('/professor')
    }
    for (const p of ['/profiles', '/rankings', '/account', '/account/profile', '/professor/sessions/1']) {
      expect(redirectFor('profesor', p)).toBeNull()
    }
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
  trained: 3,
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

describe('hasData', () => {
  it('«entrenaron» llega siempre: no basta para decir que hay foto', () => {
    expect(hasData(day('2026-10-31', null))).toBe(false)
    expect(hasData(day('2026-10-31', 0))).toBe(true)
  })
})

describe('avisos de la academia', () => {
  it('uno conocido en español; uno desconocido, tal cual', () => {
    expect(noticeLabel('notice.payer_change_expired')).toBe('Un cambio de pagador ha caducado')
    expect(noticeLabel('notice.algo_nuevo')).toBe('notice.algo_nuevo')
  })
})

describe('usuarios del panel (B19.3)', () => {
  const adult = { id: 'a', display_name: 'Ana', email: 'ana@x.es', role: 'alumno' as const, is_minor: false, pending_claim: false, created_at: '', is_public: false, has_password: true, has_google: false, can_create_children: false }
  const child = { ...adult, id: 'h', display_name: 'Hijo', email: null, is_minor: true, has_password: false }
  const tutor = { id: 't', display_name: 'Tutora', email: 't@x.es' }
  const file = (profile: typeof adult | typeof child, payer?: string) =>
    ({ profile, status: null, guardians: profile.email ? [] : [tutor, { id: 't2', display_name: 'Otro', email: 'o@x.es' }], children: [], subscription: payer ? { payer: { id: payer, display_name: '' } } : null }) as unknown as ProfileFile

  it('el rol no se cambia a un admin ni a un hijo', () => {
    expect(canChangeRole(adult)).toBe(true)
    expect(canChangeRole({ ...adult, role: 'admin' })).toBe(false)
    expect(canChangeRole(child)).toBe(false)
  })
  it('de la edad, solo las marcas', () => {
    expect(ageMarks(adult)).toEqual([])
    expect(ageMarks(child)).toEqual(['Menor'])
    expect(ageMarks({ is_minor: false, pending_claim: true })).toEqual(['Mayor de edad sin reclamar'])
  })
  it('pagador: el adulto a sí mismo; el hijo, sus tutores; nunca el actual', () => {
    expect(payerCandidates(file(adult, 'x')).map((p) => p.id)).toEqual(['a'])
    expect(payerCandidates(file(adult, 'a'))).toEqual([])
    expect(payerCandidates(file(child, 't')).map((p) => p.id)).toEqual(['t2'])
    // Mayor de edad sin reclamar: sin acceso propio, no se paga a sí mismo.
    expect(payerCandidates(file({ ...child, is_minor: false, pending_claim: true }, 't')).map((p) => p.id)).toEqual(['t2'])
  })
})

describe('auditoría, avisos y cobros (B19.4)', () => {
  it('la categoría se convierte en prefijos de action; una desconocida no filtra', () => {
    expect(categoryPrefixes('sessions')).toBe('session.,class.')
    expect(categoryPrefixes('nope')).toBeUndefined()
    expect(categoryPrefixes(null)).toBeUndefined()
  })
  it('una acción desconocida sale tal cual; las conocidas, en español', () => {
    expect(auditLabel('attendance.close')).toBe('Cerró la lista')
    expect(auditLabel('foo.bar')).toBe('foo.bar')
    expect(noticeLabel('notice.otra')).toBe('notice.otra')
    expect(deliveryLabel('notice.payment_failed')).toBe('Cobro fallido')
    expect(deliveryLabel('notice.otra')).toBe('notice.otra')
  })
  it('el detalle: corrección, rol y precio; de la salud, nada', () => {
    expect(auditDetail({ action: 'attendance.correct', changes: { from: 'absent', to: 'present', reason: 'llegó tarde' } })).toBe('ausente → presente · llegó tarde')
    expect(auditDetail({ action: 'profile.role_change', changes: { from: 'alumno', to: 'profesor' } })).toBe('Alumno → Profesor')
    expect(auditDetail({ action: 'plan.price_change', changes: { from: 4500, to: 5000 } })).toBe('45 € → 50 €')
    expect(auditDetail({ action: 'health.view', changes: { student_ids: ['x'] } })).toBe('')
    expect(auditDetail({ action: 'class.create', changes: null })).toBe('')
  })
  it('el recurso: ficha, sesión o texto sin enlace', () => {
    expect(auditTarget({ resource_type: 'guardian', resource_id: 'u1' }).to).toBe('/admin/users/u1')
    expect(auditTarget({ resource_type: 'session', resource_id: '7' }).to).toBe('/admin/sessions/7')
    expect(auditTarget({ resource_type: 'plan', resource_id: '2' })).toEqual({ to: null, label: 'Plan' })
  })
  it('un alta: «Contrató una cuota» y enlace a la ficha del alumno, no del pagador', () => {
    expect(auditLabel('subscription.create')).toBe('Contrató una cuota')
    const alta = { resource_type: 'subscription', resource_id: 's1', changes: { student_id: 'kid', payer_id: 'tutor' } }
    expect(auditTarget(alta)).toEqual({ to: '/admin/users/kid', label: 'Ficha' })
    expect(auditTarget({ ...alta, changes: {} })).toEqual({ to: null, label: 'Suscripción' })
  })
  it('la pausa: etiquetas, categoría Cobros y motivo de la exención', () => {
    for (const a of ['subscription.pause', 'subscription.pause_cancel', 'subscription.pause_end_early', 'pause.exempt', 'settings.pause']) expect(auditLabel(a)).not.toBe(a)
    expect(categoryPrefixes('billing')).toContain('pause.')
    expect(auditDetail({ action: 'pause.exempt', changes: { reason: 'Lesión', subscription_id: 's' } })).toBe('Lesión')
    expect(auditTarget({ resource_type: 'pause', resource_id: 'p' })).toEqual({ to: null, label: 'Pausa' })
  })
  it('solo se anula un cambio de pagador sin pagar', () => {
    expect(canCancelPayerChange({ status: 'requested' })).toBe(true)
    expect(canCancelPayerChange({ status: 'paid' })).toBe(false)
    expect(canCancelPayerChange({ status: 'expired' })).toBe(false)
  })
  it('el enlace del recibo solo se abre si es https', () => {
    expect(safeInvoiceUrl('https://invoice.stripe.com/i/x')).toBe('https://invoice.stripe.com/i/x')
    expect(safeInvoiceUrl('javascript:alert(1)')).toBeNull()
    expect(safeInvoiceUrl(null)).toBeNull()
  })
  it('la página vive en la URL y conserva los filtros', () => {
    expect(pageOf(new URLSearchParams('page=3'))).toBe(3)
    expect(pageOf(new URLSearchParams('page=0'))).toBe(1)
    expect(pageOf(new URLSearchParams('page=x'))).toBe(1)
    expect(pageHref(new URLSearchParams('tab=grace&page=2'), 3)).toBe('?tab=grace&page=3')
    expect(pageHref(new URLSearchParams('tab=grace&page=2'), 1)).toBe('?tab=grace')
  })
})

describe('eventos en avisos y auditoría', () => {
  it('etiquetas y detalle de event.* y event_registration.*', () => {
    expect(auditLabel('event.cancel')).toBe('Canceló un evento')
    expect(auditLabel('event_registration.guest')).toBe('Inscribió a un invitado')
    expect(auditDetail({ action: 'event.update', changes: { from: { price_cents: 1 }, to: { location: 'x', price_cents: 1000 } } })).toBe('lugar, precio')
    expect(auditDetail({ action: 'event.cancel', changes: { note: 'lluvia', registrations: 2 } })).toBe('lluvia · 2 inscripciones')
    expect(auditDetail({ action: 'event_registration.cancel', changes: { from: 'confirmed', refund: true } })).toBe('Con reembolso')
    expect(auditDetail({ action: 'event_registration.refund', changes: { amount_cents: 1250 } })).toContain('12,50')
    expect(auditTarget({ resource_type: 'event', resource_id: 'e1' }).to).toBe('/admin/events/e1')
  })
  it('el aviso de reembolso fallido tiene texto y enlaza al evento', () => {
    const n = { id: '1', created_at: '', action: 'notice.event_refund_failed', resource_type: 'event_registration', resource_id: 'r', details: { event_id: 'e1' } }
    expect(noticeLabel(n.action)).toContain('reembolso')
    expect(noticeEvent(n)).toBe('e1')
  })
})

describe('Usuarios: filtros en la URL y última asistencia (B22.3)', () => {
  const url = (s: string) => new URLSearchParams(s)
  it('lee los filtros válidos e ignora los que la API rechazaría', () => {
    expect(userFilters(url('q=ana&role=tutor&discipline=3&plan=7&estado=impago&page=2'))).toEqual({
      q: 'ana', role: 'tutor', discipline: '3', plan: '7', estado: 'impago', page: 2,
    })
    expect(userFilters(url('role=jefe&discipline=x&plan=-1&estado=prueba&page=0'))).toEqual({
      q: '', role: null, discipline: null, plan: null, estado: null, page: 1,
    })
  })
  it('ida y vuelta: lo que se pone se vuelve a leer igual y la página vuelve a la 1', () => {
    let p = url('page=3')
    p = setFilter(p, 'discipline', '3')
    p = setFilter(p, 'plan', '7')
    p = setFilter(p, 'estado', 'inactivo')
    expect(userFilters(p)).toMatchObject({ discipline: '3', plan: '7', estado: 'inactivo', page: 1 })
    expect(p.has('page')).toBe(false)
    expect(userFilters(setFilter(p, 'plan', 'all')).plan).toBeNull()
    expect(profilesQuery(userFilters(url('discipline=3&estado=activo&page=2')), 25)).toEqual({
      q: undefined, role: undefined, discipline_id: '3', plan_id: undefined, estado: 'activo', limit: '25', offset: '25',
    })
  })
  it('una tarjeta pone su estado y, pulsada otra vez, lo quita', () => {
    const on = toggleEstado(url('discipline=3'), 'impago')
    expect(on.get('estado')).toBe('impago')
    expect(toggleEstado(on, 'activo').get('estado')).toBe('activo')
    const off = toggleEstado(on, 'impago')
    expect(off.has('estado')).toBe(false)
    expect(off.get('discipline')).toBe('3')
    expect(hasFilters(userFilters(off))).toBe(true)
    expect(hasFilters(userFilters(url('page=2')))).toBe(false)
  })
  it('última asistencia en relativo, por días de Madrid', () => {
    const now = new Date('2026-11-06T10:00:00Z')
    expect(lastSeen(null, now)).toBe('—')
    expect(lastSeen('2026-11-06T08:00:00Z', now)).toBe('hoy')
    expect(lastSeen('2026-11-05T22:30:00Z', now)).toBe('ayer') // 23:30 del 5 en Madrid
    expect(lastSeen('2026-11-05T23:30:00Z', now)).toBe('hoy') // 00:30 del 6 en Madrid
    expect(lastSeen('2026-11-03T18:00:00Z', now)).toBe('hace 3 días')
    expect(lastSeen('2026-08-01T18:00:00Z', now)).toBe('hace 3 meses')
    expect(lastSeen('2024-10-01T18:00:00Z', now)).toBe('hace 2 años')
  })
})

describe('Inicio en vivo (B23)', () => {
  const at = (id: string, from: string, to: string, status: 'scheduled' | 'cancelled' = 'scheduled'): HomeSession => ({
    id, starts_at: `2026-11-06T${from}:00Z`, ends_at: `2026-11-06T${to}:00Z`, discipline: { id: 1, name: 'BJJ' }, trainer: null, location: null, capacity: 10, status, booked: 0, present: 0,
  })
  const now = Date.parse('2026-11-06T18:30:00Z')
  const next = at('n', '09:00', '10:00')

  it('«Ahora»: las sesiones en curso, todas', () => {
    expect(nowFocus([at('a', '17:00', '19:00'), at('b', '18:00', '19:30'), at('c', '20:00', '21:00')], next, now)).toMatchObject({ kind: 'now', sessions: [{ id: 'a' }, { id: 'b' }] })
  })
  it('sin ninguna en curso, la próxima de hoy; las canceladas no cuentan', () => {
    const r = nowFocus([at('x', '19:00', '20:00', 'cancelled'), at('c', '21:00', '22:00'), at('b', '20:00', '21:00')], next, now)
    expect(r).toMatchObject({ kind: 'upcoming', sessions: [{ id: 'b' }] })
  })
  it('sin más hoy, la de otro día; sin nada, null', () => {
    expect(nowFocus([at('a', '10:00', '11:00')], next, now)).toMatchObject({ kind: 'next', sessions: [{ id: 'n' }] })
    expect(nowFocus([], null, now)).toBeNull()
  })
  it('variación de asistencias: sin base no hay porcentaje', () => {
    expect(variation(37, 33)).toBe(12)
    expect(variation(5, 10)).toBe(-50)
    expect(variation(5, 0)).toBeNull()
  })
  it('tendencia de 30 días: huecos fuera, y con una sola foto no hay diferencia', () => {
    const rows = [day('2026-10-01', 100), day('2026-10-02', null), day('2026-10-03', 106)]
    expect(trend(rows, 'active')).toBe(6)
    expect(trend([day('2026-10-01', 100)], 'active')).toBeNull()
    expect(trend([day('2026-10-01', null)], 'active')).toBeNull()
  })
})

describe('avisos del registro de jornada (B31)', () => {
  const n = (action: string, details: Record<string, unknown>) => ({ id: '1', created_at: '', action, resource_type: 'clock_event', resource_id: '1', details })
  it('abren la jornada del profesor, y solo los de jornada', () => {
    expect(noticeClock(n('notice.clock_open', { profile_id: 'p1' }))).toBe('p1')
    expect(noticeClock(n('notice.clock_correction_requested', { profile_id: 'p2' }))).toBe('p2')
    expect(noticeClock(n('notice.stripe_risk', { profile_id: 'p3' }))).toBeNull()
    expect(noticeClock(n('notice.clock_open', {}))).toBeNull()
  })
  it('tienen texto en español', () => {
    expect(noticeLabel('notice.clock_open')).not.toBe('notice.clock_open')
    expect(deliveryLabel('notice.clock_correction_rejected')).not.toBe('notice.clock_correction_rejected')
  })
})
