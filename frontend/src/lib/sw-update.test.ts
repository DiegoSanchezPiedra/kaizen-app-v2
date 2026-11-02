import { describe, expect, it, vi } from 'vitest'
import { updateAndReload } from '@/lib/sw-update'

const worker = (state: string) => {
  const listeners: (() => void)[] = []
  return {
    state,
    postMessage: vi.fn(),
    addEventListener: (_: string, fn: () => void) => listeners.push(fn),
    fire(next: string) {
      this.state = next
      listeners.forEach((fn) => fn())
    },
  }
}
const deps = (reg: unknown) => {
  const d = { reload: vi.fn(), later: vi.fn(), onControllerChange: vi.fn(), getRegistration: () => Promise.resolve(reg as never) }
  return d
}

describe('actualizar y recargar desde la pantalla de error', () => {
  it('sin service worker, solo recarga', async () => {
    const d = deps(undefined)
    await updateAndReload(d)
    expect(d.reload).toHaveBeenCalledOnce()
  })
  it('sin versión nueva, recarga', async () => {
    const d = deps({ update: vi.fn(() => Promise.resolve()), waiting: null, installing: null })
    await updateAndReload(d)
    expect(d.reload).toHaveBeenCalledOnce()
  })
  it('con una versión esperando, la activa y recarga al cambiar de controlador', async () => {
    const w = worker('installed')
    const d = deps({ update: vi.fn(() => Promise.resolve()), waiting: w, installing: null })
    await updateAndReload(d)
    expect(w.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    expect(d.onControllerChange).toHaveBeenCalledWith(d.reload)
    expect(d.later).toHaveBeenCalledWith(d.reload, 5000)
    expect(d.reload).not.toHaveBeenCalled()
  })
  it('si aún se está instalando, la activa al terminar', async () => {
    const w = worker('installing')
    const d = deps({ update: vi.fn(() => Promise.resolve()), waiting: null, installing: w })
    await updateAndReload(d)
    expect(w.postMessage).not.toHaveBeenCalled()
    w.fire('installed')
    expect(w.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
  })
  it('si buscar la versión nueva falla (sin red), recarga igual', async () => {
    const d = deps({ update: vi.fn(() => Promise.reject(new Error('offline'))), waiting: null, installing: null })
    await updateAndReload(d)
    expect(d.reload).toHaveBeenCalledOnce()
  })
})
