import { describe, expect, it } from 'vitest'
import { errorText } from '@/lib/errors'
import { formatDate, formatEuros, formatTime, maskSpanishDate, parseSpanishDate } from '@/lib/format'
import { decode, isExpired, loginPath, safeReturnPath } from '@/lib/paths'
import { cropRect, initials } from '@/lib/avatar'
import { activeSubject, subjectOptions, usesSubject } from '@/lib/subject'

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

describe('fechas en Madrid', () => {
  it('una sesión a las 23:30 del 31 sale a las 23:30 del 31 con el proceso en UTC', () => {
    // npm test corre con TZ=UTC, como un móvil fuera de España.
    expect(new Date().getTimezoneOffset()).toBe(0)
    // 22:30 UTC = 23:30 en Madrid (invierno); en UTC un formato ingenuo daría 22:30.
    expect(formatTime('2026-12-31T22:30:00Z')).toBe('23:30')
    expect(formatDate('2026-12-31T22:30:00Z')).toBe('jueves, 31 de diciembre')
    // En verano (UTC+2) y cruzando la medianoche: 23:30 UTC del 31 ya es el 1 en Madrid.
    expect(formatTime('2026-07-31T21:30:00Z')).toBe('23:30')
    expect(formatDate('2026-12-31T23:30:00Z')).toBe('viernes, 1 de enero')
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
  it('rellena {clave} con los datos del error (pause_year_limit trae per_year)', () => {
    expect(errorText('pause_year_limit', { per_year: 2 })).toBe('Ya se ha usado el máximo de pausas de este año (2).')
    expect(errorText('pause_year_limit')).toBe('Ya se ha usado el máximo de pausas de este año.')
    expect(errorText('paused')).toBe('No se puede durante la pausa de la membresía.')
  })
})

describe('selector de sujeto', () => {
  const kids = [
    { id: 'h1', display_name: 'Ana', birth_date: '2015-01-01', pending_claim: false },
    { id: 'h2', display_name: 'Luis', birth_date: '2007-01-01', pending_claim: true },
    { id: 'h3', display_name: 'Eva', birth_date: '2017-01-01', pending_claim: false },
  ]
  it('un tutor elige entre sus hijos; un alumno con hijos, él y ellos; nunca un pending_claim', () => {
    expect(subjectOptions('tutor', 't1', null, kids).map((o) => o.id)).toEqual(['h1', 'h3'])
    expect(subjectOptions('alumno', 'a1', '2001-05-01', kids).map((o) => o.id)).toEqual(['a1', 'h1', 'h3'])
    expect(subjectOptions('alumno', 'a1', null, [])).toEqual([])
    expect(subjectOptions('alumno', 'a1', null, [kids[1]])).toEqual([])
    expect(subjectOptions('profesor', 'p1', null, kids)).toEqual([])
  })
  it('cada sujeto lleva su fecha de nacimiento (la de la disciplina la mira billing)', () => {
    const o = subjectOptions('alumno', 'a1', '2001-05-01', kids)
    expect(o.map((s) => s.birth_date)).toEqual(['2001-05-01', '2015-01-01', '2017-01-01'])
  })
  it('un ?para= que no está en la lista cae en el sujeto por defecto', () => {
    const alumno = subjectOptions('alumno', 'a1', null, kids)
    expect(activeSubject(alumno, 'h3')?.id).toBe('h3')
    expect(activeSubject(alumno, 'h2')?.id).toBe('a1')
    expect(activeSubject(alumno, 'ajeno')?.id).toBe('a1')
    expect(activeSubject(subjectOptions('tutor', 't1', null, kids), null)?.id).toBe('h1')
    expect(activeSubject([], 'h1')).toBeNull()
  })
  it('sale en las pantallas por sujeto, no en el check-in', () => {
    expect(usesSubject('/')).toBe(true)
    expect(usesSubject('/bookings')).toBe(true)
    expect(usesSubject('/billing/plan')).toBe(true)
    expect(usesSubject('/billing/success')).toBe(false)
    expect(usesSubject('/billing/payer-changes/x')).toBe(false)
    expect(usesSubject('/checkin')).toBe(false)
    expect(usesSubject('/bookingsx')).toBe(false)
  })
})

describe('foto de perfil', () => {
  it('iniciales: primera y última palabra, o un punto sin nombre', () => {
    expect(initials('Ana García Pérez')).toBe('AP')
    expect(initials('  ana ')).toBe('A')
    expect(initials(null)).toBe('·')
  })
  it('recorte: el cuadrado no se sale de la imagen', () => {
    expect(cropRect(400, 200, 1, 0, 0)).toEqual({ sx: 0, sy: 0, size: 200 })
    expect(cropRect(400, 200, 2, 400, 200)).toEqual({ sx: 300, sy: 100, size: 100 })
    expect(cropRect(400, 200, 1, 200, 100).sx).toBe(100)
  })
})
