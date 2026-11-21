import { describe, expect, it, vi } from 'vitest'
import { updateAndReload, watchForUpdates } from '@/lib/sw-update'

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

// La app instalada en el iPhone vuelve del segundo plano sin navegar, y el navegador solo busca sw.js al navegar.
describe('buscar versión nueva sin navegar', () => {
  const setup = (visible = true, waiting: unknown = null) => {
    let onVisible = () => {}
    let tick = () => {}
    const reg = { update: vi.fn(() => Promise.resolve()), waiting }
    const onWaiting = vi.fn()
    const d = {
      isVisible: () => visible,
      onVisible: (fn: () => void) => void (onVisible = fn),
      every: (fn: () => void, ms: number) => void ((tick = fn), expect(ms).toBe(15 * 60 * 1000)),
    }
    watchForUpdates(reg as never, onWaiting, d)
    return { reg, onWaiting, back: () => onVisible(), tick: () => tick(), hide: () => void (visible = false) }
  }
  it('al abrir la app ya busca sw.js, sin esperar a ningún temporizador', () => {
    const t = setup()
    expect(t.reg.update).toHaveBeenCalledOnce()
  })
  it('al volver a la app busca otra vez', () => {
    const t = setup()
    t.back()
    expect(t.reg.update).toHaveBeenCalledTimes(2)
  })
  it('cada 15 minutos con la app a la vista; oculta, no', () => {
    const t = setup()
    t.tick()
    t.hide()
    t.tick()
    t.back() // el evento de ocultarse tampoco busca
    expect(t.reg.update).toHaveBeenCalledTimes(2)
  })
  it('con una versión ya descargada, vuelve a enseñar el aviso (aunque se cerrara) en vez de buscar', () => {
    const t = setup(true, { state: 'installed' })
    t.back()
    expect(t.onWaiting).toHaveBeenCalledTimes(2)
    expect(t.reg.update).not.toHaveBeenCalled()
  })
  it('un fallo de red no rompe nada', () => {
    const t = setup()
    t.reg.update.mockReturnValueOnce(Promise.reject(new Error('offline')))
    expect(() => t.back()).not.toThrow()
  })
})
