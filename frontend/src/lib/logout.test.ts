import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: string[] = []
const api = vi.fn()
vi.mock('@/lib/api', () => ({ api }))
let session: { token: string; role: string } | null = null
vi.mock('@/lib/session', () => ({ clearToken: (reason: string) => calls.push(`clearToken:${reason}`), getSession: () => session }))

const { checkRole, logout, queryClient } = await import('@/lib/logout')

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

describe('rol de la base distinto del del token (B19)', () => {
  beforeEach(() => {
    calls.length = 0
    api.mockReset()
    queryClient.removeQueries()
    vi.spyOn(queryClient, 'clear').mockImplementation(() => void calls.push('clear'))
    fakePush()
    session = { token: 't', role: 'alumno' }
  })

  it('cierra la sesión entera (con la baja del push) y con su motivo', async () => {
    api.mockImplementation(async (path: string, opts?: { method: string }) => {
      calls.push(`${opts?.method ?? 'GET'} ${path}`)
      return path === '/me' ? { role: 'profesor' } : undefined
    })
    await checkRole()
    expect(calls).toEqual(['GET /me', 'DELETE /me/push-subscriptions', 'unsubscribe', 'clearToken:role_changed', 'clear'])
  })

  it('mismo rol: no hace nada', async () => {
    api.mockResolvedValue({ role: 'alumno' })
    await checkRole()
    expect(calls).toEqual([])
  })

  it('si GET /me falla (sin red), no cierra la sesión', async () => {
    api.mockRejectedValue(new Error('network'))
    await checkRole()
    expect(calls).toEqual([])
  })
})
