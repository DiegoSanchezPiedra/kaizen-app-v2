import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.fn()
vi.mock('@/lib/api', () => ({ api, ApiError: class {} }))

const { cardState, keyBytes, pushSupport, sameKey, showOnHome, syncPush } = await import('@/lib/push')

// Una clave VAPID de verdad (65 bytes en base64url) y otra distinta.
const KEY = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'
const OTHER = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM'

const base = { support: 'ok' as const, permission: 'default' as NotificationPermission, subscribed: false, busy: false, failed: false }

describe('estado de la tarjeta de avisos', () => {
  it('sin soporte o iOS sin instalar mandan sobre el permiso', () => {
    expect(cardState({ ...base, support: 'ios', permission: 'granted' })).toBe('ios')
    expect(cardState({ ...base, support: 'sin_soporte' })).toBe('sin_soporte')
  })
  it('pidiendo, denegado, activado, error y ofrecer', () => {
    expect(cardState({ ...base, busy: true })).toBe('pidiendo')
    expect(cardState({ ...base, permission: 'denied' })).toBe('denegado')
    expect(cardState({ ...base, permission: 'granted', subscribed: true })).toBe('activado')
    expect(cardState({ ...base, failed: true })).toBe('error')
    expect(cardState(base)).toBe('ofrecer')
  })
  it('con permiso pero sin suscripción vuelve a ofrecer (no se suscribe solo)', () => {
    expect(cardState({ ...base, permission: 'granted' })).toBe('ofrecer')
  })
})

describe('qué enseña Inicio', () => {
  const home = { dismissed: false, decidedNow: false }
  it('ofrece, espera, error e iOS salvo tras «Ahora no»', () => {
    for (const s of ['ofrecer', 'pidiendo', 'error', 'ios'] as const) {
      expect(showOnHome(s, home)).toBe(true)
      expect(showOnHome(s, { ...home, dismissed: true })).toBe(false)
    }
  })
  it('activado y denegado solo en la visita en que se decide; sin soporte nunca', () => {
    expect(showOnHome('activado', home)).toBe(false)
    expect(showOnHome('denegado', home)).toBe(false)
    expect(showOnHome('activado', { ...home, decidedNow: true })).toBe(true)
    expect(showOnHome('denegado', { ...home, decidedNow: true })).toBe(true)
    expect(showOnHome('sin_soporte', home)).toBe(false)
  })
})

describe('soporte', () => {
  const nav = (ua: string, extra = {}) => ({ userAgent: ua, platform: 'iPhone', maxTouchPoints: 5, ...extra }) as unknown as Navigator
  const win = (standalone: boolean, apis = false) =>
    ({ matchMedia: () => ({ matches: standalone }), ...(apis ? { PushManager: 1, Notification: 1 } : {}) }) as unknown as typeof globalThis
  it('iPhone en Safari sin instalar → ios; instalado sin APIs → sin_soporte', () => {
    expect(pushSupport(nav('iPhone'), win(false))).toBe('ios')
    expect(pushSupport(nav('iPhone'), win(true))).toBe('sin_soporte')
  })
  it('iPad que se presenta como Mac → ios', () => {
    expect(pushSupport(nav('Macintosh', { platform: 'MacIntel' }), win(false))).toBe('ios')
  })
  it('con serviceWorker, PushManager y Notification → ok', () => {
    expect(pushSupport(nav('Android', { serviceWorker: {} }), win(false, true))).toBe('ok')
  })
})

describe('clave VAPID', () => {
  it('decodifica base64url a los 65 bytes del punto P-256', () => {
    expect(keyBytes(KEY)).toHaveLength(65)
    expect(keyBytes(KEY)[0]).toBe(4)
  })
  it('compara la applicationServerKey de la suscripción con la de la API', () => {
    expect(sameKey(keyBytes(KEY).buffer, KEY)).toBe(true)
    expect(sameKey(keyBytes(OTHER).buffer, KEY)).toBe(false)
    expect(sameKey(null, KEY)).toBe(false)
  })
})

describe('resincronizar al abrir', () => {
  const calls: string[] = []
  const sub = (key: string, endpoint: string) => ({
    options: { applicationServerKey: keyBytes(key).buffer },
    toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: async () => void calls.push(`unsubscribe ${endpoint}`),
  })
  const pm = (current: ReturnType<typeof sub> | null) =>
    ({
      getSubscription: async () => current,
      subscribe: async (o: { applicationServerKey: Uint8Array }) => {
        calls.push(`subscribe ${o.applicationServerKey.length}`)
        return sub(KEY, 'https://push.example/nuevo')
      },
    }) as unknown as PushManager

  beforeEach(() => {
    calls.length = 0
    api.mockReset().mockImplementation(async (path: string, o: { method: string; body: unknown }) => {
      calls.push(`${o.method} ${path} ${JSON.stringify(o.body)}`)
    })
  })

  it('misma clave: solo reafirma con POST (sin expirationTime)', async () => {
    expect(await syncPush(pm(sub(KEY, 'https://push.example/1')), KEY)).toBe(true)
    expect(calls).toEqual(['POST /me/push-subscriptions {"endpoint":"https://push.example/1","keys":{"p256dh":"p","auth":"a"}}'])
  })
  it('otra clave: unsubscribe, subscribe con la de la API y POST del nuevo', async () => {
    expect(await syncPush(pm(sub(OTHER, 'https://push.example/1')), KEY)).toBe(true)
    expect(calls).toEqual([
      'unsubscribe https://push.example/1',
      'subscribe 65',
      'POST /me/push-subscriptions {"endpoint":"https://push.example/nuevo","keys":{"p256dh":"p","auth":"a"}}',
    ])
  })
  it('sin suscripción no suscribe sola ni llama a la API', async () => {
    expect(await syncPush(pm(null), KEY)).toBe(false)
    expect(calls).toEqual([])
  })
})
