// Salida de emergencia cuando la app revienta (pantalla de error del router): casi siempre es una versión vieja guardada
// por el service worker tras un despliegue, y el aviso «Actualizar» ya no se ve. Busca la versión nueva, la activa
// (SKIP_WAITING, como el aviso: ADR 0015, la activa quien toca el botón) y recarga. Sin service worker, solo recarga.
type Reg = Pick<ServiceWorkerRegistration, 'update' | 'waiting' | 'installing'>
type Deps = {
  getRegistration: () => Promise<Reg | undefined>
  onControllerChange: (fn: () => void) => void
  reload: () => void
  later: (fn: () => void, ms: number) => void
}

const browser = (): Deps => ({
  getRegistration: () => navigator.serviceWorker?.getRegistration() ?? Promise.resolve(undefined),
  onControllerChange: (fn) => navigator.serviceWorker?.addEventListener('controllerchange', fn, { once: true }),
  reload: () => location.reload(),
  later: (fn, ms) => void setTimeout(fn, ms),
})

export async function updateAndReload(d: Deps = browser()): Promise<void> {
  const reg = await d.getRegistration().catch(() => undefined)
  if (!reg) return d.reload()
  await reg.update().catch(() => {})
  const sw = reg.waiting ?? reg.installing
  if (!sw) return d.reload()
  d.onControllerChange(d.reload)
  const activate = () => sw.postMessage({ type: 'SKIP_WAITING' })
  if (sw.state === 'installed') activate()
  else sw.addEventListener('statechange', () => sw.state === 'installed' && activate())
  d.later(d.reload, 5000) // si el cambio de controlador no llega (Safari a veces), se recarga igual
}

// El navegador solo busca sw.js al navegar, y la app instalada en el iPhone vuelve del segundo plano sin navegar: sin esto, el
// aviso «Actualizar» tardaba o no salía. Busca al abrir, al volver a la app (visibilitychange y pageshow, que iOS da al
// restaurarla) y cada 15 minutos con ella a la vista. Si ya hay una versión descargada esperando, `onWaiting` vuelve a
// enseñar el aviso (aunque se cerrara); se activa con el botón (ADR 0015).
type WatchDeps = {
  isVisible: () => boolean
  onVisible: (fn: () => void) => void
  every: (fn: () => void, ms: number) => void
}
const page = (): WatchDeps => ({
  isVisible: () => document.visibilityState === 'visible',
  onVisible: (fn) => {
    document.addEventListener('visibilitychange', fn)
    window.addEventListener('pageshow', fn)
  },
  every: (fn, ms) => void setInterval(fn, ms),
})

export function watchForUpdates(
  reg: Pick<ServiceWorkerRegistration, 'update' | 'waiting'>,
  onWaiting: () => void,
  d: WatchDeps = page(),
): void {
  const check = () => {
    if (!d.isVisible()) return
    if (reg.waiting) return onWaiting()
    void reg.update().catch(() => {})
  }
  check()
  d.onVisible(check)
  d.every(check, 15 * 60 * 1000)
}
