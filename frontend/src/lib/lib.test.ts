import { describe, expect, it } from 'vitest'
import { errorText } from '@/lib/errors'
import { formatEuros, maskSpanishDate, parseSpanishDate } from '@/lib/format'
import { decode, isExpired, loginPath, safeReturnPath } from '@/lib/paths'

const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '')
const jwt = (payload: object) => `${b64({ alg: 'HS256' })}.${b64(payload)}.firma`

describe('fecha de nacimiento', () => {
  it('pasa dd/mm/aaaa a AAAA-MM-DD y rechaza fechas que no existen', () => {
    expect(parseSpanishDate('14/05/1998')).toBe('1998-05-14')
    expect(parseSpanishDate('2/3/2010')).toBe('2010-03-02')
    expect(parseSpanishDate('31/02/2000')).toBeNull()
    expect(parseSpanishDate('1998-05-14')).toBeNull()
  })
  it('pone las barras mientras se escribe', () => {
    expect(maskSpanishDate('14051998')).toBe('14/05/1998')
    expect(maskSpanishDate('140')).toBe('14/0')
  })
})

describe('importes', () => {
  it('céntimos a euros en español', () => {
    expect(formatEuros(4500).replace(/\s/g, ' ')).toBe('45,00 €')
  })
})

describe('sesión', () => {
  it('lee rol y caducidad del JWT y detecta el caducado', () => {
    const s = decode(jwt({ sub: 'p1', role: 'tutor', exp: 100 }))
    expect(s).toMatchObject({ id: 'p1', role: 'tutor', exp: 100 })
    expect(isExpired(s!, 99_000)).toBe(false)
    expect(isExpired(s!, 100_000)).toBe(true)
    expect(decode('basura')).toBeNull()
  })
  it('solo vuelve a rutas propias', () => {
    expect(safeReturnPath('/bookings?para=1')).toBe('/bookings?para=1')
    expect(safeReturnPath('//evil.example')).toBe('/')
    expect(safeReturnPath('https://evil.example')).toBe('/')
    expect(safeReturnPath(null)).toBe('/')
  })
  it('a /login según por qué terminó la sesión', () => {
    expect(loginPath('logout', '/account')).toBe('/login')
    expect(loginPath('expired', '/bookings')).toBe('/login?caducada=1&volver=%2Fbookings')
    expect(loginPath(null, '/billing')).toBe('/login?volver=%2Fbilling')
    expect(loginPath(null, '/')).toBe('/login')
  })
})

describe('errores', () => {
  it('texto por code, nunca el message de la API', () => {
    expect(errorText('link_required')).toBe('Ya hay una cuenta con ese email: entra con tu contraseña.')
    expect(errorText('algo_nuevo')).toBe('Algo ha fallado; inténtalo de nuevo.')
    expect(errorText('push_disabled')).toBe('')
  })
})
