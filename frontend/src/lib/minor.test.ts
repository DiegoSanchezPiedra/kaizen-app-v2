import { describe, expect, it } from 'vitest'
import { onboardingSteps } from '@/lib/profile'
import { MISSING_TEXT } from '@/lib/notices'
import { bookBlock, isUsername, joinBlock, minorView, redirectForMinor } from '@/lib/minor'

const can = { can_book: true, can_publish: false }
const noBook = { can_book: false, can_publish: true }

describe('menú y tarjetas de un menor con acceso propio', () => {
  it('un adulto (o aún sin cargar /me) lo ve todo', () => {
    for (const m of [null, undefined]) {
      expect(minorView(m)).toEqual({ isMinor: false, billing: true, agreements: true, health: true, children: true, ownData: true, publicProfile: true })
    }
  })
  it('un menor no ve cuota, acuerdos, salud, hijos ni la edición de su nombre', () => {
    expect(minorView(can)).toMatchObject({ isMinor: true, billing: false, agreements: false, health: false, children: false, ownData: false })
  })
  it('el perfil público solo con can_publish (la edad la decide el servidor)', () => {
    expect(minorView(can).publicProfile).toBe(false)
    expect(minorView(noBook).publicProfile).toBe(true)
  })
})

describe('reservar e inscribirse', () => {
  it('sin permiso de reservar, el motivo en lugar de la acción', () => {
    expect(bookBlock(noBook)).toBe('Tu tutor no te ha dado permiso para reservar')
    expect(bookBlock(can)).toBeNull()
    expect(bookBlock(null)).toBeNull()
  })
  it('un evento de pago lo inscribe el tutor, aunque pueda reservar', () => {
    expect(joinBlock(can, 0)).toBeNull()
    expect(joinBlock(can, 1500)).toMatch(/tutor/)
    expect(joinBlock(noBook, 0)).toBe(bookBlock(noBook))
    expect(joinBlock(null, 1500)).toBeNull()
  })
})

describe('hoja de acceso propio', () => {
  it('un usuario no lleva @', () => {
    expect(isUsername('hugo')).toBe(true)
    expect(isUsername('  hugo ')).toBe(true)
    expect(isUsername('hugo@kaizen.test')).toBe(false)
    expect(isUsername('  ')).toBe(false)
  })
})

describe('rutas directas de un menor', () => {
  it('cuota, acuerdos, salud, mis datos y mis hijos llevan a Inicio', () => {
    for (const p of ['/billing', '/billing/plans/3', '/billing/success', '/agreements', '/account/health', '/account/data', '/account/children', '/account/children/abc']) {
      expect(redirectForMinor(noBook, p)).toBe('/')
    }
  })
  it('lo demás, y un adulto o /me sin cargar, no se tocan', () => {
    for (const p of ['/', '/calendar', '/bookings', '/progress', '/account', '/account/password', '/account/profile', '/events/1', '/profiles']) {
      expect(redirectForMinor(can, p)).toBeNull()
    }
    expect(redirectForMinor(null, '/billing')).toBeNull()
    expect(redirectForMinor(undefined, '/account/children')).toBeNull()
  })
})

describe('a los 18, el email que falta', () => {
  it('completar perfil pide el paso de datos y lo nombra', () => {
    expect(onboardingSteps(['email'], false)).toEqual(['datos'])
    expect(onboardingSteps(['health_info', 'email'], false)).toEqual(['datos', 'ficha'])
    expect(MISSING_TEXT.email).toBe('tu email')
  })
})
