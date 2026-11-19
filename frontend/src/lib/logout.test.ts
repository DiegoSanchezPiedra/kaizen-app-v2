import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: string[] = []
const api = vi.fn()
vi.mock('@/lib/api', () => ({ api }))
vi.mock('@/lib/session', () => ({ clearToken: (reason: string) => calls.push(`clearToken:${reason}`) }))

const { logout, queryClient } = await import('@/lib/logout')

function fakePush() {
  const sub = { endpoint: 'https://push.example/1', unsubscribe: async () => void calls.push('unsubscribe') }
  vi.stubGlobal('navigator', {
    serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription: async () => sub } }) },
  })
}

describe('cerrar sesión (ADR 0014)', () => {
  beforeEach(() => {
    calls.length = 0
    api.mockReset()
    vi.spyOn(queryClient, 'clear').mockImplementation(() => void calls.push('clear'))
    fakePush()
  })

  it('DELETE, unsubscribe, borrar el token y vaciar la caché, en ese orden', async () => {
    api.mockImplementation(async (path: string, opts: { method: string; body: unknown }) => {
      calls.push(`${opts.method} ${path}`)
      expect(opts.body).toEqual({ endpoint: 'https://push.example/1' })
    })
    await logout()
    expect(calls).toEqual(['DELETE /me/push-subscriptions', 'unsubscribe', 'clearToken:logout', 'clear'])
  })

  it('sigue si el DELETE falla', async () => {
    api.mockImplementation(async () => {
      calls.push('DELETE')
      throw new Error('network')
    })
    await logout()
    expect(calls).toEqual(['DELETE', 'unsubscribe', 'clearToken:logout', 'clear'])
  })

  it('caducada: sin DELETE (no hay token válido)', async () => {
    await logout({ expired: true })
    expect(api).not.toHaveBeenCalled()
    expect(calls).toEqual(['unsubscribe', 'clearToken:expired', 'clear'])
  })
})
