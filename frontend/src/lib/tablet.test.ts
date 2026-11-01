import { describe, expect, it } from 'vitest'
import { backoffSeconds, createSseParser, normalizeLinkCode, sessionBadge, validUntil, viewOf, type Received } from '@/lib/tablet'

const feedMsg = 'event: feed\ndata: {"qr":"abc","expires_in":12,"sessions":[]}\n\n'

describe('lector del SSE', () => {
  it('lee un evento entero', () => {
    expect(createSseParser()(feedMsg)).toEqual([{ event: 'feed', data: { qr: 'abc', expires_in: 12, sessions: [] } }])
  })
  it('junta un evento partido entre trozos, incluso en mitad de una línea', () => {
    const parse = createSseParser()
    expect(parse('event: fe')).toEqual([])
    expect(parse('ed\ndata: {"qr":"a')).toEqual([])
    expect(parse('bc","expires_in":12,"sessions":[]}\n')).toEqual([])
    expect(parse('\n')).toHaveLength(1)
  })
  it('separa varios eventos en el mismo trozo y deja el resto para el siguiente', () => {
    const parse = createSseParser()
    const out = parse(`${feedMsg}event: revoked\ndata: {"code":"device_not_found"}\n\nevent: fe`)
    expect(out.map((e) => e.event)).toEqual(['feed', 'revoked'])
    expect(parse('ed\ndata: {}\n\n')).toEqual([{ event: 'feed', data: {} }])
  })
  it('entiende revoked y error con su code', () => {
    const parse = createSseParser()
    expect(parse('event: revoked\ndata: {"code":"device_not_found"}\n\n')).toEqual([
      { event: 'revoked', data: { code: 'device_not_found' } },
    ])
    expect(parse('event: error\ndata: {"code":"internal"}\n\n')).toEqual([{ event: 'error', data: { code: 'internal' } }])
  })
  it('acepta CRLF e ignora comentarios y datos que no son JSON', () => {
    const parse = createSseParser()
    expect(parse(': ping\r\n\r\nevent: feed\r\ndata: {"x":1}\r\n\r\n')).toEqual([{ event: 'feed', data: { x: 1 } }])
    expect(parse('event: feed\ndata: no-json\n\n')).toEqual([])
  })
})

describe('reconexión', () => {
  it('espera 1, 2, 4, 8, 16 y 30 s como máximo', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(backoffSeconds)).toEqual([1, 2, 4, 8, 16, 30, 30, 30])
  })
})

describe('qué se ve', () => {
  const feed = { qr: 'a', expires_in: 12, sessions: [] }
  const received: Received = { feed, at: 1_000_000, period: 30 }
  it('el QR vale expires_in más un periodo, que es lo que acepta el servidor', () => {
    expect(validUntil(received)).toBe(1_000_000 + 42_000)
  })
  it('conectando, en marcha, reconectando y en pausa', () => {
    const base = { online: true, received, down: false, now: 1_010_000 }
    expect(viewOf({ ...base, received: null })).toBe('connecting')
    expect(viewOf(base)).toBe('live')
    expect(viewOf({ ...base, down: true })).toBe('reconnecting')
    expect(viewOf({ ...base, now: 1_042_000 })).toBe('paused')
    expect(viewOf({ ...base, received: null, down: true })).toBe('paused')
  })
  it('sin internet se oculta el QR aunque no haya caducado', () => {
    expect(viewOf({ online: false, received, down: false, now: 1_001_000 })).toBe('offline')
  })
})

describe('textos de la pantalla', () => {
  it('el código de vinculación se limpia', () => {
    expect(normalizeLinkCode(' k7mp-q2xr ')).toBe('K7MPQ2XR')
  })
  it('la sesión dice cuánto falta o que ha empezado', () => {
    const now = Date.parse('2026-11-02T18:41:00Z')
    expect(sessionBadge('2026-11-02T19:00:00Z', now)).toEqual({ text: 'En 19 min', started: false })
    expect(sessionBadge('2026-11-02T18:35:00Z', now)).toEqual({ text: 'Ha empezado', started: true })
  })
})
